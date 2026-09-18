// cloudfunctions/saveCostCard/validate.js —— 入参校验（纯函数）。
// 契约（core/10 §3）：saveCostCard 入参 { shop_id, card:{name,lines:[{material_id,qty}]}, client_request_id }。
// 金额铁律（R27）：*_fen 必须 JSON number（整数分）；字符串一律 INVALID_PARAM。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const card = src.card;
  if (!card || typeof card !== 'object') return err('card 必须是对象');
  if (typeof card.name !== 'string' || !card.name.trim()) return err('card.name 必须是非空字符串');

  const lines = card.lines || [];
  if (!Array.isArray(lines)) return err('card.lines 必须是数组');
  if (lines.length === 0) return err('card.lines 不能为空');
  const cLines = [];
  for (const ln of lines) {
    if (!ln || typeof ln.material_id !== 'string' || !ln.material_id) {
      return err('明细行 material_id 必须是非空字符串');
    }
    const qty = ln.qty != null ? ln.qty : ln.quantity;
    if (typeof qty !== 'number' || !isFinite(qty) || qty <= 0) {
      return err(`明细行 ${ln.material_id} 的 qty/quantity 必须是 >0 的 number（克或份）`);
    }
    cLines.push({ material_id: ln.material_id, quantity: qty });
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

  const targetMarginPct = (typeof card.target_margin_pct === 'number') ? card.target_margin_pct : 0;

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
      targetMarginPct,
      card_code: (typeof card.card_code === 'string' && card.card_code) ? card.card_code : '',
      category: (typeof card.category === 'string') ? card.category : '',
      tags: (typeof card.tags === 'string') ? card.tags : '',
      parent_card_code: (typeof card.parent_card_code === 'string') ? card.parent_card_code : '',
    },
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };