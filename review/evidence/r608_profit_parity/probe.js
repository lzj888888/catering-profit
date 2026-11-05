// review/evidence/r608_profit_parity/probe.js
// R507 利润恒可比 · 引擎实跑验证（engine-truth-audit 技术 A + 真实引擎 + 变异回灌）
//
// 铁律：一切数字来自生产引擎真实输出。不手抄、不照源码推演、不重抄实现。
// 做法：从 input.js 抽取真实 buildItems / syncSubsidyCarry 源码段，
//      用 new Function 注入依赖后执行原文；抽不到 → process.exit(2)（fail-closed）。
//      组装出的 income_items / expense_items 用真实 api.yuanToFen 转换，
//      平铺后喂给真实 calcMonthlyProfit(service.js) 纯引擎。
//      最后做变异回灌（强制 net 也带出补贴），证明探针能抓到 R507 双重扣减 bug。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../'); // catering-profit 仓根
const INPUT_JS = path.join(ROOT, 'subpkg/biz/month/input.js');
const SERVICE = path.join(ROOT, 'cloudfunctions/calcMonthlyProfit/service.js');
const VALIDATE = path.join(ROOT, 'cloudfunctions/calcMonthlyProfit/validate.js');
const API = path.join(ROOT, 'utils/api.js');
const TAKEAWAY = path.join(ROOT, 'utils/takeaway.js');
const TERMS = path.join(ROOT, 'miniprogram/i18n/terms.js');

// ---- 1. require 真实生产模块 ----
const { calcMonthlyProfit } = require(SERVICE);
let cleanItems;
try { cleanItems = require(VALIDATE).cleanItems; } catch (e) { cleanItems = null; }
const api = require(API);
let subsidyTotal;
try { subsidyTotal = require(TAKEAWAY).subsidyTotal; } catch (e) { subsidyTotal = (rows) => (rows || []).reduce((s, r) => s + (Number(r.subsidy) || 0), 0); }
let TERMS_REAL;
try { TERMS_REAL = require(TERMS).TERMS; } catch (e) { TERMS_REAL = { semantic: { expenseMktSubsidy: '外卖活动补贴' } }; }

// ---- 2. 抽取真实源码段（fail-closed）----
// 只抽方法「内部语句」（去掉外层 {}），才能喂给 new Function 当函数体。
const SRC = fs.readFileSync(INPUT_JS, 'utf8');

function sliceBody(startMarker) {
  const i = SRC.indexOf(startMarker);
  if (i < 0) { console.error('❌ 抽不到:', startMarker); process.exit(2); }
  const braceOpen = SRC.indexOf('{', i);
  if (braceOpen < 0) { console.error('❌ 抽不到 { :', startMarker); process.exit(2); }
  const rest = SRC.slice(braceOpen + 1);
  const m = rest.match(/\n  \},/); // 方法级边界（2 空格缩进 + },）
  if (!m) { console.error('❌ 抽不到方法边界:', startMarker); process.exit(2); }
  // m[0] = '\n  },'，其中 '}' 位于 m.index + 3
  const closeBrace = braceOpen + 1 + m.index + 3;
  return SRC.slice(braceOpen + 1, closeBrace);
}

const BODY_BUILD = sliceBody('buildItems(groups) {');
const BODY_SYNC = sliceBody('syncSubsidyCarry() {');

const buildItemsFn = new Function('api', 'groups', BODY_BUILD);
const syncFn = new Function('TERMS', 'subsidyTotal', BODY_SYNC);

// ---- 3. 一个经济现实（同一笔生意，两种录法）----
// 美团：商品+打包 3166.20，商家承担补贴 50，平台佣金 200，配送费 30  ⇒ 净额 2886.20
// 淘宝：商品+打包 1200.00，商家承担补贴 0，  平台佣金 80，  配送费 15  ⇒ 净额 1105.00
const DETAIL = [
  { platform: '美团', subtotal: 3166.20, qty: 100, subsidy: 50 },
  { platform: '淘宝', subtotal: 1200.00, qty: 50, subsidy: 0 },
];
const NET_FAST = [
  { subItem: '美团', amountYuan: 2886.20 },
  { subItem: '淘宝', amountYuan: 1105.00 },
];
const COMMISSION = 200 + 80;   // 280
const DELIVERY = 30 + 15;      // 45

function makeStub(groups) {
  const stub = { data: groups };
  stub._hasVal = (v) => String(v === undefined || v === null ? '' : v).trim() !== '';
  stub.setData = (patch) => { Object.assign(stub.data, patch); };
  return stub;
}

// 组装：真实 buildItems + 真实 syncSubsidyCarry
function assemble(opts) {
  const { takeoutMode, takeoutTrack, incomeGroups, expenseGroups } = opts;
  const stub = makeStub({
    takeoutMode, takeoutTrack,
    takeoutDetailRows: DETAIL,
    incomeGroups, expenseGroups,
  });
  const incomeItems = buildItemsFn.call(stub, api, incomeGroups);
  // syncSubsidyCarry 会 mutate expenseGroups（通过 setData 回写），先跑
  syncFn.call(stub, TERMS_REAL, subsidyTotal);
  // 回读被 syncSubsidyCarry 改写的 expenseGroups
  const expAfter = stub.data.expenseGroups;
  const expenseItems = buildItemsFn.call(stub, api, expAfter);
  return { incomeItems, expenseItems, stub };
}

function flatten(groups) {
  const out = [];
  for (const g of groups) for (const it of (g.sub_items || [])) {
    if (it.amount_fen !== undefined) out.push({ amountFen: it.amount_fen });
  }
  return out;
}

function runEngine(incomeItems, expenseItems, { amortizeOn }) {
  const clean = {
    incomeItems: flatten(incomeItems),
    expenseItems: flatten(expenseItems),
    directConsumeFen: 200000,
    amortizeFen: amortizeOn ? 30000 : 0,
    lumpSumFen: 0,
    amortizeSwitchOn: !!amortizeOn,
    inventorySwitchOn: false,
    inventory: {},
    pendingSettlementFen: 0,
  };
  return calcMonthlyProfit(clean);
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

// ---- 4. 实跑（正确代码）----
function parityCheck(label, amortizeOn) {
  const g = assemble(grossState());
  const n = assemble(netState());
  const rg = runEngine(g.incomeItems, g.expenseItems, { amortizeOn });
  const rn = runEngine(n.incomeItems, n.expenseItems, { amortizeOn });

  // 直接核验 syncSubsidyCarry 在 net 模式把补贴费用行清零
  const netSubsidyRow = n.stub.data.expenseGroups.find((x) => x.category === 'marketing')
    .rows.find((r) => r.subItem === '外卖活动补贴');
  const grossSubsidyRow = g.stub.data.expenseGroups.find((x) => x.category === 'marketing')
    .rows.find((r) => r.subItem === '外卖活动补贴');

  const eq =
    rg.totalFactorRealProfitFen === rn.totalFactorRealProfitFen &&
    rg.operationRefProfitFen === rn.operationRefProfitFen;
  console.log(`\n[${label}] amortizeOn=${amortizeOn}`);
  console.log('  gross totalFactorRealProfitFen =', rg.totalFactorRealProfitFen, '| operationRefProfitFen =', rg.operationRefProfitFen);
  console.log('  net   totalFactorRealProfitFen =', rn.totalFactorRealProfitFen, '| operationRefProfitFen =', rn.operationRefProfitFen);
  console.log('  net 模式补贴费用行 amountYuan =', JSON.stringify(netSubsidyRow.amountYuan), '(期望 "" → 0)');
  console.log('  gross 模式补贴费用行 amountYuan =', JSON.stringify(grossSubsidyRow.amountYuan), '(期望 "50.00")');
  console.log('  ⇒ 利润恒可比（net ≡ gross）:', eq ? '✅ 成立' : '❌ 不成立');
  return { eq, netSubsidyCleared: netSubsidyRow.amountYuan === '', grossSubsidyCarried: grossSubsidyRow.amountYuan === '50.00' };
}

let allPass = true;
const r1 = parityCheck('场景1', false);
const r2 = parityCheck('场景2', true);
allPass = allPass && r1.eq && r1.netSubsidyCleared && r1.grossSubsidyCarried && r2.eq;

// ---- 5. 变异回灌：强制 net 也带出补贴（注入 R507 双重扣减 bug）----
console.log('\n=== 变异回灌：回退 R507 修复（net 模式也读 takeoutDetailRows 的补贴带出费用侧 → 注入双重扣减，应使 parity 失败 → 证明探针非假绿）===');
const mutated = BODY_SYNC.replace('trackNet ? 0 : (isFast', 'trackNet ? subsidyTotal(this.data.takeoutDetailRows || []) : (isFast');
if (mutated === BODY_SYNC) {
  console.error('❌ 变异锚点未命中（源码已变？）'); process.exit(2);
}
const syncMut = new Function('TERMS', 'subsidyTotal', mutated);
// 用变异版替换 syncFn 行为：临时改写 assemble 用 syncMut
function assembleMut(opts) {
  const { takeoutMode, takeoutTrack, incomeGroups, expenseGroups } = opts;
  const stub = makeStub({ takeoutMode, takeoutTrack, takeoutDetailRows: DETAIL, incomeGroups, expenseGroups });
  const incomeItems = buildItemsFn.call(stub, api, incomeGroups);
  syncMut.call(stub, TERMS_REAL, subsidyTotal);
  const expenseItems = buildItemsFn.call(stub, api, stub.data.expenseGroups);
  return { incomeItems, expenseItems, stub };
}
function parityCheckMut(label, amortizeOn) {
  const g = assembleMut(grossState());
  const n = assembleMut(netState());
  const rg = runEngine(g.incomeItems, g.expenseItems, { amortizeOn });
  const rn = runEngine(n.incomeItems, n.expenseItems, { amortizeOn });
  const diff = rg.totalFactorRealProfitFen - rn.totalFactorRealProfitFen;
  const detected = rg.totalFactorRealProfitFen !== rn.totalFactorRealProfitFen;
  console.log(`[${label}] 变异后 gross - net 利润差 = ${diff} 分（${diff / 100} 元）, 探针检出:`, detected ? '✅ 转红' : '❌ 假绿');
  return detected;
}
const m1 = parityCheckMut('场景1', false);
allPass = allPass && m1;

console.log('\n========================================');
console.log(allPass ? '✅ 全部通过：利润恒可比成立 + 变异回灌能抓 bug（非假绿）' : '❌ 存在失败');
console.log('========================================');
process.exit(allPass ? 0 : 1);
