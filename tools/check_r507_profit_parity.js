// tools/check_r507_profit_parity.js —— R507「利润恒可比」不变量守卫（engine-truth-audit 技术 A）
// 运行：node tools/check_r507_profit_parity.js      （EXIT 0 = 全绿）
//
// 背景（R507 外卖引擎反转的核心不变量）：
//   R505 §四 dsh 警示——切净额后「收入」从 gross 掉到 net（美团 3166→1747），
//   若利润也跟跌，趋势图/环比会出现**断崖**，老板以为生意掉了 44%。
//   R507 的修复承诺是「利润恒可比」：net ≡ gross 利润，与录入模式无关。
//   syncSubsidyCarry 是真正执行点：net 模式 total=0 清空营销补贴费用行（杜绝双重扣减），
//   gross 模式才把补贴带出费用侧。
//
// 铁律（engine-truth-audit）：一切数字来自生产引擎**真实输出**，不手抄、不照源码推演、不重抄实现。
// 做法：
//   ① require 真实 calcMonthlyProfit(service.js) 纯引擎 + 真实 api.yuanToFen / subsidyTotal / TERMS；
//   ② 从 input.js **抽取真实 buildItems / syncSubsidyCarry 源码段**（`new Function` 注入依赖执行原文），
//      抽不到 → process.exit(2)（fail-closed，绝不明目绿）；
//   ③ 构造同一笔生意的 net/fast 套 与 gross/detail 套，实跑比对 totalFactorRealProfitFen / operationRefProfitFen；
//   ④ 变异回灌：回退 R507 修复（net 也读 takeoutDetailRows 补贴带出费用侧），断言 parity 失败 → 证明探针非假绿。
//
// ⚠️ 写新套件须知：本文件输出**不以 `===` 包裹段标题**（R66 会按段标题审计「段内 ✅ == 0」），
//   直接逐条 `✅` + 末行 `N 通过 / M 失败` 收尾（R69）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_JS = path.join(ROOT, 'subpkg/biz/month/input.js');
const SERVICE = path.join(ROOT, 'cloudfunctions/calcMonthlyProfit/service.js');
const API = path.join(ROOT, 'utils/api.js');
const TAKEAWAY = path.join(ROOT, 'utils/takeaway.js');
const TERMS = path.join(ROOT, 'miniprogram/i18n/terms.js');

// ---- 1. require 真实生产模块 ----
let calcMonthlyProfit;
try { ({ calcMonthlyProfit } = require(SERVICE)); } catch (e) {
  console.error('❌ 抽不到真实计算引擎:', SERVICE, e && e.message); process.exit(2);
}
const api = require(API);
const subsidyTotal = (() => {
  try { return require(TAKEAWAY).subsidyTotal; } catch (e) { return (rows) => (rows || []).reduce((s, r) => s + (Number(r.subsidy) || 0), 0); }
})();
const TERMS_REAL = (() => {
  try { return require(TERMS).TERMS; } catch (e) { return { semantic: { expenseMktSubsidy: '外卖活动补贴' } }; }
})();

// ---- 2. 抽取真实源码段（fail-closed）----
const SRC = (() => { try { return fs.readFileSync(INPUT_JS, 'utf8'); } catch (e) { console.error('❌ 抽不到:', INPUT_JS); process.exit(2); } })();

function sliceBody(startMarker) {
  const i = SRC.indexOf(startMarker);
  if (i < 0) { console.error('❌ 抽不到:', startMarker); process.exit(2); }
  const braceOpen = SRC.indexOf('{', i);
  if (braceOpen < 0) { console.error('❌ 抽不到 { :', startMarker); process.exit(2); }
  const rest = SRC.slice(braceOpen + 1);
  const m = rest.match(/\n  \},/);
  if (!m) { console.error('❌ 抽不到方法边界:', startMarker); process.exit(2); }
  const closeBrace = braceOpen + 1 + m.index + 3;
  return SRC.slice(braceOpen + 1, closeBrace);
}

const BODY_BUILD = sliceBody('buildItems(groups) {');
const BODY_SYNC = sliceBody('syncSubsidyCarry() {');
const buildItemsFn = new Function('api', 'groups', BODY_BUILD);
const syncFn = new Function('TERMS', 'subsidyTotal', BODY_SYNC);

// ---- 3. 一个经济现实（同一笔生意，两种录法）----
// 美团：商品+打包 3166.20，商家承担补贴 50，平台佣金 200，配送费 30 ⇒ 净额 2886.20
// 淘宝：商品+打包 1200.00，商家承担补贴 0，  平台佣金 80，  配送费 15 ⇒ 净额 1105.00
const DETAIL = [
  { platform: '美团', subtotal: 3166.20, qty: 100, subsidy: 50 },
  { platform: '淘宝', subtotal: 1200.00, qty: 50, subsidy: 0 },
];
const NET_FAST = [
  { subItem: '美团', amountYuan: 2886.20 },
  { subItem: '淘宝', amountYuan: 1105.00 },
];
const COMMISSION = 200 + 80; // 280
const DELIVERY = 30 + 15;    // 45

function makeStub(groups) {
  const stub = { data: groups };
  stub._hasVal = (v) => String(v === undefined || v === null ? '' : v).trim() !== '';
  stub.setData = (patch) => { Object.assign(stub.data, patch); };
  return stub;
}

function assemble(opts) {
  const { takeoutMode, takeoutTrack, incomeGroups, expenseGroups } = opts;
  const stub = makeStub({ takeoutMode, takeoutTrack, takeoutDetailRows: DETAIL, incomeGroups, expenseGroups });
  const incomeItems = buildItemsFn.call(stub, api, incomeGroups);
  syncFn.call(stub, TERMS_REAL, subsidyTotal);
  const expenseItems = buildItemsFn.call(stub, api, stub.data.expenseGroups);
  return { incomeItems, expenseItems, stub };
}

function flatten(groups) {
  const out = [];
  for (const g of groups) for (const it of (g.sub_items || [])) {
    if (it.amount_fen !== undefined) out.push({ amountFen: it.amount_fen });
  }
  return out;
}

function runEngine(incomeItems, expenseItems, amortizeOn) {
  return calcMonthlyProfit({
    incomeItems: flatten(incomeItems),
    expenseItems: flatten(expenseItems),
    directConsumeFen: 200000,
    amortizeFen: amortizeOn ? 30000 : 0,
    lumpSumFen: 0,
    amortizeSwitchOn: !!amortizeOn,
    inventorySwitchOn: false,
    inventory: {},
    pendingSettlementFen: 0,
  });
}

// 两组录入状态
function grossState() {
  return {
    takeoutMode: 'detail', takeoutTrack: 'gross',
    incomeGroups: [
      { category: 'dine_in', label: '堂食收入', rows: [{ subItem: '堂食', amountYuan: 10000 }] },
      { category: 'takeaway', label: '外卖收入', rows: [] },
    ],
    expenseGroups: [
      { category: 'rent', label: '房租', rows: [{ subItem: '房租', amountYuan: 3000 }] },
      { category: 'marketing', label: '营销', rows: [
        { subItem: '外卖活动补贴', amountYuan: '' },
        { subItem: '外卖平台佣金', amountYuan: String(COMMISSION) },
        { subItem: '外卖配送服务费', amountYuan: String(DELIVERY) },
        { subItem: '线上广告推广', amountYuan: '500' },
      ] },
    ],
  };
}
function netState() {
  return {
    takeoutMode: 'fast', takeoutTrack: 'net',
    incomeGroups: [
      { category: 'dine_in', label: '堂食收入', rows: [{ subItem: '堂食', amountYuan: 10000 }] },
      { category: 'takeaway', label: '外卖收入', rows: NET_FAST.map((r) => ({ subItem: r.subItem, amountYuan: r.amountYuan })) },
    ],
    expenseGroups: [
      { category: 'rent', label: '房租', rows: [{ subItem: '房租', amountYuan: 3000 }] },
      { category: 'marketing', label: '营销', rows: [
        { subItem: '外卖活动补贴', amountYuan: '' },
        { subItem: '外卖平台佣金', amountYuan: '' },
        { subItem: '外卖配送服务费', amountYuan: '' },
        { subItem: '线上广告推广', amountYuan: '500' },
      ] },
    ],
  };
}

// ---- 4. 守卫判据 ----
let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('✅ ' + name + (detail ? '（' + detail + '）' : '')); }
  else { problems.push(name + (detail ? '（' + detail + '）' : '')); console.log('❌ ' + name + (detail ? '（' + detail + '）' : '')); }
}

function parityCheck(label, amortizeOn) {
  const g = assemble(grossState());
  const n = assemble(netState());
  const rg = runEngine(g.incomeItems, g.expenseItems, amortizeOn);
  const rn = runEngine(n.incomeItems, n.expenseItems, amortizeOn);

  const netSubsidyRow = n.stub.data.expenseGroups.find((x) => x.category === 'marketing')
    .rows.find((r) => r.subItem === '外卖活动补贴');
  const grossSubsidyRow = g.stub.data.expenseGroups.find((x) => x.category === 'marketing')
    .rows.find((r) => r.subItem === '外卖活动补贴');

  ok('[' + label + '] 利润恒可比：totalFactorRealProfitFen net≡gross',
    rg.totalFactorRealProfitFen === rn.totalFactorRealProfitFen,
    'gross=' + rg.totalFactorRealProfitFen + ' net=' + rn.totalFactorRealProfitFen);
  ok('[' + label + '] 利润恒可比：operationRefProfitFen net≡gross',
    rg.operationRefProfitFen === rn.operationRefProfitFen,
    'gross=' + rg.operationRefProfitFen + ' net=' + rn.operationRefProfitFen);
  ok('[' + label + '] net 模式补贴费用行清零（amountYuan===\"\" ⇒ 0，杜绝双重扣减）',
    netSubsidyRow.amountYuan === '',
    'net subsidy=' + JSON.stringify(netSubsidyRow.amountYuan));
  ok('[' + label + '] gross 模式补贴费用行真实带出（amountYuan==="50.00"）',
    grossSubsidyRow.amountYuan === '50.00',
    'gross subsidy=' + JSON.stringify(grossSubsidyRow.amountYuan));
}

parityCheck('场景1 无摊销', false);
parityCheck('场景2 摊销3万', true);

// ---- 5. 变异回灌：回退 R507 修复（net 模式也读 detail 补贴带出费用侧 → 注入双重扣减，应使 parity 失败）----
console.log('\n— 变异回灌：回退 R507 修复，验证探针非假绿 —');
const mutated = BODY_SYNC.replace('trackNet ? 0 : (isFast',
  'trackNet ? subsidyTotal(this.data.takeoutDetailRows || []) : (isFast');
if (mutated === BODY_SYNC) {
  console.error('❌ 变异锚点未命中（源码已变？）'); process.exit(2);
}
const syncMut = new Function('TERMS', 'subsidyTotal', mutated);
function assembleMut(opts) {
  const { takeoutMode, takeoutTrack, incomeGroups, expenseGroups } = opts;
  const stub = makeStub({ takeoutMode, takeoutTrack, takeoutDetailRows: DETAIL, incomeGroups, expenseGroups });
  const incomeItems = buildItemsFn.call(stub, api, incomeGroups);
  syncMut.call(stub, TERMS_REAL, subsidyTotal);
  const expenseItems = buildItemsFn.call(stub, api, stub.data.expenseGroups);
  return { incomeItems, expenseItems, stub };
}
const gM = assembleMut(grossState());
const nM = assembleMut(netState());
const rgM = runEngine(gM.incomeItems, gM.expenseItems, false);
const rnM = runEngine(nM.incomeItems, nM.expenseItems, false);
const diffM = rgM.totalFactorRealProfitFen - rnM.totalFactorRealProfitFen;
ok('变异回灌：回退修复后 gross≠net（利润差 ' + diffM + ' 分=' + (diffM / 100) + ' 元，探针转红）',
  rgM.totalFactorRealProfitFen !== rnM.totalFactorRealProfitFen);

// ---- 6. 结论 ----
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ R507 利润恒可比校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ R507 利润恒可比校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ R507 利润恒可比守卫通过（真实引擎实跑 + 变异回灌证伪假绿，抽取 input.js buildItems/syncSubsidyCarry 源码段）');
console.log('✅ R507 利润恒可比校验：' + total + ' 通过 / 0 失败');
process.exit(0);
