// cloudfunctions/getCardVersions/service.js —— 批次 4 · M3 成本卡版本历史出参映射（纯函数）
// 与 getCostCard/service.js 同口径：DB 成本卡/明细行 doc → 出参（snake_case，金额均为整数「分」）。
const { ERROR_CODES } = require('./common');

// 成本卡版本行（shop_cost_card）doc → 出参条目（不含明细，明细另行装配）
function cardToOut(doc) {
  return {
    card_code: doc.card_code || '',
    version: doc.version || 1,
    name: doc.name || '',
    category: doc.category || '',
    tags: doc.tags || '',
    calc_mode: doc.calc_mode === 2 ? 'B' : 'A',
    batch_output: doc.batch_output != null ? doc.batch_output : null,
    loss_rate: doc.loss_rate != null ? doc.loss_rate : 0,
    aux_fen: doc.aux_cost != null ? doc.aux_cost : 0,
    price_fen: doc.price_list != null ? doc.price_list : 0,
    total_cost_fen: doc.total_cost != null ? doc.total_cost : 0,
    material_total_fen: doc.material_total_fen != null ? doc.material_total_fen : 0,
    gross_profit_fen: doc.gross_profit_fen != null ? doc.gross_profit_fen : 0,
    gross_margin_pct: doc.gross_margin_pct != null ? doc.gross_margin_pct : 0,
    reverse_price_fen: doc.reverse_price_fen != null ? doc.reverse_price_fen : 0,
    created_at: doc.created_at != null ? doc.created_at : 0,
    lines: [],
  };
}

// 明细行（shop_cost_card_line）doc → 出参（含净料单位成本快照）
function lineToOut(doc) {
  return {
    material_id: doc.material_id || '',
    material_name: doc.material_name || '',
    quantity: doc.quantity != null ? doc.quantity : 0,
    net_unit_cost: doc.net_unit_cost != null ? doc.net_unit_cost : 0, // 万分快照
    line_net_cost_fen: doc.line_net_cost != null ? doc.line_net_cost : 0,
  };
}

module.exports = { cardToOut, lineToOut, ERROR_CODES };