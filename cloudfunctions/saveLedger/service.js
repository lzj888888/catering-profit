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
  // R477：直接填的消耗 —— 先**归一化**再判断（不许直接 === 0）。
  //   directProvided = 「老板填过没有」（undefined/null/''/NaN ⇒ 没填）；
  //   显式填 0 与未填必须分开：填 0 = 明确声明这月没消耗，要尊重；未填 = 不知道。
  //   ⚠️ 与 calcMonthlyProfit/service.js、getLedger/service.js 同源同口径，改一处必改三处。
  const rawDirect = (clean && clean.directConsumeFen);
  const directProvided = rawDirect !== undefined && rawDirect !== null && rawDirect !== ''
    && !(typeof rawDirect === 'number' && Number.isNaN(rawDirect));
  const directConsumeFen = directProvided ? num0(rawDirect) : 0;
  const amortizeFen = num0(clean && clean.amortizeFen);
  const amortizeSwitchOn = !!(clean && clean.amortizeSwitchOn);
  const inventorySwitchOn = !!(clean && clean.inventorySwitchOn);
  // round106（F2）：一次性投入（分）。语义 = 「金额不大，就当这个月的费用」⇒
  //   在**当月**作为费用扣减，参考利润与全要素真实利润**两式都减**（与摊销不同：摊销只影响真实利润）。
  // 🔴 round107 纠正：这里原来写着「与摊销互斥」（amortizeSwitchOn 为真就归 0）。**那是错的** ——
  //   摊销资产和一次算清的投入是**两笔不同的钱**，一个月完全可以两者都有（李老师真机反馈）。
  //   互斥只会在「既摊着装修、又买了个小东西」时把后者悄悄丢掉 ⇒ 当月利润虚高。
  //   防重复靠的是「同一笔钱只能登记成一行」（mode 二选一），不靠跨口径互斥。
  const lumpSumFen = num0(clean && clean.lumpSumFen);
  const effectiveLumpSumFen = lumpSumFen;
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
  // R477：参考口径取数 —— 库存开且「直接填的消耗」没有正数 ⇒ 回落倒轧。
  //   判据为什么是 ≤ 0 而不是「未填」：库存模式下前端恒传 0（subpkg/biz/month/inventory.js:240
  //   写死 `|| 0`），那个 0 是占位、不承载老板意图 ⇒ 按"未填"处理。详见 calcMonthlyProfit/service.js 头部。
  const refMaterialSource = inventorySwitchOn ? 'reverse' : 'direct';
  const refMaterialFen = inventorySwitchOn ? realConsumeFen : directConsumeFen;
  const profitCaliberVersion = 'm1_v2';
  const operationRefProfitFen = Math.round(incomeTotalFen - expenseTotalFen - refMaterialFen - effectiveLumpSumFen);
  const totalFactorRealProfitFen = Math.round(incomeTotalFen - expenseTotalFen - realConsumeFen - effectiveAmortizeFen - effectiveLumpSumFen);
  const profitDiffFen = Math.round((realConsumeFen - refMaterialFen) + effectiveAmortizeFen);
  return {
    incomeTotalFen, expenseTotalFen,
    materialCostFen, directConsumeFen, realConsumeFen,
    grossProfitFen, grossMarginRatePct,
    grossMarginRatePctDisplay: Math.round((grossMarginRatePct + Number.EPSILON) * 100) / 100,
    amortizeFen, effectiveAmortizeFen,
    lumpSumFen, effectiveLumpSumFen,
    operationRefProfitFen, totalFactorRealProfitFen, profitDiffFen,
    // R477：参考口径取数与来源（前端解释差异的取数单源）+ 口径版本标识
    refMaterialFen, refMaterialSource, directProvided, profitCaliberVersion,
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