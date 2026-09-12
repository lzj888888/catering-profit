/**
 * POC4 锚点自测：场景 S4（选址盈利沙盘）
 * 运行：node test_poc4.js
 * 全部 ✅ 即代表沙盘计算引擎算法 100% 命中验收锚点（金额类整数分严格相等，core/02:5 铁律）
 * 锚点来源：core/02_模拟测试数据集.md 场景 4 + M2 规范 M2.10
 */
const { calcSandbox } = require('./calcM2.js');

let pass = 0, fail = 0;
function approx(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }
// 金额锚点：整数分严格相等（core/02:5 铁律，禁止"比元 + 容差"）
function chkFen(name, actualFen, expectedFen) {
  const ok = actualFen === expectedFen;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}: 实际=${actualFen} 分  预期=${expectedFen} 分`);
}
// 比率类：允许 ±0.01 舍入容差（core/02 允许）
function chkPct(name, actual, expected) {
  const ok = approx(actual, expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}: 实际=${actual}  预期=${expected}`);
}
function check(name, cond) {
  const ok = !!cond;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
}

// S4 基础输入（不含模拟摊销）
const s4 = {
  rentYuan: 8000, propertyYuan: 500, laborYuan: 12000, otherYuan: 800,
  includeAmort: false, simAmortYuan: 0,
  varFoodPct: 35, varMktPct: 8, varOtherPct: 2,
  targetProfitYuan: 15000,
};

console.log('\n--- POC4 场景 S4: 选址盈利沙盘（基础）---');
const r = calcSandbox(s4);
chkFen('固定成本合计(分)', r.fixedTotalFen, 2130000);
chkPct('综合变动成本率(%)', r.compositeVarRatePct, 45);
chkPct('边际贡献率(%)', r.marginRatePct, 55);
chkFen('保本月营业额(分)', r.breakEvenMonthlyFen, 3872727);
chkFen('保本日均营业额(分)', r.breakEvenDailyFen, 129091);
chkFen('目标利润月营收(分)', r.targetMonthlyFen, 6600000);
chkFen('目标利润日均(分)', r.targetDailyFen, 220000);
check('无红警', r.redAlert === false);

// 红警：综合变动成本率 ≥ 100% → 不计算负保本
console.log('\n--- POC4 红警边界: 变动率 95+8+2=105% ---');
const red = calcSandbox({ ...s4, varFoodPct: 95, varMktPct: 8, varOtherPct: 2 });
check('综合变动率=105% 触发红警', red.redAlert === true);
check('红警时保本为 null（不计算负数）', red.breakEvenMonthlyFen === null);
check('红警时目标为 null', red.targetMonthlyFen === null);

// 含模拟摊销：固定合计叠加 +2000，验证 include_amort 叠加与重新整除
console.log('\n--- POC4 含模拟摊销: 叠 +2000 元/月 ---');
const amort = calcSandbox({ ...s4, includeAmort: true, simAmortYuan: 2000 });
chkFen('含摊销固定合计(分)', amort.fixedTotalFen, 2330000);
chkFen('含摊销保本月营业额(分)', amort.breakEvenMonthlyFen, 4236364); // 2330000/0.55=4236363.63→4236364
chkFen('含摊销保本日均(分)', amort.breakEvenDailyFen, 141212);        // 4236364/30=141212.13→141212

console.log(`\n==== POC4 结果：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
