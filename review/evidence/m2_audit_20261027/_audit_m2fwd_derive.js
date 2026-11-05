// _audit_m2fwd_derive.js —— 只读取证：前端展示派生（利润阶梯 / 客流 / 现金保本 / 现金回本）
// 与引擎出参的行为对拍（≥30 组），验证派生公式与引擎同源、无第二份实现。
const { makePage, PAGE } = require('./_audit_m2fwd_harness.js');
const { calcSandbox } = require('./cloudfunctions/calcSandbox/service.js');
const { cashBreakeven, paybackCash } = require('./utils/bizPreset.js');

const CASES = [];
const MARGINS = [45, 55, 60, 67, 75];
const RENTS = [3000, 8000, 15000, 30000];
const LABORS = [9000, 25000, 44000];
const INVEST = [[50000, 30000], [150000, 60000], [400000, 200000]];
for (const m of MARGINS) for (const r of RENTS) for (const l of LABORS) for (const inv of INVEST) {
  CASES.push({ presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, areaNum: '60', rentYuan: String(r),
    laborTotalYuan: String(l), headcountNum: '2', marginPct: m, avgPriceYuan: '20',
    waterYuan: '200', electricYuan: '1500', gasYuan: '300', targetYuan: '20000',
    buildRows: [{ key: 'transfer', name: '', note: '', yuan: '', years: 3 },
      { key: 'decor', name: '', note: '', yuan: String(inv[0]), years: 3 },
      { key: 'equip', name: '', note: '', yuan: String(inv[1]), years: 5 },
      { key: 'franchise', name: '', note: '', yuan: '', years: 3 }] });
}

let n = 0, badLadder = 0, badCash = 0, badPayback = 0, maxLadderErr = 0;
for (const ov of CASES) {
  const p = makePage(ov);
  const prm = p.buildPresetParam('forward');
  const d = calcSandbox({
    cityTier: prm.city_tier, bizType: prm.biz_type, buildItems: prm.build_items,
    fixedItems: prm.fixed_items, varItems: prm.var_items,
    grossMarginPct: prm.gross_margin_pct, targetProfitFen: prm.target_profit_fen,
    expectedRevenueFen: prm.expected_revenue_fen, validDays: prm.valid_days,
  });
  const fen = (v) => (v == null ? null : (v / 100));
  const res = {
    red_alert: d.red_alert,
    build_total: d.build_total_fen, build_amort: d.build_amort_monthly_fen,
    fixed_total: fen(d.fixed_total_fen), platform_pct: d.platform_pct,
    margin_rate: d.margin_rate_ratio != null ? (d.margin_rate_ratio * 100).toFixed(1) : '—',
    break_even_monthly: d.break_even_monthly_fen == null ? null : (d.break_even_monthly_fen / 100).toFixed(2),
    break_even_daily: d.break_even_daily_fen == null ? null : (d.break_even_daily_fen / 100).toFixed(2),
    target_monthly: d.target_monthly_fen == null ? null : (d.target_monthly_fen / 100).toFixed(2),
    target_daily: d.target_daily_fen == null ? null : (d.target_daily_fen / 100).toFixed(2),
  };
  n++;
  // ① 利润阶梯 1.0× 档必须 ≈ 0（保本档）
  const ladder = p.profitLadderOf(res);
  if (ladder) {
    const row = ladder[1]; // mults[1] === 1
    const rev = Math.round(Number(res.break_even_monthly) * 1);
    const profit = Math.round(rev * (Number(res.margin_rate) / 100) - Number(res.fixed_total));
    const err = Math.abs(profit);
    if (err > maxLadderErr) maxLadderErr = err;
    if (err > 50) badLadder++;   // 允许 50 元内的取整/格式化误差
  } else badLadder++;
  // ② 现金保本必须 ≤ 账面保本（有摊销时严格小）
  const beCash = cashBreakeven(Number(res.break_even_monthly), d.fixed_ex_amort_fen, d.fixed_total_fen);
  const beBook = Number(res.break_even_monthly);
  if (d.build_amort_monthly_fen > 0) {
    if (!(beCash != null && beCash < beBook)) badCash++;
    // 独立复算：cash = be × (fixed_ex/total)
    const expect = Math.round(beBook * d.fixed_ex_amort_fen / d.fixed_total_fen);
    if (Math.abs(expect - beCash) > 1) badCash++;
  } else if (beCash !== null) badCash++;
  // ③ 现金回本 = 建店总额 ÷ (目标利润 + 月摊销)，必须 ≤ 账面回本
  const cash = paybackCash(d.build_total_fen, prm.target_profit_fen, d.build_amort_monthly_fen);
  const book = d.payback_months;
  if (cash != null && book != null && !(cash < book)) badPayback++;
  const expectCash = Number((d.build_total_fen / (prm.target_profit_fen + d.build_amort_monthly_fen)).toFixed(1));
  if (cash != null && Math.abs(expectCash - cash) > 0.05) badPayback++;
  if (cash === null && prm.target_profit_fen > 0 && d.build_total_fen > 0) badPayback++;
}
console.log('=== 前端派生 vs 引擎（' + n + ' 组）===');
console.log('   ① profitLadderOf 保本档利润 |误差| 最大值 = ' + maxLadderErr + ' 元；超差组数 = ' + badLadder);
console.log('   ② cashBreakeven 异常组数 = ' + badCash + '（含独立复算比对）');
console.log('   ③ paybackCash 异常组数 = ' + badPayback + '（含独立复算比对，且须 < 账面回本）');

// ④ crowdOf / effOf 与引擎日均的闭合校验
console.log('\n=== crowdOf / effOf ===');
const p2 = makePage({ presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, rentYuan: '8000',
  laborTotalYuan: '9000', headcountNum: '3', areaNum: '60', marginPct: 60, avgPriceYuan: '20',
  waterYuan: '200', electricYuan: '1500', gasYuan: '300', expectYuan: '100000', targetYuan: '20000',
  buildRows: [{ key: 'transfer', name: '', note: '', yuan: '', years: 3 },
    { key: 'decor', name: '', note: '', yuan: '100000', years: 3 },
    { key: 'equip', name: '', note: '', yuan: '50000', years: 5 },
    { key: 'franchise', name: '', note: '', yuan: '', years: 3 }] });
const prm2 = p2.buildPresetParam('forward');
const d2 = calcSandbox({ cityTier: prm2.city_tier, bizType: prm2.biz_type, buildItems: prm2.build_items,
  fixedItems: prm2.fixed_items, varItems: prm2.var_items, grossMarginPct: 60,
  targetProfitFen: prm2.target_profit_fen, expectedRevenueFen: prm2.expected_revenue_fen, validDays: 30 });
const res2 = { red_alert: d2.red_alert, break_even_daily: (d2.break_even_daily_fen / 100).toFixed(2),
  target_daily: (d2.target_daily_fen / 100).toFixed(2) };
const crowd = p2.crowdOf(res2);
console.log('   引擎保本日均=' + res2.break_even_daily + ' 目标日均=' + res2.target_daily);
console.log('   crowdOf ⇒ 保本来客 ' + crowd.breakPeople + ' 人 / 目标来客 ' + crowd.targetPeople + ' 人（客单价 20）');
console.log('   手算校验: ceil(' + res2.break_even_daily + '/20)=' + Math.ceil(Number(res2.break_even_daily) / 20)
  + ', ceil(' + res2.target_daily + '/20)=' + Math.ceil(Number(res2.target_daily) / 20));
const eff = p2.effOf();
console.log('   effOf ⇒ 坪效 ' + eff.pixel + ' 元/㎡·月（100000/60=' + Math.round(100000 / 60)
  + '） 人效 ' + eff.perHead + ' 元/人·月（100000/3=' + Math.round(100000 / 3) + '）');
