// r731 摊销边界复核 v2：字段契约按 getAmortSchedule/service.js:44-58 真实定义（total_value / total_months）
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const A = require(ROOT + '/cloudfunctions/getAmortSchedule/service.js');

function sumYear(asset, months) {
  return months.reduce((s, m) => s + A.amountForMonth(asset, m) + A.disposalLossForMonth([asset], m), 0);
}

console.log('=== 边界①：terminate_month 早于 start_month（脏数据）===');
const dirty = { _id: 'a1', mode: 'amort', start_month: '2026-03', total_months: 24, total_value: 120000, terminate_month: '2026-01' };
for (const m of ['2026-01', '2026-02', '2026-03', '2026-04']) {
  console.log('  ', m, '摊销=', A.amountForMonth(dirty, m), '处置损失=', A.disposalLossForMonth([dirty], m));
}
const months2026 = [];
for (let i = 0; i < 24; i++) months2026.push(A.fmtMonthIdx(A.monthIndex('2026-01') + i));
console.log('  2026-01 起 24 个月累计（摊销+处置）=', sumYear(dirty, months2026), '｜原值=', dirty.total_value);

console.log('\n=== 边界②：正常提前报废（2026-03 起 24 期，2026-08 报废）===');
const term = { _id: 'a2', mode: 'amort', start_month: '2026-03', total_months: 24, total_value: 120000, terminate_month: '2026-08' };
let run = 0, lines = [];
for (let i = 0; i < 24; i++) {
  const m = A.fmtMonthIdx(A.monthIndex('2026-03') + i);
  const am = A.amountForMonth(term, m), dl = A.disposalLossForMonth([term], m);
  run += am + dl;
  if (am || dl) lines.push(m + ':摊' + am + (dl ? ' 处置' + dl : ''));
}
console.log('  ', lines.join(' | '));
console.log('  24 个月累计 =', run, '｜原值 =', term.total_value, '｜守恒:', run === term.total_value ? '✅' : '❌ 差 ' + (run - term.total_value));

console.log('\n=== 边界③：极小金额 + 24 期（末月尾差是否为负）===');
const tiny = { _id: 'a3', mode: 'amort', start_month: '2026-01', total_months: 24, total_value: 10 };
const rows = [];
for (let i = 0; i < 24; i++) {
  const m = A.fmtMonthIdx(A.monthIndex('2026-01') + i);
  rows.push([m, A.amountForMonth(tiny, m)]);
}
console.log('  前3:', JSON.stringify(rows.slice(0, 3)), '末3:', JSON.stringify(rows.slice(-3)));
console.log('  24 期合计 =', rows.reduce((s, r) => s + r[1], 0), '｜原值 =', tiny.total_value);
console.log('  负数期:', rows.filter((r) => r[1] < 0).map((r) => r[0] + '=' + r[1]).join(', ') || '无');

console.log('\n=== 边界④：跨年连续性（2025-11 起 36 期）===');
const long = { _id: 'a4', mode: 'amort', start_month: '2025-11', total_months: 36, total_value: 360000 };
let sum = 0, nz = 0, zeroAfter = [];
for (let i = 0; i < 48; i++) {
  const m = A.fmtMonthIdx(A.monthIndex('2025-11') + i);
  const v = A.amountForMonth(long, m);
  sum += v; if (v) nz++; else zeroAfter.push(m);
}
console.log('  48 个月累计 =', sum, '｜原值 =', long.total_value, '｜有值月数 =', nz);
console.log('  第 36 期(2028-10) =', A.amountForMonth(long, '2028-10'), '｜第 37 期(2028-11) =', A.amountForMonth(long, '2028-11'));
console.log('  跨年断点检查 2026-01 / 2027-01 =', A.amountForMonth(long, '2026-01'), '/', A.amountForMonth(long, '2027-01'));
