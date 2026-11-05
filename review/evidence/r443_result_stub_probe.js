// R443 / R298·C1 页面桩探针 —— M1 结果页三态判据（不采信自述，真跑源码）
//
// 目标：证明「未建档月（getLedger 返回无 account_id 的默认空账）」下，
//   result 页走空态分支、不挂红带「亏损」；判据恒为账本存在性 `!!d.account_id`（R298·C1）。
//
// 机制：new Function 加载真实 subpkg/biz/month/result.js（非副本），
//   require 桩拦截 api/ui/entitlement（碰云环境），其余纯 util 真实 require。
//   驱动真实 onLoad→load()，断言 p.data.hasLedger。
//
// 变异回灌：把修复行 `hasLedger: !!(d && d.account_id)` 改回恒真 `hasLedger: !!d`，
//   重跑同场景，必须得到 true —— 证明本探针有分辨力，不是假绿。

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..'); // ...
const RESULT = path.resolve(REPO, 'subpkg/biz/month/result.js');
const PAGE_DIR = path.dirname(RESULT);

// ---- 全局桩 ----
let captured = null;
global.Page = (cfg) => { captured = cfg; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  showToast: () => {},
  showModal: () => {},
  navigateTo: () => {},
  request: () => {},
  cloud: { callFunction: () => Promise.resolve({ result: {} }) },
};

// ---- 场景账本（由测试设定，api.call('getLedger') 返回） ----
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
  const src = srcOverride || fs.readFileSync(RESULT, 'utf8');
  captured = null;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(PAGE_DIR), PAGE_DIR, RESULT);
  if (!captured) throw new Error('Page() 未被调用，源码可能已改结构');
  return captured;
}

function makePage(cfg) {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { Object.assign(this.data, patch); };
  return p;
}

const EMPTY_LEDGER = { month: '2026-01', result: {}, income_items: [], expense_items: [], indicators: [] };
const REAL_LEDGER = {
  month: '2026-01', account_id: 'acc_1',
  result: {
    total_factor_real_profit_fen: 916000, income_total_fen: 1000000,
    gross_margin_pct: 55, expense_total_fen: 600000, gross_profit_fen: 400000,
    material_cost_fen: 300000, real_consume_fen: 0, effective_amortize_fen: 0,
    operation_ref_profit_fen: 916000, ref_material_source: 'reverse',
  },
  income_items: [], expense_items: [], indicators: [], fixed_items_fen: null,
};

let pass = 0, fail = 0;
const fails = [];
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}

async function runScenario(label, ledger, expectHasLedger, expectLoadOk) {
  LEDGER = ledger;
  const cfg = loadCfg();
  const p = makePage(cfg);
  p.data.month = '2026-01';
  let loadErr = null;
  try { await p.load(); } catch (e) { loadErr = e; }
  console.log(`[${label}] loadErr=${loadErr ? (loadErr.message || loadErr) : 'null'} hasLedger=${p.data.hasLedger}`);
  assert(`${label}: load() 正常完成（不崩溃）`, expectLoadOk ? !loadErr : !!loadErr, loadErr && loadErr.stack);
  assert(`${label}: hasLedger === ${expectHasLedger}`, p.data.hasLedger === expectHasLedger, '实际=' + p.data.hasLedger);
  return { loadErr, hasLedger: p.data.hasLedger, p };
}

(async () => {
  console.log('=== R443 / R298·C1 三态判据页面桩 ===');

  // A：未建档月（默认空账，无 account_id）→ 必须走空态，hasLedger=false
  await runScenario('A-未建档月', EMPTY_LEDGER, false, true);

  // B：已建档月（有 account_id）→ 必须走结果分支，hasLedger=true（健康绿带）
  const b = await runScenario('B-已建档月', REAL_LEDGER, true, true);
  assert('B: 真赚钱且毛利率达标 → 绿带', b.loadErr == null && (b.p.data.bandClass || '') === 'green', 'bandClass=' + (b.p.data.bandClass || ''));

  // C：变异回灌（修复行改回恒真 `hasLedger: !!d`）→ 同 A 场景必须得 true（证明探针有牙）
  const orig = fs.readFileSync(RESULT, 'utf8');
  const FIX = 'hasLedger: !!(d && d.account_id),';
  const BUG = 'hasLedger: !!d,';
  if (orig.indexOf(FIX) < 0) throw new Error('修复行签名漂移，无法做变异回灌：' + FIX);
  const mutated = orig.replace(FIX, BUG);
  if (mutated === orig) throw new Error('变异未生效（replace 失败）');
  captured = null;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', mutated);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(PAGE_DIR), PAGE_DIR, RESULT);
  LEDGER = EMPTY_LEDGER;
  const pMut = makePage(captured);
  pMut.data.month = '2026-01';
  let mutErr = null;
  try { await pMut.load(); } catch (e) { mutErr = e; }
  console.log(`[C-变异] loadErr=${mutErr ? (mutErr.message || mutErr) : 'null'} hasLedger=${pMut.data.hasLedger}`);
  assert('C-变异: 同未建档账本 → hasLedger 退化成 true（证明若回退代码本探针会转红）', pMut.data.hasLedger === true);

  console.log('\n=== 汇总 ===');
  console.log(`PASS=${pass}  FAIL=${fail}`);
  if (fails.length) { console.log('失败项:\n - ' + fails.join('\n - ')); }
  process.exit(fail ? 1 : 0);
})();
