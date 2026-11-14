'use strict';
// review/evidence/r194_audit_weighted_wiring.js
// 独立交叉审计 ·【R729 加权标量接线】真实引擎端到端取证
//
// 方法（engine-truth-audit）：一切数字来自生产引擎真实输出，不手抄。
//   - 真实 require  production 的 getDishReview/service.js
//   - 用真实 buildDishReview / buildTakeawayReview / mergeTotals 产出的「ranked / totals」
//     对象，100% 复刻 index.js 免费档的接线（ranked=dine_in，totals.qty=全渠道）
//   - 再把同一批销量行喂「正确全渠道口径」（ranked = 堂食+外卖合并）对照，暴露口径差
//   - 与现有守卫 check_r729_weighted_wiring.js 的锚点（55.22/32.13/36.00）独立复算交叉验证
//
// 运行：node review/evidence/r194_audit_weighted_wiring.js   （EXIT 0=审计通过，!=0=发现真缺陷）

const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SVC = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js'));
const { buildDishReview, buildTakeawayReview, mergeTotals, calcWeightedMenuPct } = SVC;

// 与 check_r729 / check_r714 同款成本卡与锚点构造
const CARDS = [
  { card_code: 'A', version: 1, name: '青菜', price_list: 1200, total_cost: 400 },
  { card_code: 'B', version: 1, name: '招牌鱼', price_list: 8800, total_cost: 6000 },
];
// deps：无映射表（lookupCardCode 恒空 ⇒ 走同名归一回落，dish_key 直接命中 nameToCode）
const deps = {
  normalizeDishName: (s) => String(s == null ? '' : s).trim(),
  toMonth: () => '2026-11',
  lookupCardCode: () => '',
};

let pass = 0, found = 0;
const log = (tag, msg) => console.log('   ' + tag + ' ' + msg);
function expect(name, cond, extra) {
  if (cond) { pass++; log('✅', name); }
  else { found++; log('❌', name + (extra ? '  → ' + extra : '')); }
}

console.log('\n===== R194 审计：用真实引擎复算加权标量（独立交叉）=====');

// ---- 0. 锚点独立复算（与 check_r729 A-①/A-②、check_r714 交叉验证，不采信任何一方）----
const R = (a, b) => ([{ card_code: 'A', qty: a }, { card_code: 'B', qty: b }]);
const anchorGood = calcWeightedMenuPct(R(300, 20), CARDS, 320);
const anchorFlip = calcWeightedMenuPct(R(20, 300), CARDS, 320);
const anchorEq = calcWeightedMenuPct(R(300, 300), CARDS, 600);
expect('锚点·便宜菜卖多 = 55.22%', anchorGood.pct === 55.22, JSON.stringify(anchorGood));
expect('锚点·贵菜卖多 = 32.13%', anchorFlip.pct === 32.13, JSON.stringify(anchorFlip));
expect('锚点·等量 ≡ 售价加权 36.00%', anchorEq.pct === 36, JSON.stringify(anchorEq));

// 手写独立复算校验公式口径 1 - Σ(qty·cost)/Σ(qty·price)
function handCalc(qA, qB) {
  const rev = qA * 1200 + qB * 8800;
  const cost = qA * 400 + qB * 6000;
  return Math.round((1 - cost / rev) * 10000) / 100;
}
expect('公式口径自检·便宜菜卖多 55.22', handCalc(300, 20) === 55.22);
expect('公式口径自检·贵菜卖多 32.13', handCalc(20, 300) === 32.13);
expect('公式口径自检·等量 36.00', handCalc(300, 300) === 36);

console.log('\n===== 真实引擎端到端：复刻 index.js 免费档接线，再与「正确全渠道口径」对照 =====');

// 工具：把销量行喂真实引擎，产出与 index.js 完全一致的 { ranked, totals }
function runFreeTierWiring(dineInRows, takeawayRows) {
  const { dine_in: ranked, totals: dineTotals } = buildDishReview(dineInRows, CARDS, deps);
  const takeawayResult = buildTakeawayReview(takeawayRows, CARDS, deps);
  const totals = mergeTotals(dineTotals, takeawayResult.totals);
  // —— 这就是 getDishReview/index.js:180 的真实接线 ——
  const actual = calcWeightedMenuPct(ranked, CARDS, totals.qty);
  // —— 正确的全渠道口径：把所有已建卡销量（堂食+外卖）都并进分子 ——
  const combinedRanked = ranked.concat(
    Object.keys(takeawayResult.by_platform || {}).reduce(
      (acc, p) => acc.concat(takeawayResult.by_platform[p].ranked), []));
  const correct = calcWeightedMenuPct(combinedRanked, CARDS, totals.qty);
  return { ranked, totals, actual, correct, dineTotals, takeawayTotals: takeawayResult.totals, combinedRanked };
}

const mk = (dish_key, qty, platform) => ({ dish_key, qty, amount: 0, platform, biz_date: '2026-11-05' });

// ===== 场景 1：纯外卖店（堂食 0 行，真云实证存在，R254）=====
{
  const dineIn = [];
  const takeaway = [ mk('青菜', 300, 'meituan'), mk('招牌鱼', 20, 'meituan') ]; // A 重
  const r = runFreeTierWiring(dineIn, takeaway);
  console.log('   [场景1 纯外卖·A重] ranked(堂食)=' + r.ranked.length +
    ' 行, totals.qty=' + r.totals.qty +
    '  实际加权=' + JSON.stringify(r.actual) +
    '  正确全渠道=' + JSON.stringify(r.correct));
  // 真缺陷断言：100% 建卡的纯外卖店，免费档却恒 no_match；正确口径应给 55.22
  expect('【真缺陷】纯外卖店：实际应给数却被 no_match（覆盖率分母含外卖、分子不能含）',
    r.actual.pct === null && r.actual.reason === 'no_match' && r.correct.pct === 55.22,
    'actual=' + JSON.stringify(r.actual) + ' correct=' + JSON.stringify(r.correct));
}

// ===== 场景 2：混合店（堂食+外卖各占一半，全部建卡）=====
{
  const dineIn = [ mk('青菜', 50, 'pos'), mk('招牌鱼', 50, 'pos') ];
  const takeaway = [ mk('青菜', 50, 'meituan'), mk('招牌鱼', 50, 'meituan') ];
  const r = runFreeTierWiring(dineIn, takeaway);
  console.log('   [场景2 混合·均衡] ranked(堂食)=' + r.ranked.length +
    ' 行, totals.qty=' + r.totals.qty +
    '  实际加权=' + JSON.stringify(r.actual) +
    '  正确全渠道=' + JSON.stringify(r.correct));
  // 真缺陷断言：100% 建卡的混合店（外卖占 50%）被 low_match 抑制，正确口径应给 36.00
  expect('【真缺陷】混合店(外卖50%)：实际被 low_match 抑制（覆盖率被分母压到50%）',
    r.actual.pct === null && r.actual.reason === 'low_match' && r.correct.pct === 36,
    'actual=' + JSON.stringify(r.actual) + ' correct=' + JSON.stringify(r.correct));
}

// ===== 场景 3：对照——纯堂食店（无外卖）应正常 =====
{
  const dineIn = [ mk('青菜', 300, 'pos'), mk('招牌鱼', 20, 'pos') ];
  const takeaway = [];
  const r = runFreeTierWiring(dineIn, takeaway);
  console.log('   [场景3 纯堂食·A重] ranked(堂食)=' + r.ranked.length +
    ' 行, totals.qty=' + r.totals.qty +
    '  实际加权=' + JSON.stringify(r.actual) +
    '  正确全渠道=' + JSON.stringify(r.correct));
  expect('【对照·基线】纯堂食店：实际与正确口径一致 = 55.22%',
    r.actual.pct === 55.22 && r.correct.pct === 55.22, JSON.stringify(r.actual));
}

// ===== 场景 4：门禁盲区证明——现有守卫是否覆盖该缺陷 =====
console.log('\n===== 门禁盲区：现有 check_r729 是否覆盖「口径不一致」类缺陷 =====');
const fs = require('fs');
const idxSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/getDishReview/index.js'), 'utf8');
// A-⑥ 只查字面调用 calcWeightedMenuPct(ranked, cards, totals.qty) 是否存在，不查 ranked 与 totals 的渠道口径是否一致
const a6 = /calcWeightedMenuPct\(ranked, cards, totals\.qty\)/.test(idxSrc);
expect('现有守卫 A-⑥ 仅校验「字面调用存在」（不校验 ranked 与 totals 渠道口径一致）', a6 === true);
// 源码免费档把外卖 ranked 合并进加权分子吗？—— 只查 calcWeightedMenuPct 调用点是否 .concat
const mergesTakeaway = /calcWeightedMenuPct\(\s*ranked\s*\.concat/.test(idxSrc);
expect('源码免费档未把外卖 ranked 并入加权分子（缺陷确为现存，非已修）', mergesTakeaway === false);

console.log('\n===== R194 审计结果 =====');
console.log('   通过断言: ' + pass + ' / 发现真缺陷/缺口: ' + found);
process.exit(found > 0 ? 1 : 0);
