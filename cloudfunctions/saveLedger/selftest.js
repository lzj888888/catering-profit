// cloudfunctions/saveLedger/selftest.js —— 批次 4 · M1 月度账内嵌引擎自测（S1/S2 锚点 + 归档守卫校验）
// 运行： node cloudfunctions/saveLedger/selftest.js
//
// 目的：证明 saveLedger 内嵌的双利润引擎与批次 1 calcMonthlyProfit **同源同值**，
//       （S1 经营参考 9,160 / S2 全要素 3,476.67），以及 S3 摊销末月尾差倒挤 3,333.45。
const { calcMonthlyProfit, amortizeTotalForMonth } = require('./service');
const { validateInput } = require('./validate');

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
const AMORTIZE_FEN = Math.round(4683.33 * YUAN); // 468333

// ===== S1：库存关 / 摊销关 =====
const r1 = calcMonthlyProfit({ incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: false, inventorySwitchOn: false, inventory: {} });
check('S1 经营参考利润 = 9,160（916000分）', r1.operationRefProfitFen === 916000, `=${r1.operationRefProfitFen}`);
check('S1 全要素真实利润 = 9,160（口径锁，库存关无倒轧）', r1.totalFactorRealProfitFen === 916000, `=${r1.totalFactorRealProfitFen}`);

// ===== S2：库存开 / 摊销开 =====
const r2 = calcMonthlyProfit({ incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: true, inventorySwitchOn: true, inventory: { openingFen: 5000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN } });
check('S2 真实消耗 = 23,000（倒轧）', r2.realConsumeFen === 2300000, `=${r2.realConsumeFen}`);
check('S2 经营参考仍 = 9,160（口径锁：开库存也不改用倒轧）', r2.operationRefProfitFen === 916000, `=${r2.operationRefProfitFen}`);
check('🏆 S2 全要素真实利润 = 3,476.67（347667分）', r2.totalFactorRealProfitFen === 347667, `=${r2.totalFactorRealProfitFen}`);
check('S2 两利润差异 = 5,683.33（568333分）', r2.profitDiffFen === 568333, `=${r2.profitDiffFen}`);

// ===== S3：摊销末月尾差倒挤（装修 120,000/36 月，末月 3,333.45）=====
const decor = { asset_id: 'a', total_value: 120000 * YUAN, start_month: '2026-01', total_months: 36, terminate_month: '' };
check('装修 2026-12 摊销 = 3,333.33', amortizeTotalForMonth([decor], '2026-12') === 333333, `=${amortizeTotalForMonth([decor], '2026-12')}`);
check('🏆 装修末月 2028-12 尾差倒挤 = 3,333.45（333345分）', amortizeTotalForMonth([decor], '2028-12') === 333345, `=${amortizeTotalForMonth([decor], '2028-12')}`);

// ===== 校验：validate（金额字符串拒 / 明细双收拒）=====
const g = { shop_id: 's1', month: '2026-07', income_items: [{ amount_fen: 1 }], expense_items: [], direct_consume_fen: 100 };
check('合法月度账放行', validateInput(g).error === null);
check('明细 amount_fen 为字符串 → INVALID_PARAM', validateInput({ ...g, income_items: [{ amount_fen: '1' }] }).error === 'INVALID_PARAM');
check('明细 amountFen 并存 → INVALID_PARAM（R30）', validateInput({ ...g, income_items: [{ amount_fen: 1, amountFen: 1 }] }).error === 'INVALID_PARAM');
check('month 非 YYYY-MM → INVALID_PARAM', validateInput({ ...g, month: '2026-7' }).error === 'INVALID_PARAM');

console.log(`\n==== saveLedger 批次 4 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);