// cloudfunctions/calcSandbox/selftest.js —— 批次 4 · M2 开店测算自测（S4 锚点，14 项）
// 运行： node cloudfunctions/calcSandbox/selftest.js
// 判据：金额一律「分」整数 ===（无 ±0.01 容差），并做 ±1 分变异回验（判据有鉴别力）。
const { calcSandbox } = require('./service');

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

// S4 标准工况（无模拟摊销）。固定 21,300 元 = 房租 12,000 + 物业 300 + 人工 7,000 + 其他 2,000；目标利润 15,000 元。
const base = {
  rentFen: 1200000, propertyFen: 30000, laborFen: 700000, otherFen: 200000,
  includeAmort: false, simAmortFen: 0,
  varFoodPct: 30, varMktPct: 10, varOtherPct: 5,
  targetProfitFen: 1500000,
};
const r = calcSandbox(base);

check('固定成本合计 = 21,300（2130000分）', r.fixed_total_fen === 2130000, `=${r.fixed_total_fen}分`);
check('综合变动成本率 = 45%', r.composite_var_rate_pct === 45, `=${r.composite_var_rate_pct}%`);
check('边际贡献率 = 55%', r.margin_rate_pct === 0.55, `=${r.margin_rate_pct}`);
check('🏆 保本月营业额 = 38,727.27（3872727分）', r.break_even_monthly_fen === 3872727, `=${r.break_even_monthly_fen}分`);
backcheckFen('保本月营业额', r.break_even_monthly_fen, 3872727);
check('🏆 保本日均 = 1,290.91（129091分）', r.break_even_daily_fen === 129091, `=${r.break_even_daily_fen}分`);
backcheckFen('保本日均', r.break_even_daily_fen, 129091);
check('🏆 目标利润月营收 = 66,000（6600000分）', r.target_monthly_fen === 6600000, `=${r.target_monthly_fen}分`);
backcheckFen('目标利润月营收', r.target_monthly_fen, 6600000);
check('🏆 目标利润日均 = 2,200（220000分）', r.target_daily_fen === 220000, `=${r.target_daily_fen}分`);
backcheckFen('目标利润日均', r.target_daily_fen, 220000);
check('红警 = false', r.red_alert === false);

// 含模拟摊销：叠加 sim_amort 后固定合计变大
const withAmort = calcSandbox({ ...base, includeAmort: true, simAmortFen: 50000 });
check('含模拟摊销 500 元 → 固定合计 = 21,800 元（2180000分）', withAmort.fixed_total_fen === 2180000, `=${withAmort.fixed_total_fen}分`);

// 红警：综合变动成本率 105% → 保本/目标为 null
const red = calcSandbox({ ...base, varFoodPct: 90, varMktPct: 10, varOtherPct: 5 });
check('变动率 105% → red_alert=true', red.red_alert === true);
check('红警下保本月营业额 = null', red.break_even_monthly_fen === null);
check('红警下保本日均 = null', red.break_even_daily_fen === null);
check('红警下目标月营收 = null', red.target_monthly_fen === null);
check('红警下目标日均 = null', red.target_daily_fen === null);

console.log(`\n==== calcSandbox 批次 4 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);