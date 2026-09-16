// cloudfunctions/getCostCard/service.js —— 纯函数：成本卡/明细行 doc → 出参（snake_case 契约形态）。
// 最新版本判定（默认返回最新）= card_code 下 version 最大者（版本自然数递增，只 INSERT 不 UPDATE）。
const { ERROR_CODES } = require('./common');

// 版本行 doc → 出参条目（不含明细行，明细另行装配）
function cardToOutput(doc) {
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

// 明细行 doc → 出参（含净料单位成本快照）
function lineToOutput(doc) {
  return {
    material_id: doc.material_id || '',
    material_name: doc.material_name || '',
    quantity: doc.quantity != null ? doc.quantity : 0,
    net_unit_cost: doc.net_unit_cost != null ? doc.net_unit_cost : 0, // 万分整数快照
    line_net_cost_fen: doc.line_net_cost != null ? doc.line_net_cost : 0,
  };
}

module.exports = { cardToOutput, lineToOutput, ERROR_CODES };