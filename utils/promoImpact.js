// utils/promoImpact.js —— 促销（打折）对毛利率与保本线的影响
//
// 🔴 定位（2026-10-18 与李老师定稿）：
//   M2 不依赖账本、不依赖菜品成本卡；本文件只做「纯假设推演」。
//   老板输入：折扣力度 + 几成客人会用；系统输出：活动期毛利率、保本变化、打平所需客流。
//
// 公式（三项均已独立复算，见 review/NOTE_2026-10-18_M2活动测算_豆包GUI三轮.md）：
//   记 G0 = 日常毛利率；d = 折扣系数（8 折 ⇒ 0.8）；W = 活动营业额占比
//   ① 活动期综合毛利率
//        GA = [G0 − W×(1−d)] ÷ [1 − W×(1−d)]
//      ⚠️ 分母不能省 —— 省了就是把「毛利额占原价」当成毛利率（豆包最初就错在这里）
//   ② 活动期保本营业额
//        BE_after = FC ÷ GA
//   ③ 打平原利润所需客流倍数
//        k = G0 ÷ [G0 − W×(1−d)]
//      注意 ③ 与 ① 的分母不同：③ 的分母是「让价后的边际贡献」，不是营收。
//
// 边界（fail-closed，绝不输出编出来的数）：
//   · G0 ≤ 0 或 > 1        ⇒ badMargin
//   · d ≤ 0 或 > 1         ⇒ badDiscount（折扣不能高于原价）
//   · W < 0 或 > 1         ⇒ badWeight
//   · FC ≤ 0               ⇒ noFixed（没有固定费用就没有保本线可言）
//   · 分子 ≤ 0             ⇒ negativeMargin（让价幅度 ≥ 毛利率 ⇒ 无论卖多少都亏）

const ROUND = (n, p) => {
  const f = Math.pow(10, p);
  return Math.round(n * f + 1e-9) / f;
};

/**
 * @param {object} p
 * @param {number} p.fixedYuan    月固定费用（元）
 * @param {number} p.marginPct    日常毛利率（百分数，55 表示 55%）
 * @param {number} p.discount     折扣系数（0.8 表示打 8 折；1 表示不打折）
 * @param {number} p.weightPct    活动营业额占比（百分数，30 表示 30%）
 */
function promoImpact(p) {
  const fixed = Number(p && p.fixedYuan);
  const g0 = Number(p && p.marginPct) / 100;
  const d = Number(p && p.discount);
  const w = Number(p && p.weightPct) / 100;

  if (!(g0 > 0) || !(g0 <= 1)) return { ok: false, reason: 'badMargin' };
  if (!(d > 0) || d > 1) return { ok: false, reason: 'badDiscount' };
  if (!(w >= 0) || w > 1) return { ok: false, reason: 'badWeight' };
  if (!(fixed > 0)) return { ok: false, reason: 'noFixed' };

  const cut = w * (1 - d);          // 被活动让掉的那部分毛利率
  const numer = g0 - cut;           // 让价后的边际贡献
  const denom = 1 - cut;            // 让价后的实际营收（相对原价）

  // 让价幅度 ≥ 毛利率 ⇒ 卖越多亏越多，不存在保本点
  if (!(numer > 0)) return { ok: false, reason: 'negativeMargin' };

  const ga = numer / denom;
  const beBefore = fixed / g0;
  const beAfter = fixed / ga;
  const k = g0 / numer;

  return {
    ok: true,
    // 毛利率（小数，页面自行转百分数）
    gaRatio: ga,
    gaPct: ROUND(ga * 100, 1),
    dropPctPoints: ROUND((g0 - ga) * 100, 1),
    // 保本（元）
    beBeforeYuan: Math.round(beBefore),
    beAfterYuan: Math.round(beAfter),
    beIncreasePct: ROUND((beAfter / beBefore - 1) * 100, 1),
    // 打平所需客流（倍数与百分比；1.1224 ⇒ 需多来 12.2%）
    trafficMultiple: ROUND(k, 4),
    needTrafficPct: ROUND((k - 1) * 100, 1),
  };
}

module.exports = { promoImpact };
