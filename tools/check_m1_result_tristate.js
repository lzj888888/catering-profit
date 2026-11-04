#!/usr/bin/env node
// tools/check_m1_result_tristate.js —— M1 结果页三态判据守卫（R298·C1 / #443）
//
// 为什么需要它：
//   #443（R298 同族病第八例）当年就是「未建档月误挂红带『亏损』」。根因是月度结果页三态判据
//   写成了 `wx:elif="{{r}}"`，而 getLedger 对**无账本的月份**返回的是「默认空账」
//   （getLedger/index.js:4：result 恒存在、account_id 缺），⇒ r 在成功路径恒真 ⇒
//   空态分支永远走不到 ⇒ 未建档月反而显示红带「亏损」+ 全 ¥0.00 + 可导出空报表。
//
//   正确判据（R298·C1）：用账本存在性 `!!d.account_id`（与首页 index.js:98 同源），写进 data.hasLedger，
//   WXML 用 `wx:elif="{{hasLedger}}"` 切结果分支、`wx:else` 切中性空态。
//
//   这条判据当年静默回退过，**没有守卫兜底**，所以必须落永久 guard：
//   A 未建档月（默认空账、无 account_id）→ load() 不崩溃且 hasLedger=false（走空态、不挂红带）
//   B 已建档月（有 account_id、真赚钱、毛利率达标）→ hasLedger=true 且绿带
//   C 变异回灌：把修复行 `hasLedger: !!(d && d.account_id)` 改回恒真 `hasLedger: !!d`，
//     重跑 A 场景必须退化成 true ⇒ 证明本守卫有分辨力（不是假绿）。
//
// 运行：node tools/check_m1_result_tristate.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_REL = 'subpkg/biz/month/result.js';
const PAGE = path.join(ROOT, PAGE_REL);

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

// ===== 页面桩：new Function 加载真实 result.js（非副本），require 桩拦截碰云依赖 =====
let cfg = null;
global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  showToast: () => {},
  showModal: () => {},
  navigateTo: () => {},
  request: () => {},
  cloud: { callFunction: () => Promise.reject(new Error('stub: 页面桩不连云')) },
};

let LEDGER = null;
const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name) => {
    if (name === 'getLedger') return LEDGER;
    if (name === 'getMonthList') return { list: [] };
    return {};
  },
  fenToYuan: (v, n) => (Number(v || 0) / 100).toFixed(n == null ? 2 : n),
  toastError: () => {},
};
const mockUi = { setTitle: () => {}, nowMonth: () => '2026-01' };
const mockEntitle = {
  fetchEntitlement: async () => ({ expire_at: null, days_left: 999 }),
  expireSoonDays: () => 0,
};
const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
  '../../../utils/entitlement.js': mockEntitle,
};
function makeRequire(baseDir) {
  return function (req) {
    if (MOCKS[req]) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}
function loadCfg(srcOverride) {
  const src = srcOverride || fs.readFileSync(PAGE, 'utf8');
  cfg = null;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用，result.js 结构可能已变');
  return cfg;
}
function fresh() {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { Object.assign(this.data, patch); };
  return p;
}

const EMPTY_LEDGER = { month: '2026-01', result: {}, income_items: [], expense_items: [], indicators: [] };
const REAL_LEDGER = {
  month: '2026-01', account_id: 'acc_1',
  result: {
    total_factor_real_profit_fen: 916000, income_total_fen: 1000000, gross_margin_pct: 55,
    expense_total_fen: 600000, gross_profit_fen: 400000, material_cost_fen: 300000,
    real_consume_fen: 0, effective_amortize_fen: 0, operation_ref_profit_fen: 916000,
    ref_material_source: 'reverse',
  },
  income_items: [], expense_items: [], indicators: [], fixed_items_fen: null,
};

async function run(label, ledger, expectHas, expectOk) {
  LEDGER = ledger;
  const p = fresh();
  p.data.month = '2026-01';
  let err = null;
  try { await p.load(); } catch (e) { err = e; }
  console.log(`  [${label}] loadErr=${err ? (err.message || err) : 'null'} hasLedger=${p.data.hasLedger} bandClass=${p.data.bandClass || ''}`);
  check(`${label}: load() 正常完成（不崩溃）`, expectOk ? !err : !!err, err && err.stack);
  check(`${label}: hasLedger === ${expectHas}`, p.data.hasLedger === expectHas, '实际=' + p.data.hasLedger);
  return { err, p };
}

(async () => {
  console.log('\nM1 结果页三态判据守卫（R298·C1 / #443）');

  loadCfg(); // 加载真实 result.js 到全局 cfg（A/B 场景用）

  sec('A · 未建档月（默认空账，无 account_id）');
  await run('A', EMPTY_LEDGER, false, true);

  sec('B · 已建档月（真赚钱、毛利率达标）');
  const b = await run('B', REAL_LEDGER, true, true);
  check('B: 绿带（真利润>0 且毛利率≥30%）', b.err == null && (b.p.data.bandClass || '') === 'green', 'bandClass=' + (b.p.data.bandClass || ''));

  sec('C · 变异回灌（修复行改回恒真 `hasLedger: !!d`）');
  const orig = fs.readFileSync(PAGE, 'utf8');
  const FIX = 'hasLedger: !!(d && d.account_id),';
  const BUG = 'hasLedger: !!d,';
  if (orig.indexOf(FIX) < 0) { console.log('❌ 修复行签名漂移，无法做变异回灌：' + FIX); process.exit(1); }
  const mutated = orig.replace(FIX, BUG);
  if (mutated === orig) { console.log('❌ 变异未生效（replace 失败）'); process.exit(1); }
  const cfgMut = loadCfg(mutated);
  LEDGER = EMPTY_LEDGER;
  const pMut = fresh();
  pMut.data.month = '2026-01';
  let mutErr = null;
  try { await pMut.load(); } catch (e) { mutErr = e; }
  console.log(`  [C-变异] loadErr=${mutErr ? (mutErr.message || mutErr) : 'null'} hasLedger=${pMut.data.hasLedger}`);
  check('C: 同未建档账本 → hasLedger 退化成 true（证明若回退代码本守卫会转红）', pMut.data.hasLedger === true);

  console.log(`\n===== M1 结果页三态守卫结果：${pass} 通过 / ${failN} 失败 =====`);
  process.exit(failN ? 1 : 0);
})();
