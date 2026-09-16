// cloudfunctions/getMaterial/service.js —— 纯函数：DB 原料文档 → 出参（含净料单位成本）。
// 净料单位成本口径（与 calcBom 严格一致）：round4(采购单价÷换算系数÷(出成率/100))，以「万分」整数表达。
const { ERROR_CODES } = require('./common');

// 与 calcBom/service.js 完全一致（单源同口径）：净料单位成本 = round 到 4 位小数（元）→ 万分整数。
// 保持与 calcBom.service.netUnitCostWan 相同的实现，防止快照口径漂移。
function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  const yuan = (purchasePriceFen / 100) / convertFactor / (yieldRate / 100);
  return Math.round(yuan * 10000);
}

// DB 原料文档 → 契约出参条目 { id, name, is_virtual, unit_cost_fen, net_unit_cost, ... }。
// unit_cost_fen：展示用「分」单位成本（元→分）；net_unit_cost：万分整数（精确快照值）。
function docToOutput(doc) {
  const costWan = Number(doc.net_unit_cost);
  const unitCostFen = Math.round(costWan / 100); // 万分 → 分（1 万分 = 0.01 元 = 1 分）
  return {
    id: doc.id || doc.material_id || doc._id,
    name: doc.name || '',
    brand_spec: doc.brand_spec || '',
    purchase_unit: doc.purchase_unit || '',
    purchase_price_fen: doc.purchase_price != null ? doc.purchase_price : 0,
    convert_factor: doc.convert_factor != null ? doc.convert_factor : 1,
    yield_rate: doc.yield_rate != null ? doc.yield_rate : 100,
    is_virtual: !!doc.is_virtual,
    net_unit_cost: costWan,                 // 万分整数（0.0001元），精确快照值
    unit_cost_fen: unitCostFen,             // 分整数（用万分换算）
  };
}

module.exports = { docToOutput, netUnitCostWan, ERROR_CODES };