// tools/selftest_m3_combo.js —— M3.16 套餐成本卡（引用型卡）自测（批次 C）
//
// 核心约束：**必须 require 生产引擎 `cloudfunctions/calcBom/service.js` 实算**，不许重写一份引擎。
//   套餐行在引擎眼里与原料行**形状相同** ⇒ 把「子卡单份成本(分) × 100」当 net_unit_cost、quantity = 份数，
//   喂**同一个** calcCostCard。引擎一行不改（R131 副本等价守卫继续兜底）。
//
// 覆盖锚点（规范 §M3.26）：
//   A-a 套餐成本 1275 分；售 25 元 ⇒ 毛利 1225、毛利率 49%；少赚 1200、顾客省 1200
//   A-b 锁版本：子卡涨价（宫保 975→1208）套餐仍 1275；同步至最新 ⇒ 1508（毛利率 39.68%）
//   A-c 禁嵌套：套餐引用套餐 ⇒ COMBO_NEST_NOT_ALLOWED；版本无效 ⇒ SUB_CARD_VERSION_INVALID
//
// 运行：node tools/selftest_m3_combo.js

const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// —— require 生产引擎 + 派生层单源（不重写引擎、不复制逻辑）——
const { calcCostCard } = require('../cloudfunctions/calcBom/service.js');
const { buildComboLines, comboInsight, judgeComboRef, fenToWan } = require('../cloudfunctions/common/comboDerive.js');

console.log('===== A-a · 套餐成本 / 毛利 / 毛利率 =====');
// 子卡：宫保 975 / 米饭 120 / 例汤 180（各 1 份）；套餐无辅料、无损耗。
const subCardsAa = [
  { card_code: 'cc_gongbao', name: '宫保鸡丁', unit_cost_fen: 975, quantity: 1 },
  { card_code: 'cc_rice', name: '米饭', unit_cost_fen: 120, quantity: 1 },
  { card_code: 'cc_soup', name: '例汤', unit_cost_fen: 180, quantity: 1 },
];
const comboLines = buildComboLines(subCardsAa);
check('A-a buildComboLines 生成 3 行', comboLines.length === 3);
check('A-a 子卡行 net_unit_cost = 成本分 × 100（宫保 975→97500 万分）',
  comboLines[0].net_unit_cost === 97500, `97500 expected, got ${comboLines[0].net_unit_cost}`);
check('A-a fenToWan(975)=97500（1 分 = 100 万分）', fenToWan(975) === 97500);

const costAa = calcCostCard({ mode: 'A', lines: comboLines, auxFen: 0, lossPct: 0, priceFen: 2500 });
check('A-a 套餐成本 = 1275 分', costAa.unit_cost_fen === 1275, `got ${costAa.unit_cost_fen}`);
check('A-a 毛利 = 1225（2500−1275）', costAa.gross_profit_fen === 1225, `got ${costAa.gross_profit_fen}`);
check('A-a 毛利率 = 49%', costAa.gross_margin_pct === 49, `got ${costAa.gross_margin_pct}`);

console.log('===== A-a 对比 · 顾客省 / 我少赚 / 成本结构 =====');
// 子菜单点挂牌价：宫保 2800 / 米饭 600 / 例汤 300 ⇒ 单点毛利合计 2425
const insightAa = comboInsight(
  [
    { name: '宫保鸡丁', unit_cost_fen: 975, price_fen: 2800, quantity: 1 },
    { name: '米饭', unit_cost_fen: 120, price_fen: 600, quantity: 1 },
    { name: '例汤', unit_cost_fen: 180, price_fen: 300, quantity: 1 },
  ],
  2500,
  1275,
);
check('A-a 顾客省 = 1200（Σ 单点 3700 − 套餐 2500）', insightAa.customerSaveFen === 1200, `got ${insightAa.customerSaveFen}`);
check('A-a 我少赚 = −1200（套餐毛利 1225 − 单点毛利 2425）', insightAa.merchantLoseFen === -1200, `got ${insightAa.merchantLoseFen}`);
check('A-a 成本结构 3 项', insightAa.costShare.length === 3);
check('A-a 宫保成本占比 ≈ 76.47%', Math.abs(insightAa.costShare[0].share_pct - 76.47) < 0.01, `got ${insightAa.costShare[0].share_pct}`);

console.log('===== A-b · 锁版本：子卡涨价不回溯 / 同步至最新 =====');
// 锁版本：套餐保存时锁定的子卡成本仍是 975（宫保），鸡胸肉涨价后宫保升到 1208，但套餐明细行快照仍是 97500 万分
const lockedLines = buildComboLines([
  { card_code: 'cc_gongbao', name: '宫保鸡丁', unit_cost_fen: 975, quantity: 1, version: 1 },   // 锁 v1 = 975
  { card_code: 'cc_rice', name: '米饭', unit_cost_fen: 120, quantity: 1, version: 1 },
  { card_code: 'cc_soup', name: '例汤', unit_cost_fen: 180, quantity: 1, version: 1 },
]);
const costLocked = calcCostCard({ mode: 'A', lines: lockedLines, auxFen: 0, lossPct: 0, priceFen: 2500 });
check('A-b 锁版本套餐仍 1275（子卡涨价不回溯）', costLocked.unit_cost_fen === 1275, `got ${costLocked.unit_cost_fen}`);

// 同步至最新：宫保 v2 = 1208，米饭/例汤不变 ⇒ 1208 + 120 + 180 = 1508
const syncedLines = buildComboLines([
  { card_code: 'cc_gongbao', name: '宫保鸡丁', unit_cost_fen: 1208, quantity: 1, version: 2 },  // 最新 v2 = 1208
  { card_code: 'cc_rice', name: '米饭', unit_cost_fen: 120, quantity: 1, version: 1 },
  { card_code: 'cc_soup', name: '例汤', unit_cost_fen: 180, quantity: 1, version: 1 },
]);
const costSynced = calcCostCard({ mode: 'A', lines: syncedLines, auxFen: 0, lossPct: 0, priceFen: 2500 });
check('A-b 同步至最新套餐成本 = 1508', costSynced.unit_cost_fen === 1508, `got ${costSynced.unit_cost_fen}`);
check('A-b 同步后毛利率 = 39.68%（2500−1508=992）',
  Math.abs(costSynced.gross_margin_pct - 39.68) < 0.005, `got ${costSynced.gross_margin_pct}`);

console.log('===== A-c · 禁嵌套 / 版本无效 =====');
// 套餐引用套餐（子卡 card_type=3）⇒ COMBO_NEST_NOT_ALLOWED
const nestVerdict = judgeComboRef({ sub_card_ref: 'cc_combo2' }, { card_code: 'cc_combo2', card_type: 3, version: 1, is_deleted: false });
check('A-c 套餐引用套餐 ⇒ COMBO_NEST_NOT_ALLOWED', nestVerdict.ok === false && nestVerdict.code === 'COMBO_NEST_NOT_ALLOWED', JSON.stringify(nestVerdict));
// 版本不存在 ⇒ SUB_CARD_VERSION_INVALID
const missingVerdict = judgeComboRef({ sub_card_ref: 'cc_nope' }, null);
check('A-c 版本不存在 ⇒ SUB_CARD_VERSION_INVALID', missingVerdict.ok === false && missingVerdict.code === 'SUB_CARD_VERSION_INVALID', JSON.stringify(missingVerdict));
// 已软删 ⇒ SUB_CARD_VERSION_INVALID
const softDelVerdict = judgeComboRef({ sub_card_ref: 'cc_x' }, { card_code: 'cc_x', card_type: 1, version: 1, is_deleted: true });
check('A-c 已软删 ⇒ SUB_CARD_VERSION_INVALID', softDelVerdict.ok === false && softDelVerdict.code === 'SUB_CARD_VERSION_INVALID', JSON.stringify(softDelVerdict));
// 正常引用（单品，非套餐）⇒ 通过
const okVerdict = judgeComboRef({ sub_card_ref: 'cc_gongbao' }, { card_code: 'cc_gongbao', card_type: 1, version: 1, is_deleted: false });
check('A-c 正常单品引用 ⇒ 通过', okVerdict.ok === true, JSON.stringify(okVerdict));

console.log('\n' + '='.repeat(60));
console.log(`===== M3.16 套餐自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
