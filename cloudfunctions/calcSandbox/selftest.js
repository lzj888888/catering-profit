// cloudfunctions/calcSandbox/selftest.js —— M2 开店测算自测（S4 锚点）· v2
// 运行： node cloudfunctions/calcSandbox/selftest.js
// 判据：金额一律「分」整数 ===（无 ±0.01 容差），并做 ±1 分变异回验（判据有鉴别力）。
//
// v2（2026-09-23）：契约由「4 金额 + 3 变效率」改为结构化清单 ⇒ 本自测同步重写。
//   ⚠️ 标准工况**可手算**，任何人拿计算器都能复现（这是 S4 锚点的意义）。
const { calcSandbox } = require('./service');
const { indicatorRef } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
function assertFen(actual, expected) { return Number.isInteger(actual) && actual === expected; }
function backcheckFen(name, actual, expected) {
  const discrim = !assertFen(actual, expected + 1) && !assertFen(actual, expected - 1);
  if (discrim) pass++; else failN++;
  console.log(`🔍 [变异回验] ${name}：期望±1分均判红，±1 分鉴别力 = ${discrim ? '✅' : '❌'}`);
  return discrim;
}

// ============ 标准工况（正餐 · 二三线）============
// 建店投入：装修 360,000 元 / 3 年 → 10,000 元/月；加盟 180,000 元 / 3 年 → 5,000 元/月；
//          设备 120,000 元 / 5 年 → 2,000 元/月 ⇒ 合计投入 660,000 元，月摊销 17,000 元
// 每月固定：房租 12,000 + 人工 7,000 + 管理 2,000 = 21,000 元
// ⇒ 固定成本合计 = 21,000 + 17,000 = 38,000 元
// 菜品毛利率 65% ⇒ 食材成本率 35%；外卖佣金 15% ⇒ 综合变动成本率 50%，边际贡献率 0.5
// ⇒ 保本月营业额 = 38,000 ÷ 0.5 = 76,000 元；目标利润 15,000 元 ⇒ 目标月营收 = 106,000 元
const base = {
  cityTier: 'tier23', bizType: 'dining',
  buildItems: [
    { key: 'decor', fen: 36000000, years: 3 },
    { key: 'franchise', fen: 18000000, years: 3 },
    { key: 'equip', fen: 12000000, years: 5 },
  ],
  fixedItems: [
    { key: 'rent', fen: 1200000 },
    { key: 'labor', fen: 700000 },
    { key: 'manage', fen: 200000 },
  ],
  varItems: [{ key: 'takeawayComm', pct: 15 }],
  grossMarginPct: 65,
  targetProfitFen: 1500000,
};
const r = calcSandbox(base);

console.log('===== A 投入与固定成本 =====');
check('A1 建店总投入 = 660,000（66000000分）', r.build_total_fen === 66000000, `=${r.build_total_fen}分`);
check('A2 月摊销 = 17,000（1700000分）', r.build_amort_monthly_fen === 1700000, `=${r.build_amort_monthly_fen}分`);
check('A3 不含摊销固定 = 21,000（2100000分）', r.fixed_ex_amort_fen === 2100000, `=${r.fixed_ex_amort_fen}分`);
check('A4 固定成本合计 = 38,000（3800000分）', r.fixed_total_fen === 3800000, `=${r.fixed_total_fen}分`);
backcheckFen('固定成本合计', r.fixed_total_fen, 3800000);

console.log('\n===== B 变动成本率与边际贡献 =====');
check('B1 食材成本率 = 100 − 65 = 35%', r.food_cost_pct === 35, `=${r.food_cost_pct}%`);
check('B2 挂钩费率合计 = 15%', r.platform_pct === 15, `=${r.platform_pct}%`);
check('B3 综合变动成本率 = 35 + 15 = 50%', r.composite_var_rate_pct === 50, `=${r.composite_var_rate_pct}%`);
check('B4 边际贡献率 = 0.5', r.margin_rate_ratio === 0.5, `=${r.margin_rate_ratio}`);
check('B5 红警 = false', r.red_alert === false);

console.log('\n===== C 四个核心结果 =====');
check('C1 🏆 保本月营业额 = 76,000（7600000分）', r.break_even_monthly_fen === 7600000, `=${r.break_even_monthly_fen}分`);
backcheckFen('保本月营业额', r.break_even_monthly_fen, 7600000);
check('C2 🏆 保本日均 = 2,533.33（253333分）', r.break_even_daily_fen === 253333, `=${r.break_even_daily_fen}分`);
backcheckFen('保本日均', r.break_even_daily_fen, 253333);
check('C3 🏆 目标利润月营收 = 106,000（10600000分）', r.target_monthly_fen === 10600000, `=${r.target_monthly_fen}分`);
backcheckFen('目标利润月营收', r.target_monthly_fen, 10600000);
check('C4 目标利润日均 = 3,533.33（353333分）', r.target_daily_fen === 353333, `=${r.target_daily_fen}分`);
check('C5 回本周期 = 660,000 ÷ 15,000 = 44 月', r.payback_months === 44, `=${r.payback_months}月`);

console.log('\n===== D 餐饮指标对照（分母=保本营业额 76,000）=====');
const ib = r.indicators_at_breakeven;
check('D1 指标条数 = 6（食材/房租/人工/能耗/管理/平台）', ib.length === 6, `=${ib.length}`);
const pick = (k) => ib.filter((x) => x.key === k)[0] || {};
const irent = pick('rent'), ilabor = pick('labor'), ifood = pick('food'), imkt = pick('mkt'), ienergy = pick('energy');
check('D2 房租占比 = 12,000 ÷ 76,000 = 15.8%', irent.pct === 15.8, `=${irent.pct}%`);
check('D3 房租参考带（正餐·二三线）= 8%~15%', irent.lo === 8 && irent.hi === 15, `=${irent.lo}%~${irent.hi}%`);
check('D4 房租超带上限 ⇒ level=warn', irent.level === 'warn', `=${irent.level}`);
check('D5 房租命中 M1.6 警戒线 15%（15.8 > 15）', irent.redline === 15 && irent.redlineHit === true, `警戒线=${irent.redline} 命中=${irent.redlineHit}`);
check('D6 人工占比 = 9.2%（7,000 ÷ 76,000）', ilabor.pct === 9.2, `=${ilabor.pct}%`);
check('D7 人工低于参考带下限 ⇒ level=good', ilabor.level === 'good', `=${ilabor.level}`);
check('D8 人工未命中警戒线 20%', ilabor.redlineHit === false, `命中=${ilabor.redlineHit}`);
check('D9 食材成本率 = 35%（由毛利率反推，非用户直填）', ifood.pct === 35, `=${ifood.pct}%`);
check('D10 平台费率 = 15% 超参考带上限 10% ⇒ level=bad', imkt.pct === 15 && imkt.level === 'bad', `=${imkt.pct}% / ${imkt.level}`);
check('D11 未填的能耗项占比 = null（未填 ≠ 0 元，前端渲染「—」而不编造 0%）', ienergy.pct === null, `=${ienergy.pct}`);

console.log('\n===== E 城市层级只调「有据可依」的项 =====');
const g = (biz, ind, city) => indicatorRef.bandOf(biz, ind, city);
check('E1 正餐·一线 房租带 = 9.6%~18%（×1.2）', g('dining', 'rent', 'tier1').lo === 9.6 && g('dining', 'rent', 'tier1').hi === 18, JSON.stringify(g('dining', 'rent', 'tier1')));
check('E2 正餐·县城 房租带 = 6%~11.3%（×0.75）', g('dining', 'rent', 'county').lo === 6 && g('dining', 'rent', 'county').hi === 11.3, JSON.stringify(g('dining', 'rent', 'county')));
check('E3 正餐·一线 人工带 = 28.8%~40.3%（×1.15）', g('dining', 'labor', 'tier1').lo === 28.8 && g('dining', 'labor', 'tier1').hi === 40.3, JSON.stringify(g('dining', 'labor', 'tier1')));
check('E4 食材带**不随城市变**（一线采购贵但售价同步高）', g('dining', 'food', 'tier1').hi === g('dining', 'food', 'county').hi && g('dining', 'food', 'tier1').hi === 45, `一线 ${g('dining', 'food', 'tier1').hi} / 县城 ${g('dining', 'food', 'county').hi}`);

console.log('\n===== F 红警与边界（不编造数据）=====');
const red = calcSandbox({ ...base, grossMarginPct: 10, varItems: [{ key: 'takeawayComm', pct: 95 }] });
check('F1 综合变动率 90+95=185% ⇒ red_alert=true', red.red_alert === true, `=${red.composite_var_rate_pct}%`);
check('F2 红警下保本月营业额 = null', red.break_even_monthly_fen === null);
check('F3 红警下目标月营收 = null', red.target_monthly_fen === null);
check('F4 红警下指标对照 = 空数组（不基于无效分母编造）', red.indicators_at_breakeven.length === 0);
const noProfit = calcSandbox({ ...base, targetProfitFen: 0 });
check('F5 目标利润 = 0 ⇒ 回本周期 = null（不做除零编造）', noProfit.payback_months === null, `=${noProfit.payback_months}`);
check('F6 目标利润 = 0 ⇒ 目标月营收 = 保本月营收', noProfit.target_monthly_fen === noProfit.break_even_monthly_fen, `${noProfit.target_monthly_fen} / ${noProfit.break_even_monthly_fen}`);
const noBuild = calcSandbox({ ...base, buildItems: [] });
check('F7 无建店投入 ⇒ 月摊销 = 0、固定合计 = 21,000', noBuild.build_amort_monthly_fen === 0 && noBuild.fixed_total_fen === 2100000, `${noBuild.build_amort_monthly_fen} / ${noBuild.fixed_total_fen}`);
check('F8 空入参不崩且全零', (() => { const z = calcSandbox({}); return z.fixed_total_fen === 0 && z.build_total_fen === 0; })());

console.log(`\n==== calcSandbox M2 v2 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
