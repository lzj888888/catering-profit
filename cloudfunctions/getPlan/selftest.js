// cloudfunctions/getPlan/selftest.js —— M2v1.2 多方案存储自测（只读函数 · 复现规范 §十 五组锚点）
// 运行：node cloudfunctions/getPlan/selftest.js
//
// getPlan 是**只读**函数（不内联引擎、不写快照）。本自测用生产引擎 + savePlan 的 paramMap，
// 验证 getPlan 依赖的「从存库 param_json 取回 → paramToClean → calcSandbox 实时重算」这条路径
// 能无损复现首次出参 —— 这是列表卡片快照 / 并排对比重算成立的前提。
const E = require('../../cloudfunctions/calcSandbox/service.js');   // 🔴 生产引擎
const { calcSandbox, calcSandboxReverse } = E;
const { paramToClean } = require('../../cloudfunctions/savePlan/paramMap.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? ' · ' + detail : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? ' · ' + detail : ''}`); }
}
const YUAN = 100;
const y2f = (y) => Math.round(y * YUAN);

const CLEAN_FWD = {
  mode: 'forward', cityTier: 'tier23', bizType: 'dining',
  buildItems: [
    { key: 'decor', fen: y2f(360000), years: 3 },
    { key: 'franchise', fen: y2f(180000), years: 3 },
    { key: 'equip', fen: y2f(120000), years: 5 },
  ],
  fixedItems: [
    { key: 'rent', fen: y2f(12000) }, { key: 'labor', fen: y2f(7000) }, { key: 'manage', fen: y2f(2000) },
  ],
  varItems: [{ key: 'takeawayComm', pct: 15 }],
  grossMarginPct: 65, targetProfitFen: y2f(15000), expectedRevenueFen: 0,
};
const CLEAN_REV = {
  mode: 'reverse', cityTier: 'tier23', bizType: 'dining',
  buildItems: [],
  fixedItems: [{ key: 'labor', fen: y2f(28000) }],
  varItems: [],
  grossMarginPct: 60, targetProfitFen: y2f(20000), expectedRevenueFen: 0,
  rev_price_fen: y2f(45), seats: 20, open_days: 30, target_rent_rate: 12, pixel_eff_fen: y2f(40),
};
const P_FWD = {
  mode: 'forward', city_tier: 'tier23', biz_type: 'dining',
  build_items: CLEAN_FWD.buildItems, fixed_items: CLEAN_FWD.fixedItems, var_items: CLEAN_FWD.varItems,
  gross_margin_pct: 65, target_profit_fen: y2f(15000), expected_revenue_fen: 0,
  rev_price_fen: 0, seats: 0, open_days: 30, target_rent_rate: 0, pixel_eff_fen: 0,
};
const P_REV = {
  mode: 'reverse', city_tier: 'tier23', biz_type: 'dining',
  build_items: [], fixed_items: CLEAN_REV.fixedItems, var_items: [],
  gross_margin_pct: 60, target_profit_fen: y2f(20000), expected_revenue_fen: 0,
  rev_price_fen: y2f(45), seats: 20, open_days: 30, target_rent_rate: 12, pixel_eff_fen: y2f(40),
};

console.log('===== ① 旧锚点回归（正算 · M2.10 标准工况）=====');
const A1 = calcSandbox(CLEAN_FWD);
check('660000 / 17000 / 21000 / 38000 元（建店投入/月摊/不含摊固定/含摊固定）',
  A1.build_total_fen === y2f(660000) && A1.build_amort_monthly_fen === y2f(17000)
  && A1.fixed_ex_amort_fen === y2f(21000) && A1.fixed_total_fen === y2f(38000),
  `${A1.build_total_fen}/${A1.build_amort_monthly_fen}/${A1.fixed_ex_amort_fen}/${A1.fixed_total_fen}`);
check('综合变动率 50% / 保本 76000 / 目标 106000 / 回本 44 月',
  A1.composite_var_rate_pct === 50 && A1.break_even_monthly_fen === y2f(76000)
  && A1.target_monthly_fen === y2f(106000) && A1.payback_months === 44,
  `${A1.composite_var_rate_pct}%/${A1.break_even_monthly_fen}/${A1.target_monthly_fen}/${A1.payback_months}`);

console.log('\n===== ②-A 正算重算路径（param_json → clean → calcSandbox）=====');
const A2 = calcSandbox(paramToClean(P_FWD));
check('重算出参 === 首次出参（逐字段 JSON 全等）', JSON.stringify(A2) === JSON.stringify(A1), '');

console.log('\n===== ②-B 反推重算路径（R=100000 / 房租上限 12000 / 日均 74.07 / 翻台 3.70 / 面积 300）=====');
const R1 = calcSandboxReverse(CLEAN_REV);
const R2 = calcSandboxReverse(paramToClean(P_REV));
check('反推重算 === 首次（逐字段 JSON 全等）', JSON.stringify(R2) === JSON.stringify(R1), '');
check('R / 房租上限 / 日均客流 / 翻台 / 面积上限',
  R1.target_monthly_fen === y2f(100000) && R1.rent_cap_fen === y2f(12000)
  && R1.daily_traffic === 74.07 && R1.turn_rate === 3.7 && R1.area_cap_sqm === 300,
  `${R1.target_monthly_fen}/${R1.rent_cap_fen}/${R1.daily_traffic}/${R1.turn_rate}/${R1.area_cap_sqm}`);

console.log('\n===== ③ 反例（命名口径 / 缺字段 —— 规则有鉴别力）=====');
const toCamel = (p) => {
  const c = {};
  for (const k of Object.keys(p)) c[k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())] = p[k];
  return c;
};
const A3 = calcSandbox(paramToClean(toCamel(P_FWD)));
check('camel 写法 ⇒ 目标月营收 null（不是 10600000）', A3.target_monthly_fen === null, `=${A3.target_monthly_fen}`);
const R3 = calcSandboxReverse(paramToClean(P_REV, ['seats']));
// 对齐权威锚点 recalc_anchors.js：seats 漏掉 → 分母 0 → 翻台非有限值（不编造）。
check('漏 seats ⇒ 翻台非有限值（分母 0，不编造）', !Number.isFinite(R3.turn_rate), `=${String(R3.turn_rate)}`);
const R4 = calcSandboxReverse(paramToClean(P_REV, ['pixel_eff_fen']));
check('漏 pixel_eff_fen ⇒ 面积上限 null', R4.area_cap_sqm === null, `=${JSON.stringify(R4.area_cap_sqm)}`);

console.log('\n===== ④ 边界（红警 ⇒ 全 null，不编造）=====');
const red = Object.assign({}, CLEAN_REV, { grossMarginPct: 30, target_rent_rate: 60 });
const R5 = calcSandboxReverse(red);
check('红警触发且 R 与派生量全 null',
  R5.red_alert === true && R5.target_monthly_fen === null
  && [R5.rent_cap_fen, R5.monthly_traffic, R5.daily_traffic, R5.turn_rate, R5.area_cap_sqm]
    .every((x) => x === null), '');

console.log(`\n===== getPlan 自测：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);