// cloudfunctions/syncCostCard/index.js —— 批次 3 · POC2 成本卡「同步至原料最新价格」（Controller 层 · 写）
//
// 行为（M3 §3.4 规则 4）：用原料档案**当前**最新净料单位成本，对指定 card_code 的**最新版本**卡重新计算，
//   **生成新版本**（version+1），旧版本保留可查。引导前提：改原料价后，旧卡成本不变（快照隔离）；
//   只有手动点本函数才更新，且产生新版本。
//
// ⚠️ 与 saveCostCard 相同：成本卡主表**只 INSERT 不 UPDATE**；明细行快照明细重新取"当前原料净料单位成本"；
//   模式 B 半成品要同步其虚拟原料的"每份成本"，使新创建的引用卡拿到新价（已保存的引用卡不受影响，快照隔离）。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, genId } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { buildComboLines, judgeComboRef } = common.comboDerive;   // M3.16 套餐（派生层单源）
const { rebuildSnapshotLines, calcCostCard, cardParamFromDoc } = require('./service');
const { validateInput } = require('./validate');

// 🔒 R213 写限流（批次 0 §2.2.5 · openid 维度 60 次/分钟）
//   单源 cloudfunctions/common/rateLimit.js —— 已挂在聚合入口 common.rateLimit 上（sync_common 派生出
//   cx_rateLimit.js，本目录内即有），故本次接线**零 common 改动**、无需重跑 sync_common。
//   ⚠️ store 必须放**模块级单例**：若写在 exports.main 里 `makeRateLimiter(new Map())`，每次调用都是
//      新桶 ⇒ 计数永远为 1 ⇒ 限流恒不触发（零件齐全却等于没接线，正是 R212 挖出的那个盲区）。
//      守卫 tools/check_rate_limit_params.js::A8 把这一点钉死（含"不得在 main 内建 store"的负判据）。
const RATE_STORE = new Map();
const rateLimitCheck = common.rateLimit.makeRateLimiter(RATE_STORE);

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
  const cardCode = v.card_code;
  const clientRequestId = v.input.client_request_id;

  // ===== 2.4 写限流（R213）=====
  //   dry_run 是「影响面预览」（M3.19）—— 只读、零写库、不产生新版本 ⇒ **不计入写限额**，
  //   否则用户反复预览会被误拒。只有真正落库的重算才计数。
  if (!v.dry_run) {
    const rl = await rateLimitCheck(userId);
    if (rl.limited) return fail(rl.code);
  }

  const da = makeAdapter(db);

  // ===== 2.5. M3.19（批次 E）：dry_run 影响面预览（🔴 只读、零写库）=====
  //   语义：原料改价后，列出所有「用到了该原料」的成本卡，按原料**最新价**重建（同一份 rebuildSnapshotLines）
  //   重算新成本/新毛利率，并标出是否跌破该业态毛利率参考带下限。**绝不 insert/update/remove，不生成新版本。**
  if (v.dry_run) {
    const materialId = v.material_id;
    // 业态参考带下限（shop.biz_type；未设置回落 dining，与 indicatorRef.bandOf 同口径）
    let bizType = '';
    try {
      const shopDoc = await da.get('shop', shopId);
      bizType = (shopDoc && shopDoc.biz_type) || '';
    } catch (e) { bizType = ''; }
    const bandFloor = (common.indicatorRef.BANDS[bizType] || common.indicatorRef.BANDS.dining).grossMargin[0];

    // 读全部卡（取 card_code 最新版本；套餐 card_type===3 不含原料行，跳过）
    const allRes = await da.listAll('shop_cost_card', { shop_id: shopId });
    const latestByCode = new Map();
    for (const c of (allRes && allRes.data) || []) {
      if (!c.card_code || c.card_type === 3) continue;
      const cur = latestByCode.get(c.card_code);
      if (!cur || (c.version || 0) > (cur.version || 0)) latestByCode.set(c.card_code, c);
    }

    const affected = [];
    for (const [cc, card] of latestByCode) {
      const lineRes = await da.list('shop_cost_card_line', { shop_id: shopId, cost_card_row_id: card._id });
      const lines = (lineRes && lineRes.data) || [];
      const uses = lines.some((l) => l.input_type !== 2 && String(l.material_id) === String(materialId));
      if (!uses) continue;

      // 读这些原料的**当前**净料成本（含改价后的目标原料）
      const materialsById = new Map();
      for (const ln of lines) {
        if (ln.input_type === 2 || !ln.material_id) continue;
        if (materialsById.has(String(ln.material_id))) continue;
        const mat = await da.get('shop_material', String(ln.material_id));
        if (mat) materialsById.set(String(ln.material_id), mat);
      }

      // 用同一份 rebuildSnapshotLines 按最新价重建（引擎只调用不修改）
      let merged;
      try {
        const rebuilt = rebuildSnapshotLines(lines.filter((l) => l.input_type !== 2), materialsById);
        const manual = lines.filter((l) => l.input_type === 2).map((l) => ({
          material_id: '', material_name: l.material_name || '', quantity: l.quantity || 0,
          net_unit_cost: l.net_unit_cost || 0, input_type: 2,
          brand_spec: l.brand_spec || '', purchase_unit: l.purchase_unit || '',
          purchase_price: l.purchase_price || 0, convert_factor: l.convert_factor || 0,
          yield_rate: l.yield_rate || 0,
        }));
        const out = [];
        let cursor = 0;
        for (const ln of lines) {
          if (ln.input_type === 2) out.push(manual.shift());
          else out.push(Object.assign({}, rebuilt[cursor++], { input_type: 1 }));
        }
        merged = out;
      } catch (e) { continue; }

      const p = cardParamFromDoc(card);
      const newResult = calcCostCard({ mode: p.mode, lines: merged, auxFen: p.auxFen, lossPct: p.lossPct, batchOutput: p.batchOutput, priceFen: p.priceFen });

      // 🔴 R181j 门禁方验收修正：**未挂牌价 ⇒ 毛利率不可算**，一律回 null（不是 0）。
      //   理由① 与同批 `utils/reconDerive.js` 的既定口径一致（该处明写「priceFen === 0 ⇒ { pct: null, reason: 'no_price' }，不许返回 0」），
      //          同批次内两处对「无价」必须同口径；
      //   理由② 前端 `pages/metrics/impact.js:49-50` 已按 `xx != null ? toFixed(1) : '—'` 写好，后端若恒返 0，该分支即死代码；
      //   理由③ priceFen = 0 时 `calcCostCard` 返回 gross_margin_pct = **0**（实测），`0 < bandFloor` 恒真
      //          ⇒ 会把「还没定价的卡」误标成「已跌破业态参考带下限」并在 `impact.wxml:20` 渲染红字警告。
      //   ⚠️ priceFen = 0 是**合法值**（`saveCostCard/validate.js:116` 只要求「非负」），该状态真实可达 ⇒ 不是理论缺陷。
      const noPrice = !(Number(p.priceFen) > 0);

      // 旧毛利率：库内 gross_margin_pct 有则用；否则用旧行快照算一次（同一份 calcCostCard）
      let oldGross = (card.gross_margin_pct != null && card.gross_margin_pct !== undefined) ? card.gross_margin_pct : null;
      if (oldGross == null) {
        const oldLines = lines.map((l) => ({ quantity: Number(l.quantity) || 0, net_unit_cost: Number(l.net_unit_cost) || 0 }));
        const oldResult = calcCostCard({ mode: p.mode, lines: oldLines, auxFen: p.auxFen, lossPct: p.lossPct, batchOutput: p.batchOutput, priceFen: p.priceFen });
        oldGross = oldResult.gross_margin_pct;
      }

      affected.push({
        card_code: cc,
        name: card.name || '',
        price_fen: card.price_list != null ? card.price_list : 0,
        old_total_cost_fen: card.total_cost != null ? card.total_cost : 0,
        new_total_cost_fen: newResult.unit_cost_fen,
        no_price: noPrice,
        old_gross_margin_pct: noPrice ? null : oldGross,
        new_gross_margin_pct: noPrice ? null : newResult.gross_margin_pct,
        band_floor_pct: bandFloor,
        below_band: !noPrice && newResult.gross_margin_pct < bandFloor,
      });
    }

    return ok({
      shop_id: shopId,
      material_id: materialId,
      dry_run: true,
      scanned_cards: latestByCode.size,
      affected,
      client_request_id: clientRequestId || '',
    });
  }

  // ===== 幂等预检（契约 §10：syncCostCard = user+shop+幂等）=====
  // 🔒 R73：本函数此前**把 client_request_id 读进变量却从未使用**（死读，纯回显）—— 而第 8 步每次都
  //   INSERT 新版本，天然**非**幂等：重复提交（网络重试 / 双击）会让版本号连跳（1→2→3），
  //   且新增的几版内容完全相同，属脏数据。
  //   命中即返回首次结果、不再落库。空 client_request_id ⇒ 单源返回 null ⇒ 不做约束（守卫已登记在案）。
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  // ===== 3. 找该 card_code 的最新版本卡 =====
  const cardsRes = await da.list('shop_cost_card', { shop_id: shopId, card_code: cardCode });
  const versions = (cardsRes && cardsRes.data) || [];
  if (versions.length === 0) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `成本卡 ${cardCode} 不存在或已软删`);
  let latestCard = versions[0];
  for (const c of versions) if ((c.version || 0) > (latestCard.version || 0)) latestCard = c;

  // ===== 4. 读该版本的现有明细行（material_id + quantity）=====
  const lineRes = await da.list('shop_cost_card_line', { shop_id: shopId, cost_card_row_id: latestCard._id });
  const existingLines = (lineRes && lineRes.data) || [];
  if (existingLines.length === 0) return fail(ERROR_CODES.INVALID_PARAM, '该成本卡没有明细行，无法同步');

  // ===== 4.5. M3.16 套餐：付费墙 + 按子卡**最新版本**重建（锁版本 → 升到最新）=====
  const isCombo = latestCard.card_type === 3;
  let newLines;
  if (isCombo) {
    const unlocked = await common.hasFeature(db, userId, 'm3_combo');
    if (!unlocked) return fail(ERROR_CODES.FEATURE_LOCKED);

    const comboSubCards = [];
    for (const ln of existingLines) {
      if (ln.line_type !== 2 || !ln.sub_card_ref) continue;
      const subRes = await da.list('shop_cost_card', { shop_id: shopId, card_code: ln.sub_card_ref });
      const subVers = (subRes && subRes.data) || [];
      let sub = null;
      for (const c of subVers) if ((c.version || 0) > (sub ? (sub.version || 0) : -1)) sub = c;
      const verdict = judgeComboRef(ln, sub);
      if (!verdict.ok) {
        return fail(ERROR_CODES[verdict.code] || verdict.code,
          verdict.code === 'COMBO_NEST_NOT_ALLOWED' ? '套餐里不能引用另一个套餐' : '引用的菜品版本已失效，请重新选择');
      }
      comboSubCards.push({
        card_code: sub.card_code,
        name: sub.name,
        unit_cost_fen: sub.total_cost || 0,   // 子卡**最新版本**成本（分）
        quantity: ln.quantity,
        version: sub.version,
      });
    }
    if (comboSubCards.length === 0) return fail(ERROR_CODES.INVALID_PARAM, '套餐没有子卡行，无法同步');
    // 入参变换：子卡最新成本(分) × 100 → 万分 net_unit_cost，喂同一个 calcCostCard
    newLines = buildComboLines(comboSubCards);
  }

  // ===== 5. 读这些原料的**当前**净料单位成本快照 =====
  const materialsById = new Map();
  if (!isCombo) {
    for (const ln of existingLines) {
      if (!ln.material_id || materialsById.has(String(ln.material_id))) continue;
      const mat = await da.get('shop_material', String(ln.material_id));
      if (!mat) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `原料 ${ln.material_id} 不存在或已软删，无法同步`);
      materialsById.set(String(ln.material_id), mat);
    }
  }

  // ===== 6. 用最新价重建快照明细 + 重算成本 =====
  // M3.3（批次 P0）：input_type=1 行走 rebuildSnapshotLines（取原料**最新**价重算）；
  //   input_type=2 临时手工行**原样保留快照**（不随原料价变、不查档案）。
  //   ⚠️ 不改 rebuildSnapshotLines 具名函数，仅在 Controller 层分流合并。
  //   M3.16：套餐已在 4.5 走 buildComboLines 重建（跳过原料分支）。
  if (!isCombo) {
    let newLinesTmp;
    try {
      newLinesTmp = rebuildSnapshotLines(existingLines.filter((l) => l.input_type !== 2), materialsById);
    } catch (e) {
      return fail(e.code || ERROR_CODES.SYSTEM_ERROR, e.message);
    }
    // 手工行原样快照（material_id 空、保留原 net_unit_cost）
    const manualLines = existingLines.filter((l) => l.input_type === 2).map((l) => ({
      material_id: '',
      material_name: l.material_name || '',
      quantity: l.quantity || 0,
      net_unit_cost: l.net_unit_cost || 0,
      input_type: 2,
      // 任务1（S0）：手工行无原料可查，5 字段按缺省值；yield_rate 有真值（S0 后保存的）就存真值
      brand_spec: l.brand_spec || '',
      purchase_unit: l.purchase_unit || '',
      purchase_price: l.purchase_price || 0,
      convert_factor: l.convert_factor || 0,
      yield_rate: l.yield_rate || 0,
    }));
    const mergedNewLines = [];
    let archiveCursor = 0;
    for (const ln of existingLines) {
      if (ln.input_type === 2) {
        mergedNewLines.push(manualLines.shift());
      } else {
        mergedNewLines.push(Object.assign({}, newLinesTmp[archiveCursor++], { input_type: 1 }));
      }
    }
    newLines = mergedNewLines;
  }
  const p = cardParamFromDoc(latestCard);
  if (isCombo) p.mode = 'A';   // 套餐固定按份聚合
  let result;
  try {
    result = calcCostCard({
      mode: p.mode,
      lines: newLines,
      auxFen: p.auxFen,
      lossPct: p.lossPct,
      batchOutput: p.batchOutput,
      priceFen: p.priceFen,
    });
  } catch (e) {
    // R81：引擎对非法 mode 抛 INVALID_PARAM（透传为响亮失败），其余按系统错误兜底
    if (e && e.code) return fail(e.code, e.msg || e.message);
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '成本计算失败');
  }

  // ===== 7. 计算新版本号（该 card_code 最大版本 + 1）=====
  let nextVersion = 1;
  for (const c of versions) if ((c.version || 0) >= nextVersion) nextVersion = (c.version || 0) + 1;

  const now = nowUtc();
  const cardDoc = {
    card_code: cardCode,
    version: nextVersion,
    shop_id: shopId,
    name: latestCard.name || '',
    category: latestCard.category || '',
    tags: latestCard.tags || '',
    // M3.16（批次 C）：卡片类型随版本透传（套餐同步后仍是套餐）。
    card_type: latestCard.card_type === 3 ? 3 : 1,
    calc_mode: latestCard.calc_mode === 2 ? 2 : 1,
    batch_output: latestCard.calc_mode === 2 ? p.batchOutput : null,
    loss_rate: p.lossPct,
    aux_cost: p.auxFen,
    price_list: p.priceFen,
    total_cost: result.unit_cost_fen,   // 整数分
    material_total_fen: result.material_total_fen,
    gross_profit_fen: result.gross_profit_fen,
    gross_margin_pct: result.gross_margin_pct,
    reverse_price_fen: result.reverse_price_fen,
    parent_card_id: latestCard.id || '',
    created_by: userId,
    client_request_id: clientRequestId || '',
  };

  // ===== 8. 只 INSERT 新版本 + 明细行 =====
  const insert = await da.insert('shop_cost_card', cardDoc);
  const cardRowId = insert && insert._id;
  const lineRows = [];
  if (cardRowId) {
    for (let i = 0; i < result.lines.length; i++) {
      const ln = newLines[i];
      await da.insert('shop_cost_card_line', {
        cost_card_row_id: cardRowId,
        card_code: cardCode,
        card_version: nextVersion,
        shop_id: shopId,
        material_id: ln.material_id,
        material_name: ln.material_name,
        quantity: ln.quantity,
        net_unit_cost: ln.net_unit_cost,   // 快照：原料最新净料单位成本
        // 任务1（S0）：快照补 5 字段
        brand_spec: ln.brand_spec || '',
        purchase_unit: ln.purchase_unit || '',
        purchase_price: ln.purchase_price || 0,
        convert_factor: ln.convert_factor || 0,
        yield_rate: ln.yield_rate || 0,
        line_net_cost: result.lines[i].line_net_cost_fen,
        input_type: ln.input_type || 1,    // M3.3：按行真实值（1=档案 / 2=临时手工）
        // M3.16（批次 C）：套餐子卡行（line_type=2）—— sub_card_ref + sub_version（同步后升到子卡最新版本）。
        line_type: ln.line_type || 1,
        sub_card_ref: ln.sub_card_ref || '',
        sub_version: ln.sub_version || 0,
        sort_order: i + 1,
      });
      lineRows.push({ material_id: ln.material_id, net_unit_cost: ln.net_unit_cost, line_net_cost_fen: result.lines[i].line_net_cost_fen });
    }
  }

  // ===== 9. 模式 B：同步虚拟半成品原料的"每份成本" =====
  let virtualMaterialId = null;
  if (latestCard.calc_mode === 2) {
    const virtRes = await da.list('shop_material', { shop_id: shopId, is_virtual: true });
    const vm = ((virtRes && virtRes.data) || []).find((x) => String(x.parent_card_id) === String(cardCode)) || null;
    const unitWan = Math.round(result.unit_cost_fen * 100);
    if (vm) {
      // 🔴 round116 同族修复：同 saveCostCard —— `_id` 优先（原写法真云静默 0 行）。
      await db.collection('shop_material').doc(vm._id || vm.id || vm.material_id).update({
        data: { purchase_price: result.unit_cost_fen, net_unit_cost: unitWan, updated_at: now },
      });
      virtualMaterialId = String(vm.material_id || vm.id);
    }
    // 若尚无虚拟（理论上已有），不新建——保持与 saveCostCard 一致即可
  }

  const out = {
    shop_id: shopId,
    card_code: cardCode,
    new_version: nextVersion,
    old_version: latestCard.version || (nextVersion - 1),
    total_cost_fen: result.unit_cost_fen,
    material_total_fen: result.material_total_fen,
    gross_profit_fen: result.gross_profit_fen,
    gross_margin_pct: result.gross_margin_pct,
    reverse_price_fen: result.reverse_price_fen,
    lines: lineRows,
    virtual_material_id: virtualMaterialId,
    client_request_id: clientRequestId || '',
  };

  // ===== 10. 幂等登记（键与上面查重键**同源**，一律走单源 shopKey）=====
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'SYNC_COST_CARD',
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