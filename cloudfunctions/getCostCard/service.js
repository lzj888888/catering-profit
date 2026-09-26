// cloudfunctions/getCostCard/service.js —— 纯函数：成本卡/明细行 doc → 出参（snake_case 契约形态）。
// 最新版本判定（默认返回最新）= card_code 下 version 最大者（版本自然数递增，只 INSERT 不 UPDATE）。
const { ERROR_CODES } = require('./common');
const { specsFromJson } = require('./common');

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
    price_promo_fen: doc.price_promo != null ? doc.price_promo : 0,
    total_cost_fen: doc.total_cost != null ? doc.total_cost : 0,
    material_total_fen: doc.material_total_fen != null ? doc.material_total_fen : 0,
    gross_profit_fen: doc.gross_profit_fen != null ? doc.gross_profit_fen : 0,
    gross_margin_pct: doc.gross_margin_pct != null ? doc.gross_margin_pct : 0,
    reverse_price_fen: doc.reverse_price_fen != null ? doc.reverse_price_fen : 0,
    created_at: doc.created_at != null ? doc.created_at : 0,
    // M3.15（R150）：多规格定义快照（TEXT/JSON ⇒ 出参一律**数组**）。
    //   存量卡无此字段 ⇒ `specsFromJson(undefined)` 返回 []（fail-soft，不报错不回填）。
    specs: specsFromJson(doc.specs_json),
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
    // 任务1（S0）：快照 5 字段出参（fail-soft：存量行缺这 5 字段 ⇒ 给缺省值，不报错不回填）
    brand_spec: doc.brand_spec || '',
    purchase_unit: doc.purchase_unit || '',
    purchase_price: doc.purchase_price != null ? doc.purchase_price : 0,
    convert_factor: doc.convert_factor != null ? doc.convert_factor : 0,
    yield_rate: doc.yield_rate != null ? doc.yield_rate : 0,
    // M3.14（R150）：组件分类 + 分组名出参（存量行缺字段 ⇒ 'main' / ''）
    input_type: doc.input_type === 2 ? 2 : 1,
    line_kind: doc.line_kind || 'main',
    group_name: doc.group_name || '',
  };
}

module.exports = { cardToOutput, lineToOutput, ERROR_CODES };