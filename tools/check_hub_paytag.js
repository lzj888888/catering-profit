#!/usr/bin/env node
// tools/check_hub_paytag.js —— R3-5（台账）M3 枢纽「需开通」标签与付费墙开关同源守卫
//
// 发现经过（2026-11-13 模拟器实测，不是静态判据能看出来的）：
//   `pages/m3/hub.wxml` 四张卡片（外卖/团购/复盘/对账）都挂着一句 `{{t.payTag}}`「需开通」，
//   而 `pages/m3/hub.js` 里它是**无条件硬编码** `TERMS.hub.payTag`。
//   当时前端 `PAYWALL_ENABLED=false`、云端 `FREE_ACCESS=true`（提审期全开）——
//   四张卡片**点进去就能用**，标签却在说「需要开通」。
//   ⇒ 老板以为要付钱、不敢点。正是李老师的原话「要不然人点都不敢点进去」。
//
// 为什么静态守卫看不出来：字符串「需开通」确实在 wxml 里、也确实是产品要的词，
//   单看源码永远是对的。只有**把页面真跑起来并读 data.t.payTag**，才能发现
//   当前开关状态下这个标签根本不该出现。
//
// 判据：
//   H-① 真跑页面：`PAYWALL_ENABLED=false` ⇒ payTag 必须是空串（标签不显示）
//   H-② 🔴 分辨力证明：把开关设成 true 重跑 ⇒ payTag 必须非空（不是把标签删了，而是跟着开关走）
//   H-③ 静态：wxml 里每个 `hub-pay` 都必须带 `wx:if`（否则空串也会渲染一个空 span，
//        多出一行空白，卡片高度不一致）
//   H-④ 前后端开关同源：前端 `PAYWALL_ENABLED` 与云端 `payFlags.FREE_ACCESS` 必须互为取反
//   H-⑤ 变异：把 payTag 改回硬编码 ⇒ H-① 必须红
//
// 运行：node tools/check_hub_paytag.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'pages/m3/hub.js');
const WXML = path.join(ROOT, 'pages/m3/hub.wxml');
const FLAGS = path.join(ROOT, 'utils/featureFlags.js');
const CLOUD_FLAGS = path.join(ROOT, 'cloudfunctions/common/payFlags.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 桩 ----------
let cfg = null;
let flagsMock = { PAYWALL_ENABLED: false };

const mockApi = {
  call: async () => ({ list: [] }),
  ensureShop: async () => ({ shop_id: 's' }),
  fenToYuan: (v) => String(v),
  toastError: () => {},
};
const mockUi = { setTitle: () => {}, nowMonth: () => '2026-11' };
const mockShopGuard = { promptNoShop: () => {} };
const mockDh = { truncatedNote: () => '' };

global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: {} });
global.wx = {
  showToast: () => {}, showModal: () => {}, navigateTo: () => {}, switchTab: () => {},
  getStorageSync: () => '', setStorageSync: () => {},
};

const MOCKS = {
  '../../utils/api.js': mockApi,
  '../../utils/ui.js': mockUi,
  '../../utils/shopGuard.js': mockShopGuard,
  '../../utils/dataHealth.js': mockDh,
  '../../utils/featureFlags.js': flagsMock,
};
function makeRequire(baseDir) {
  return function (req) {
    if (MOCKS[req]) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}
function loadCfg(srcOverride, paywall) {
  const src = srcOverride || fs.readFileSync(PAGE, 'utf8');
  cfg = null;
  flagsMock = { PAYWALL_ENABLED: !!paywall };
  MOCKS['../../utils/featureFlags.js'] = flagsMock;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：pages/m3/hub.js');
  return cfg;
}

(async () => {
  console.log('[R3-5] M3 枢纽「需开通」标签 ↔ 付费墙开关');

  const SRC = fs.readFileSync(PAGE, 'utf8');
  const WXML_SRC = fs.readFileSync(WXML, 'utf8');

  // ===== H-① 当前开关下不应出现「需开通」 =====
  sec('H · 标签真值');

  loadCfg(null, false);
  check('H-① 🔴 PAYWALL_ENABLED=false（提审期全开）⇒ payTag 必须为空串',
    cfg.data.t.payTag === '', 'payTag=' + JSON.stringify(cfg.data.t.payTag));

  // ===== H-② 分辨力：开关一开标签就该回来 =====
  loadCfg(null, true);
  check('H-② 🔴 分辨力证明：PAYWALL_ENABLED=true ⇒ payTag 必须非空（是跟着开关走，不是删掉）',
    !!cfg.data.t.payTag, 'payTag=' + JSON.stringify(cfg.data.t.payTag));

  loadCfg(null, false);   // 还原

  // ===== H-③ WXML 每处都必须有 wx:if =====
  sec('H · 渲染条件');

  const payTags = (WXML_SRC.match(/<text[^>]*hub-pay[^>]*>/g) || []);
  const withIf = payTags.filter((s) => /wx:if\s*=\s*"\{\{\s*t\.payTag\s*\}\}"/.test(s));
  check('H-③ 每处 hub-pay 都带 wx:if（空串不渲染空行，卡片高度一致）',
    payTags.length > 0 && withIf.length === payTags.length,
    '共 ' + payTags.length + ' 处，带条件 ' + withIf.length + ' 处');

  // ===== H-④ 前后端开关同源 =====
  sec('H · 前后端开关同源');

  const fSrc = fs.readFileSync(FLAGS, 'utf8');
  const cSrc = fs.readFileSync(CLOUD_FLAGS, 'utf8');
  const mFront = /const PAYWALL_ENABLED = (true|false);/.exec(fSrc);
  const mCloud = /const FREE_ACCESS = (true|false);/.exec(cSrc);
  const front = mFront ? mFront[1] === 'true' : null;
  const cloud = mCloud ? mCloud[1] === 'true' : null;
  check('H-④ 前端 PAYWALL_ENABLED ≡ 云端 FREE_ACCESS 取反（半开半关会造出「入口在但功能被藏」）',
    front !== null && cloud !== null && cloud === !front,
    '前端 PAYWALL_ENABLED=' + front + ' 云端 FREE_ACCESS=' + cloud);

  check('H-⑤ 页面确实引用 featureFlags 单源（不是自己另写一个布尔）',
    /require\('\.\.\/\.\.\/utils\/featureFlags\.js'\)/.test(SRC) && /PAYWALL_ENABLED/.test(SRC));

  // ===== H-⑥ 变异回灌 =====
  sec('H · 变异回灌');

  function mut(label, from, to, runFn) {
    if (SRC.indexOf(from) < 0) { console.log('  ❌ ' + label + ' 锚点漂移：' + from); failN++; return; }
    const mutated = SRC.replace(from, to);
    if (mutated === SRC) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let mc = null;
    try { mc = loadCfg(mutated, false); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return; }
    const r = runFn(mc);
    check(label + ' ⇒ 检出「硬编码需开通」退化', !!r.degraded, r.detail || '');
    loadCfg(null, false);
  }

  mut('H-⑥ 改回无条件硬编码', "payTag: PAYWALL_ENABLED ? TERMS.hub.payTag : '',", 'payTag: TERMS.hub.payTag,',
    (mc) => ({ degraded: mc.data.t.payTag !== '', detail: 'payTag=' + JSON.stringify(mc.data.t.payTag) }));

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('ERR', (e && e.stack) || e); process.exit(1); });
