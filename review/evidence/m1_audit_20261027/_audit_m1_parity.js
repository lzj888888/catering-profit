// _audit_m1_parity.js —— 只读取证：三份引擎副本的行为对拍（不改任何业务文件）
// 覆盖组合：库存开/关 × 直接填的消耗（正数 / 0 / 不填）
const path = require('path');
const R = (p) => require(path.join(__dirname, p));

const E1 = R('cloudfunctions/calcMonthlyProfit/service.js').calcMonthlyProfit;
const E2 = R('cloudfunctions/getLedger/service.js').calcMonthlyProfit;
const E3 = R('cloudfunctions/saveLedger/service.js').calcMonthlyProfit;

const YUAN = 100;
const items = (arr) => arr.map((y) => ({ amountFen: Math.round(y * YUAN) }));
const INCOME = items([64000]);
const EXPENSE = items([32840]);
const AMORT = Math.round(4683.33 * YUAN);
const INV = { openingFen: 5000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN };

const COMBOS = [
  { name: '库存关 + 消耗填正数 22000', inv: false, direct: 22000 * YUAN },
  { name: '库存关 + 消耗填 0', inv: false, direct: 0 },
  { name: '库存关 + 消耗不填', inv: false, direct: undefined },
  { name: '库存开 + 消耗填正数 22000', inv: true, direct: 22000 * YUAN },
  { name: '库存开 + 消耗填 0', inv: true, direct: 0 },
  { name: '库存开 + 消耗不填', inv: true, direct: undefined },
];

const KEYS = ['incomeTotalFen', 'expenseTotalFen', 'materialCostFen', 'realConsumeFen',
  'grossProfitFen', 'grossMarginRatePct', 'effectiveAmortizeFen', 'effectiveLumpSumFen',
  'operationRefProfitFen', 'totalFactorRealProfitFen', 'profitDiffFen',
  'refMaterialFen', 'refMaterialSource', 'directProvided', 'diffCheck'];

const fmt = (v) => (typeof v === 'number' ? v : String(v));
const rows = [];
let mismatch = 0;
for (const c of COMBOS) {
  const base = {
    incomeItems: INCOME, expenseItems: EXPENSE, amortizeFen: AMORT,
    amortizeSwitchOn: true, inventorySwitchOn: c.inv,
    inventory: c.inv ? INV : {},
  };
  if (c.direct !== undefined) base.directConsumeFen = c.direct;
  const a = E1(base), b = E2(base), d = E3(base);
  const rec = { combo: c.name };
  for (const k of KEYS) {
    const va = fmt(a[k]), vb = fmt(b[k]), vd = fmt(d[k]);
    if (!(va === vb && vb === vd)) { mismatch++; console.log(`!! 不一致 ${c.name} :: ${k} => calc=${va} getLedger=${vb} saveLedger=${vd}`); }
    rec[k] = va;
  }
  rows.push(rec);
}

console.log('\n===== 三副本对拍（calcMonthlyProfit / getLedger / saveLedger）=====');
console.log('不一致字段数 =', mismatch);
console.log('\n| 组合 | 真实消耗(元) | 参考口径消耗(元) | refSource | directProvided | 参考利润(元) | 实际利润(元) | 差异(元) | 自洽 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.combo} | ${r.realConsumeFen / 100} | ${r.refMaterialFen / 100} | ${r.refMaterialSource} | ${r.directProvided} | ${r.operationRefProfitFen / 100} | ${r.totalFactorRealProfitFen / 100} | ${r.profitDiffFen / 100} | ${r.diffCheck} |`);
}

// ===== 口径锁核验 =====
console.log('\n===== 口径锁核验 =====');
const lock1 = rows.find((r) => r.combo === '库存开 + 消耗填正数 22000');
console.log('锁1「开库存 + 填正数 ⇒ 参考利润 = 9160」实测 =', lock1.operationRefProfitFen / 100, lock1.operationRefProfitFen === 916000 ? '✅' : '❌ 不符');
const lock2 = rows.find((r) => r.combo === '库存开 + 消耗填 0');
console.log('锁2「库存开 + 消耗≤0 ⇒ 回落倒轧」实测 refSource =', lock2.refMaterialSource, '参考消耗 =', lock2.refMaterialFen / 100, '（倒轧应为 23000）', lock2.refMaterialFen === 23000 * YUAN ? '✅' : '❌');
const lock3 = rows.find((r) => r.combo === '库存开 + 消耗不填');
console.log('锁2b「库存开 + 未填 ⇒ 回落倒轧」实测 refSource =', lock3.refMaterialSource, '参考消耗 =', lock3.refMaterialFen / 100);

// ===== 组合数：库存开时 directConsumeFen 是否被使用过 =====
console.log('\n===== directConsumeFen 在库存开时是否影响任何出参 =====');
const mk = (inv, direct) => {
  const b = {
    incomeItems: INCOME, expenseItems: EXPENSE, amortizeFen: AMORT,
    amortizeSwitchOn: true, inventorySwitchOn: inv, inventory: inv ? INV : {},
  };
  if (direct !== undefined) b.directConsumeFen = direct;
  return b;
};
for (const inv of [true, false]) {
  const r0 = E1(mk(inv, 0)), r1 = E1(mk(inv, 22000 * YUAN)), r2 = E1(mk(inv, 99999 * YUAN));
  const same = KEYS.every((k) => fmt(r0[k]) === fmt(r1[k]) && fmt(r1[k]) === fmt(r2[k]));
  console.log(`库存${inv ? '开' : '关'}：direct=0 / 22000 / 99999 三组出参全等 ? ${same ? '✅ 全等（手填数完全不影响结果）' : '❌ 有差异'}`);
  if (!same) {
    for (const k of KEYS) if (!(fmt(r0[k]) === fmt(r1[k]) && fmt(r1[k]) === fmt(r2[k]))) console.log('   差异字段', k, r0[k], r1[k], r2[k]);
  }
}
