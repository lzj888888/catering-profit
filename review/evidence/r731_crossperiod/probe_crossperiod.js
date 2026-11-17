// r731 跨期审计探针：直接用生产引擎（getDishReview/service.js）实跑，不手算
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const S = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js'));

function row(o) {
  return Object.assign({ platform: 'pos', dish_key: 'D1', name: '红烧肉', qty: 700, amountFen: 70000, qty_fen: 0 }, o);
}
function show(tag, r) {
  console.log(tag, '| rows=', r.rows.length, '| from=', r.from || '(空)', '| to=', r.to || '(空)', '| days=', r.days,
    '| qty合计=', r.rows.reduce((a, x) => a + (x.qty || 0), 0));
}

console.log('===== 用例 1：7 天区间表跨月（10-28 ~ 11-03），biz_date=区间末日 =====');
const cross = row({ biz_date: '2026-11-03', granularity: 'interval', period_from: '2026-10-28', period_to: '2026-11-03' });
show('查 10 月(10-01~10-31)', S.filterByRange([cross], '2026-10-01', '2026-10-31'));
show('查 11 月(11-01~11-30)', S.filterByRange([cross], '2026-11-01', '2026-11-30'));
show('查全期间(10-01~11-30)', S.filterByRange([cross], '2026-10-01', '2026-11-30'));
const cs = S.coverageStats([cross]);
console.log('coverageStats =>', JSON.stringify(cs));
console.log('期望（若按区间归属）: 10 月应分到 10-28~10-31 那 4 天的量, 11 月分到 11-01~11-03 那 3 天');

console.log('\n===== 用例 2：7 天区间表不跨月（11-01 ~ 11-07），biz_date=11-07 =====');
const same = row({ biz_date: '2026-11-07', granularity: 'interval', period_from: '2026-11-01', period_to: '2026-11-07' });
show('查 11 月', S.filterByRange([same], '2026-11-01', '2026-11-30'));
console.log('coverageStats =>', JSON.stringify(S.coverageStats([same])));

console.log('\n===== 用例 3：逐日外卖行（daily）合计必须 ≡ 区间行整体（同一 7 天） =====');
const dailies = [];
for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']) {
  dailies.push(row({ biz_date: d, granularity: 'daily', platform: 'meituan', qty: 100, amountFen: 10000 }));
}
show('逐日7行 查 11 月', S.filterByRange(dailies, '2026-11-01', '2026-11-30'));
console.log('coverageStats =>', JSON.stringify(S.coverageStats(dailies)));

console.log('\n===== 用例 4：跨年区间（12-29 ~ 01-04） =====');
const yr = row({ biz_date: '2027-01-04', granularity: 'interval', period_from: '2026-12-29', period_to: '2027-01-04' });
show('查 2026 年 12 月', S.filterByRange([yr], '2026-12-01', '2026-12-31'));
show('查 2027 年 1 月', S.filterByRange([yr], '2027-01-01', '2027-01-31'));
console.log('coverageStats =>', JSON.stringify(S.coverageStats([yr])));

console.log('\n===== 用例 5：区间反了 / 缺端点（fail-closed 检查） =====');
show('from>to', S.filterByRange([cross], '2026-11-30', '2026-11-01'));
show('缺 to', S.filterByRange([cross], '2026-10-01', ''));
const bad = row({ biz_date: '2026-11-03', granularity: 'interval', period_from: '2026-11-05', period_to: '2026-11-01' });
console.log('非法区间 coverageStats =>', JSON.stringify(S.coverageStats([bad])));

console.log('\n===== 用例 6：同一天「分两次导不同部分」在 _id 层面的语义（离线推演 _id 冲突） =====');
const id = (seq) => 'SALE_shop_x_pos_2026-11-03_' + seq;
console.log('第一次导 5 行 =>', [0, 1, 2, 3, 4].map(id).join(', '));
console.log('第二次导 3 行 => 覆盖', [0, 1, 2].map(id).slice(0, 3).join(', '), '；R587 pruneStaleGroup 会把 seq3/4 软删');
console.log('结论：同店同平台同日「分次导」= 后者覆盖前者（已在 pruneStaleGroup 注释中声明为有意语义）');
