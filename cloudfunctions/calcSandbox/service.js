// cloudfunctions/calcSandbox/service.js —— 批次 4 · M2 开店测算（Service 层纯引擎，POC4/S4 锚点）
//
// ⚠️ 分层铁律：本文件是「纯函数」，只做计算，绝不 require('wx-server-sdk') / 碰 DB / 触前端请求。
//
// 公式（M2.5，确定锁）：
//   综合变动成本率 = 菜品% + 营销% + 其他%
//   边际贡献率     = 1 − 综合变动成本率
//   固定成本合计   = 月房租 + 物业费 + 固定人工合计 + 其他固定杂费
//                  +（含模拟摊销时叠加 sim_amort_fen）
//   保本月营业额   = 固定成本合计 ÷ 边际贡献率
//   保本日均       = 保本月营业额 ÷ 30（固定÷30，不按当月实际天数）
//   目标利润月营收 = (固定成本合计 + 目标月利润) ÷ 边际贡献率
//   目标利润日均   = 目标利润月营收 ÷ 30
//   红警（唯一强制指标）：综合变动成本率 ≥ 100% → red_alert=true，保本/目标返回 null（不计算负数保本）。
//
// 精度：金额一律「分」整数；中间高精度，除法仅**最后一步** round 到分（同 M1/M3 红线）。
// ⚠️ 展示值必须经本 Service 重算校验（前端不重算、不编公式）。

/**
 * 开店测算（纯函数）。
 * @param {object} clean 干净入参（Controller 已校验/清洗）：
 *   - rentFen, propertyFen, laborFen, otherFen: 月固定成本（分）
 *   - includeAmort:boolean, simAmortFen:number（含模拟摊销时叠加）
 *   - varFoodPct, varMktPct, varOtherPct: 三类变动成本率%（综合 = 三者和）
 *   - targetProfitFen: 目标月利润（分）
 * @returns {object} {
 *   fixed_total_fen, composite_var_rate_pct, margin_rate_ratio, red_alert:boolean,
 *   break_even_monthly_fen, break_even_daily_fen, target_monthly_fen, target_daily_fen
 * }
 */
function calcSandbox(clean) {
  const rentFen = num0(clean && clean.rentFen);
  const propertyFen = num0(clean && clean.propertyFen);
  const laborFen = num0(clean && clean.laborFen);
  const otherFen = num0(clean && clean.otherFen);
  const includeAmort = !!(clean && clean.includeAmort);
  const simAmortFen = includeAmort ? num0(clean && clean.simAmortFen) : 0;

  const varFoodPct = num0(clean && clean.varFoodPct);
  const varMktPct = num0(clean && clean.varMktPct);
  const varOtherPct = num0(clean && clean.varOtherPct);
  const targetProfitFen = num0(clean && clean.targetProfitFen);

  // 固定成本合计（分）
  const fixedTotalFen = rentFen + propertyFen + laborFen + otherFen + simAmortFen;

  // 变动成本率（%）与边际贡献率
  const compositeVarRatePct = varFoodPct + varMktPct + varOtherPct;
  const marginRatePct = 1 - compositeVarRatePct / 100;

  // 红警：综合变动成本率 ≥ 100% → 无法盈利，保本/目标为 null（不计算负数保本）
  const redAlert = compositeVarRatePct >= 100
    || marginRatePct <= 0;

  let breakEvenMonthlyFen = null;
  let breakEvenDailyFen = null;
  let targetMonthlyFen = null;
  let targetDailyFen = null;
  if (!redAlert) {
    // 保本月营业额 = 固定成本 ÷ 边际贡献率；日均 ÷ 30（固定 30）
    breakEvenMonthlyFen = Math.round(fixedTotalFen / marginRatePct);
    breakEvenDailyFen = Math.round(breakEvenMonthlyFen / 30);
    // 目标利润月营收 = (固定 + 目标利润) ÷ 边际贡献率；日均 ÷ 30
    targetMonthlyFen = Math.round((fixedTotalFen + targetProfitFen) / marginRatePct);
    targetDailyFen = Math.round(targetMonthlyFen / 30);
  }

  return {
    fixed_total_fen: fixedTotalFen,
    composite_var_rate_pct: compositeVarRatePct,
    margin_rate_ratio: Math.round(marginRatePct * 10000) / 10000,
    red_alert: redAlert,
    break_even_monthly_fen: breakEvenMonthlyFen,
    break_even_daily_fen: breakEvenDailyFen,
    target_monthly_fen: targetMonthlyFen,
    target_daily_fen: targetDailyFen,
  };
}

function num0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { calcSandbox };