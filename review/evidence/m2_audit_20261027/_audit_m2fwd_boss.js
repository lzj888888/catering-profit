// _audit_m2fwd_boss.js —— 只读取证：老板给的样例「60㎡ 快餐 / 房租 8000 / 2 人 / 人均 4500 / 毛利率 60% / 投入 15 万」
// ⚠️ 「投入 15 万」有两种读法（建店投入 vs 初始总投入），**两种都跑**，场景定义写清，避免把两个场景当一条基线。
const { run, makePage } = require('./_audit_m2fwd_engine.js');
const { paybackCash, cashBreakeven } = require('./utils/bizPreset.js');

const BASE = {
  presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0,
  areaNum: '60', rentYuan: '8000', headcountNum: '2',
  laborTotalYuan: '9000',          // 2 人 × 人均 4500
  laborUnitYuan: '4500',
  marginPct: 60, avgPriceYuan: '20', targetYuan: '20000',
};
const BUILD15 = [
  { key: 'transfer', name: '', note: '', yuan: '', years: 3 },
  { key: 'decor', name: '', note: '', yuan: '100000', years: 3 },
  { key: 'equip', name: '', note: '', yuan: '50000', years: 5 },
  { key: 'franchise', name: '', note: '', yuan: '', years: 3 },
];

function show(tag, ov, investYuan) {
  const r = run(ov);
  if (r.err) { console.log(tag + ' ⇒ 校验失败 ' + r.err); return; }
  const p = makePage(ov).buildPresetParam('forward');
  const d = r._d;
  const cashPayback = paybackCash(d.build_total_fen, p.target_profit_fen, d.build_amort_monthly_fen);
  const userPayback = investYuan > 0
    ? paybackCash(investYuan * 100, p.target_profit_fen, d.build_amort_monthly_fen) : null;
  const beCash = cashBreakeven(Number(d.break_even_monthly_fen) / 100, d.fixed_ex_amort_fen, d.fixed_total_fen);
  console.log('【' + tag + '】');
  console.log('   固定成本 = ' + r.fixed_items.join(' , ') + '  | 挂钩费率 = ' + r.var_items.join(','));
  console.log('   建店总投入 ' + r.build_total + ' 元，月摊销 ' + r.amort + ' 元，固定(含摊) ' + r.fixed_total + ' 元');
  console.log('   保本月营收   = ' + r.break_even_monthly + ' 元   (日均 ' + r.break_even_daily + ')');
  const tgDaily = d.target_daily_fen == null ? null : Math.round(d.target_daily_fen / 100);
  console.log('   目标月营收   = ' + r.target_monthly + ' 元   (日均 ' + tgDaily + '，目标月利润 20,000)');
  console.log('   回本月数     = 引擎 ' + d.payback_months + ' 月 / 现金回本 ' + cashPayback + ' 月'
    + (userPayback != null ? ' / 按初始总投入 ' + investYuan / 10000 + ' 万 ⇒ ' + userPayback + ' 月' : ''));
  console.log('   现金保本     = ' + (beCash == null ? 'null（无摊销，两口径同数）' : beCash + ' 元'));
  console.log('   指标@保本    = ' + JSON.stringify((d.indicators_at_breakeven || []).map((x) => x.key + '=' + x.pct + '%/' + x.level)));
  console.log('   指标@目标    = ' + JSON.stringify(r.indicators_at_target));
  console.log('');
}

console.log('=== 样例：60㎡ 快餐 / 房租 8000 / 2 人(人均4500 ⇒ 人工9000) / 毛利率 60% / 投入 15 万 ===');
console.log('（二三线城市，业态=快餐面馆，营业 30 天，客单价 20，目标月利润 2 万）\n');

show('B-1 「15 万」= 建店投入（装修10万/3年 + 设备5万/5年）',
  Object.assign({}, BASE, { buildRows: BUILD15 }), 0);

show('B-2 「15 万」= 初始总投入（initialInvestYuan，不进引擎；建店投入四行全空）',
  Object.assign({}, BASE), 150000);

show('B-3 同 B-1，但水/电/气都留空（走房租派生）',
  Object.assign({}, BASE, { buildRows: BUILD15, waterYuan: '', electricYuan: '', gasYuan: '' }), 0);

show('B-4 同 B-1，水/电/气手填（水200/电1500/气300）',
  Object.assign({}, BASE, { buildRows: BUILD15,
    waterYuan: '200', electricYuan: '1500', gasYuan: '300' }), 0);
