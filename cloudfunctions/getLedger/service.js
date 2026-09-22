// cloudfunctions/getLedger/service.js —— 内嵌批次 1 calcMonthlyProfit 双利润引擎（与 saveLedger/service.js 同源）。
const { ERROR_CODES } = require('./common');

function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function calcMonthlyProfit(clean) {
  const incomeItems = (clean && clean.incomeItems) || [];
  const expenseItems = (clean && clean.expenseItems) || [];
  const directConsumeFen = num0(clean && clean.directConsumeFen);
  const amortizeFen = num0(clean && clean.amortizeFen);
  const amortizeSwitchOn = !!(clean && clean.amortizeSwitchOn);
  const inventorySwitchOn = !!(clean && clean.inventorySwitchOn);
  // round106（F2）：一次性装修设备投入（分）—— 与 saveLedger/service.js 同源同口径
  const lumpSumFen = num0(clean && clean.lumpSumFen);
  const effectiveLumpSumFen = amortizeSwitchOn ? 0 : lumpSumFen;
  const inv = (clean && clean.inventory) || {};
  const incomeTotalFen = incomeItems.reduce((s, it) => s + num0(it && it.amountFen), 0);
  const expenseTotalFen = expenseItems.reduce((s, it) => s + num0(it && it.amountFen), 0);
  const realConsumeFen = inventorySwitchOn
    ? num0(inv.openingFen) + num0(inv.purchaseFen) - num0(inv.closingFen)
    : directConsumeFen;
  const materialCostFen = realConsumeFen;
  const grossProfitFen = Math.round(incomeTotalFen - materialCostFen);
  const grossMarginRatePct = incomeTotalFen === 0 ? 0 : (grossProfitFen / incomeTotalFen) * 100;
  const effectiveAmortizeFen = amortizeSwitchOn ? Math.round(amortizeFen) : 0;
  const operationRefProfitFen = Math.round(incomeTotalFen - expenseTotalFen - directConsumeFen - effectiveLumpSumFen);
  const totalFactorRealProfitFen = Math.round(incomeTotalFen - expenseTotalFen - realConsumeFen - effectiveAmortizeFen - effectiveLumpSumFen);
  const profitDiffFen = Math.round((realConsumeFen - directConsumeFen) + effectiveAmortizeFen);
  return {
    incomeTotalFen, expenseTotalFen, materialCostFen, directConsumeFen, realConsumeFen,
    grossProfitFen, grossMarginRatePct,
    grossMarginRatePctDisplay: Math.round((grossMarginRatePct + Number.EPSILON) * 100) / 100,
    amortizeFen, effectiveAmortizeFen,
    lumpSumFen, effectiveLumpSumFen,
    operationRefProfitFen, totalFactorRealProfitFen, profitDiffFen,
    switchUsed: { inventorySwitchOn, amortizeSwitchOn },
    diffCheck: operationRefProfitFen - totalFactorRealProfitFen === profitDiffFen,
  };
}

module.exports = { calcMonthlyProfit, ERROR_CODES };