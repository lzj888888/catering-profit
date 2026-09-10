/**
 * POC3 锚点自测：S1 / S2 / 2-R
 * 运行：node test_poc3.js
 * 全部 ✅ 即代表双利润引擎算法 100% 命中验收锚点（误差 ≤ 0.01 元）
 */
const { calcMonthlyProfit } = require('./calcMonthlyProfit.js');

let pass = 0, fail = 0;
function approx(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }
function check(name, actual, expected) {
  const ok = approx(actual, expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}: 实际=${actual}  预期=${expected}`);
}

// ---------- S1 基础双利润（库存关、摊销关）----------
const S1 = {
  incomesYuan: [8000, 25000, 5000, 3000, 2000, 18000, 500, 1500, 1000], // 堂食合计43000 + 外卖20000 + 其他1000
  expensesYuan: [10300, 15000, 7240, 300], // 运营+人工+营销+其他 = 32840
  directCostYuan: 22000,
  inventoryOn: false,
  amortYuan: 0,
};
const r1 = calcMonthlyProfit(S1);
console.log('\n--- S1 基础双利润（库存关/摊销关）---');
check('收入合计', r1.income, 64000);
check('费用合计', r1.expense, 32840);
check('菜品毛利', r1.grossProfit, 42000);
check('菜品毛利率%', r1.grossMarginPct, 65.625);
check('🟢 经营参考利润', r1.bizRefProfit, 9160);
check('🔵 全要素真实利润', r1.fullProfit, 9160); // 无库存无摊销，两口径相等

// ---------- S2 库存+摊销（口径锁验证）----------
const S2 = {
  incomesYuan: [8000, 25000, 5000, 3000, 2000, 18000, 500, 1500, 1000],
  expensesYuan: [10300, 15000, 7240, 300],
  directCostYuan: 22000, // ⚠️ 老板直接填的仍是 22000（与 S1 相同）
  inventoryOn: true,
  beginInvYuan: 5000,
  purchaseYuan: 25000,
  endInvYuan: 7000,
  amortYuan: 4683.33,
};
const r2 = calcMonthlyProfit(S2);
console.log('\n--- S2 库存+摊销（口径锁）---');
check('本期真实消耗', r2._realCost, 23000); // 5000+25000-7000
check('🟢 经营参考利润', r2.bizRefProfit, 9160); // 必须用 22000，不是 23000（锁）
check('🔵 全要素真实利润', r2.fullProfit, 3476.67); // 64000-23000-32840-4683.33
check('两利润差异', r2.diff, 5683.33); // (23000-22000)+4683.33

// ---------- 选做 2-R 连锁重算 ----------
// 2026-07 期末盘点 5000 -> 3000 => 2026-08 期初 3000 => 真实消耗 3000+25000-7000=21000
const S2R = { ...S2, beginInvYuan: 3000 };
const r2r = calcMonthlyProfit(S2R);
console.log('\n--- 选做 2-R 连锁重算（期初 3000）---');
check('本期真实消耗', r2r._realCost, 21000);
check('🔵 全要素真实利润', r2r.fullProfit, 5476.67); // 64000-21000-32840-4683.33

console.log(`\n==== 结果：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
