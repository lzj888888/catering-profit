// cloudfunctions/calcSandbox/service.js —— M2 开店测算（Service 层纯引擎，POC4/S4 锚点）· v2
//
// ⚠️ 分层铁律：本文件是「纯函数」，只做计算，绝不 require('wx-server-sdk') / 碰 DB / 触前端请求。
//    唯一例外是 require('./common') 取**纯数据/纯函数**单源（indicatorRef），不引入任何 IO。
//
// 公式（M2.5 v2，2026-09-23 李老师拍板改造）：
//   月摊销         = Σ(建店投入_i ÷ (年限_i × 12))          ← 逐项高精度求和，最后一步 round 到分
//   固定成本合计   = Σ 每月固定项 + 月摊销
//   食材成本率     = 100 − 菜品毛利率                         ← ⚠️ **引擎内部中间量，不出前端**
//                                                              （round111：对外一律"毛利率" —— 客户看不懂成本率）
//   综合变动成本率 = 食材成本率 + Σ 跟营业额挂钩费率           ← 佣金是"率"不是"额"（拍板项③方案 A）
//   边际贡献率     = 1 − 综合变动成本率 ÷ 100
//   保本月营业额   = 固定成本合计 ÷ 边际贡献率
//   保本日均       = 保本月营业额 ÷ 30（固定÷30，不按当月实际天数）
//   目标利润月营收 = (固定成本合计 + 目标月利润) ÷ 边际贡献率
//   目标利润日均   = 目标利润月营收 ÷ 30
//   回本周期(月)   = 建店总投入 ÷ 目标月利润（目标利润 ≤ 0 → null，不编造）
//   红警（唯一强制指标）：综合变动成本率 ≥ 100% → red_alert=true，保本/目标返回 null（不计算负数保本）。
//
// 指标对照（v2 新增）：分母用**两个**都算 —— 保本营业额（最保守）+ 目标利润营业额（拍板项⑤），
//   区间值来自 indicatorRef（分业态 × 分城市层级），返回只给 key/数值/level 枚举，
//   **中文文案一律由前端 terms.js 映射**（页面零硬编码 + 术语单源）。
//
// 精度：金额一律「分」整数；中间高精度，除法仅**最后一步** round 到分（同 M1/M3 红线）。
// ⚠️ 展示值必须经本 Service 重算校验（前端不重算、不编公式）。

const common = require('./common');
const { indicatorRef } = common;

/**
 * 开店测算（纯函数）。
 * @param {object} clean 干净入参（Controller 已校验/清洗）：
 *   - cityTier / bizType: 城市层级 / 业态（指标对照用）
 *   - buildItems: [{key, fen, years}] 一次性建店投入（分摊到月）
 *   - fixedItems: [{key, fen}]        每月固定支出
 *   - varItems:   [{key, pct}]        跟营业额挂钩的费用（%）
 *   - grossMarginPct: 菜品毛利率（%）
 *   - targetProfitFen: 目标月利润（分）
 * @returns {object}
 */
function calcSandbox(clean) {
  const c = clean || {};
  const cityTier = c.cityTier;
  const bizType = c.bizType;
  const buildItems = arr(c.buildItems);
  const fixedItems = arr(c.fixedItems);
  const varItems = arr(c.varItems);
  const grossMarginPct = num0(c.grossMarginPct);
  const targetProfitFen = num0(c.targetProfitFen);

  // ---- 1) 一次性建店投入 → 月摊销（逐项高精度，最后一步取整）----
  let buildTotalFen = 0;
  let amortRaw = 0;
  for (let i = 0; i < buildItems.length; i++) {
    const fen = num0(buildItems[i] && buildItems[i].fen);
    const years = num0(buildItems[i] && buildItems[i].years);
    buildTotalFen += fen;
    if (years > 0) amortRaw += fen / (years * 12);
  }
  const buildAmortMonthlyFen = Math.round(amortRaw);

  // ---- 2) 每月固定支出 ----
  const fixedFen = {};
  let fixedExAmortFen = 0;
  for (let i = 0; i < fixedItems.length; i++) {
    const k = fixedItems[i] && fixedItems[i].key;
    const fen = num0(fixedItems[i] && fixedItems[i].fen);
    if (k) fixedFen[k] = (fixedFen[k] || 0) + fen;
    fixedExAmortFen += fen;
  }
  const fixedTotalFen = fixedExAmortFen + buildAmortMonthlyFen;

  // ---- 3) 变动成本率 ----
  // ⚠️ foodCostPct 是「综合变动成本率」的加数，**删了保本点会算错** —— 必须留。
  //    但 round111 起它**不再作为前端展示口径**：对外（指标对照 / 术语 / 文案）统一用"毛利率"，
  //    因为目标客户是餐饮小白，"食材成本率"听不懂。见 indicatorRef.js 顶部「口径铁律」。
  const foodCostPct = 100 - grossMarginPct;              // 食材成本率 = 100 − 菜品毛利率
  let platformPct = 0;
  for (let i = 0; i < varItems.length; i++) platformPct += num0(varItems[i] && varItems[i].pct);
  const compositeVarRatePct = round1(foodCostPct + platformPct);
  const marginRatePct = 1 - compositeVarRatePct / 100;

  // ---- 4) 红警 ----
  const redAlert = compositeVarRatePct >= 100 || marginRatePct <= 0;

  let breakEvenMonthlyFen = null;
  let breakEvenDailyFen = null;
  let targetMonthlyFen = null;
  let targetDailyFen = null;
  if (!redAlert) {
    breakEvenMonthlyFen = Math.round(fixedTotalFen / marginRatePct);
    breakEvenDailyFen = Math.round(breakEvenMonthlyFen / 30);
    targetMonthlyFen = Math.round((fixedTotalFen + targetProfitFen) / marginRatePct);
    targetDailyFen = Math.round(targetMonthlyFen / 30);
  }

  // ---- 5) 回本周期（月）：建店总投入 ÷ 目标月利润；目标利润 ≤ 0 时不编造 ----
  let paybackMonths = null;
  if (targetProfitFen > 0 && buildTotalFen > 0 && !redAlert) {
    paybackMonths = round1(buildTotalFen / targetProfitFen);
  }

  // ---- 6) 餐饮指标对照（两套分母）----
  const base = { bizKey: bizType, cityKey: cityTier, fixedFen, grossMarginPct, platformPct };
  const indAtBreakEven = redAlert ? [] : indicatorRef.evaluateIndicators(
    mix(base, { revenueFen: breakEvenMonthlyFen }));
  const indAtTarget = redAlert ? [] : indicatorRef.evaluateIndicators(
    mix(base, { revenueFen: targetMonthlyFen }));

  return {
    // 投入与固定成本
    build_total_fen: buildTotalFen,
    build_amort_monthly_fen: buildAmortMonthlyFen,
    fixed_ex_amort_fen: fixedExAmortFen,
    fixed_total_fen: fixedTotalFen,
    // 变动与边际
    food_cost_pct: round1(foodCostPct),
    platform_pct: round1(platformPct),
    composite_var_rate_pct: compositeVarRatePct,
    margin_rate_ratio: Math.round(marginRatePct * 10000) / 10000,
    red_alert: redAlert,
    // 四个核心结果
    break_even_monthly_fen: breakEvenMonthlyFen,
    break_even_daily_fen: breakEvenDailyFen,
    target_monthly_fen: targetMonthlyFen,
    target_daily_fen: targetDailyFen,
    payback_months: paybackMonths,
    // 指标对照（无红警时才有意义）
    indicators_at_breakeven: indAtBreakEven,
    indicators_at_target: indAtTarget,
    // 参考带**预览**（round113）：只依赖 业态 × 城市，与用户填了什么**无关**，红警时也返回。
    // 用途：填表页在用户**还没填**时就显示"行业参考区间" —— 解决"不知道这项该填多少"的门槛
    //（M2 的主要流失点：开店前用户手里没有任何数字）。
    // ⚠️ 与 indicators_* 的区别：那两份是"你的值 vs 参考带"（需分母），本份只有参考带本身。
    // ⚠️ 中文名仍由前端 terms 映射（key → 名），本层只回 key / 数值 / 方向。
    bands_preview: indicatorRef.listBands(bizType, cityTier),
  };
}

function arr(v) { return Array.isArray(v) ? v : []; }
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
// 保留 1 位小数带十进制容差（见 indicatorRef.js 同处说明：25×1.15 的浮点陷阱）
function round1(n) { return Math.round(n * 10 + 1e-9) / 10; }
function mix(a, b) {
  const o = {};
  for (const k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
  for (const k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
  return o;
}

module.exports = { calcSandbox };
