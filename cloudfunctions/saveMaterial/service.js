// cloudfunctions/saveMaterial/service.js —— 纯函数：原料「净料单位成本」计算（与 calcBom 同口径）。
// ⚠️ 改价只改 shop_material 的 purchase_price 等；已保存成本卡的明细行快照**不受影响**（快照隔离本体）。
const { ERROR_CODES } = require('./common');

// 净料单位成本 = round4(采购单价÷换算系数÷(出成率/100))，万分整数。与 calcBom.service.netUnitCostWan 一致。
function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  // 🔴 R298（D2）：出成率 / 换算系数**夹紧**（口径同前端 utils/units.js::yieldRateOf：未填=100）。
  //   原实现裸除 ⇒ yieldRate=0 时 ÷0 = Infinity、缺失时 NaN、>100 时成本被系统性低估（静默错账）。
  //   手工行路径（saveCostCard/index.js）云端**无 validate 兜底** ⇒ 必须在本函数内 fail-closed。
  //   越界 / 缺失 / 非数 ⇒ 100（不折损，中性值）；换算系数 ≤0 ⇒ 1。
  const y = Number(yieldRate);
  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;
  const cf = Number(convertFactor) > 0 ? Number(convertFactor) : 1;
  const yuan = (purchasePriceFen / 100) / cf / (yr / 100);
  return Math.round(yuan * 10000);
}

module.exports = { netUnitCostWan, ERROR_CODES };