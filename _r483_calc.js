// _r483_calc.js —— 用 2026-10 真云数据复算：现状口径 vs 「二选一」口径
const path = require('path');
const { calcMonthlyProfit } = require(path.join(__dirname, 'cloudfunctions', 'calcMonthlyProfit', 'service.js'));

// 真云取数（店 Abc · 2026-10）
const BASE = {
  incomeItems: [{ amountFen: 9950000 }],   // 99,500 元（合计，明细不影响结论）
  expenseItems: [{ amountFen: 4760000 }],  // 47,600 元
  directConsumeFen: 2200000,               // 手填 22,000
  inventory: { openingFen: 0, purchaseFen: 3500000, closingFen: 2800000 },
  inventorySwitchOn: true,
  amortizeFen: 0, amortizeSwitchOn: false,
  lumpSumFen: 0,
};

const y = (f) => (f / 100).toFixed(0);

console.log('===== 现状口径（R477 修后）：库存开且填了正数 ⇒ 参考仍用手填 =====');
const now = calcMonthlyProfit(BASE);
console.log('  倒轧消耗 B =', y(now.realConsumeFen), '元');
console.log('  参考口径用 =', y(now.refMaterialFen), '元（source=' + now.refMaterialSource + '）');
console.log('  🟢 参考利润 =', y(now.operationRefProfitFen));
console.log('  🔵 真实利润 =', y(now.totalFactorRealProfitFen));
console.log('  差异       =', y(now.profitDiffFen), '（真实 − 参考 = ' + y(now.totalFactorRealProfitFen - now.operationRefProfitFen) + '）');

console.log('');
console.log('===== 「二选一」口径：开了库存 ⇒ 参考也用倒轧（手填退役）=====');
// 模拟：把手填去掉（等同 R477 的回落分支）
const one = calcMonthlyProfit(Object.assign({}, BASE, { directConsumeFen: undefined }));
console.log('  倒轧消耗 B =', y(one.realConsumeFen), '元');
console.log('  参考口径用 =', y(one.refMaterialFen), '元（source=' + one.refMaterialSource + '）');
console.log('  🟢 参考利润 =', y(one.operationRefProfitFen));
console.log('  🔵 真实利润 =', y(one.totalFactorRealProfitFen));
console.log('  差异       =', y(one.profitDiffFen));

console.log('');
console.log('===== 两个利润真正的区别应该是什么？=====');
const withAmort = calcMonthlyProfit(Object.assign({}, BASE, {
  directConsumeFen: undefined, amortizeFen: 468333, amortizeSwitchOn: true,
}));
console.log('  假如当月摊销 4,683.33 元：');
console.log('  🟢 参考（不扣摊销）=', y(withAmort.operationRefProfitFen));
console.log('  🔵 真实（扣摊销）  =', y(withAmort.totalFactorRealProfitFen));
console.log('  差异             =', y(withAmort.profitDiffFen), '← 只剩摊销，老板看得懂');
