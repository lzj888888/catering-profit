// _audit_m2fwd_sanity.js —— 只读取证：老板看得懂的量级回归（保本/目标/回本/现金保本）
const { run } = require('./_audit_m2fwd_engine.js');
const { paybackCash, cashBreakeven } = require('./utils/bizPreset.js');
const { makePage } = require('./_audit_m2fwd_harness.js');

const BUILD = (decor, equip) => [
  { key: 'transfer', name: '', note: '', yuan: '', years: 3 },
  { key: 'decor', name: '', note: '', yuan: String(decor), years: 3 },
  { key: 'equip', name: '', note: '', yuan: String(equip), years: 5 },
  { key: 'franchise', name: '', note: '', yuan: '', years: 3 },
];

// 场景定义（写清每个数是什么，避免"两个场景两个数当一条基线"）
const S = [
  {
    name: '① 县城小面馆 60㎡｜房租 3000｜2人9000｜毛利 60%｜投入 8万（装修5万+设备3万）',
    ov: { presetKey: 'fastfood_noodle', cityIdx: 2, bizIdx: 0, areaNum: '60', rentYuan: '3000',
      headcountNum: '2', laborTotalYuan: '9000', marginPct: 60, avgPriceYuan: '15',
      waterYuan: '150', electricYuan: '900', gasYuan: '250',
      expectYuan: '60000', targetYuan: '10000', buildRows: BUILD(50000, 30000) },
  },
  {
    name: '② 二三线快餐 60㎡｜房租 8000｜3人13500｜毛利 60%｜投入 15万（装修10万+设备5万）',
    ov: { presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, areaNum: '60', rentYuan: '8000',
      headcountNum: '3', laborTotalYuan: '13500', marginPct: 60, avgPriceYuan: '20',
      waterYuan: '200', electricYuan: '1500', gasYuan: '300',
      expectYuan: '100000', targetYuan: '20000', buildRows: BUILD(100000, 50000) },
  },
  {
    name: '③ 二三线川菜 200㎡｜房租 25000｜8人44000｜毛利 60%｜投入 60万（装修40万+设备20万）',
    ov: { presetKey: 'dining_sichuan', cityIdx: 1, bizIdx: 1, areaNum: '200', rentYuan: '25000',
      headcountNum: '8', laborTotalYuan: '44000', marginPct: 60, avgPriceYuan: '60',
      waterYuan: '800', electricYuan: '5000', gasYuan: '2000',
      expectYuan: '300000', targetYuan: '50000', buildRows: BUILD(400000, 200000) },
  },
  {
    name: '④ 一线茶饮 30㎡｜房租 15000｜3人13500｜毛利 67%｜投入 25万（装修15万+设备10万）',
    ov: { presetKey: 'cafe_tea', cityIdx: 0, bizIdx: 3, areaNum: '30', rentYuan: '15000',
      headcountNum: '3', laborTotalYuan: '13500', marginPct: 67, avgPriceYuan: '18',
      waterYuan: '150', electricYuan: '1200', gasYuan: '100',
      expectYuan: '180000', targetYuan: '40000', buildRows: BUILD(150000, 100000) },
  },
  {
    name: '⑤ 县城火锅 150㎡｜房租 12000｜6人30000｜毛利 53%｜投入 26万（走预设 buildRef）',
    ov: { presetKey: 'hotpot_half_self', cityIdx: 2, bizIdx: 2, areaNum: '150', rentYuan: '12000',
      headcountNum: '6', laborTotalYuan: '30000', marginPct: 53, avgPriceYuan: '65',
      waterYuan: '600', electricYuan: '4000', gasYuan: '1500',
      expectYuan: '200000', targetYuan: '40000' },
  },
];

console.log('=== 老板视角量级回归（全部走 index.js::buildPresetParam + 云端 validate/service）===\n');
for (const s of S) {
  const r = run(s.ov);
  if (r.err) { console.log(s.name + '\n   校验失败: ' + r.err + '\n'); continue; }
  const p = makePage(s.ov).buildPresetParam('forward');
  const d = r._d;
  const targetFen = p.target_profit_fen;
  const cash = paybackCash(d.build_total_fen, targetFen, d.build_amort_monthly_fen);
  const beCash = cashBreakeven(Number(d.break_even_monthly_fen) / 100, d.fixed_ex_amort_fen, d.fixed_total_fen);
  const beMonthly = Math.round(d.break_even_monthly_fen / 100);
  const rentPctAtBe = (d.indicators_at_breakeven || []).filter((x) => x.key === 'rent')[0];
  const rentPctAtTg = (d.indicators_at_target || []).filter((x) => x.key === 'rent')[0];
  console.log(s.name);
  console.log('   固定成本 = ' + JSON.stringify(r.fixed_items) + '  建店=' + r.build_total + ' 月摊销=' + r.amort);
  console.log('   保本月营收 ' + beMonthly + ' 元 | 保本日均 ' + r.break_even_daily
    + ' | 目标月营收 ' + r.target_monthly + ' 元');
  console.log('   回本(引擎 payback_months) = ' + d.payback_months + ' 月 | 现金回本 = ' + cash + ' 月'
    + ' | 现金保本 = ' + (beCash == null ? 'null(无摊销)' : beCash + ' 元'));
  console.log('   房租占比：@保本 ' + (rentPctAtBe ? rentPctAtBe.pct + '%/' + rentPctAtBe.level : '—')
    + '  @目标 ' + (rentPctAtTg ? rentPctAtTg.pct + '%/' + rentPctAtTg.level : '—'));
  console.log('   指标@目标 = ' + JSON.stringify(r.indicators_at_target));
  console.log('');
}

// 房租/水电留空时城市系数对兜底的影响
console.log('=== 房租+水电都留空 → RATE_COST_FLOOR × 城市系数（utility 兜底）===');
for (const [ci, nm] of [[0, '一线'], [1, '二三线'], [2, '县城']]) {
  const r = run({ presetKey: 'fastfood_noodle', cityIdx: ci, bizIdx: 0, rentYuan: '',
    laborTotalYuan: '9000', headcountNum: '2', marginPct: 60, targetYuan: '0' });
  console.log('   ' + nm + ': fixed=' + JSON.stringify(r.fixed_items) + ' 保本=' + r.break_even_monthly);
}
