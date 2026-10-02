// utils/grouponDerive.js —— M3.37 到店团购渠道层（纯计算单源）
//
// 依据：R190 李老师口径（2026-10-02）：
//   ① 佣金率由**商家自己填**（各店不同；行业常见 6%，但本仓**不给默认值**，只进 placeholder）。
//   ② 🔴 **佣金基数 = 顾客实付的团购价**，不是原价（原价 188、团购价 88 ⇒ 佣金 = 88 × 6%）。
//   ③ 算利润时把佣金减掉；团购**无配送费、无打包费、无包材**（到店核销）。
//
// 🔴 红线（违反即退回）：
//   ① **纯计算、不落库、不进云函数** —— 与 M3.17 外卖同构（试算结果只做展示）。
//   ② 团购结果**不得进 M1**（守卫 R135：输出对象不含任何 monthly/ledger 字段）。
//   ③ **佣金基数恒为「顾客实付价」** —— 用原价算会系统性高估佣金（188×6%=11.28 vs 88×6%=5.28）。
//   ④ **费率没有默认值**：店家不填即按 0 计，绝不替他编一个数（R128 同族）。
//   ⑤ 与堂食对比**只在给了挂牌价时才出**（dineFen<=0 ⇒ vsDine 恒 0，不猜一个数）。

/**
 * 团购单均试算。
 * @param {object} input
 *   - priceFen  顾客实付团购价（分）
 *   - costFen   本卡/套餐成本（分，来自引擎 calcBom 的 unit_cost_fen）
 *   - ratePct   平台佣金率（%；基数 = 顾客实付价）
 *   - promoFen  推广费（分，选填）
 *   - dineFen   堂食挂牌价（分，选填 —— 用于"比堂食少赚多少"）
 * @returns {object} 纯展示数值
 */
function calcGrouponOrder(input) {
  const i = input || {};
  const priceFen = Math.round(Number(i.priceFen) || 0);
  const costFen = Math.round(Number(i.costFen) || 0);
  const ratePct = Number(i.ratePct) || 0;
  const promoFen = Math.round(Number(i.promoFen) || 0);
  const dineFen = Math.round(Number(i.dineFen) || 0);

  const commissionFen = Math.round((priceFen * ratePct) / 100);
  const netFen = priceFen - commissionFen - promoFen;
  const profitFen = netFen - costFen;

  const netRatePct = priceFen > 0 ? Number(((netFen / priceFen) * 100).toFixed(2)) : 0;
  const profitRatePct = netFen > 0 ? Number(((profitFen / netFen) * 100).toFixed(2)) : 0;

  // 与堂食对比：堂食毛利 = 挂牌价 − 同一份成本（成本不变，变的是费用侧）
  const dineProfitFen = dineFen > 0 ? dineFen - costFen : 0;
  const vsDineFen = dineFen > 0 ? dineProfitFen - profitFen : 0;

  return {
    priceFen,
    costFen,
    commissionFen,
    promoFen,
    netFen,
    profitFen,
    netRatePct,
    profitRatePct,
    dineProfitFen,
    vsDineFen,
    hasDine: dineFen > 0,
  };
}

module.exports = { calcGrouponOrder };
