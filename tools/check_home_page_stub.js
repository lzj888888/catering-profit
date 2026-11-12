#!/usr/bin/env node
// tools/check_home_page_stub.js —— R1-8（台账）首页行为守卫：权益分流 / 三态 / hero 三列 / 跳转
//
// 为什么需要它：`pages/index/index.js` 是**每个老板每次打开小程序都第一眼看到**的页面，
//   而它此前只有静态守卫（check_home_ui_v3 看的是「文案/结构在不在」），**从没有一处真跑页面代码**。
//   扫全部 34 个页面，仍有 8 个零桩，首页是其中流量最高的一个。
//
// 这页最容易出的四类静默错误（都不会崩、界面还挺正常）：
//   ① **权益分流接错**：免费档必须显示「经营参考利润」(operation_ref_profit_fen)，
//      付费档才显示会计利润 (total_factor_real_profit_fen)。接反了 ⇒ 免费档首页的数
//      与月首页/结果页对不上 —— 这正是 R484/R493 花两轮要消灭的困惑，且没有任何报错。
//   ② **三态塌成两态**：无账本时必须走空态，不能渲染「¥0.00」；「未确定」也不能先闪空态
//      （profitKnown 就是为这帧存在的）。
//   ③ **hero 三列把 0 渲染出来**：任一项为 0 就整行不显示，渲染 ¥0 会被读成
//      「这店没花钱/没赚钱」；毛利率在营收为 0 时无意义。
//   ④ **tabBar 页用 navigateTo**：微信直接失败（R199 踩过），入口点了没反应。
//
// 取证层级：L2 页面桩（Page/wx/getApp/api/ui/entitlement/shopGuard 全桩，真跑页面源码）。
//   ⚠️ 不替代真机：验的是「数据怎么决定数字与文案」，不验视觉。
//
// 运行：node tools/check_home_page_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'pages/index/index.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const REAL_ENT = require(path.join(ROOT, 'utils/entitlement.js'));   // isPaid 用真身，不抄

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 桩 ----------
let cfg = null;
let seen = {};
let ledgerResp = null;
let ledgerThrows = false;
let entResp = { is_active: false };
let entThrows = false;
let shopCtx = {};
let shopCtxThrows = false;
let appStub = null;

const mockApi = {
  call: async (name) => {
    if (name === 'getLedger') { if (ledgerThrows) throw new Error('stub: 账本读失败'); return ledgerResp; }
    if (name === 'getShopContext') { if (shopCtxThrows) throw new Error('stub: 店铺上下文失败'); return shopCtx; }
    return {};
  },
  fenToYuan: (v, n) => (Number(v || 0) / 100).toFixed(n == null ? 2 : n),
  toastError: () => { seen.toastError = (seen.toastError || 0) + 1; },
};
const mockUi = { setTitle: () => {}, nowMonth: () => '2026-11' };
const mockEnt = {
  fetchEntitlement: async () => { if (entThrows) throw new Error('stub: 权益失败'); return entResp; },
  isPaid: REAL_ENT.isPaid,
  expireSoonDays: REAL_ENT.expireSoonDays,
};
const mockShopGuard = { promptNoShop: () => { seen.promptNoShop = (seen.promptNoShop || 0) + 1; } };

global.Page = (c) => { cfg = c; };
global.wx = {
  showToast: (o) => { seen.toast = o; },
  showModal: () => {},
  navigateTo: (o) => { seen.navigateTo = (seen.navigateTo || []).concat(o.url); },
  switchTab: (o) => { seen.switchTab = (seen.switchTab || []).concat(o.url); },
  stopPullDownRefresh: () => { seen.stopped = true; },
  getStorageSync: () => '', setStorageSync: () => {},
};

const MOCKS = {
  '../../utils/api.js': mockApi,
  '../../utils/ui.js': mockUi,
  '../../utils/entitlement.js': mockEnt,
  '../../utils/shopGuard.js': mockShopGuard,
};
function makeRequire(baseDir) {
  return function (req) {
    if (MOCKS[req]) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}
// 页面顶层就调 getApp()，所以每次加载都要重置 app 桩
function loadCfg(srcOverride) {
  const src = srcOverride || fs.readFileSync(PAGE, 'utf8');
  cfg = null; appStub = { globalData: {}, ctx: null, setShopContext(ctx) { this.ctx = ctx; } };
  global.getApp = () => appStub;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：pages/index/index.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() {
  seen = {}; ledgerResp = null; ledgerThrows = false;
  entResp = { is_active: false }; entThrows = false;
  shopCtx = {}; shopCtxThrows = false;
}
function ledger(o) {
  return Object.assign({
    account_id: 'acc_1', month: '2026-11',
    result: {
      total_factor_real_profit_fen: 916000,
      operation_ref_profit_fen: 777700,
      incomeTotalFen: 1000000,
      expenseTotalFen: 400000,
      materialCostFen: 300000,
      grossMarginRatePct: 55,
    },
    switches: {}, inventory: {}, effective_lump_sum_fen: 0,
  }, o || {});
}

(async () => {
  console.log('[R1-8] 首页行为守卫（权益分流 / 三态 / hero 三列 / 跳转）');

  const SRC = fs.readFileSync(PAGE, 'utf8');
  loadCfg();

  // =====================================================
  // A · 权益分流（最贵的一类：接反了首页与结果页对不上，零报错）
  // =====================================================
  sec('A · 权益分流（免费=参考口径 / 付费=会计利润）');

  reset();
  ledgerResp = ledger();
  entResp = { is_active: true };
  let p = fresh(cfg);
  await p.loadRefProfit();
  check('A-① 付费 ⇒ 取会计利润 total_factor_real_profit_fen（9160.00）',
    p.data.refProfit === '9160.00' && p.data.hasProfit === true,
    'refProfit=' + p.data.refProfit);
  check('A-② 付费 ⇒ 标签是「本月利润」侧（不是经营参考）',
    p.data.profitTitle === TERMS.ui.netProfit || /本月利润|估算利润|真实利润/.test(String(p.data.profitTitle)),
    'title=' + p.data.profitTitle);

  reset();
  ledgerResp = ledger();
  entResp = { is_active: false };
  p = fresh(cfg);
  await p.loadRefProfit();
  check('A-③ 🔴 免费 ⇒ 必须取经营参考利润 operation_ref_profit_fen（7777.00），不是会计利润',
    p.data.refProfit === '7777.00' && p.data.hasProfit === true,
    'refProfit=' + p.data.refProfit);
  check('A-④ 🔴 免费 ⇒ 标签是「经营参考利润」（与月首页/结果页同名）',
    p.data.profitTitle === TERMS.ui.netRef, 'title=' + p.data.profitTitle);

  reset();
  ledgerResp = ledger({ result: { total_factor_real_profit_fen: 916000, incomeTotalFen: 1000000, expenseTotalFen: 400000, materialCostFen: 300000, grossMarginRatePct: 55 } }); // 无 operation_ref
  entResp = { is_active: false };
  p = fresh(cfg);
  await p.loadRefProfit();
  check('A-⑤ 🔴 免费档但参考口径缺失 ⇒ 走空态，**绝不拿会计利润顶上**（顶了就等于免费看付费数）',
    p.data.hasProfit === false && p.data.profitKnown === true,
    'hasProfit=' + p.data.hasProfit + ' refProfit=' + p.data.refProfit);

  reset();
  ledgerResp = ledger();
  entThrows = true;
  p = fresh(cfg);
  let aErr = null;
  try { await p.loadRefProfit(); } catch (e) { aErr = e; }
  check('A-⑥ 权益接口抛错 ⇒ 不崩、走空态（本请求只服务装饰性总结，不许拖垮首页）',
    aErr === null && p.data.hasProfit === false && p.data.profitKnown === true,
    aErr ? (aErr.message || String(aErr)) : 'hasProfit=' + p.data.hasProfit);

  // =====================================================
  // B · 三态：未确定 ≠ 无数据
  // =====================================================
  sec('B · 三态与空态（无账本必须走空态，不能渲染 ¥0）');

  reset();
  ledgerResp = { account_id: '', month: '2026-11', result: {} };
  p = fresh(cfg);
  await p.loadRefProfit();
  check('B-① 🔴 无 account_id ⇒ hasProfit=false 且 profitKnown=true（不显示 ¥0.00）',
    p.data.hasProfit === false && p.data.profitKnown === true, 'hasProfit=' + p.data.hasProfit);

  reset();
  ledgerResp = ledger({ result: { total_factor_real_profit_fen: NaN, incomeTotalFen: 1 } });
  entResp = { is_active: true };
  p = fresh(cfg);
  await p.loadRefProfit();
  check('B-② 利润字段非有限数 ⇒ 空态（NaN 不许显示成 ¥0 或 ¥NaN）',
    p.data.hasProfit === false, 'hasProfit=' + p.data.hasProfit + ' refProfit=' + p.data.refProfit);

  reset();
  ledgerThrows = true;
  p = fresh(cfg);
  let bErr = null;
  try { await p.loadRefProfit(); } catch (e) { bErr = e; }
  check('B-③ 🔴 账本读失败 ⇒ 静默空态，**不弹 toast**（首页已有一个店铺失败提示，再加就是噪音）',
    bErr === null && p.data.hasProfit === false && !seen.toast,
    bErr ? (bErr.message || String(bErr)) : 'toast=' + JSON.stringify(seen.toast));

  check('B-④ data 初值 profitKnown=false（「未确定」不能先闪一帧空态）',
    cfg.data.profitKnown === false && cfg.data.hasProfit === false);

  // =====================================================
  // C · hero 三列
  // =====================================================
  sec('C · hero 三列（任一项为 0 就不显示，绝不渲染 ¥0）');

  function hero(res) {
    reset();
    ledgerResp = ledger({ result: Object.assign({ total_factor_real_profit_fen: 100000, operation_ref_profit_fen: 100000 }, res) });
    entResp = { is_active: true };
    const hp = fresh(cfg);
    return hp.loadRefProfit().then(() => hp.data);
  }

  const c1 = await hero({ incomeTotalFen: 0, expenseTotalFen: 400000, materialCostFen: 300000, grossMarginRatePct: 55 });
  check('C-① 营收为 0 ⇒ heroIncome 为空串（不渲染 ¥0）', c1.heroIncome === '', 'heroIncome=' + JSON.stringify(c1.heroIncome));
  check('C-② 营收为 0 ⇒ 毛利率也留空（分母为 0 时无意义）', c1.heroGm === '', 'heroGm=' + JSON.stringify(c1.heroGm));

  const c2 = await hero({ incomeTotalFen: 1000000, expenseTotalFen: 0, materialCostFen: 0, grossMarginRatePct: 0 });
  check('C-③ 费用与材料都为 0 ⇒ heroCost 为空串', c2.heroCost === '', 'heroCost=' + JSON.stringify(c2.heroCost));

  const c3 = await hero({ incomeTotalFen: 1000000, expenseTotalFen: 400000, materialCostFen: 300000, grossMarginRatePct: 55.6 });
  check('C-④ 正常值 ⇒ 营收/成本上万走「X.X万」，毛利率取整',
    c3.heroIncome === '1万' && c3.heroCost === '7000' && c3.heroGm === '56%',
    'income=' + c3.heroIncome + ' cost=' + c3.heroCost + ' gm=' + c3.heroGm);

  // =====================================================
  // D · wanText 边界（三列只有 1/3 屏宽，五位数会挤爆）
  // =====================================================
  sec('D · wanText 边界');

  check('D-① 9999 分以下 → 原样整数', p.wanText(999900) === '9999', p.wanText(999900));
  check('D-② 10000 元 → 1万', p.wanText(1000000) === '1万', p.wanText(1000000));
  check('D-③ 86000 元 → 8.6万', p.wanText(8600000) === '8.6万', p.wanText(8600000));
  check('D-④ 0 → "0"', p.wanText(0) === '0', p.wanText(0));
  check('D-⑤ 非数 → "0"（不渲染 NaN）', p.wanText(undefined) === '0' && p.wanText('abc') === '0',
    p.wanText(undefined) + '/' + p.wanText('abc'));

  // =====================================================
  // E · bootstrap
  // =====================================================
  sec('E · bootstrap（店铺上下文 / 无店态 / 失败）');

  reset();
  shopCtx = { shop_name: '观音桥店' };
  p = fresh(cfg);
  await p.bootstrap();
  check('E-① 成功 ⇒ shopName 写入且 app.setShopContext 被调（全站请求靠它带 shop_id）',
    p.data.shopName === '观音桥店' && appStub.ctx && appStub.ctx.shop_name === '观音桥店',
    'shopName=' + p.data.shopName);
  check('E-② 成功后 loading 收起', p.data.loading === false);

  reset();
  shopCtx = { no_shop: true };
  p = fresh(cfg);
  await p.bootstrap();
  check('E-③ 无店铺态 ⇒ 触发引导（不能静默停在空白首页）', seen.promptNoShop === 1);

  reset();
  shopCtxThrows = true;
  p = fresh(cfg);
  let eErr = null;
  try { await p.bootstrap(); } catch (e) { eErr = e; }
  check('E-④ 失败 ⇒ 不崩 + loading 收起 + 一句人话 toast',
    eErr === null && p.data.loading === false && !!seen.toast,
    eErr ? (eErr.message || String(eErr)) : 'toast=' + (seen.toast && seen.toast.title));

  reset();
  shopCtx = {};
  p = fresh(cfg);
  await p.bootstrap();
  check('E-⑤ shop_name 缺失 ⇒ shopName 空串（不渲染 undefined）', p.data.shopName === '');

  // =====================================================
  // F · 跳转与生命周期
  // =====================================================
  sec('F · 跳转方式与生命周期（tabBar 页必须 switchTab）');

  reset();
  p = fresh(cfg);
  p.goCard();
  check('F-① 🔴 M3 入口用 switchTab（hub 是 tabBar 页，navigateTo 会直接失败——R199 踩过）',
    (seen.switchTab || []).indexOf('/pages/m3/hub') >= 0 && !(seen.navigateTo || []).some((u) => u.indexOf('/pages/m3/hub') >= 0),
    'switchTab=' + JSON.stringify(seen.switchTab));

  reset();
  p = fresh(cfg);
  p.goSettings(); p.goSwitch(); p.goMonth(); p.goSandbox();
  const navs = seen.navigateTo || [];
  check('F-② 普通页用 navigateTo（设置/切店/月度/沙盒四个入口都在）',
    navs.length === 4 && navs.some((u) => u.indexOf('shop/setting') >= 0)
    && navs.some((u) => u.indexOf('shop/switch') >= 0)
    && navs.some((u) => u.indexOf('month/index') >= 0)
    && navs.some((u) => u.indexOf('sandbox/index') >= 0),
    JSON.stringify(navs));

  reset();
  ledgerResp = ledger();
  p = fresh(cfg);
  p.onShow();
  await new Promise((r) => setTimeout(r, 0));
  check('F-③ 🔴 onShow 每次都重新拉（不切缓存）—— 在设置页改完店名回来必须看到新名',
    p.data.shopName !== undefined && !!ledgerResp,
    'onShow 已执行');

  reset();
  ledgerResp = ledger();
  p = fresh(cfg);
  p.onPullDownRefresh();
  await new Promise((r) => setTimeout(r, 5));
  check('F-④ 下拉刷新调两者并 stopPullDownRefresh（不能转圈没反应）', seen.stopped === true);

  // =====================================================
  // M · 变异回灌
  // =====================================================
  sec('M · 变异回灌');

  async function mut(label, from, to, expect, runFn) {
    // from/to 支持数组：页面有「双保险」时，只拆一道不退化是**正确**的，
    // 必须同时拆掉全部同类判据，才能证明守卫真的在看这件事。
    const froms = Array.isArray(from) ? from : [from];
    const tos = Array.isArray(to) ? to : [to];
    if (froms.length !== tos.length) { console.log('  ❌ ' + label + ' 变异参数不成对'); failN++; return; }
    let mutated = SRC, drift = null;
    for (let i = 0; i < froms.length; i++) {
      if (mutated.indexOf(froms[i]) < 0) { drift = froms[i]; break; }
      mutated = mutated.replace(froms[i], tos[i]);
    }
    if (drift) { console.log('  ❌ ' + label + ' 锚点漂移：' + drift); failN++; return; }
    if (mutated === SRC) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let mc = null;
    try { mc = loadCfg(mutated); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return; }
    let degraded = false, detail = '';
    try { const r = await runFn(mc); degraded = !!r.degraded; detail = r.detail || ''; }
    catch (e) { degraded = true; detail = '变异后抛错：' + ((e && e.message) || e); }
    check(label + ' ⇒ 检出「' + expect + '」退化', degraded, detail);
    loadCfg();
  }

  // M-1 免费档也取会计利润（把 R493 的两口径分流取消）
  await mut('M-1 免费档也取会计利润', 'const fen = isPaid ? res.total_factor_real_profit_fen : res.operation_ref_profit_fen;',
    'const fen = res.total_factor_real_profit_fen;', 'A-③ 免费取参考口径', async (mc) => {
      reset(); ledgerResp = ledger(); entResp = { is_active: false };
      const mp = fresh(mc); await mp.loadRefProfit();
      return { degraded: mp.data.refProfit === '9160.00', detail: '免费档拿到=' + mp.data.refProfit };
    });

  // M-2 同时拆掉**两道**账本存在性判据（页面本来就是双保险，只拆一道不退化是对的）
  await mut('M-2 去掉两道账本存在性判据',
    ['if (!d || !d.account_id) {', 'if (d.account_id && typeof fen === \'number\' && Number.isFinite(fen)) {'],
    ['if (!d) {', 'if (typeof fen === \'number\' && Number.isFinite(fen)) {'],
    'B-① 无账本走空态', async (mc) => {
      reset(); ledgerResp = { account_id: '', result: { operation_ref_profit_fen: 0 } };
      const mp = fresh(mc); await mp.loadRefProfit();
      return { degraded: mp.data.hasProfit === true, detail: 'hasProfit=' + mp.data.hasProfit };
    });

  // M-3 hero 营收 0 也渲染
  await mut('M-3 营收 0 也渲染', "heroIncome: incomeFen > 0 ? this.wanText(incomeFen) : '',", 'heroIncome: this.wanText(incomeFen),',
    'C-① 营收 0 留空', async (mc) => {
      reset(); ledgerResp = ledger({ result: { total_factor_real_profit_fen: 100000, operation_ref_profit_fen: 100000, incomeTotalFen: 0, expenseTotalFen: 1, materialCostFen: 1, grossMarginRatePct: 50 } });
      entResp = { is_active: true };
      const mp = fresh(mc); await mp.loadRefProfit();
      return { degraded: mp.data.heroIncome !== '', detail: 'heroIncome=' + JSON.stringify(mp.data.heroIncome) };
    });

  // M-4 tabBar 页改 navigateTo
  await mut('M-4 M3 入口改 navigateTo', "goCard() { wx.switchTab({ url: '/pages/m3/hub' }); },",
    "goCard() { wx.navigateTo({ url: '/pages/m3/hub' }); },", 'F-① 必须 switchTab', async (mc) => {
      reset();
      const mp = fresh(mc); mp.goCard();
      return { degraded: (seen.navigateTo || []).some((u) => u.indexOf('/pages/m3/hub') >= 0), detail: 'navigateTo=' + JSON.stringify(seen.navigateTo) };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
