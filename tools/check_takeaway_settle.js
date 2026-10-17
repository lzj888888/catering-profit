// tools/check_takeaway_settle.js —— 【R302】M1「外卖到手账」守卫（口径单源 + 页面消费面）
// 运行：node tools/check_takeaway_settle.js      （EXIT 0 = 全绿）
//
// 背景（R300 决策 §2「D 主」）：京东/美团《商品销量》表拿不到，且**平台 App 上老板每天看的
//   就是汇总级**（营业额 / 回款）⇒ 把 M1 **已录**的外卖整体口径用起来（营收 + 佣金/配送费/补贴
//   → 到手金额 / 到手率 / 单均到手），**零新增输入、零云函数改动**。
//
// 🔴 本守卫守的**第一件事是"不许出现两份公式"**：
//   「到手金额」与 `reconcile`（配平校验）的「应有商家应收款」**是同一个口径**。
//   若各写一份，一旦漂移就会出现「校验说对、到手账说另一个数」——同一语义两份实现，本仓最贵的病。
//   ⇒ 判据：`reconcile` 必须**调用** `expectedReceivable`（而不是内联公式）。
//
// 判据（四组）：
//   ① 口径单源：`reconcile` 调 `expectedReceivable`；该函数**单位无关**（无除法/无取整）
//   ② 行为：`settleSummary` 与 `reconcile` 对同一组数**算出同一个到手额**（真跑，不比字面）
//   ③ 不编数：营收 0 ⇒ 到手率 `null`（不是 0）；无订单数 ⇒ 单均 `''`（不是 '0.00'）
//   ④ 页面面：只在 `hasIncome` 时渲染；项名走**术语单源**（页面零中文字面量）；缺项提示在场
//   ＋ 反恒真与自失效护栏
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); }
}
function rd(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } }
function stripComments(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const src = rd('utils/takeaway.js');
const pageSrc = rd('pages/month/result.js');
const wxmlSrc = rd('pages/month/result.wxml');
ok('⓪ 自失效护栏：三份源码非空且关键锚点在场（防读空文件 ⇒ 恒真）',
  src.length > 5000 && pageSrc.length > 5000 && wxmlSrc.length > 2000
  && /function settleSummary/.test(src) && /function expectedReceivable/.test(src)
  && /buildSettle/.test(pageSrc) && /settle\.has/.test(wxmlSrc));

// ===== ① 口径单源 =====
const stripped = stripComments(src);
ok('①-a 🔴 `reconcile` 必须**调用** `expectedReceivable`（剥注释后判），不得内联第二份公式'
  + ' —— 两份公式一旦漂移，就会出现"配平校验说对、到手账说另一个数"',
  (() => {
    const i = stripped.indexOf('function reconcile(');
    if (i < 0) return false;
    const body = stripped.slice(i, i + 2000);
    return /expectedReceivable\(/.test(body)
      && !/- \s*Math\.abs\(subsidy\)/.test(body);   // 内联公式的特征片段不得再出现
  })());
ok('①-b 🔴 `expectedReceivable` 必须**单位无关**（无除法 / 无取整）—— 元与分才能共用同一份'
  + '（一旦出现 `/ 100` 或 `Math.round`，两处必然只能各写一份）',
  (() => {
    const i = stripped.indexOf('function expectedReceivable(');
    if (i < 0) return false;
    const body = stripped.slice(i, i + 900).split('\nfunction ')[0];
    return !/\/\s*\d/.test(body) && !/Math\.round/.test(body) && !/toFixed/.test(body);
  })());

// ===== ② ③ 行为面（真跑模块）=====
let T = null;
try { T = require(path.join(ROOT, 'utils/takeaway.js')); } catch (e) { T = null; }
ok('②-a 模块可 require 且导出两个函数', !!T && typeof T.settleSummary === 'function'
  && typeof T.expectedReceivable === 'function');

// 同一组数：元一套、分一套（分 = 元 × 100）
const YUAN = { incomeTotal: 12500, subsidy: 200, commission: 1500, deliveryFee: 300, deliverySubsidy: 50 };
const expYuan = T ? T.expectedReceivable(YUAN.incomeTotal, YUAN.subsidy, YUAN.commission, YUAN.deliveryFee, YUAN.deliverySubsidy) : NaN;
const st = T ? T.settleSummary({
  incomeFen: 1250000, commissionFen: 150000, deliveryFeeFen: 30000,
  deliverySubsidyFen: 5000, subsidyFen: 20000, orderCount: 250,
}) : null;
ok('②-b 🔴 行为：分与元**算出同一个到手额**（单位无关成立）—— 元版 ' + expYuan + ' 元 vs 分版 ' + (st ? st.netFen : '?') + ' 分',
  !!st && Math.round(expYuan * 100) === st.netFen, st ? `netFen=${st.netFen}` : '未跑');
ok('②-c 行为：`reconcile` 与 `settleSummary` 口径一致（把 settle 的到手额喂给 reconcile ⇒ 差额 0）',
  !!T && (() => {
    const rec = T.reconcile({
      incomeTotal: YUAN.incomeTotal, subsidy: YUAN.subsidy, commission: YUAN.commission,
      deliveryFee: YUAN.deliveryFee, deliverySubsidy: YUAN.deliverySubsidy,
      actualReceivable: expYuan,
    });
    return !!rec && rec.diff === 0 && rec.status === 'pass';
  })());
ok('②-d 行为：到手率与单均按分算出（12500 元营收 → 82% / 41.00 元单均）',
  !!st && st.netRatePct === 82 && st.perOrderText === '41.00',
  st ? `${st.netRatePct}% / ${st.perOrderText}` : '未跑');

// 不编数（本仓同一条纪律：缺项不得显示成 0）
const empty = T ? T.settleSummary({}) : null;
ok('③-a 🔴 不编数：营收 0 ⇒ 到手率回 `null`（**不是 0**）—— 0% 会被读成"一分没到手"',
  !!empty && empty.netRatePct === null && empty.hasIncome === false);
ok('③-b 🔴 不编数：没有有效订单数 ⇒ 单均回**空串**（不是 0.00）—— 除零既不能是 NaN 也不能是 0',
  !!empty && empty.perOrderText === '' && empty.hasOrderCount === false
  && !!T && T.settleSummary({ incomeFen: 100, orderCount: 0 }).perOrderText === '');
ok('③-c 佣金/配送费全 0 ⇒ `platformFeeKnown=false`（页面据此显示"未填"并提示去补录，不静默）',
  !!st && st.platformFeeKnown === true && !!empty && empty.platformFeeKnown === false);

// ===== ④ 页面面 =====
ok('④-a 页面只在 `hasIncome` 时渲染（没做外卖的店不显示空卡）',
  /settle\.has/.test(wxmlSrc) && /if \(!st\.hasIncome\) return \{ has: false \}/.test(pageSrc));
// 🔴 ④-b 的判据本体：页面源码里**不得出现任何外卖术语值的中文字面量**。
//   首版只查 `x.name === '外卖…'` ⇒ **抓不到**「直接把项名当字面量传进 fenOf」那种写法
//   （实测：变异 M19 把 `roles.commission` 换成 `'外卖平台佣金'`，首版判据照样绿）。
//   ⇒ 改为**从术语单源取真值**，逐个判"是否以带引号字面量出现"——这也正是 `check_page_terms` 判据③
//     的口径（页面层不得把任何术语值当字面量），只是这里限定到本功能相关的四个值。
const TERMS_M = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
const ROLES = ((TERMS_M.ledger.takeawayMode || {}).reconcileRoles) || {};
const TERM_VALUES = [ROLES.commission, ROLES.deliveryFee, ROLES.deliverySubsidy, TERMS_M.semantic.expenseMktSubsidy]
  .filter((v) => !!v);
const pageStripped = stripComments(pageSrc);
const literalHits = TERM_VALUES.filter((v) => new RegExp("['\"]" + v + "['\"]").test(pageStripped));
ok('④-b 🔴 页面定位费用项走**术语单源**，且四个外卖术语值**一个都不许以字面量出现**'
  + '（守 check_page_terms 判据③：页面不得把术语值当字面量；改名才不会静默失效）',
  /reconcileRoles/.test(pageSrc) && /TERMS\.semantic\.expenseMktSubsidy/.test(pageSrc)
  && literalHits.length === 0,
  literalHits.length ? '字面量命中：' + literalHits.join(' / ') : TERM_VALUES.length + ' 个术语值均未硬编码');
ok('④-c 缺项提示在场：平台扣费显示"未填"而不是 0.00，且有 warn 行',
  /platformFeeText: st\.platformFeeKnown/.test(pageSrc) && /settleMissingFee/.test(pageSrc)
  && /settle\.showMissingFee/.test(wxmlSrc));
ok('④-d 口径说明在场（"估算，不是平台结算单"）—— 不得让老板把估算当成实际到账',
  /settleNote/.test(pageSrc) && /settle\.note|settleNote/.test(wxmlSrc));

// ===== 反恒真 =====
ok('⑤-a 反恒真：把「内联公式的旧 reconcile」喂给 ①-a 的判据 ⇒ 必须判不通过',
  !(() => {
    const fake = stripComments('function reconcile(p) { const gross = inc - sub; const expected = gross - Math.abs(sub); return expected; }');
    const i = fake.indexOf('function reconcile(');
    const body = fake.slice(i, i + 2000);
    return /expectedReceivable\(/.test(body) && !/- \s*Math\.abs\(subsidy\)/.test(body);
  })());
ok('⑤-b 反恒真：把「带除法的 expectedReceivable」喂给 ①-b 的判据 ⇒ 必须判不通过',
  !(() => {
    const fake = stripComments('function expectedReceivable(a) { return a / 100; }');
    const i = fake.indexOf('function expectedReceivable(');
    const body = fake.slice(i, i + 900);
    return !/\/\s*\d/.test(body) && !/Math\.round/.test(body);
  })());
ok('⑤-c 反恒真：把「用中文字面量定位项名」的样本喂给 ④-b 的判据 ⇒ 必须判不通过',
  TERM_VALUES.length > 0
  && new RegExp("['\"]" + TERM_VALUES[0] + "['\"]").test("fenOf(expItems, '" + TERM_VALUES[0] + "')")
  && (() => {                                   // 而真源码必须判通过（正负互证用同一段逻辑）
    const sample = stripComments(pageSrc);
    return TERM_VALUES.filter((v) => new RegExp("['\"]" + v + "['\"]").test(sample)).length === 0;
  })());

// ===== 结论 =====
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 外卖到手账校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ 外卖到手账校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 外卖到手账校验通过（口径单源：reconcile 与 settleSummary 共用 expectedReceivable）');
console.log('✅ 外卖到手账校验：' + total + ' 通过 / 0 失败');
