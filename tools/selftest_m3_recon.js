// tools/selftest_m3_recon.js —— M3.21 M1↔M3 率对率对账自测（批次 E）
//
// 锚点（规范 v1.1 §M3.21，require 真实单源实算，不重写、不写死期望值自证）：
//   D 标准菜单毛利率 / D 差值 / D 抑制 / 细项名单源 / 套餐默认排除 / 除零与空账
//
// 运行：node tools/selftest_m3_recon.js

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const { calcMenuMargin, calcActualDishMargin, reconcile, GOODS_FIELD } = require('../utils/reconDerive.js');
const { TERMS } = require('../miniprogram/i18n/terms.js');

console.log('===== D · 标准菜单毛利率 =====');
const menu = calcMenuMargin([
  { card_type: 1, price_fen: 2800, total_cost_fen: 975 },     // 宫保鸡丁
  { card_type: 1, price_fen: 3200, total_cost_fen: 1120 },    // 糖醋里脊
  { card_type: 1, price_fen: 300, total_cost_fen: 120 },      // 米饭
]);
check('D 标准菜单毛利率 (6300−2215)/6300 = 64.84%', menu.pct === 64.84, `got ${menu.pct}`);

console.log('===== D · 差值 / 折算金额 =====');
// 实际 55% < 菜单 64.84% ⇒ diffPp = 55 − 64.84 = −9.84（少 9.84pp）⇒ 折算 −9840 元（少赚 9840）
const rec = reconcile({ menuPct: menu.pct, actualPct: 55, coverage: 1, incomeFen: 100000 });
check('D 差值 diffPp = −9.84（actual 55 − menu 64.84）', rec.diffPp === -9.84, `got ${rec.diffPp}`);
check('D 折算金额 diffFen = −9840（菜品口径收入 10 万）', rec.diffFen === -9840, `got ${rec.diffFen}`);
check('D 未抑制（coverage=1 ≥ 0.6）', rec.suppressed === false, '');

console.log('===== D · 覆盖率闸门（抑制）=====');
const suppressed = reconcile({ menuPct: menu.pct, actualPct: 55, coverage: 3 / 12, incomeFen: 100000 });
check('D 覆盖率 3/12 = 25% < 60% ⇒ 抑制生效', suppressed.suppressed === true, JSON.stringify(suppressed));
check('D 抑制时只回两个 pct、diffPp 为 null', suppressed.diffPp === null && suppressed.diffFen === null, `diffPp=${suppressed.diffPp} diffFen=${suppressed.diffFen}`);
check('D 抑制时两个 pct 仍可读', suppressed.menuPct === 64.84 && suppressed.actualPct === 55, '');
const missingCov = reconcile({ menuPct: menu.pct, actualPct: 55, coverage: null, incomeFen: 100000 });
check('D 覆盖率缺失（null）⇒ 抑制', missingCov.suppressed === true && missingCov.diffPp === null, JSON.stringify(missingCov));

console.log('===== 细项名单源 =====');
check("细项名取自单源（GOODS_FIELD === TERMS.ledger.takeawayMode.goodsField）",
  GOODS_FIELD === TERMS.ledger.takeawayMode.goodsField && GOODS_FIELD === '商品总价', GOODS_FIELD);

console.log('===== 套餐默认排除（正负互证）=====');
const withCombo = [
  { card_type: 1, price_fen: 2800, total_cost_fen: 975 },
  { card_type: 1, price_fen: 3200, total_cost_fen: 1120 },
  { card_type: 1, price_fen: 300, total_cost_fen: 120 },
  { card_type: 3, price_fen: 2500, total_cost_fen: 1275 },   // 套餐（引用宫保等，会重复计成本）
];
const excl = calcMenuMargin(withCombo, { includeCombo: false });
const incl = calcMenuMargin(withCombo, { includeCombo: true });
check('套餐默认排除：加套餐后默认口径与不含套餐一致（64.84）', excl.pct === 64.84, `got ${excl.pct}`);
check('includeCombo: true 时含套餐 ⇒ 结果改变（≠ 64.84）', incl.pct !== 64.84 && incl.pct != null, `got ${incl.pct}`);

console.log('===== 除零 / 空账 =====');
const zeroPrice = calcMenuMargin([{ price_fen: 0, total_cost_fen: 0 }]);
check('price_fen 全 0 ⇒ pct === null 且 reason === no_price（不许除零/不许返回 0）',
  zeroPrice.pct === null && zeroPrice.reason === 'no_price', JSON.stringify(zeroPrice));
const emptyMenu = calcMenuMargin([]);
check('空卡数组 ⇒ pct === null（不是 0）', emptyMenu.pct === null && emptyMenu.reason === 'no_price', JSON.stringify(emptyMenu));

console.log('===== 外卖快速录入 ⇒ 抑制（need_detail_income）=====');
const fastLedger = { income_items: [{ category: 'takeaway', amount_fen: 6585, sub_items: [] }], result: { material_cost_fen: 3000 } };
const fastActual = calcActualDishMargin(fastLedger);
check('外卖快速录入（无 sub_items）⇒ pct === null 且 reason === need_detail_income',
  fastActual.pct === null && fastActual.reason === 'need_detail_income', JSON.stringify(fastActual));

console.log('===== 实际菜品毛利率（分项录入）=====');
const detailLedger = {
  income_items: [
    { category: 'dine_in', amount_fen: 70000, sub_items: [] },
    { category: 'takeaway', amount_fen: 32000, sub_items: [
      { sub_item: '商品总价', amount_fen: 28000 },
      { sub_item: '打包费', amount_fen: 2000 },
      { sub_item: '商家活动补贴', amount_fen: 2000 },
    ] },
    { category: 'other', amount_fen: 2000, sub_items: [] },
  ],
  result: { material_cost_fen: 45000 },
};
const actual = calcActualDishMargin(detailLedger);
check('菜品口径收入 = dine_in 70000 + 外卖商品总价 28000 = 98000', actual.income_fen === 98000, `got ${actual.income_fen}`);
check('实际菜品毛利率 = (98000−45000)/98000 = 54.08%', actual.pct === 54.08, `got ${actual.pct}`);

console.log('\n' + '='.repeat(60));
console.log(`===== M3.21 对账自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
