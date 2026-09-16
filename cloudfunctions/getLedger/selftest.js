// cloudfunctions/getLedger/selftest.js —— 批次 4 · M1 月度账读取（读）自测（R57 补齐）
// 运行： node cloudfunctions/getLedger/selftest.js
//
// 背景：此前无 selftest。本函数是 M1 的**回读重算**入口——index.js 注释明写"防篡改：不信任落库存量，
// 回读时用明细重算"。⇒ 重算引擎必须与落库引擎（saveLedger/service.js）**逐字段同值**，否则同一个月
// 存进去与读出来是两个数。本套件把这条"同源"从注释变成机器断言。
//   ① 锚点回归：S1 经营参考 9,160 / S2 全要素 3,476.67 / 差异 5,683.33（与 batch1/4 同一组锚点）
//   ② 跨函数等价：getLedger.calcMonthlyProfit ≡ saveLedger.calcMonthlyProfit（多组输入逐字段）
//   ③ 口径锁：开库存开关时"经营参考利润"仍用老板直接填的消耗（**不得**改用倒轧）
//   ④ 入参面 + 静态形状守卫

const fs = require('fs');
const path = require('path');
const { calcMonthlyProfit } = require('./service');
const saveLedger = require('../saveLedger/service');
const { validateInput } = require('./validate');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const YUAN = 100;
const itemsYuan = (arr) => arr.map((y) => ({ amountFen: Math.round(y * YUAN) }));
const INCOME_ITEMS = itemsYuan([8000, 25000, 5000, 3000, 2000, 18000, 500, 1500, 1000]); // 64,000
const EXPENSE_ITEMS = itemsYuan([8000, 500, 200, 800, 600, 100, 100, 12000, 1500, 800, 500, 200, 3600, 1200, 1500, 300, 400, 240, 300]); // 32,840
const DIRECT_CONSUME_FEN = 22000 * YUAN;
const AMORTIZE_FEN = Math.round(4683.33 * YUAN);

console.log('===== 1. 锚点回归（与 batch1 calcMonthlyProfit / batch4 saveLedger 同锚点）=====');
const r1 = calcMonthlyProfit({ incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: false, inventorySwitchOn: false, inventory: {} });
check('S1 收入合计 = 64,000 元（6400000 分）', r1.incomeTotalFen === 6400000, `=${r1.incomeTotalFen}`);
check('S1 费用合计 = 32,840 元（3284000 分）', r1.expenseTotalFen === 3284000, `=${r1.expenseTotalFen}`);
check('🏆 S1 经营参考利润 = 9,160（916000 分）', r1.operationRefProfitFen === 916000, `=${r1.operationRefProfitFen}`);
check('S1 全要素真实利润 = 9,160（库存关无倒轧）', r1.totalFactorRealProfitFen === 916000, `=${r1.totalFactorRealProfitFen}`);
check('S1 差异 = 0', r1.profitDiffFen === 0);
check('S1 自洽校验位 diffCheck = true', r1.diffCheck === true);

const r2 = calcMonthlyProfit({ incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: true, inventorySwitchOn: true, inventory: { openingFen: 5000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN } });
check('S2 真实消耗 = 23,000（倒轧 5000+25000−7000）', r2.realConsumeFen === 2300000, `=${r2.realConsumeFen}`);
check('🏆 S2 经营参考利润仍 = 9,160（🔴 口径锁：开库存也不改用倒轧，出 8160 即违规）', r2.operationRefProfitFen === 916000, `=${r2.operationRefProfitFen}`);
check('S2 经营参考 ≠ 816000（反面断言：防"开了开关就倒轧"回归）', r2.operationRefProfitFen !== 816000);
check('🏆 S2 全要素真实利润 = 3,476.67（347667 分）', r2.totalFactorRealProfitFen === 347667, `=${r2.totalFactorRealProfitFen}`);
check('S2 两利润差异 = 5,683.33（568333 分）', r2.profitDiffFen === 568333, `=${r2.profitDiffFen}`);
check('S2 毛利 = 64,000 − 23,000 = 41,000（4100000 分）', r2.grossProfitFen === 4100000, `=${r2.grossProfitFen}`);
check('S2 毛利率 = 64.0625%', r2.grossMarginRatePctDisplay === 64.06, `=${r2.grossMarginRatePctDisplay}`);

console.log('===== 2. 跨函数等价（回读重算 ≡ 落库引擎，防口径漂移）=====');
const CASES = [
  { name: 'S1 双关', input: { incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: false, inventorySwitchOn: false, inventory: {} } },
  { name: 'S2 双开', input: { incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: true, inventorySwitchOn: true, inventory: { openingFen: 500000, purchaseFen: 2500000, closingFen: 700000 } } },
  { name: '空账（无收入无费用）', input: { incomeItems: [], expenseItems: [], directConsumeFen: 0, amortizeFen: 0, amortizeSwitchOn: false, inventorySwitchOn: false } },
  { name: '零收入有开销（毛利率除零保护）', input: { incomeItems: [], expenseItems: itemsYuan([1000]), directConsumeFen: 50000, amortizeFen: 0, amortizeSwitchOn: false, inventorySwitchOn: false } },
  { name: '仅库存开（倒轧为负：进少耗多）', input: { incomeItems: itemsYuan([10000]), expenseItems: [], directConsumeFen: 0, amortizeFen: 0, amortizeSwitchOn: false, inventorySwitchOn: true, inventory: { openingFen: 100000, purchaseFen: 0, closingFen: 300000 } } },
  { name: '仅摊销开 + 小数摊销额', input: { incomeItems: itemsYuan([10000]), expenseItems: [], directConsumeFen: 100000, amortizeFen: 333344.6, amortizeSwitchOn: true, inventorySwitchOn: false } },
  { name: '脏输入（字符串/NaN/缺字段）', input: { incomeItems: [{ amountFen: '100' }, { amountFen: NaN }], expenseItems: [{ amountFen: 50 }], directConsumeFen: '200', amortizeFen: NaN, amortizeSwitchOn: 1, inventorySwitchOn: 'x' } },
];
for (const c of CASES) {
  const a = calcMonthlyProfit(c.input);
  const b = saveLedger.calcMonthlyProfit(c.input);
  const diff = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  check(`[${c.name}] getLedger ≡ saveLedger（逐字段 ${Object.keys(b).length} 项）`, diff.length === 0, diff.length ? '不一致字段: ' + diff.join(',') : '');
}
check('零收入毛利率 = 0（不产生 NaN/Infinity）', calcMonthlyProfit({ incomeItems: [], expenseItems: [], directConsumeFen: 0, amortizeFen: 0 }).grossMarginRatePctDisplay === 0);
check('脏输入不产生 NaN（金额一律 num0 归一）', Number.isFinite(calcMonthlyProfit({ incomeItems: [], expenseItems: [], directConsumeFen: 'abc' }).operationRefProfitFen));
check('金额出参一律整数分（Number.isInteger）', [r1, r2].every((x) => Number.isInteger(x.incomeTotalFen) && Number.isInteger(x.operationRefProfitFen) && Number.isInteger(x.totalFactorRealProfitFen)));

console.log('===== 3. 入参面 =====');
check('合法入参放行', validateInput({ shop_id: 's1', month: '2026-09' }).error === null);
check('month "2026-13" → 拒', validateInput({ shop_id: 's1', month: '2026-13' }).error === ERROR_CODES.INVALID_PARAM);
check('month "2026-1" → 拒（两位月）', validateInput({ shop_id: 's1', month: '2026-1' }).error === ERROR_CODES.INVALID_PARAM);
check('month "202609" → 拒', validateInput({ shop_id: 's1', month: '202609' }).error === ERROR_CODES.INVALID_PARAM);
check('month 缺失 → 拒（本函数 month 必填）', validateInput({ shop_id: 's1' }).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 缺失 → 拒', validateInput({ month: '2026-09' }).error === ERROR_CODES.INVALID_PARAM);
check('支持 { input: {...} } 包裹层', validateInput({ input: { shop_id: 's1', month: '2026-09' } }).month === '2026-09');
check('错误码 = INVALID_PARAM（全局标准码）', ERROR_CODES.INVALID_PARAM === 'INVALID_PARAM');

console.log('===== 4. 静态形状守卫 =====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const body = src.slice(src.indexOf('exports.main'));
const at = (s) => body.indexOf(s);
check('顺序：resolveAuth → assertShopOwner → validateInput', at('resolveAuth') < at('assertShopOwner') && at('assertShopOwner') < at('validateInput'));
check('🔴 开关取服务端权威值（读 shop_switch 表，不信前端/落库快照）', /da\.list\('shop_switch'/.test(body) && /inventory_switch/.test(body));
check('🔴 回读即重算（调 calcMonthlyProfit），不直接回吐库存值', /calcMonthlyProfit\(/.test(body));
check('无记录返回空账而非报错（RESOURCE_NOT_FOUND 不得出现）', !/RESOURCE_NOT_FOUND/.test(body));
check('读账走 DataAdapter（软删过滤）', /da\.list\('shop_monthly_account'/.test(body));
check('出参金额字段名与 service 一致（snake_case 契约）', body.includes('operation_ref_profit_fen: result.operationRefProfitFen') && body.includes('total_factor_real_profit_fen: result.totalFactorRealProfitFen'));

console.log(`\n==== getLedger 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
