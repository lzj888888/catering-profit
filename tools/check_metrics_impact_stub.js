#!/usr/bin/env node
// tools/check_metrics_impact_stub.js —— R1-8（台账）涨价影响面页行为守卫
//
// 为什么需要它：`subpkg/tools/metrics/impact.js` 此前零桩，只有静态形状守卫。
//   它是「原料涨价会动到哪些菜、动多少」的只读预览页，静默错误最伤人的是**越权**：
//
//   🔴 ① 只展示、绝不自动改卡（R203 红线）：本页只能 dry_run 预览，绝不允许出现
//      「一键应用新价」。若 regression 漏掉 dry_run:true，syncCostCard 会变成真实写，
//      把老板没点确认的涨价直接落进成本卡 —— 比「没提示」严重十倍。
//   🔴 ② 路由中文名解码（R203）：跳转侧 encodeURIComponent 过，本页必须自己 decode，
//      否则页面顶上一串 `%E7%82%B8...`。双重编码 + 裸% catch 都要对。
//   🔴 ③ hundred_delta 成本差×100（R615）：每卖 100 份的毛利减少额 = 成本差 × 100 份，
//      漏 ×100 会小 100 倍，老板以为只少赚 1 块其实少 100 块。
//   🔴 ④ 降级提示（marginDrift 单源）：跌破低毛利带 / 亏本必须给红字提示，
//      两处阈值（列表色带 vs 影响面）必须同一套 marginDrift，不能各写一套。
//   🔴 ⑤ 下拉刷新（R379）：老板在原料页改完采购价回来看影响面，必须重新拉，
//      否则看到的是旧 dry_run 结果，把旧影响当新影响。
//
// 取证层级：L2 页面桩（Page/wx/getApp/依赖全桩，真跑页面源码）。不替代真机。
//   marginBand/marginAlert 为纯计算模块，走真实依赖；api/ui 桩。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/tools/metrics/impact.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 可变量 ----------
let seen = {};
let syncAffected = [
  { card_code: 'C1', name: '炸鸡', price_fen: 500, old_total_cost_fen: 300, new_total_cost_fen: 400, old_gross_margin_pct: 45, new_gross_margin_pct: 35, below_band: true, band_floor_pct: 40 },
  { card_code: 'C2', name: '亏本菜', price_fen: 200, old_total_cost_fen: 100, new_total_cost_fen: 300, old_gross_margin_pct: 10, new_gross_margin_pct: -5, below_band: true, band_floor_pct: 0 },
];

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls.push({ name, params });
    if (name === 'syncCostCard') return { affected: syncAffected };
    return {};
  },
  fenToYuan: (fen, digits) => { const v = (Number(fen) || 0) / 100; return v.toFixed(digits === undefined ? 2 : digits); },
  toastError: (e) => { seen.toastError = (seen.toastError || 0) + 1; seen.lastErr = e && (e.msg || e.message); },
};
const mockUi = { setTitle: (t) => { seen.title = t; } };

const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
};
function makeRequire(baseDir) {
  return function (req) {
    if (Object.prototype.hasOwnProperty.call(MOCKS, req)) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}

let cfg = null;
function loadCfg(srcOverride) {
  const src = srcOverride || SRC;
  cfg = null;
  global.getApp = () => ({ globalData: { switches: { inv: true } } });
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：metrics/impact.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() {
  seen = { calls: [], toasts: [], modals: [], nav: [], redirected: [], scrolled: false };
  syncAffected = [
    { card_code: 'C1', name: '炸鸡', price_fen: 500, old_total_cost_fen: 300, new_total_cost_fen: 400, old_gross_margin_pct: 45, new_gross_margin_pct: 35, below_band: true, band_floor_pct: 40 },
    { card_code: 'C2', name: '亏本菜', price_fen: 200, old_total_cost_fen: 100, new_total_cost_fen: 300, old_gross_margin_pct: 10, new_gross_margin_pct: -5, below_band: true, band_floor_pct: 0 },
  ];
}
function flush() { return new Promise((r) => setTimeout(r, 15)); }

global.Page = (c) => { cfg = c; };
global.wx = {
  showToast: (o) => { seen.toasts.push(o); },
  showModal: (o) => { seen.modals.push(o); },
  navigateBack: () => { seen.nav.push('back'); },
  redirectTo: (o) => { seen.redirected.push(o); },
  stopPullDownRefresh: () => { seen.stopped = (seen.stopped || 0) + 1; },
};

const SRC = fs.readFileSync(PAGE, 'utf8');

(async () => {
  console.log('[R1-8] 涨价影响面页行为守卫（dry_run 红线 / 中文名解码 / hundred_delta×100 / 降级提示 / 下拉刷新）');

  // =====================================================
  // I · 加载映射 + 红线
  // =====================================================
  sec('I · 加载映射与红线：dry_run 预览、中文名解码、hundred_delta×100、降级提示、跌破带提示');
  reset();
  let p = fresh(loadCfg());
  await p.onLoad({ material_id: 'M1', name: encodeURIComponent('炸鸡腿') }); await flush();

  // I-① dry_run 红线：syncCostCard 必须带 dry_run:true（绝不真实改卡）
  const syncCalls = seen.calls.filter((c) => c.name === 'syncCostCard');
  const dryOk = syncCalls.length === 1 && syncCalls[0].params.dry_run === true;
  check('I-① 🔴 拉影响面必须 dry_run:true（只预览、绝不改卡）', dryOk, 'sync=' + syncCalls.length + (syncCalls[0] ? ' dry=' + syncCalls[0].params.dry_run : ''));

  // I-② 中文名解码（R203）
  check('I-② 🔴 路由中文名必须解码：material_name=炸鸡腿（非 %E7%82%B8...）',
    p.data.material_name === '炸鸡腿', 'name=' + p.data.material_name);

  // I-③ hundred_delta 成本差×100（R615）：C1 成本差 100 分 ×100 份 = 100.00 元
  const row0 = p.data.affected.find((r) => r.card_code === 'C1');
  check('I-③ 🔴 hundred_delta 含 ×100：C1 成本差 100 分×100 份 = 100.00 元',
    row0 && row0.hundred_delta === '100.00', row0 ? 'hundred_delta=' + row0.hundred_delta : '无 C1');

  // I-④ 降级提示：C2 亏本（newM<0）⇒ drift_tag = impactDriftLoss
  const row1 = p.data.affected.find((r) => r.card_code === 'C2');
  check('I-④ 亏本提示：C2 newM<0 ⇒ drift_tag = impactDriftLoss',
    row1 && row1.drift_tag === TERMS.card.impactDriftLoss, row1 ? 'drift_tag=' + row1.drift_tag : '无 C2');

  // I-⑤ 跌破带提示：C1 below_band=true ⇒ 红字 band_hint 非空
  check('I-⑤ 跌破低毛利带：C1 below_band=true ⇒ band_hint 非空（impactBelowBand）',
    row0 && row0.below_band === true && !!row0.band_hint && row0.band_hint === TERMS.card.impactBelowBand(40),
    row0 ? 'below=' + row0.below_band + ' hint=' + JSON.stringify(row0.band_hint) : '无 C1');

  // =====================================================
  // J · 下拉刷新（R379）：必须重新拉，不能拿旧结果当新
  // =====================================================
  sec('J · 下拉刷新（R379）：onPullDownRefresh 必须重新拉取');
  reset();
  p = fresh(loadCfg());
  await p.onLoad({ material_id: 'M1', name: 'x' }); await flush();
  const before = seen.calls.filter((c) => c.name === 'syncCostCard').length;
  await p.onPullDownRefresh(); await flush();
  const after = seen.calls.filter((c) => c.name === 'syncCostCard').length;
  check('J-① 🔴 onPullDownRefresh 重新拉取（syncCostCard 调用 +1）', after === before + 1, 'before=' + before + ' after=' + after);

  // =====================================================
  // M · 变异回灌：每条必须真跑、exit=1、点名断言
  // =====================================================
  sec('M · 变异回灌（证明上面不是恒真）');

  async function mut(label, from, to, setupFn, runFn) {
    if (SRC.indexOf(from) < 0) { console.log('  ❌ ' + label + ' 锚点漂移'); failN++; return; }
    const mutated = SRC.replace(from, to);
    if (mutated === SRC) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let mc = null;
    try { setupFn(); mc = loadCfg(mutated); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return; }
    let degraded = false, detail = '';
    try { const r = await runFn(mc); degraded = !!r.degraded; detail = r.detail || ''; }
    catch (e) { console.log('  ❌ ' + label + ' 变异后桩抛错（FATAL ≠ 真抓到）：' + (e && e.message)); failN++; return; }
    check(label + ' ⇒ 检出退化', degraded, detail);
    loadCfg();
  }

  // M-1 漏 dry_run（回到「自动改卡」红线坑）：syncCostCard 变成真实写
  await mut('M-1 漏 dry_run',
    "        dry_run: true,\n",
    "",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad({ material_id: 'M1', name: 'x' }); await flush();
      const c = seen.calls.filter((x) => x.name === 'syncCostCard');
      return { degraded: !(c.length === 1 && c[0].params.dry_run === true), detail: 'I-① dry_run 竟漏 dry_run=' + (c[0] ? c[0].params.dry_run : '无') };
    });

  // M-2 漏中文名解码（回到 %E7%82%B8... 坑）
  await mut('M-2 漏中文名解码',
    "  let out = String(s == null ? '' : s);\n  for (let i = 0; i < 2; i += 1) {\n    if (out.indexOf('%') < 0) break;\n    let next;\n    try { next = decodeURIComponent(out); } catch (e) { break; }\n    if (next === out) break;\n    out = next;\n  }\n  return out;",
    "  return String(s == null ? '' : s);",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad({ material_id: 'M1', name: encodeURIComponent('炸鸡腿') }); await flush();
      return { degraded: q.data.material_name !== '炸鸡腿', detail: 'I-② 中文名竟未解码=' + q.data.material_name };
    });

  // M-3 漏 hundred_delta ×100（回到小 100 倍坑）
  await mut('M-3 漏 hundred_delta ×100',
    "          hundred_delta: api.fenToYuan((a.new_total_cost_fen - a.old_total_cost_fen) * 100, 2),",
    "          hundred_delta: api.fenToYuan((a.new_total_cost_fen - a.old_total_cost_fen), 2),",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad({ material_id: 'M1', name: 'x' }); await flush();
      const r = q.data.affected.find((x) => x.card_code === 'C1');
      return { degraded: !(r && r.hundred_delta === '100.00'), detail: 'I-③ hundred_delta 竟=' + (r ? r.hundred_delta : '无') };
    });

  // M-4 漏亏本提示（回到「亏本也不响」坑）
  await mut('M-4 漏亏本提示',
    "        if (drift.level === 'danger' && newM != null && newM < 0) driftTag = TERMS.card.impactDriftLoss;",
    "        if (false) driftTag = TERMS.card.impactDriftLoss;",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad({ material_id: 'M1', name: 'x' }); await flush();
      const r = q.data.affected.find((x) => x.card_code === 'C2');
      return { degraded: !(r && r.drift_tag === TERMS.card.impactDriftLoss), detail: 'I-④ C2 drift_tag 竟=' + (r ? JSON.stringify(r.drift_tag) : '无') };
    });

  // M-5 漏下拉刷新重新拉取（回到「旧影响当新影响」坑）
  await mut('M-5 漏下拉刷新重新拉取',
    "  onPullDownRefresh() {\n    const done = () => wx.stopPullDownRefresh();\n    this.load().then(done, done);\n  }",
    "  onPullDownRefresh() {\n    const done = () => wx.stopPullDownRefresh();\n    done();\n  }",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad({ material_id: 'M1', name: 'x' }); await flush();
      const before = seen.calls.filter((x) => x.name === 'syncCostCard').length;
      await q.onPullDownRefresh(); await flush();
      const after = seen.calls.filter((x) => x.name === 'syncCostCard').length;
      return { degraded: after !== before + 1, detail: 'J-① onPullDownRefresh 竟没重新拉 before=' + before + ' after=' + after };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e && (e.stack || e.message)); process.exit(2); });
