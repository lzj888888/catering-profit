// cloudfunctions/saveCostCard/validate.js —— 入参校验（纯函数）。
// 契约（core/10 §3）：saveCostCard 入参 { shop_id, card:{name,lines:[{material_id,qty}]}, client_request_id }。
// 金额铁律（R27）：*_fen 必须 JSON number（整数分）；字符串一律 INVALID_PARAM。
const { ERROR_CODES } = require('./common');
const { LINE_KINDS, sanitizeSpecs } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const card = src.card;
  if (!card || typeof card !== 'object') return err('card 必须是对象');

  // M3.7（批次 P0）软删分支：card._delete=true 时只校验 card_code，跳过 name/lines 必填。
  if (card._delete === true) {
    if (typeof card.card_code !== 'string' || !card.card_code) return err('删除菜品需提供 card.card_code');
    return {
      error: null,
      shop_id: src.shop_id,
      card: { _delete: true, card_code: card.card_code, name: '', mode: 'A', lines: [], auxFen: 0, lossPct: 0, batchOutput: 0, priceFen: 0, targetMarginPct: 0, specs: [] },
      input: { client_request_id: src.client_request_id || '' },
    };
  }

  if (typeof card.name !== 'string' || !card.name.trim()) return err('card.name 必须是非空字符串');

  const lines = card.lines || [];
  if (!Array.isArray(lines)) return err('card.lines 必须是数组');
  if (lines.length === 0) return err('card.lines 不能为空');
  const cLines = [];
  for (const ln of lines) {
    if (!ln || typeof ln !== 'object') return err('明细行必须是对象');
    const qty = ln.qty != null ? ln.qty : ln.quantity;
    if (typeof qty !== 'number' || !isFinite(qty) || qty <= 0) {
      return err(`明细行的 qty/quantity 必须是 >0 的 number（克或份）`);
    }
    // M3.3（批次 P0）：录入方式 1=从原料档案选择 / 2=临时手工录入（默认 1）
    const inputType = (ln.input_type === 2) ? 2 : 1;
    // M3.14（R150）：组件类型 line_kind（主料/辅料/调料/半成品/耗材包装）——
    //   · 缺字段 / 空串 ⇒ 按 `main` 兜底（**存量行**没有这个字段，fail-soft；兜底只作用于入参，不回写存量数据）
    //   · 给了**非法值** ⇒ 响亮拒（那是前端 bug；静默降级会让"半份缩放"按错的口径生效）
    // M3.14：分组名 group_name（自由文本，**仅展示折叠用**，引擎不认识 ⇒ 对成本零影响）
    const rawKind = (ln.line_kind === undefined || ln.line_kind === null) ? '' : String(ln.line_kind);
    if (rawKind && LINE_KINDS.indexOf(rawKind) < 0) {
      return err(`明细行 line_kind 非法（当前值：${JSON.stringify(rawKind)}；合法值：${LINE_KINDS.join('/')}）`);
    }
    const lineKind = rawKind || 'main';
    const groupName = (typeof ln.group_name === 'string') ? ln.group_name.trim().slice(0, 20) : '';
    if (inputType === 2) {
      // 临时手工录入：material_id 为空、不存原料档案；须填名称。
      // 净料单位成本二选一：① 录入时传 unit_price_fen + yield_rate（后端 netUnitCostWan 算）；
      //   ② 复制/编辑回填时传 net_unit_cost（万分整数快照，直接落库，不再重算）。
      if (typeof ln.name !== 'string' || !ln.name.trim()) return err('手工录入行 name 必须是非空字符串');
      const upf = ln.unit_price_fen;
      const yr = ln.yield_rate;
      const nuc = ln.net_unit_cost;
      const hasInput = (upf !== undefined && yr !== undefined);
      const hasSnapshot = (nuc !== undefined);
      if (hasInput && hasSnapshot) return err('手工录入行 unit_price_fen/yield_rate 与 net_unit_cost 二选一，不能同时传');
      if (hasInput) {
        if (typeof upf !== 'number' || !Number.isInteger(upf) || upf < 0) return err('手工录入行 unit_price_fen 必须是非负整数分（JSON number）');
        if (typeof yr !== 'number' || !(yr > 0) || !isFinite(yr) || yr > 100) return err('手工录入行 yield_rate 必须是 (0,100] 的 number');
      } else if (hasSnapshot) {
        if (typeof nuc !== 'number' || !Number.isInteger(nuc) || nuc < 0) return err('手工录入行 net_unit_cost 必须是非负整数（万分快照）');
      } else {
        return err('手工录入行需传 unit_price_fen+yield_rate 或 net_unit_cost（二选一）');
      }
      cLines.push({ material_id: '', input_type: 2, name: ln.name.trim(), quantity: qty, unit_price_fen: hasInput ? upf : undefined, yield_rate: hasInput ? yr : undefined, net_unit_cost: hasSnapshot ? nuc : undefined, line_kind: lineKind, group_name: groupName });
    } else {
      if (typeof ln.material_id !== 'string' || !ln.material_id) {
        return err('明细行 material_id 必须是非空字符串');
      }
      cLines.push({ material_id: ln.material_id, input_type: 1, quantity: qty, line_kind: lineKind, group_name: groupName });
    }
  }

  // R81：mode 白名单 —— 非法值一律**响亮拒**，禁止静默兜底 A。
  // 历史兜底会把 'b' / 2 / 'C' / '' / 缺失 静默当成 A ⇒ 不生成虚拟半成品、忽略 batch_output、
  // 落库 calc_mode:1 ⇒ **成本语义悄悄变错且无任何报错**（本仓唯一"已知会静默算错成本"的开口）。
  if (card.mode !== 'A' && card.mode !== 'B') {
    return err('card.mode 必须是 "A" 或 "B"（当前值：' + JSON.stringify(card.mode === undefined ? null : card.mode) + '）');
  }
  const mode = card.mode;
  const auxFen = (typeof card.aux_fen === 'number') ? card.aux_fen
    : (typeof card.auxYuan === 'number' ? Math.round(card.auxYuan * 100) : 0);
  if (!Number.isInteger(auxFen) || auxFen < 0) return err('card.aux_fen/auxYuan 辅料分摊必须是非负值');

  const lossPct = (typeof card.loss_pct === 'number') ? card.loss_pct : 0;
  if (typeof lossPct !== 'number' || !isFinite(lossPct) || lossPct < 0 || lossPct >= 100) {
    return err('card.loss_pct 制作损耗率必须 ∈ [0,100)（%）');
  }

  const batchOutput = (typeof card.batch_output === 'number' && Number.isInteger(card.batch_output) && card.batch_output > 0) ? card.batch_output : 0;
  if (mode === 'B' && !(batchOutput > 0)) return err('模式 B 必须提供 card.batch_output（>0 整数份数）');

  const priceFen = (typeof card.price_fen === 'number') ? card.price_fen
    : (typeof card.priceYuan === 'number' ? Math.round(card.priceYuan * 100) : 0);
  if (!Number.isInteger(priceFen) || priceFen < 0) return err('card.price_fen/priceYuan 建议售价必须是非负值');

  // M3.3（批次 P0）活动特价：可选，非负分（或元 → 分）
  const activityPriceFen = (typeof card.activity_price_fen === 'number') ? card.activity_price_fen
    : (typeof card.activity_price_yuan === 'number' ? Math.round(card.activity_price_yuan * 100) : 0);
  if (!Number.isInteger(activityPriceFen) || activityPriceFen < 0) return err('card.activity_price_* 活动特价必须是非负值');

  const targetMarginPct = (typeof card.target_margin_pct === 'number') ? card.target_margin_pct : 0;

  // M3.15（R150）多规格：`card.specs` = [{spec_key, price_fen?, name?, coef?, enabled?}]。
  //   系数与可读名缺省由 common/specDerive.js::SPEC_PRESETS 补齐（**单源**），落库**快照**。
  //   ⚠️ 合法域见规范 §M3.26 错误表（系数 0~1；spec_key 非空且不重复）。
  const specsCheck = sanitizeSpecs(card.specs);
  if (specsCheck.error) return err(specsCheck.error);

  return {
    error: null,
    shop_id: src.shop_id,
    card: {
      name: card.name.trim(),
      mode,
      lines: cLines,
      auxFen,
      lossPct,
      batchOutput,
      priceFen,
      activityPriceFen,
      targetMarginPct,
      specs: specsCheck.value,
      card_code: (typeof card.card_code === 'string' && card.card_code) ? card.card_code : '',
      category: (typeof card.category === 'string') ? card.category : '',
      tags: (typeof card.tags === 'string') ? card.tags : '',
      parent_card_code: (typeof card.parent_card_code === 'string') ? card.parent_card_code : '',
    },
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };