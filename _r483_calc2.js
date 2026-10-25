// _r483_calc2.js —— 按李老师的定义复算：A = 当月采购额（不是"手填的消耗"）
const path = require('path');
const { calcMonthlyProfit } = require(path.join(__dirname, 'cloudfunctions', 'calcMonthlyProfit', 'service.js'));
const y = (f) => (f / 100).toFixed(0);

// 真云 2026-10：收入 99,500 / 费用 47,600 / 采购 35,000 / 期初 0 / 期末 28,000 / 手填 22,000
const B = {
  incomeItems: [{ amountFen: 9950000 }],
  expenseItems: [{ amountFen: 4760000 }],
  inventory: { openingFen: 0, purchaseFen: 3500000, closingFen: 2800000 },
  inventorySwitchOn: true, amortizeFen: 0, amortizeSwitchOn: false, lumpSumFen: 0,
};

const rows = [
  ['① 现状（A = 老板手填 22,000）', 2200000],
  ['② 李老师的定义（A = 当月采购 35,000）', 3500000],
];
for (const [name, a] of rows) {
  const r = calcMonthlyProfit(Object.assign({}, B, { directConsumeFen: a }));
  console.log(name);
  console.log('   A（这个月买/记的成本）= ' + y(a) + ' 元');
  console.log('   B（倒轧实际耗用）    = ' + y(r.realConsumeFen) + ' 元');
  console.log('   🟢 参考利润 = ' + y(r.operationRefProfitFen));
  console.log('   🔵 真实利润 = ' + y(r.totalFactorRealProfitFen));
  console.log('   差异       = ' + y(r.profitDiffFen) + '  （真实 − 参考 = ' + y(r.totalFactorRealProfitFen - r.operationRefProfitFen) + '）');
  console.log('');
}

console.log('===== 差异到底是不是"库存变动"？=====');
const purchase = 3500000, consume = 700000, opening = 0, closing = 2800000;
console.log('  采购 − 耗用            = ' + y(purchase - consume) + ' 元');
console.log('  期末 − 期初（库存净增）= ' + y(closing - opening) + ' 元');
console.log('  ⇒ 两者' + ((purchase - consume) === (closing - opening) ? '**完全相等** ✅' : '不等 ❌') +
  '：这个月买多了用不完的，就是压在库里的那部分');
