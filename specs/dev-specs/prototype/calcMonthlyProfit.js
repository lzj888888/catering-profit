/**
 * POC3 · 月度双利润计算引擎（Node 验证原型）
 *
 * 依据：specs/dev-specs/poc/POC3_双利润口径锁.md
 * 严格实现：毛利铁律 / 双利润口径 / ⚠️口径锁 / 待结算不进利润
 * 金额内部一律用「分」(整数) 计算，展示 ÷100。
 *
 * 注意：本文件是「本机验证锚点」原型，证明算法 100% 命中 POC3 验收值。
 *      最终以 inscode 生成的云函数版本 + GitHub 同步为准，本文件可作参考基线。
 */

// 元 -> 分（整数，避免浮点）
function toFen(yuan) {
  return Math.round(yuan * 100);
}
// 分 -> 元（展示）
function toYuan(fen) {
  return fen / 100;
}

/**
 * @param {Object} input
 * @param {number[]} input.incomesYuan   各项收入（元）
 * @param {number[]} input.expensesYuan  各项费用（元）
 * @param {number}   input.directCostYuan 老板直接填的「当月食材耗材总消耗」（元）—— 经营参考口径永远用这个
 * @param {boolean}  input.inventoryOn   库存开关
 * @param {number}   input.beginInvYuan  期初存货（元，库存开时必填）
 * @param {number}   input.purchaseYuan  本期采购（元，库存开时必填）
 * @param {number}   input.endInvYuan    期末盘点（元，库存开时必填）
 * @param {number}   input.amortYuan     当月摊销总费用（元，由外部传入，本 POC 不计算摊销）
 * @param {number}   input.pendingSettleYuan 待结算金额（元）—— ⚠️ 不进利润，仅记录
 * @returns {Object} 各项指标（元）
 */
function calcMonthlyProfit(input) {
  const incomeFen = input.incomesYuan.reduce((s, v) => s + toFen(v), 0);
  const expenseFen = input.expensesYuan.reduce((s, v) => s + toFen(v), 0);
  const directCostFen = toFen(input.directCostYuan);

  // 毛利铁律：食材成本只含食材耗材，房租/人工/水电绝不算进营业成本
  const grossProfitFen = incomeFen - directCostFen;
  const grossMargin = incomeFen === 0 ? 0 : (grossProfitFen / incomeFen) * 100;

  // 真实消耗（库存开时倒轧；关时直接填值即真实消耗=直接填值）
  let realCostFen = directCostFen;
  if (input.inventoryOn) {
    realCostFen = toFen(input.beginInvYuan) + toFen(input.purchaseYuan) - toFen(input.endInvYuan);
  }
  const amortFen = toFen(input.amortYuan || 0);

  // ⚠️ 口径锁：经营参考利润永远用 directCost（直接填），即使开了库存也不改用倒轧值
  const bizRefProfitFen = incomeFen - expenseFen - directCostFen;
  // 全要素真实利润：用真实消耗 + 摊销
  const fullProfitFen = incomeFen - expenseFen - realCostFen - amortFen;
  // 差异 = (真实消耗 - 直接填消耗) + 摊销
  const diffFen = (realCostFen - directCostFen) + amortFen;

  return {
    income: toYuan(incomeFen),
    expense: toYuan(expenseFen),
    grossProfit: toYuan(grossProfitFen),
    grossMarginPct: Math.round(grossMargin * 1000) / 1000,
    bizRefProfit: toYuan(bizRefProfitFen),
    fullProfit: toYuan(fullProfitFen),
    diff: toYuan(diffFen),
    _realCost: toYuan(realCostFen), // 调试用：真实消耗
    _pendingSettle: toYuan(toFen(input.pendingSettleYuan || 0)), // 不进利润，仅回声
  };
}

module.exports = { calcMonthlyProfit, toFen, toYuan };
