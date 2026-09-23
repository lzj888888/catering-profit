// cloudfunctions/calcSandbox/selftest.js —— M2 开店测算自测（S4 锚点）· v2
// 运行： node cloudfunctions/calcSandbox/selftest.js
// 判据：金额一律「分」整数 ===（无 ±0.01 容差），并做 ±1 分变异回验（判据有鉴别力）。
//
// v2（2026-09-23）：契约由「4 金额 + 3 变效率」改为结构化清单 ⇒ 本自测同步重写。
//   ⚠️ 标准工况**可手算**，任何人拿计算器都能复现（这是 S4 锚点的意义）。
const { calcSandbox } = require('./service');
const { validateInput } = require('./validate');   // round114：入参契约此前零自测覆盖
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
check('D1 指标条数 = 6（毛利率/房租/人工/能耗/管理/平台）', ib.length === 6, `=${ib.length}`);
const pick = (k) => ib.filter((x) => x.key === k)[0] || {};
const irent = pick('rent'), ilabor = pick('labor'), igm = pick('grossMargin'), imkt = pick('mkt'), ienergy = pick('energy');
check('D2 房租占比 = 12,000 ÷ 76,000 = 15.8%', irent.pct === 15.8, `=${irent.pct}%`);
check('D3 房租参考带（正餐·二三线）= 8%~15%', irent.lo === 8 && irent.hi === 15, `=${irent.lo}%~${irent.hi}%`);
check('D4 房租超带上限 ⇒ level=warn', irent.level === 'warn', `=${irent.level}`);
check('D5 房租命中 M1.6 警戒线 15%（15.8 > 15）', irent.redline === 15 && irent.redlineHit === true, `警戒线=${irent.redline} 命中=${irent.redlineHit}`);
check('D6 人工占比 = 9.2%（7,000 ÷ 76,000）', ilabor.pct === 9.2, `=${ilabor.pct}%`);
check('D7 人工低于参考带下限 ⇒ level=good', ilabor.level === 'good', `=${ilabor.level}`);
check('D8 人工未命中警戒线 20%', ilabor.redlineHit === false, `命中=${ilabor.redlineHit}`);
check('D9 菜品毛利率 = 65%（**用户直填值直接对照** —— round111 起不再换算成成本率）', igm.pct === 65, `=${igm.pct}%`);
check('D10 毛利率 65% 达带上限（正餐 55~65）⇒ level=good · gain 方向越高越好', igm.level === 'good', `=${igm.level}`);
check('D11 毛利率未命中 M1.6 警戒线 55%（gain 方向判"低于"才命中 ⇒ 65 不命中）', igm.redline === 55 && igm.redlineHit === false, `警戒线=${igm.redline} 命中=${igm.redlineHit}`);
check('D12 平台费率 = 15% 超参考带上限 10% ⇒ level=bad', imkt.pct === 15 && imkt.level === 'bad', `=${imkt.pct}% / ${imkt.level}`);
check('D13 未填的能耗项占比 = null（未填 ≠ 0 元，前端渲染「—」而不编造 0%）', ienergy.pct === null, `=${ienergy.pct}`);
// ---- round111 新增：口径统一到毛利率 + [D5] 行业校准（钉死，防被"优化"回去）----
check('D14 🔴 方向分区：毛利率 50%（正餐带 55~65）⇒ warn，**不是 good**',
  indicatorRef.levelOf(50, 55, 65, 'gain') === 'warn' && indicatorRef.levelOf(65, 55, 65, 'gain') === 'good',
  `50⇒${indicatorRef.levelOf(50, 55, 65, 'gain')} / 65⇒${indicatorRef.levelOf(65, 55, 65, 'gain')}`);
// ---- round113（2026-09-24）：labor 四业态带按 [D4] 警戒线重定（hi=警戒 / lo=floor(警戒×0.8)）----
// ⚠️ 本条**替换**了 round111 的 D15（原钉 hotpot [18,24]）—— 那组值自身有真错：lo(18) 恰等于警戒线(18)，
//    零余量，"优秀线 == 警戒线"语义不成立；且 dining/cafe 的 lo 更是**高于**警戒线。见 indicatorRef 注。
check('D15 🔴 人工带四业态 = 快餐16~20 / 正餐17~22 / 火锅14~18 / 茶饮14~18（[D4] 警戒线派生 · round113）',
  JSON.stringify(indicatorRef.BANDS.fastfood.labor) === '[16,20]'
  && JSON.stringify(indicatorRef.BANDS.dining.labor) === '[17,22]'
  && JSON.stringify(indicatorRef.BANDS.hotpot.labor) === '[14,18]'
  && JSON.stringify(indicatorRef.BANDS.cafe.labor) === '[14,18]',
  Object.keys(indicatorRef.BANDS).map((b) => b + ':' + indicatorRef.BANDS[b].labor.join('~')).join(' '));
check('D17 🔴 labor 的 lo ≤ 本仓警戒线 20%（否则"优秀"与"命中警戒"会同时成立）',
  Object.keys(indicatorRef.BANDS).every((b) => indicatorRef.BANDS[b].labor[0] <= indicatorRef.REDLINE.labor),
  Object.keys(indicatorRef.BANDS).map((b) => b + ':lo' + indicatorRef.BANDS[b].labor[0]).join(' '));
check('D16 四业态毛利率带（快餐58~68 / 正餐55~65 / 火锅52~67 / 茶饮62~72 · [D5] 校准）',
  JSON.stringify(indicatorRef.BANDS.fastfood.grossMargin) === '[58,68]'
  && JSON.stringify(indicatorRef.BANDS.dining.grossMargin) === '[55,65]'
  && JSON.stringify(indicatorRef.BANDS.hotpot.grossMargin) === '[52,67]'
  && JSON.stringify(indicatorRef.BANDS.cafe.grossMargin) === '[62,72]',
  Object.keys(indicatorRef.BANDS).map((b) => b + ':' + indicatorRef.BANDS[b].grossMargin.join('~')).join(' '));

console.log('\n===== E 城市层级只调「有据可依」的项 =====');
const g = (biz, ind, city) => indicatorRef.bandOf(biz, ind, city);
check('E1 正餐·一线 房租带 = 9.6%~18%（×1.2）', g('dining', 'rent', 'tier1').lo === 9.6 && g('dining', 'rent', 'tier1').hi === 18, JSON.stringify(g('dining', 'rent', 'tier1')));
check('E2 正餐·县城 房租带 = 6%~11.3%（×0.75）', g('dining', 'rent', 'county').lo === 6 && g('dining', 'rent', 'county').hi === 11.3, JSON.stringify(g('dining', 'rent', 'county')));
check('E3 正餐·一线 人工带 = 19.6%~25.3%（[17,22]×1.15 · 17×1.15 的浮点边界由 check_indicator_ref C-④ 钉死）', g('dining', 'labor', 'tier1').lo === 19.6 && g('dining', 'labor', 'tier1').hi === 25.3, JSON.stringify(g('dining', 'labor', 'tier1')));
check('E4 毛利率带**不随城市变**（一线采购贵但售价同步高）', g('dining', 'grossMargin', 'tier1').hi === g('dining', 'grossMargin', 'county').hi && g('dining', 'grossMargin', 'tier1').hi === 65, `一线 ${g('dining', 'grossMargin', 'tier1').hi} / 县城 ${g('dining', 'grossMargin', 'county').hi}`);

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

console.log('\n===== G 参考带预览 bands_preview（round113：填表页"行业参考"的数据源）=====');
check('G1 标准工况返回 6 项参考带（与用户填了什么无关）', r.bands_preview.length === 6, `=${r.bands_preview.length} 项`);
const pv = {};
r.bands_preview.forEach((x) => { pv[x.key] = x; });
check('G2 预览带 ≡ indicators 的带（同一 bandOf 单源，不允许两套数）',
  pv.rent.lo === irent.lo && pv.rent.hi === irent.hi
  && pv.labor.lo === ilabor.lo && pv.labor.hi === ilabor.hi,
  `rent ${pv.rent.lo}~${pv.rent.hi} / labor ${pv.labor.lo}~${pv.labor.hi}`);
check('G3 预览带含方向（grossMargin=gain / 其余 cost）—— 前端据此选"偏高/偏低"文案表',
  pv.grossMargin.dir === 'gain' && pv.rent.dir === 'cost' && pv.labor.dir === 'cost',
  `gm=${pv.grossMargin.dir} rent=${pv.rent.dir} labor=${pv.labor.dir}`);
check('G4 预览带带出警戒线（与 M1.6 并列展示，不互覆盖）',
  pv.rent.redline === 15 && pv.labor.redline === 20 && pv.grossMargin.redline === 55,
  `rent=${pv.rent.redline} labor=${pv.labor.redline} gm=${pv.grossMargin.redline}`);
check('G5 🔴 红警时预览带仍在（红警=算不出保本点，不等于"没有行业参考"）',
  !!red.bands_preview && red.bands_preview.length === 6,
  red.bands_preview ? `${red.bands_preview.length} 项` : 'null（缺失 ⚠️）');
check('G6 空入参也给默认业态（dining）的参考带，不崩',
  (() => { const z = calcSandbox({}); return Array.isArray(z.bands_preview) && z.bands_preview.length === 6; })());

console.log('\n===== H 参考金额反算（round114 · 预计月营业额锚点）=====');
// 正餐 · 二三线 · 预计月营业额 100,000 元（10000000 分）：
//   房租 带[8,15] 中值 11.5% ⇒ 11,500.00 元；人工 [17,22]→19.5% ⇒ 19,500.00 元
//   能耗 [3,5]  →4%         ⇒  4,000.00 元；管理 [5,10]→7.5% ⇒  7,500.00 元
const withRev = calcSandbox(Object.assign({}, base, { expectedRevenueFen: 10000000 }));
const am = withRev.amount_preview || [];
const amOf = (k) => am.filter((x) => x.key === k)[0] || {};
check('H1 填了预计营业额 ⇒ 反算 4 项（房租/人工/水电气/管理费）', am.length === 4, `=${am.length} 项`);
check('H2 房租参考金额 = 100,000 × 11.5% = 11,500（1150000分）', amOf('rent').fen === 1150000, `=${amOf('rent').fen}分`);
check('H3 人工参考金额 = 19,500（1950000分）', amOf('labor').fen === 1950000, `=${amOf('labor').fen}分`);
check('H4 能耗/管理 = 4,000 / 7,500（固定项 key=utility，指标 indKey=energy —— 双键各归其位）',
  amOf('utility').fen === 400000 && amOf('utility').indKey === 'energy' && amOf('manage').fen === 750000,
  `utility=${amOf('utility').fen}/${amOf('utility').indKey} manage=${amOf('manage').fen}`);
check('H5 🔴 未填营业额（0）⇒ 空数组，不编造 0 元', (calcSandbox(base).amount_preview || []).length === 0);
check('H6 🔴 pct 与 fen 自洽（fen == 营业额 × pct%，客户拿计算器可复算）',
  am.length === 4 && am.every((x) => x.fen === Math.round(10000000 * x.pct / 100)),
  am.map((x) => `${x.key}:${x.pct}%→${x.fen}`).join(' '));
check('H7 城市系数生效：一线人工 22.5% ⇒ 2,250,000 分（22.45% 先定标再算金额）',
  (() => {
    const t1 = calcSandbox(Object.assign({}, base, { cityTier: 'tier1', expectedRevenueFen: 10000000 })).amount_preview;
    const l = t1.filter((x) => x.key === 'labor')[0] || {};
    return l.pct === 22.5 && l.fen === 2250000;
  })());
check('H8 🔴 红警时参考金额仍在（红警=算不出保本点，不等于"我没有参考"）',
  (() => {
    const r2 = calcSandbox({
      cityTier: 'tier23', bizType: 'dining', grossMarginPct: 5,
      varItems: [{ key: 'takeawayComm', pct: 96 }], expectedRevenueFen: 10000000,
    });
    return r2.red_alert === true && (r2.amount_preview || []).length === 4;
  })());

console.log('\n===== I 入参契约（round114 · 补测：此前 validate 零自测覆盖）=====');
// 🔴 本条守的是本轮修回的**真缺陷**：M2 页面在用户"一个字没填"时也要能拿到参考区间/参考金额，
//    而旧校验要求 fixed_items 至少一项 ⇒ 空表单被拒 ⇒ 参考区间**根本没显示**（round113 零生效）。
const vEmpty = validateInput({
  shop_id: 's', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], fixed_items: [], var_items: [],
  gross_margin_pct: 65, target_profit_fen: 0,
});
check('I1 🔴 空 fixed_items 必须放行（否则"没填就先看行业参考"整条路走不通 —— round114 修）',
  !vEmpty.error, vEmpty.error ? vEmpty.error + ' / ' + vEmpty.msg : 'error=null');
check('I2 空表单的 clean 可跑 service 且不崩（参考区间照常下发）',
  !vEmpty.error && (() => {
    const z = calcSandbox(vEmpty.clean);
    return z.fixed_total_fen === 0 && Array.isArray(z.bands_preview) && z.bands_preview.length === 6;
  })());
check('I3 预计月营业额缺省 = 0（选填；前端不传也不报错）',
  !vEmpty.error && vEmpty.clean.expectedRevenueFen === 0);
check('I4 预计月营业额非整数分 ⇒ 拒（放宽非空 ≠ 放宽格式）', (() => {
  const e = validateInput({
    shop_id: 's', city_tier: 'tier23', biz_type: 'dining',
    fixed_items: [], build_items: [], var_items: [],
    gross_margin_pct: 65, target_profit_fen: 0, expected_revenue_fen: 12.5,
  });
  return !!e.error;
})());
check('I5 fixed_items 的 key 越白名单 / 重复 ⇒ 仍拒（放宽非空 ≠ 放宽内容）', (() => {
  const a = validateInput({ shop_id: 's', city_tier: 'tier23', biz_type: 'dining',
    fixed_items: [{ key: 'hack', fen: 1 }], build_items: [], var_items: [], gross_margin_pct: 65, target_profit_fen: 0 });
  const b = validateInput({ shop_id: 's', city_tier: 'tier23', biz_type: 'dining',
    fixed_items: [{ key: 'rent', fen: 1 }, { key: 'rent', fen: 2 }], build_items: [], var_items: [], gross_margin_pct: 65, target_profit_fen: 0 });
  return !!a.error && !!b.error;
})());

console.log(`\n==== calcSandbox M2 v2 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
