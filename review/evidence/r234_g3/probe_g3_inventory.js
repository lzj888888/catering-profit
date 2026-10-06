// R234 探针：把 S2「开库存 + 开摊销」上锁样本灌进三个 service.js 引擎，
//           核实三副本对「开库存」口径的真实出参是否与上锁锚点一致。
// 只读探测，不改任何源码。运行： node review/evidence/r234_g3/probe_g3_inventory.js
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const YUAN = 100;
const itemsYuan = (arr) => arr.map((y) => ({ amountFen: Math.round(y * YUAN) }));

// —— 与 cloudfunctions/calcMonthlyProfit/selftest.js 的 S2 场景逐字一致 ——
const INCOME_ITEMS = itemsYuan([8000, 25000, 5000, 3000, 2000, 18000, 500, 1500, 1000]);
const EXPENSE_ITEMS = itemsYuan([8000, 500, 200, 800, 600, 100, 100, 12000, 1500, 800, 500, 200, 3600, 1200, 1500, 300, 400, 240, 300]);
const S2 = {
  incomeItems: INCOME_ITEMS,
  expenseItems: EXPENSE_ITEMS,
  directConsumeFen: 22000 * YUAN,
  amortizeFen: Math.round(4683.33 * YUAN),
  amortizeSwitchOn: true,
  inventorySwitchOn: true,
  inventory: { openingFen: 5000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN },
};

// 上锁锚点（来自 calcMonthlyProfit/selftest.js #7~#10）
const LOCK = { realConsumeFen: 2300000, operationRefProfitFen: 916000, totalFactorRealProfitFen: 347667, profitDiffFen: 568333 };

const ENGINES = ['saveLedger/service.js', 'getLedger/service.js', 'calcMonthlyProfit/service.js'];
const KEYS = Object.keys(LOCK);

console.log('=== S2 开库存样本 · 三副本出参 ===');
const rows = [];
for (const f of ENGINES) {
  const mod = require(path.join(ROOT, 'cloudfunctions', f));
  const fn = mod.calcMonthlyProfit || (mod.service && mod.service.calcMonthlyProfit);
  if (typeof fn !== 'function') { console.log('  ❌ 未导出 calcMonthlyProfit:', f); continue; }
  const r = fn(JSON.parse(JSON.stringify(S2)));
  const row = { engine: f };
  for (const k of KEYS) row[k] = r[k];
  row.diffCheck = r.diffCheck;
  rows.push(row);
  console.log(' ', f.padEnd(34), KEYS.map((k) => k + '=' + r[k]).join('  '), 'diffCheck=' + r.diffCheck);
}

console.log('\n=== 与上锁锚点比对 ===');
let allOk = true;
for (const row of rows) {
  const bad = KEYS.filter((k) => row[k] !== LOCK[k]);
  const ok = bad.length === 0 && row.diffCheck === true;
  if (!ok) allOk = false;
  console.log(' ', ok ? '✅' : '❌', row.engine.padEnd(34), bad.length ? ('不符：' + bad.map((k) => k + '(' + row[k] + '≠' + LOCK[k] + ')').join(', ')) : '四值全等 + diffCheck');
}
console.log('\n三副本一致且命中上锁锚点：', allOk ? '✅ 是' : '❌ 否');
console.log('LOCK =', JSON.stringify(LOCK));
process.exit(allOk ? 0 : 1);
