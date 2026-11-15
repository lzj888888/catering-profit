// cloudfunctions/saveLedger/service.js —— 批次 4 · M1 月度账（Service 层纯逻辑）
//
// ⚠️ 自包含：云函数无法跨包 require，这里把「批次 1 calcMonthlyProfit 双利润引擎」与
//    「批次 2 calcAmortize 摊销引擎（单月）」各内联一份。与 calcMonthlyProfit/service.js、
//    calcAmortize/service.js **保持同源同口径**；锚点用 S1(9160)/S2(3476.67)/S3(末月 3333.45) 双侧核对防漂移。
//    批次 4 禁止改动批次 1~3 云函数，故本副本是"派生存档"，不是覆盖。

// ===================== 批次 1 引擎内嵌：双利润（与 calcMonthlyProfit/service.js 同款） =====================
// 🔴 R740：摊销**一律计入**，本副本不再有月份闸门（R736 的 '2026-11' 闸门已拆）。
//   拆的理由见 calcMonthlyProfit/service.js 顶部长注释；一句话：它挡住的月份是永久蒸发。
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
  // 🔴 R740：一律计入（不看开关、不看月份）。金额由调用点从台账求和后喂进来。
  //   与 calcMonthlyProfit/service.js、getLedger/service.js 同源同口径 —— 改一处必改三处。
  //   ⚠️ 漏改本文件是最阴的一种：页面按新规则报「已计入」，而**落库**的 effective_amortize_fen
  //      仍是 0 ⇒ 导出月报与页面打架，且归档后永远对不上（R736 就是这么发现的，守卫 C7-3 抓到）。
  const effectiveAmortizeFen = Math.round(amortizeFen);
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
    // 🔴 R740：落库快照恒记 true（"这个月扣了摊销"）。漏改这里 ⇒ 归档后读快照说"没计入"，
    //   而金额明明记了 ⇒ 两页互相打脸。
    switchUsed: { inventorySwitchOn, amortizeSwitchOn: true },
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

// ===== R744：提前报废「资产处置损失」（同源函数，四副本逐字同构，守卫 check_amort_metamorphic 钉死）=====
// 规范 02_模拟测试数据集.md:185/205 + 开发规范v1.0_M1:90/94 + 04_核对清单:24 明文：
//   「终止月后未摊销余额（原值 − 已摊合计）作为资产处置/报废损失一次性计入当期」。
// R743 独立审计抓出：calcAmortize(POC) 算了 residual_loss，但它是死代码，生产链路从未消费
//   ⇒ 老板点「提前报废」、弹窗说「未摊余额将作为处置损失计入」，这笔钱实际从未进过利润表（永久蒸发）。
// 判据（三条同时成立才计）：
//   ① 资产提前终止（terminate_month 早于自然到期月）；
//   ② 且本月 === terminate_month（只在报废当月一次性计，绝不逐月重复）；
//   ③ 金额 = 原值 − base × 已摊期数（已摊期数含终止当月，因「终止当月仍摊」）。
// 闭包：历史逐月摊销和 + 本函数处置损失 ≡ 原值 ⇒ 整笔投入全部体现，不多不少。
function disposalLossForMonth(assets, month) {
  let sum = 0;
  for (const a of (assets || [])) {
    if (a.mode === 'lump' || !a.start_month || !a.terminate_month) continue;
    const start = monthIndex(a.start_month);
    const naturalEnd = start + (Number(a.total_months) || 0) - 1;
    const term = monthIndex(a.terminate_month);
    if (!(term < naturalEnd)) continue;                 // 非提前终止（自然到期无残值）
    if (term !== monthIndex(month)) continue;        // 只在报废当月计一次
    const paidPeriods = term - start + 1;
    const base = a.total_months > 0 ? Math.round(a.total_value / a.total_months) : 0;
    const residual = (Number(a.total_value) || 0) - base * paidPeriods;
    if (residual > 0) sum += residual;
  }
  return sum;
}

function amortizeTotalForMonth(assets, month) {
  return (assets || []).reduce((s, a) => s + amountForMonth(a, month), 0);
}

module.exports = { calcMonthlyProfit, amortizeTotalForMonth, disposalLossForMonth, amountForMonth, monthIndex };