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

const fs = require('fs');
const path = require('path');
const { calcMenuMargin, calcActualDishMargin, reconcile, suppressKeyOf, GOODS_FIELD } = require('../utils/reconDerive.js');
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

// ============================================================
// R298X · 抑制原因 → 文案键（修前：menu_no_price / actual_no_data 被兜底成「覆盖率不足」）
//   根因：`reconcile` 的判定顺序是 coverage_missing → coverage_low → menu_no_price → actual_no_data
//   ⇒ 能走到后两种 reason，说明**覆盖率是够的（≥60%）**；而页面把这两种兜底成覆盖率文案，
//     于是用户在覆盖率 100% 的页面上读到「覆盖率不足」，去补在售菜品数（真问题是没填售价 / 没录收入）。
//   修法：reason→文案键 提到单源 `utils/reconDerive.js::suppressKeyOf`，本段 ①~⑧ 对它**实跑**判行为。
// ============================================================
console.log('\n===== R298X · 抑制原因 → 文案键（单源分派 + 语义相符）=====');

// ① 单源分派必须可 require 并实跑（不是抄字面量进测试）
check('R298X-① suppressKeyOf 已从单源导出', typeof suppressKeyOf === 'function');

// ② 六种入参 → 专属键（期望值手写，不从被测模块读回）
const KEY_CASES = [
  ['coverage_missing', undefined, 'reconSuppressNoCount'],
  ['coverage_low', undefined, 'reconSuppressCoverage'],
  ['menu_no_price', undefined, 'reconSuppressNoPrice'],
  ['actual_no_data', 'need_detail_income', 'reconSuppressDetail'],
  ['actual_no_data', 'no_income', 'reconSuppressNoIncome'],
  ['unknown_reason_xyz', undefined, 'reconSuppressGeneric'],
];
const keyBad = [];
for (const [reason, ar, want] of KEY_CASES) {
  const got = suppressKeyOf({ suppressed: true, reason }, ar);
  if (got !== want) keyBad.push(`${reason}/${ar || '-'} ⇒ ${got} ≠ ${want}`);
}
check('R298X-② 每个 reason 映射到语义相符的专属键（6/6）', keyBad.length === 0, keyBad.join(' · ') || '6 组全中');

// ③ 🔴 核心判据：覆盖率文案**只允许** coverage_low 用（**判行为**，不是判上面那张用例表）
//    ⚠️ 自纠：初版写成 `KEY_CASES.filter(...)` —— 那只在检查**测试自己的表**，
//       对生产码是**恒真断言**（把单源改坏它照样绿）。变异证明 A1 当场把它证出来。
const borrowCases = [
  ['menu_no_price', undefined], ['actual_no_data', 'need_detail_income'],
  ['actual_no_data', 'no_income'], ['coverage_missing', undefined],
];
const borrowed = borrowCases.filter(([reason, ar]) => suppressKeyOf({ suppressed: true, reason }, ar) === 'reconSuppressCoverage').map((c) => c[0]);
check('R298X-③ 🔴「覆盖率不足」文案只属于 coverage_low（实跑：其余 reason 一律不得取到它）',
  borrowed.length === 0,
  borrowed.length ? borrowed.join('、') + ' 实跑取到了覆盖率文案（本轮修的正是这条）' : `${borrowCases.length} 种非 coverage_low 入参均未取到`);

// ④ 专属键互不重复（防「两个 reason 共用一条文案」复活）；通用兜底不计入
const distinct = KEY_CASES.map((c) => c[2]).filter((k) => k !== 'reconSuppressGeneric');
check('R298X-④ 专属键互不重复（几个 reason 就有几条文案）',
  new Set(distinct).size === distinct.length, `实 ${distinct.length} 个 reason / ${new Set(distinct).size} 个键`);

// ⑤ 键名对了但 terms 里没有 = 又是静默空白（WXML 对 undefined 不报错）
const keyPool = distinct.concat(['reconSuppressGeneric']);
const missingKeys = keyPool.filter((k) => !TERMS.card[k] || !String(TERMS.card[k]).trim());
check('R298X-⑤ 每个键在 TERMS.card 里真实存在且非空', missingKeys.length === 0, missingKeys.join('、') || `${keyPool.length} 键全部就位`);

// ⑥⑦⑧ 语义相符：文案必须指向**真问题**，不得再出现「覆盖率」串味
check('R298X-⑥ menu_no_price 文案指向「售价」（不含"覆盖率/在售"字样）',
  /售价/.test(TERMS.card.reconSuppressNoPrice) && !/覆盖率|在售/.test(TERMS.card.reconSuppressNoPrice),
  TERMS.card.reconSuppressNoPrice);
check('R298X-⑦ actual_no_data 文案指向「收入」（不含"覆盖率"字样）',
  /收入/.test(TERMS.card.reconSuppressNoIncome) && !/覆盖率/.test(TERMS.card.reconSuppressNoIncome),
  TERMS.card.reconSuppressNoIncome);
check('R298X-⑧ 通用兜底文案不串味（不含 覆盖率/售价/收入 任何具体 reason 的措辞）',
  !/覆盖率|售价|收入/.test(TERMS.card.reconSuppressGeneric), TERMS.card.reconSuppressGeneric);

// ⑨⑩ 页面侧：reason→文案 的判定**只许在单源里**（形态判据，剥注释后扫）
const recoSrc = fs.readFileSync(path.join(__dirname, '..', 'subpkg', 'tools', 'recon', 'index.js'), 'utf8');
const recoBody = recoSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('R298X-⑨ 页面改走单源（正文含 suppressKeyOf( 调用）', /suppressKeyOf\(/.test(recoBody));
const REASON_LITERALS = ['coverage_missing', 'coverage_low', 'menu_no_price', 'actual_no_data'];
const leaked = REASON_LITERALS.filter((r) => recoBody.indexOf(`'${r}'`) >= 0);
check('R298X-⑩ 🔴 页面正文不得出现 reason 字面量（reason→文案 的判定只许在单源里）',
  leaked.length === 0, leaked.length ? '页面仍内联判定：' + leaked.join('、') : '零 reason 字面量');

// ⑪ 前提：用例表非空（防「扫了空集所以全绿」）
check('R298X-⑪ 前提：KEY_CASES 组数 ≥ 6（删用例即转红）', KEY_CASES.length >= 6, `实 ${KEY_CASES.length} 组`);

console.log('\n' + '='.repeat(60));
console.log(`===== M3.21 对账自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);