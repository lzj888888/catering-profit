// cloudfunctions/saveLedger/service.js —— 批次 4 · M1 月度账（Service 层纯逻辑）
//
// ⚠️ 自包含：云函数无法跨包 require，这里把「批次 1 calcMonthlyProfit 双利润引擎」与
//    「批次 2 calcAmortize 摊销引擎（单月）」各内联一份。与 calcMonthlyProfit/service.js、
//    calcAmortize/service.js **保持同源同口径**；锚点用 S1(9160)/S2(3476.67)/S3(末月 3333.45) 双侧核对防漂移。
//    批次 4 禁止改动批次 1~3 云函数，故本副本是"派生存档"，不是覆盖。

// ===================== 批次 1 引擎内嵌：双利润（与 calcMonthlyProfit/service.js 同款） =====================
function calcMonthlyProfit(clean) {
  const incomeItems = (clean && clean.incomeItems) || [];
  const expenseItems = (clean && clean.expenseItems) || [];
  const directConsumeFen = num0(clean && clean.directConsumeFen);
  const amortizeFen = num0(clean && clean.amortizeFen);
  const amortizeSwitchOn = !!(clean && clean.amortizeSwitchOn);
  const inventorySwitchOn = !!(clean && clean.inventorySwitchOn);
  // round106（F2）：一次性装修设备投入（分）。语义 = 「金额不大，就当这个月的费用」⇒
  //   在**当月**作为费用扣减，参考利润与全要素真实利润**两式都减**（与摊销不同：摊销只影响真实利润）。
  //   与摊销互斥：选了按月分摊（amortizeSwitchOn）就不该再吃一次性 ⇒ effective 归 0（防同一笔钱被算两遍）。
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
    incomeTotalFen, expenseTotalFen,
    materialCostFen, directConsumeFen, realConsumeFen,
    grossProfitFen, grossMarginRatePct,
    grossMarginRatePctDisplay: Math.round((grossMarginRatePct + Number.EPSILON) * 100) / 100,
    amortizeFen, effectiveAmortizeFen,
    lumpSumFen, effectiveLumpSumFen,
    operationRefProfitFen, totalFactorRealProfitFen, profitDiffFen,
    switchUsed: { inventorySwitchOn, amortizeSwitchOn },
    diffCheck: operationRefProfitFen - totalFactorRealProfitFen === profitDiffFen,
  };
}
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// ===================== 批次 2 引擎内嵌：单月摊销（与 calcAmortize/service.js 同款） =====================
function monthIndex(ym) { const [y, m] = String(ym || '').split('-').map(Number); return y * 12 + (m - 1); }
// 单资产某月摊销额（分整数；区间外=0；自然到期末月尾差倒挤；提前终止末月仍按 base）
function amountForMonth(asset, month) {
  const start = monthIndex(asset.start_month);
  const naturalEnd = start + asset.total_months - 1;
  let end = naturalEnd;
  if (asset.terminate_month) { const t = monthIndex(asset.terminate_month); if (t < naturalEnd) end = t; }
  const mi = monthIndex(month);
  if (mi < start || mi > end) return 0;
  const k = mi - start + 1, N = end - start + 1;
  const base = asset.total_months > 0 ? Math.round(asset.total_value / asset.total_months) : 0;
  if (k < N) return base;
  if (end === naturalEnd) return asset.total_value - base * (N - 1);
  return base;
}
// 当月摊销总费用 = 各活跃资产当月摊销之和（资产由 Controller 经 DataAdapter 软删过滤后传入）
function amortizeTotalForMonth(assets, month) {
  return (assets || []).reduce((s, a) => s + amountForMonth(a, month), 0);
}

module.exports = { calcMonthlyProfit, amortizeTotalForMonth, amountForMonth, monthIndex };