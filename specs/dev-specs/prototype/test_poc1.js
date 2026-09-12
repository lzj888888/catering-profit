/**
 * POC1 锚点自测：用例 A（边界）/ 用例 B（多资产并行 + 尾差倒挤）
 * 运行：node test_poc1.js
 * 全部 ✅ 即代表摊销引擎算法 100% 命中验收锚点（整数分严格相等，core/02:5 铁律，禁止"比元 + 容差"）
 */
const { calcAmortize, calcAmortizeFen, calcAmortizeSchedule, calcResidualFen, fmtMonth, parseMonth } = require('./calcAmortize.js');

let pass = 0, fail = 0;
// 金额锚点：整数分严格相等（core/02:5 铁律，禁止"比元 + 容差"）
function chkFen(name, actualFen, expectedFen) {
  const ok = actualFen === expectedFen;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}: 实际=${actualFen} 分  预期=${expectedFen} 分`);
}

const oldAC = { name: '旧空调', valueFen: 1200000, startMonth: '2026-01', totalMonths: 36, terminateMonth: '2026-08' };
const sign = { name: '招牌制作', valueFen: 600000, startMonth: '2026-01', totalMonths: 12 };
const decor = { name: '装修', valueFen: 12000000, startMonth: '2026-01', totalMonths: 36 };
const franchise = { name: '加盟费', valueFen: 3000000, startMonth: '2026-03', totalMonths: 24 };
const freezer = { name: '冰柜', valueFen: 600000, startMonth: '2026-06', totalMonths: 60 };

console.log('\n--- POC1 用例A: 旧空调（提前报废 2026-08）---');
chkFen('旧空调 2026-01 月摊(当月即摊)', calcAmortizeFen(oldAC, '2026-01'), 33333);
chkFen('旧空调 2026-08 月摊(终止当月在摊)', calcAmortizeFen(oldAC, '2026-08'), 33333);
chkFen('旧空调 2026-09 月摊(次月停)', calcAmortizeFen(oldAC, '2026-09'), 0);
chkFen('🔵 旧空调残值(转处置损失)', calcResidualFen(oldAC), 933336);

console.log('\n--- POC1 用例A: 招牌制作（自然到期）---');
chkFen('招牌 2026-01 月摊', calcAmortizeFen(sign, '2026-01'), 50000);
chkFen('招牌 2026-12 月摊(到期当月在摊)', calcAmortizeFen(sign, '2026-12'), 50000);
chkFen('招牌 2027-01 月摊(次月停)', calcAmortizeFen(sign, '2027-01'), 0);
let signSumFen = 0;
for (let mi = parseMonth('2026-01'); mi <= parseMonth('2026-12'); mi++) signSumFen += calcAmortizeFen(sign, fmtMonth(mi));
chkFen('🔵 招牌已摊合计(严格=原值)', signSumFen, 600000);

console.log('\n--- POC1 用例B: 多资产并行 ---');
chkFen('2026-08 三资产合计', calcAmortizeFen(decor, '2026-08') + calcAmortizeFen(franchise, '2026-08') + calcAmortizeFen(freezer, '2026-08'), 468333);
chkFen('2026-02 仅装修在摊', calcAmortizeFen(decor, '2026-02') + calcAmortizeFen(franchise, '2026-02') + calcAmortizeFen(freezer, '2026-02'), 333333);
chkFen('🔴 装修末月 2028-12 尾差倒挤', calcAmortizeFen(decor, '2028-12'), 333345);
chkFen('装修 2029-01 起=0', calcAmortizeFen(decor, '2029-01'), 0);

// 顺带打印装修逐月（验证末月倒挤无破绽）
const sched = calcAmortizeSchedule(decor);
const last = sched.rows[sched.rows.length - 1];
console.log(`   (装修表共 ${sched.rows.length} 期，末期 ${last.month}=${last.amountYuan}，残值=${sched.residualYuan})`);

console.log(`\n==== POC1 结果：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
