// cloudfunctions/saveMaterial/service.js —— 纯函数：原料「净料单位成本」计算（与 calcBom 同口径）。
// ⚠️ 改价只改 shop_material 的 purchase_price 等；已保存成本卡的明细行快照**不受影响**（快照隔离本体）。
const { ERROR_CODES } = require('./common');

// 净料单位成本 = round4(采购单价÷换算系数÷(出成率/100))，万分整数。与 calcBom.service.netUnitCostWan 一致。
function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  const yuan = (purchasePriceFen / 100) / convertFactor / (yieldRate / 100);
  return Math.round(yuan * 10000);
}

module.exports = { netUnitCostWan, ERROR_CODES };