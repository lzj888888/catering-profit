/**
 * POC4 · 选址盈利沙盘计算引擎（Node 验证原型）
 *
 * 依据：specs/dev-specs/core/开发规范v1.0_ModuleM2_选址沙盘.md (M2.5 核心计算引擎)
 * 严格实现：综合变动成本率 / 边际贡献率 / 保本÷30 / 目标利润 / 红警(≥100%不盈利)
 * 金额内部一律用「分」(整数) 计算，展示 ÷100。
 *
 * 注意：本文件是「本机验证锚点」原型，证明算法 100% 命中 POC4(S4) 验收值。
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
 * 选址盈利沙盘计算（纯 Service 层逻辑，不接触 DB / 前端）
 * @param {Object} input
 * @param {number} input.rentYuan         月房租（元，含租金/物业分摊）
 * @param {number} input.propertyYuan     物业费（元，独立拆出）
 * @param {number} input.laborYuan        固定人工成本合计（元，含工资+社保+宿舍+员工餐，不含提成/奖金）
 * @param {number} input.otherYuan        其他固定杂费（元，执照/摊销外固定支出）
 * @param {boolean} input.includeAmort    是否含模拟摊销
 * @param {number} input.simAmortYuan     模拟月摊销额（元，含摊销时必填；手动填假设数，不自动带 M1 摊销台账）
 * @param {number} input.varFoodPct       菜品综合变动成本率（%，如 35）
 * @param {number} input.varMktPct        营销综合费率（%）
 * @param {number} input.varOtherPct      其他变动费率（%）
 * @param {number} input.targetProfitYuan 月度目标利润（元）
 * @returns {Object} 各项指标（元）+ 红警标志
 */
function calcSandbox(input) {
  // 固定成本合计（分）：4 项固定 +（含模拟摊销时叠加模拟月摊销额）
  const fixedFen =
    toFen(input.rentYuan) +
    toFen(input.propertyYuan) +
    toFen(input.laborYuan) +
    toFen(input.otherYuan) +
    (input.includeAmort ? toFen(input.simAmortYuan || 0) : 0);

  // 综合变动成本率 = 菜品 + 营销 + 其他
  const compositeVarRate = (input.varFoodPct + input.varMktPct + input.varOtherPct) / 100;
  // 边际贡献率 = 1 − 综合变动成本率
  const marginRate = 1 - compositeVarRate;

  // 红警（唯一强制指标）：综合变动成本率 ≥ 100% → 当前结构无法盈利，不计算负数保本营业额
  const redAlert = compositeVarRate >= 1.0;

  let breakEvenMonthly = null, breakEvenDaily = null, targetMonthly = null, targetDaily = null;
  if (!redAlert && marginRate > 0) {
    // 精度红线：金额分整数存储，除法四舍五入至分（同 M1/M3）
    breakEvenMonthly = Math.round(fixedFen / marginRate);          // 保本月营业额
    breakEvenDaily = Math.round(breakEvenMonthly / 30);            // 保本日均（固定÷30，不按当月实际天数）
    targetMonthly = Math.round((fixedFen + toFen(input.targetProfitYuan || 0)) / marginRate); // 目标利润月营收
    targetDaily = Math.round(targetMonthly / 30);                  // 目标利润日均
  }

  return {
    fixedTotal: toYuan(fixedFen),
    compositeVarRatePct: Math.round(compositeVarRate * 10000) / 100,
    marginRatePct: Math.round(marginRate * 10000) / 100,
    redAlert,
    breakEvenMonthly: breakEvenMonthly === null ? null : toYuan(breakEvenMonthly),
    breakEvenDaily: breakEvenDaily === null ? null : toYuan(breakEvenDaily),
    targetMonthly: targetMonthly === null ? null : toYuan(targetMonthly),
    targetDaily: targetDaily === null ? null : toYuan(targetDaily),

    // 验收层用（整数分，落库口径）—— 断言一律比这些字段（core/02:5 / N17）
    fixedTotalFen: fixedFen,
    breakEvenMonthlyFen: breakEvenMonthly,
    breakEvenDailyFen: breakEvenDaily,
    targetMonthlyFen: targetMonthly,
    targetDailyFen: targetDaily,
  };
}

module.exports = { calcSandbox, toFen, toYuan };
