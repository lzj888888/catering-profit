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

console.log('');
console.log('===== A2 · 二级细项 sub_items（云函数汇总大类金额，前端不计算）=====');
// 形态 A：sub_items 数组 → amountFen = Σ 细项（云函数算，不采信前端大类值）
const va = validateInput({
  shop_id: 's1', month: '2026-07', direct_consume_fen: 100,
  income_items: [
    { category: 'dine_in', name: '堂食', sub_items: [{ sub_item: '现金', amount_fen: 800000 }, { sub_item: '微信', amount_fen: 2500000 }] },
  ],
  expense_items: [],
});
check('A2 形态A（sub_items）放行', va.error === null);
check('A2 大类金额 = Σ 细项（8,000+25,000=33,000 元 → 3,300,000 分）', va.incomeItems[0].amountFen === 3300000, `=${va.incomeItems[0].amountFen}`);
check('A2 细项原样保留（含 subItem 名称）', va.incomeItems[0].subItems.length === 2 && va.incomeItems[0].subItems[1].subItem === '微信');
// 前端传了大类 amount_fen 但带 sub_items → 以细项汇总为准（计算下沉，不采信前端值）
const vb = validateInput({
  shop_id: 's1', month: '2026-07', direct_consume_fen: 100,
  income_items: [{ category: 'dine_in', name: '堂食', amount_fen: 999999, sub_items: [{ sub_item: '现金', amount_fen: 50000 }] }],
  expense_items: [],
});
check('A2 带 sub_items 时前端大类 amount_fen 不采信（以细项汇总=500 元）', vb.incomeItems[0].amountFen === 50000, `=${vb.incomeItems[0].amountFen}`);
// sub_item 超长 → 拒（21 字 > 20）
check('A2 sub_item 超 20 字 → INVALID_PARAM', validateInput({
  shop_id: 's1', month: '2026-07', direct_consume_fen: 100,
  income_items: [{ category: 'dine_in', sub_items: [{ sub_item: '一二三四五六七八九十一二三四五六七八九十一', amount_fen: 1 }] }],
  expense_items: [],
}).error === 'INVALID_PARAM');
// sub_items 金额负数/字符串 → 拒
check('A2 sub_items 金额为字符串 → INVALID_PARAM', validateInput({
  shop_id: 's1', month: '2026-07', direct_consume_fen: 100,
  income_items: [{ category: 'dine_in', sub_items: [{ sub_item: 'a', amount_fen: '100' }] }],
  expense_items: [],
}).error === 'INVALID_PARAM');
// 空 sub_items → 大类 0 元（合法）
const vc = validateInput({
  shop_id: 's1', month: '2026-07', direct_consume_fen: 100,
  income_items: [{ category: 'dine_in', name: '堂食', sub_items: [] }],
  expense_items: [],
});
check('A2 空 sub_items → 大类 0 元且放行', vc.error === null && vc.incomeItems[0].amountFen === 0);

// 形态 B 兼容：旧单行 amount_fen 仍可用（回归保护）
const vd = validateInput({ ...g });
check('A2 旧形态（单行 amount_fen）仍放行（回归）', vd.error === null && vd.incomeItems[0].amountFen === 1 && vd.incomeItems[0].subItems.length === 0);

// ===== A1 · S1 四大类费用 + 二级细项 → 引擎锚点（营销团购/外卖佣金分列）=====
console.log('');
console.log('===== A1 · S1 费用四大类（运营/人工/营销/其他）经 sub_items 汇总后引擎锚点 =====');
const s1Expense = validateInput({
  shop_id: 's1', month: '2026-07', direct_consume_fen: 22000 * YUAN,
  income_items: [
    { category: 'dine_in', name: '堂食', sub_items: [{ sub_item: '现金', amount_fen: 8000 * YUAN }, { sub_item: '微信支付宝', amount_fen: 25000 * YUAN }, { sub_item: '储值消费', amount_fen: 5000 * YUAN }, { sub_item: '团购券核销', amount_fen: 3000 * YUAN }, { sub_item: '企业挂账', amount_fen: 2000 * YUAN }] },
    { category: 'takeaway', name: '外卖', sub_items: [{ sub_item: '商品总价', amount_fen: 18000 * YUAN }, { sub_item: '打包费', amount_fen: 500 * YUAN }, { sub_item: '活动补贴', amount_fen: 1500 * YUAN }] },
    { category: 'other', name: '其他业务收入', sub_items: [{ sub_item: '废品变卖', amount_fen: 200 * YUAN }, { sub_item: '预制菜零售', amount_fen: 800 * YUAN }] },
  ],
  expense_items: [
    { category: 'operation', name: '运营', sub_items: [{ sub_item: '房租', amount_fen: 8000 * YUAN }, { sub_item: '物业费', amount_fen: 500 * YUAN }, { sub_item: '水费', amount_fen: 200 * YUAN }, { sub_item: '电费', amount_fen: 800 * YUAN }, { sub_item: '燃气费', amount_fen: 600 * YUAN }, { sub_item: '垃圾清运费', amount_fen: 100 * YUAN }, { sub_item: '宽带网费', amount_fen: 100 * YUAN }] },
    { category: 'labor', name: '人工', sub_items: [{ sub_item: '工资绩效', amount_fen: 12000 * YUAN }, { sub_item: '社保', amount_fen: 1500 * YUAN }, { sub_item: '员工宿舍', amount_fen: 800 * YUAN }, { sub_item: '员工餐', amount_fen: 500 * YUAN }, { sub_item: '工装福利', amount_fen: 200 * YUAN }] },
    { category: 'marketing', name: '营销', sub_items: [{ sub_item: '外卖平台佣金', amount_fen: 3600 * YUAN }, { sub_item: '外卖配送服务费', amount_fen: 1200 * YUAN }, { sub_item: '外卖活动补贴', amount_fen: 1500 * YUAN }, { sub_item: '外卖配送补贴', amount_fen: 300 * YUAN }, { sub_item: '外卖推广费', amount_fen: 400 * YUAN }, { sub_item: '团购平台佣金', amount_fen: 240 * YUAN }] },
    { category: 'other', name: '其他', sub_items: [{ sub_item: '代账费', amount_fen: 300 * YUAN }] },
  ],
});
check('A1 运营大类汇总 = 10,300（1030000分）', s1Expense.expenseItems[0].amountFen === 1030000, `=${s1Expense.expenseItems[0].amountFen}`);
check('A1 人工大类汇总 = 15,000（1500000分）', s1Expense.expenseItems[1].amountFen === 1500000, `=${s1Expense.expenseItems[1].amountFen}`);
check('A1 营销大类汇总 = 7,240（724000分）', s1Expense.expenseItems[2].amountFen === 724000, `=${s1Expense.expenseItems[2].amountFen}`);
check('A1 其他大类汇总 = 300（30000分）', s1Expense.expenseItems[3].amountFen === 30000, `=${s1Expense.expenseItems[3].amountFen}`);
check('A1 🏆 全部费用合计 = 32,840（3284000分）', s1Expense.expenseItems.reduce((s, x) => s + x.amountFen, 0) === 3284000);
check('A1 营销团购/外卖佣金分列（两个独立细项不合并）', s1Expense.expenseItems[2].subItems.some((x) => x.subItem === '外卖平台佣金') && s1Expense.expenseItems[2].subItems.some((x) => x.subItem === '团购平台佣金'));
check('A1 🏆 经营参考 = 9,160（收入64,000 − 费用32,840 − 消耗22,000）', calcMonthlyProfit({ incomeItems: s1Expense.incomeItems, expenseItems: s1Expense.expenseItems, directConsumeFen: 22000 * YUAN, amortizeFen: 0, amortizeSwitchOn: false, inventorySwitchOn: false, inventory: {} }).operationRefProfitFen === 916000);

console.log(`\n==== saveLedger 批次 4/8 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);