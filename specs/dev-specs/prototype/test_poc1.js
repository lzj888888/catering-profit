/**
 * POC1 锚点自测：用例 A（边界）/ 用例 B（多资产并行 + 尾差倒挤）
 * 运行：node test_poc1.js
 * 全部 ✅ 即代表摊销引擎算法 100% 命中验收锚点（误差 ≤ 0.01 元）
 */
const { calcAmortize, calcAmortizeSchedule, calcResidualFen, fmtMonth, parseMonth } = require('./calcAmortize.js');

let pass = 0, fail = 0;
function approx(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }
function check(name, actual, expected) {
  const ok = approx(actual, expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}: 实际=${actual}  预期=${expected}`);
}

const oldAC = { name: '旧空调', valueFen: 1200000, startMonth: '2026-01', totalMonths: 36, terminateMonth: '2026-08' };
const sign = { name: '招牌制作', valueFen: 600000, startMonth: '2026-01', totalMonths: 12 };
const decor = { name: '装修', valueFen: 12000000, startMonth: '2026-01', totalMonths: 36 };
const franchise = { name: '加盟费', valueFen: 3000000, startMonth: '2026-03', totalMonths: 24 };
const freezer = { name: '冰柜', valueFen: 600000, startMonth: '2026-06', totalMonths: 60 };

console.log('\n--- POC1 用例A: 旧空调（提前报废 2026-08）---');
check('旧空调 2026-01 月摊(当月即摊)', calcAmortize(oldAC, '2026-01'), 333.33);
check('旧空调 2026-08 月摊(终止当月在摊)', calcAmortize(oldAC, '2026-08'), 333.33);
check('旧空调 2026-09 月摊(次月停)', calcAmortize(oldAC, '2026-09'), 0);
check('🔵 旧空调残值(转处置损失)', calcResidualFen(oldAC) / 100, 9333.36);

console.log('\n--- POC1 用例A: 招牌制作（自然到期）---');
check('招牌 2026-01 月摊', calcAmortize(sign, '2026-01'), 500.00);
check('招牌 2026-12 月摊(到期当月在摊)', calcAmortize(sign, '2026-12'), 500.00);
check('招牌 2027-01 月摊(次月停)', calcAmortize(sign, '2027-01'), 0);
let signSum = 0;
for (let mi = parseMonth('2026-01'); mi <= parseMonth('2026-12'); mi++) signSum += calcAmortize(sign, fmtMonth(mi));
check('🔵 招牌已摊合计(严格=原值)', signSum, 6000.00);

console.log('\n--- POC1 用例B: 多资产并行 ---');
check('2026-08 三资产合计', calcAmortize(decor, '2026-08') + calcAmortize(franchise, '2026-08') + calcAmortize(freezer, '2026-08'), 4683.33);
check('2026-02 仅装修在摊', calcAmortize(decor, '2026-02') + calcAmortize(franchise, '2026-02') + calcAmortize(freezer, '2026-02'), 3333.33);
check('🔴 装修末月 2028-12 尾差倒挤', calcAmortize(decor, '2028-12'), 3333.45);
check('装修 2029-01 起=0', calcAmortize(decor, '2029-01'), 0);

// 顺带打印装修逐月（验证末月倒挤无破绽）
const sched = calcAmortizeSchedule(decor);
const last = sched.rows[sched.rows.length - 1];
console.log(`   (装修表共 ${sched.rows.length} 期，末期 ${last.month}=${last.amountYuan}，残值=${sched.residualYuan})`);

console.log(`\n==== POC1 结果：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
