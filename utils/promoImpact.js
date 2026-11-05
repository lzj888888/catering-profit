// utils/promoImpact.js —— 促销（打折）对毛利率与保本线的影响
//
// 🔴 定位（2026-10-18 与李老师定稿）：
//   M2 不依赖账本、不依赖菜品成本卡；本文件只做「纯假设推演」。
//   老板输入：折扣力度 + 几成订单用券；系统输出：活动期毛利率、保本变化、打平所需客流。
//
// 公式（三项均已独立复算，见 review/NOTE_2026-10-18_M2活动测算_豆包GUI三轮.md）：
//   记 G0 = 日常毛利率；d = 折扣系数（8 折 ⇒ 0.8）；W = 活动订单占比
//   ⚠️ W 的口径（R337/M2-A1 定稿）：**页面问的是订单占比**（"几成订单用券"），
//      公式里按营业额占比使用。两者只有在「活动单与非活动单客单价接近」时才相等，
//      所以页面必须同时显示 promoApproxNote（"按单数比例近似（假设客单价接近）"）。
//      ⇒ 本文件不改公式语义；口径差由页面文案显式承担，不许静默近似。
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
 * @param {number} p.costRatePct  商家出资的活动成本占**实收**比（百分数；赠送/奖品/自贴券）
 * @param {number} p.weightPct    活动订单占比（百分数，30 表示 30%）
 *                                页面口径＝「几成订单用券」；公式内按营业额占比使用，
 *                                前提是活动单与非活动单客单价接近（页面已注明该近似）。
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

  const cut = w * (1 - d);          // 被活动让掉的那部分毛利率（占原价）
  const numer = g0 - cut;           // 让价后的边际贡献（占**原价**）
  const denom = 1 - cut;            // 让价后的实收率（实收 ÷ 原价）
  // 🔴 R370（纯堂食口径 + 口径修正）：
  //   a = 商家出资的活动成本率（占**实收**）—— 赠酒/奖品/自贴券，随流水变动，属变动成本。
  //   实收口径的边际率 ga = numer/denom − a；原价口径的边际贡献 = ga × denom = numer − a·denom。
  const a = Math.max(0, Number(p && p.costRatePct) || 0) / 100;
  const numerNet = numer - a * denom;

  // 让价 + 活动成本 之和 ≥ 边际贡献 ⇒ 卖越多亏越多，不存在保本点
  if (!(numerNet > 0)) return { ok: false, reason: 'negativeMargin' };

  const ga = numerNet / denom;
  const beBefore = fixed / g0;
  // 🔴🔴 R370 修必现错数：原来 `beAfter = fixed / ga` 是**实收口径**，却与
  //   `beBefore = fixed / g0`（**原价口径**）并排显示并相除 ⇒ 涨幅被系统性低估
  //   （实测 G0=63%/8折 ⇒ 显示 +17.2%，真值 +46.5%，与同一张卡的"打平要多来 46.5%"自相矛盾）。
  //   ⇒ 保本额一律用**原价口径**（老板对账看的是流水）；实收口径另给 beAfterNetYuan。
  const beAfter = fixed / numerNet;
  const beAfterNet = fixed / ga;
  const k = g0 / numerNet;

  return {
    ok: true,
    // 毛利率（小数，页面自行转百分数）
    gaRatio: ga,
    gaPct: ROUND(ga * 100, 1),
    dropPctPoints: ROUND((g0 - ga) * 100, 1),
    // 保本（元）—— 两个都是**原价流水**口径，可直接相减/相除
    beBeforeYuan: Math.round(beBefore),
    beAfterYuan: Math.round(beAfter),
    // 实收口径（现金到手）—— 只用于文案说明，不参与涨幅比较
    beAfterNetYuan: Math.round(beAfterNet),
    costRatePct: ROUND(a * 100, 2),
    beIncreasePct: ROUND((beAfter / beBefore - 1) * 100, 1),
    // 打平所需客流（倍数与百分比；1.1224 ⇒ 需多来 12.2%）
    // 🔴 R375：**原价口径的边际贡献率**（一小数，0.43 = 每卖 1 元原价流水，留下 0.43 元）。
    //   给「做活动还想月赚 X」反推用：所需原价流水 = (固定费用 + 目标利润) ÷ 本值。
    //   为什么不用 gaPct：gaPct 是**实收口径**（分母是实收），拿它配"原价流水"会算小。
    marginalOnGross: ROUND(numerNet, 6),
    trafficMultiple: ROUND(k, 4),
    needTrafficPct: ROUND((k - 1) * 100, 1),
  };
}

module.exports = { promoImpact };
