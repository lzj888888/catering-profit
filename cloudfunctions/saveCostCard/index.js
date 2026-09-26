// cloudfunctions/saveCostCard/index.js —— 批次 3 · POC2 成本卡保存（Controller 层 · 写）
//
// 分层归属：
//   Controller：鉴权中间件（批次 0）→ 校验/清洗 → 读原料（DataAdapter，软删自动排除）
//               → 构建快照明细 + 循环预检 + 成本计算（Service 纯函数）
//               → 只 INSERT 新版本（shop_cost_card + shop_cost_card_line 明细行含净料单位成本快照）
//               → 模式 B 自动生成/更新虚拟半成品原料（shop_material，is_virtual=true）。
//
// ⚠️ 铁律：
//   · 成本卡主表**只 INSERT 不 UPDATE**（改 = 另存新版本；版本号自然数递增，经 card_code 关联历史版本）。
//     本实现不翻转 is_latest（查询一律取 card_code 下版本号最大者），真正做到只增不改。
//   · 明细行必须**完整存储当时的净料单位成本快照值**，不得仅存 material_id 做关联（快照隔离本质）。
//   · 循环引用：保存半成品（模式 B）前用 detectCycle 同款 DFS 预检，命中抛 BOM_CYCLE_DETECTED、**数据不入库**。
//   · 幂等：同一 shop_id + client_request_id 重复调用不重复落库，直接返回首次结果。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, genId } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { buildSnapshotLines, calcCostCard, wouldCreateCycle, judgeCardQuota, netUnitCostWan } = require('./service');
const { validateInput } = require('./validate');

// 🔒 R73：重放形态的幂等实现已收回单源 common/idempotency.js::findPriorResult
// （此前本文件内联了一份 getIdempotent，与单源构成"同一语义两份实现"）。
// 键格式同样由单源 shopKey() 统一产出，本文件不再自己拼字符串。

// 构建「虚拟半成品 → 其引用的虚拟半成品 id[]」映射（判环用）。
// 遍历该店虚拟原料，找到每个虚拟对应源半成品成本卡（parent_card_id 关联）的最新版本，收集其引用到的虚拟 id。
async function loadEdgesFromVirtual(da, shopId) {
  const virtRes = await da.list('shop_material', { shop_id: shopId, is_virtual: true });
  const virtuals = (virtRes && virtRes.data) || [];
  const byCardCode = new Map(); // card_code -> 本卡对应的虚拟物料 id
  for (const v of virtuals) {
    if (v.parent_card_id) byCardCode.set(String(v.parent_card_id), String(v.material_id || v.id));
  }
  const edges = new Map(); // virtualId -> [referenced virtualId...]
  // 一次拉全该店所有成本卡，内存里去重按 card_code 取最新版本
  const cardsRes = await da.list('shop_cost_card', { shop_id: shopId });
  const latestByCode = new Map();
  for (const c of (cardsRes && cardsRes.data) || []) {
    const cc = c.card_code;
    if (!cc) continue;
    const cur = latestByCode.get(cc);
    if (!cur || (c.version || 0) > (cur.version || 0)) latestByCode.set(cc, c);
  }
  // 对每个最新半成品卡，读它的明细行，找引用到的虚拟 id
  for (const [cc, card] of latestByCode) {
    if (card.calc_mode !== 2) continue; // 仅半成品（模式 B）
    const virtualId = byCardCode.get(cc);
    if (!virtualId) continue;
    const out = [];
    try {
      // ⚠️ 明细行的软删过滤也走 DataAdapter（统一注入 is_deleted=false）
      const lineRes = await da.list('shop_cost_card_line', { shop_id: shopId, cost_card_row_id: card.id });
      for (const ln of ((lineRes && lineRes.data) || [])) {
        // 该行引用的原料是否在本店的虚拟原料集合里
        if (byCardCode.has(ln.material_id) || virtuals.some((v) => String(v.material_id || v.id) === String(ln.material_id))) {
          if (String(ln.material_id) !== virtualId) out.push(String(ln.material_id));
        }
      }
    } catch (e) { /* 明细读取失败不阻断主流程 */ }
    edges.set(virtualId, out);
  }
  return edges;
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. 幂等预检 =====
  const da = makeAdapter(db);
  const clientRequestId = v.input.client_request_id;
  if (clientRequestId) {
    const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
    if (prior) return ok(prior); // 重复调用：直接返回首次结果，不重复落库
  }

  // ===== 3.5. M3.7（批次 P0）软删分支：软删该 card_code 所有版本（is_deleted=true，历史版本不物理删）=====
  if (v.card._delete) {
    const cardsRes = await da.listIncludingDeleted('shop_cost_card', { shop_id: shopId, card_code: v.card.card_code });
    const versions = (cardsRes && cardsRes.data) || [];
    if (versions.length === 0) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `成本卡 ${v.card.card_code} 不存在`);
    for (const c of versions) {
      await da.softDelete('shop_cost_card', c._id || c.id, userId);
    }
    return ok({ shop_id: shopId, card_code: v.card.card_code, deleted: true, versions: versions.length, client_request_id: clientRequestId || '' });
  }

  // ===== 4. 读本卡引用的原料（仅 input_type=1 行；input_type=2 临时手工行不查档案）=====
  const card = v.card;
  const materialsById = new Map();
  let missing = null;
  for (const ln of card.lines) {
    if (ln.input_type === 2) continue;               // 手工行无 material_id，不查档案
    if (materialsById.has(String(ln.material_id))) continue;
    const mat = await da.get('shop_material', String(ln.material_id));
    if (!mat) { missing = ln.material_id; break; }
    materialsById.set(String(ln.material_id), mat);
  }
  if (missing) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `引用的原料 ${missing} 不存在或已软删`);

  // ===== 5. 构建快照明细（含净料单位成本快照）+ 收集引用的虚拟 id =====
  // M3.3（批次 P0）：input_type=1 行走 buildSnapshotLines（从原料档案取快照）；
  //   input_type=2 行用 netUnitCostWan(单价分, 换算=1, 出成率) 就地算净料单位成本（不查档案、不落档案）。
  //   ⚠️ 不改 buildSnapshotLines / netUnitCostWan 两具名函数，仅在 Controller 层分流合并。
  let snap;
  try {
    snap = buildSnapshotLines(card.lines.filter((l) => l.input_type !== 2), materialsById);
  } catch (e) {
    if (e && e.code) return fail(e.code, e.message);
    return fail(ERROR_CODES.SYSTEM_ERROR, e && e.message);
  }
  // 手工行快照（按 card.lines 原始顺序与档案行交错合并，保持 sort_order 稳定）
  const manualLines = [];
  for (const ln of card.lines) {
    if (ln.input_type !== 2) continue;
    // 净料单位成本：有 net_unit_cost 快照（复制/回填）直接用；否则 netUnitCostWan(单价分, 1, 出成率) 算
    const nuc = (ln.net_unit_cost !== undefined)
      ? ln.net_unit_cost
      : netUnitCostWan(ln.unit_price_fen, 1, ln.yield_rate);
    manualLines.push({
      material_id: '',
      material_name: ln.name,
      quantity: ln.quantity,
      net_unit_cost: nuc,
      input_type: 2,
      // 任务1（S0）：手工行无原料可查，5 字段按缺省值；yield_rate 有真值就存真值
      brand_spec: '',
      purchase_unit: '',
      purchase_price: 0,
      convert_factor: 0,
      yield_rate: Number(ln.yield_rate) || 0,
    });
  }
  const mergedLines = [];
  let archiveCursor = 0;
  for (const ln of card.lines) {
    if (ln.input_type === 2) {
      mergedLines.push(manualLines.shift());
    } else {
      mergedLines.push(Object.assign({}, snap.lines[archiveCursor++], { input_type: 1 }));
    }
  }
  snap.lines = mergedLines;

  // ===== 6. 循环引用预检（仅半成品"生产/引用半成品"参与；命中即拒、不入库）=====
  if (card.mode === 'B') {
    // 本半成品的虚拟输出 id（编辑时用既有虚拟，新建用临时 id）
    let outputVirtualId = null;
    if (card.card_code) {
      const virtRes = await da.list('shop_material', { shop_id: shopId, is_virtual: true });
      for (const v of ((virtRes && virtRes.data) || [])) {
        if (String(v.parent_card_id) === String(card.card_code)) { outputVirtualId = String(v.material_id || v.id); break; }
      }
    }
    if (!outputVirtualId) outputVirtualId = 'tmp_new_' + genId('vm_');
    const edges = await loadEdgesFromVirtual(da, shopId);
    if (wouldCreateCycle(outputVirtualId, snap.childVirtualIds, edges)) {
      return fail(ERROR_CODES.BOM_CYCLE_DETECTED, '检测到半成品循环引用（A→B→A），禁止保存，数据不入库');
    }
  }

  // ===== 7. 计算成本（Service 纯引擎，口径与 calcBom 完全一致）=====
  let result;
  try {
    result = calcCostCard({
      mode: card.mode,
      lines: snap.lines,
      auxFen: card.auxFen,
      lossPct: card.lossPct,
      batchOutput: card.batchOutput,
      priceFen: card.priceFen,
      targetMarginPct: card.targetMarginPct,
    });
  } catch (e) {
    // R81：引擎对非法 mode 抛 INVALID_PARAM（透传为响亮失败），其余按系统错误兜底
    if (e && e.code) return fail(e.code, e.msg || e.message);
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '成本计算失败');
  }

  // ===== 8. 确定 version（只 INSERT，不 UPDATE；最新 = 该 card_code 版本号最大者）=====
  let cardCode = card.card_code;
  let nextVersion = 1;
  const now = nowUtc();
  if (cardCode) {
    const existRes = await da.list('shop_cost_card', { shop_id: shopId, card_code: cardCode });
    for (const c of ((existRes && existRes.data) || [])) {
      if ((c.version || 0) >= nextVersion) nextVersion = (c.version || 0) + 1;
    }
  } else {
    cardCode = cardCode || genId('cc_'); // 新卡：新 card_code，version=1
  }

  // ===== 8.5. M3.22（批次 A1）写侧真拦截：免费配额/硬上限 =====
  // 只有**新逻辑卡**才占额度（card_code 为空 = 新卡；或该 shop_id 下该 card_code 无在库版本 = version=1）；
  // 已存在卡号的「追加新版本」（version≥2）不占额度。
  // 维度 = shop_id（与 checkQuota/index.js 成本卡维度同口径：card_code 去重、版本不计、软删由 DataAdapter 过滤）。
  if (!card.card_code || nextVersion === 1) {
    let limits = null;
    try {
      const fpRes = await db.collection('feature_permissions').where({ plan_id: 'plan_free' }).limit(1).get();
      const fp = fpRes && fpRes.data && fpRes.data[0];
      limits = fp && fp.limits;
    } catch (e) { /* 读配置异常 → 视为缺失，走下方 SYSTEM_ERROR 响亮失败 */ }
    if (!limits || typeof limits !== 'object') {
      return fail(ERROR_CODES.SYSTEM_ERROR, '配额配置缺失（plan_id=plan_free）');
    }
    // M3.28（批次 Q2）：同上口径（只计可算数，草稿不占额度；`!== 'draft'` 兼容无该字段的存量行）
    const cardsRes = await da.list('shop_cost_card', { shop_id: shopId });
    const codes = new Set();
    for (const c of ((cardsRes && cardsRes.data) || [])) {
      if (!c.card_code) continue;
      if (c.calc_status === 'draft') continue;
      codes.add(c.card_code);
    }
    const activeCount = codes.size;
    let verdict;
    try {
      verdict = judgeCardQuota(limits, activeCount);
    } catch (e) {
      return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '配额判定失败');
    }
    if (verdict.hit_hard_limit) {
      return fail(ERROR_CODES.HARD_CAP_EXCEEDED);   // 文案由前端 msgOf(code) 映射（禁硬编码中文）
    }
    if (verdict.hit_free_limit) {
      return fail(ERROR_CODES.FREE_LIMIT_EXCEEDED); // 文案由前端 msgOf(code) 映射（禁硬编码中文）
    }
  }

  const createdBy = userId;
  const cardDoc = {
    card_code: cardCode,
    version: nextVersion,
    shop_id: shopId,
    // M3.28（批次 Q2）：可算状态位。本函数是"先算后插"，故所有经此落库的行必然是 'calculated'。
    //   'draft' 目前**无任何生产者**（尚无"只存不算"的入口），此字段是为将来草稿态预留的空间 + 计数口径的锚点。
    //   ⚠️ 计数侧按 `!== 'draft'` 兼容存量（见 checkQuota/index.js 注释），新增也必须显式赋值，不可依赖默认值。
    calc_status: 'calculated',
    name: card.name,
    category: card.category || '',
    tags: card.tags || '',
    calc_mode: card.mode === 'B' ? 2 : 1,
    batch_output: card.mode === 'B' ? card.batchOutput : null,
    loss_rate: card.lossPct,
    aux_cost: card.auxFen,
    price_list: card.priceFen,
    price_promo: card.activityPriceFen || 0,   // M3.3：活动特价（分，0=未设）
    total_cost: result.unit_cost_fen, // 落库必须为整数分（INT）
    material_total_fen: result.material_total_fen,
    gross_profit_fen: result.gross_profit_fen,
    gross_margin_pct: result.gross_margin_pct,
    reverse_price_fen: result.reverse_price_fen,
    parent_card_id: card.parent_card_code || '',
    created_by: createdBy,
    client_request_id: clientRequestId || '',
  };

  // ===== 9. 落库（只 INSERT）=====
  const cardInsert = await da.insert('shop_cost_card', cardDoc);
  const cardRowId = cardInsert && cardInsert._id;
  const lineRows = [];
  if (cardRowId) {
    for (let i = 0; i < snap.lines.length; i++) {
      const ln = snap.lines[i];
      await da.insert('shop_cost_card_line', {
        cost_card_row_id: cardRowId,
        card_code: cardCode,
        card_version: nextVersion,
        shop_id: shopId,
        material_id: ln.material_id,
        material_name: ln.material_name,     // 快照：名称
        quantity: ln.quantity,               // 用量（g 或 份）
        net_unit_cost: ln.net_unit_cost,     // 快照：净料单位成本（万分整数）★快照隔离本体
        // 任务1（S0）：快照补 5 字段（brand_spec/purchase_unit/purchase_price 分/convert_factor/yield_rate）
        brand_spec: ln.brand_spec || '',
        purchase_unit: ln.purchase_unit || '',
        purchase_price: ln.purchase_price || 0,
        convert_factor: ln.convert_factor || 0,
        yield_rate: ln.yield_rate || 0,
        line_net_cost: result.lines[i].line_net_cost_fen,
        input_type: ln.input_type || 1,      // M3.3：按行真实值（1=档案 / 2=临时手工）
        sort_order: i + 1,
      });
      lineRows.push({
        material_id: ln.material_id,
        net_unit_cost: ln.net_unit_cost,
        line_net_cost_fen: result.lines[i].line_net_cost_fen,
      });
    }
  }

  // ===== 10. 模式 B：自动生成 / 更新虚拟半成品原料（shop_material，is_virtual=true）=====
  let virtualMaterialId = null;
  if (card.mode === 'B') {
    // 既有虚拟（上次同卡）→ 更新其"每份成本"；否则新建
    let vm = null;
    if (cardCode) {
      const virtRes = await da.list('shop_material', { shop_id: shopId, is_virtual: true });
      vm = ((virtRes && virtRes.data) || []).find((x) => String(x.parent_card_id) === String(cardCode)) || null;
    }
    const unitWan = Math.round(result.unit_cost_fen * 100); // 单份半成品成本：分→万分（1分=100万分）
    if (vm) {
      // 🔴 round116 同族修复：`vm` 来自 `da.list()`（含 `_id`）⇒ 必须优先用 `_id`；
      //   原写法用业务 `id` ⇒ 真云静默 0 行。
      await db.collection('shop_material').doc(vm._id || vm.id || vm.material_id).update({
        data: {
          name: card.name,
          purchase_unit: '份',
          purchase_price: result.unit_cost_fen, // 每份成本（分整数）
          convert_factor: 1,
          net_unit_cost: unitWan,               // 每份成本（万分）
          updated_at: now,
          is_deleted: false,
        },
      });
      virtualMaterialId = String(vm.material_id || vm.id);
    } else {
      virtualMaterialId = genId('vm_');
      await da.insert('shop_material', {
        material_id: virtualMaterialId,
        id: virtualMaterialId,
        shop_id: shopId,
        name: card.name,
        brand_spec: '半成品',
        purchase_unit: '份',
        purchase_price: result.unit_cost_fen,
        convert_factor: 1,
        yield_rate: 100,
        net_unit_cost: unitWan,
        is_virtual: true,
        parent_card_id: cardCode,
      });
    }
  }

  const out = {
    shop_id: shopId,
    card_code: cardCode,
    version: nextVersion,
    card_row_id: cardRowId,
    total_cost_fen: result.unit_cost_fen,      // 整数分锚点
    material_total_fen: result.material_total_fen,
    gross_profit_fen: result.gross_profit_fen,
    gross_margin_pct: result.gross_margin_pct,
    reverse_price_fen: result.reverse_price_fen,
    lines: lineRows,
    virtual_material_id: virtualMaterialId,
    client_request_id: clientRequestId || '',
  };

  // 幂等登记：键必须走单源 shopKey()，与上面 findPriorResult 的**查重键同源** ——
  // 两处若各自拼字符串，就会出现「登记了却查不到」的静默失效（幂等看着有、实际没有）。
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'SAVE_COST_CARD',
        operator_type: 'user',
        operator_id: userId,
        shop_id: shopId,
        after_data: out,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }

  return ok(out);
};