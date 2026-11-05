#!/usr/bin/env node
/**
 * 页面「顶层绑定」运行时守卫（第 238 个套件 · R611）
 *
 * 事故（李老师 2026-11-05 真机反馈）：
 *   「月度盈利核算 → 去登记 / 管理 下面出了很多空格」。
 *   根因：input.wxml 的经营客流段把 8 个文案写成**顶层绑定** `{{trTitle}}` / `{{trHint}}` /
 *   `{{trThisMonth}}` ... 而页面只在 `data.t` 里映射了它们（`input.js` 的 `t: { ... }`）。
 *   ⇒ 顶层恒 undefined ⇒ wxml 渲染成「有容器没文字」的一排空白，且**零报错**。
 *
 * 现有守卫为什么全绿（这是本套件存在的原因）：
 *   · `check_page_terms` 判据② 守的是「wxml 用了 t.<键> ⇒ 该页 t:{} 里必须有」——
 *     **只守这个方向**。本事故是反过来的：t 里有、wxml 却用顶层 ⇒ 它完全看不见。
 *   · `check_wxml_structure` 只验属性形态、`check_js_syntax` 只验能否编译。
 *   · grep 式扫描会假绿：把 js 里任意 `键:`（含 t:{} 内部）都算「已定义」，
 *     R611 首轮扫描就是这样报了 0 违规。**唯一可信的判据是页面桩真跑出来的 data 顶层键**。
 *
 * 判据：每个 .wxml 里的纯单标识符绑定 `{{xxx}}`，必须真的出现在
 *       该页 .js 被 `Page({...})` 注册时的 `data` 顶层键集合里（排除 wx:for 局部变量）。
 *       ← 用 `new Function` / require 真加载生产源码，不抄副本、不落盘。
 *
 * 自证：S 段证明扫描面非空且锚点页在内；M 段用内存合成的 wxml 变体证明
 *       「故意写一个未定义顶层绑定」必须被抓到（防止判据恒真 / 空扫描假绿）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const fails = [];
function ck(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
function seg(t) { console.log('\n===== ' + t + ' ====='); }

// ---------- 桩：足以让 M1 全页 require 成功 ----------
const NOOP = function () {};
function installGlobals() {
  global.Page = function (c) { global.__cfg = c; };
  global.getApp = function () { return { globalData: { shop_id: 'shop_probe' } }; };
  global.wx = {
    showToast: NOOP, showModal: function (o) { if (o && o.success) o.success({ confirm: true }); },
    navigateTo: NOOP, redirectTo: NOOP, switchTab: NOOP, reLaunch: NOOP,
    getStorageSync: function () { return ''; }, setStorageSync: NOOP, removeStorageSync: NOOP,
    showLoading: NOOP, hideLoading: NOOP, stopPullDownRefresh: NOOP,
    cloud: { callFunction: async function () { return { result: {} }; } },
    getSystemInfoSync: function () { return {}; },
    getAccountInfoSync: function () { return { miniProgram: { envVersion: 'develop' } }; },
    onNetworkStatusChange: NOOP, setNavigationBarTitle: NOOP,
    getUpdateManager: function () { return { onUpdateReady: NOOP, onCheckForUpdate: NOOP, applyUpdate: NOOP }; },
    createSelectorQuery: function () {
      return { select: function () { return { boundingClientRect: function () { return { exec: NOOP }; } }; } };
    },
  };
}

function dataKeysOf(jsFile) {
  installGlobals();
  global.__cfg = null;
  delete require.cache[require.resolve(jsFile)];
  require(jsFile);
  const cfg = global.__cfg;
  if (!cfg || !cfg.data) throw new Error('Page({data}) 未捕获: ' + jsFile);
  return new Set(Object.keys(cfg.data));
}

// 剥掉 wxml 注释后再取绑定（注释里写 {{...}} 是文档，不是绑定）
function pureBindings(wxml) {
  const clean = wxml.replace(/<!--[\s\S]*?-->/g, '');
  const locals = new Set(['item', 'index', 'true', 'false', 'null', 'undefined']);
  for (const m of clean.matchAll(/wx:for-(?:item|index)="([^"]+)"/g)) locals.add(m[1]);
  const pure = new Set();
  for (const m of clean.matchAll(/\{\{(.*?)\}\}/gs)) {
    const e = m[1].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(e)) pure.add(e);
  }
  return { pure, locals };
}

// ---------- 扫描面：M1 全部页面 + 三个 tab 首页 ----------
const PAGES = [
  ['month/index', 'subpkg/biz/month/index'],
  ['month/input', 'subpkg/biz/month/input'],
  ['month/result', 'subpkg/biz/month/result'],
  ['month/inventory', 'subpkg/biz/month/inventory'],
  ['month/amortize', 'subpkg/biz/month/amortize'],
  ['month/assetEdit', 'subpkg/biz/month/assetEdit'],
  ['首页', 'pages/index/index'],
  ['M3hub', 'pages/m3/hub'],
  ['我的', 'pages/mine/index'],
  // 🔴 R613（2026-11-06）：诊断两页 —— 新增页面必须**手动登记**到这里，
  //   否则就是"未受守的盲区"（本套件不会自动发现新页面，这一点在文件头有声明）。
  ['diag/input', 'subpkg/biz/diag/input'],
  ['diag/result', 'subpkg/biz/diag/result'],
];

seg('S 自证：扫描面与判据不是空的');
ck('S-① 页面清单非空且含事故锚点 input 页', PAGES.length >= 11 &&
  PAGES.some(p => p[1] === 'subpkg/biz/month/input'));
// S-② 防"登记面被写窄"：新增页面若只加页面不加这里，等于没守。
//   判据取**诊断页必须在册**——它是这套守卫最近一次救回来的现场（客流 8 个顶层绑定空白）。
ck('S-② 新增的诊断两页在册（防登记面缩水）', PAGES.some(p => p[1] === 'subpkg/biz/diag/result') &&
  PAGES.some(p => p[1] === 'subpkg/biz/diag/input'));
let loadable = 0, bindingTotal = 0;
const missing = [];
for (const [name, base] of PAGES) {
  const wf = path.join(ROOT, base + '.wxml'), jf = path.join(ROOT, base + '.js');
  if (!fs.existsSync(wf) || !fs.existsSync(jf)) { missing.push(name + ':文件缺失'); continue; }
  let keys;
  try { keys = dataKeysOf(jf); loadable++; }
  catch (e) { missing.push(name + ':加载失败 ' + e.message); continue; }
  const { pure, locals } = pureBindings(fs.readFileSync(wf, 'utf8'));
  bindingTotal += pure.size;
  for (const k of pure) if (!keys.has(k) && !locals.has(k)) missing.push(name + ':' + k);
}
ck('S-② 全部页面能被页面桩真加载', loadable === PAGES.length, loadable + '/' + PAGES.length);
ck('S-③ 确实扫到了足够多的顶层绑定（防空扫描恒绿）', bindingTotal >= 90, '实测 ' + bindingTotal);

seg('P 判据：顶层绑定必须真的在 data 顶层');
ck('P-① 全站零「顶层绑定但未定义」', missing.length === 0,
  missing.length ? missing.join(' / ') : '零违规');
ck('P-② 事故锚点：input 页客流 8 键已改为 t.xxx 形式', (() => {
  const wf = path.join(ROOT, 'subpkg/biz/month/input.wxml');
  const t = fs.readFileSync(wf, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  return ['trTitle', 'trHint', 'trThisMonth', 'trThisMonthPh', 'trOld', 'trOldPh', 'trMember', 'trMemberPh']
    .every(k => t.includes('{{t.' + k + '}}') && !t.includes('{{' + k + '}}'));
})(), '8/8 取 t 单源');

seg('M 变异自证：判据能抓住故意造的未定义绑定');
{
  const { pure, locals } = pureBindings('<view>{{definedOne}}</view><view>{{ghostBinding}}</view>');
  const fake = new Set(['definedOne']);
  const bad = [...pure].filter(k => !fake.has(k) && !locals.has(k));
  ck('M-① 合成样本中的 ghostBinding 被点名', bad.length === 1 && bad[0] === 'ghostBinding',
    bad.join(',') || '零');
  const { pure: p2 } = pureBindings('<view><!-- {{commentOnly}} --></view><view>{{realOne}}</view>');
  ck('M-② 注释里的 {{...}} 不算绑定（不误报）', !p2.has('commentOnly') && p2.has('realOne'));
  const { pure: p3, locals: l3 } = pureBindings('<view wx:for="{{rows}}" wx:for-item="g">{{g.name}}</view><view>{{flag}}</view>');
  ck('M-③ 纯单标识符才纳入：rows/flag 算，循环内 g.name 不算',
    !p3.has('g') && p3.has('flag') && p3.has('rows') && p3.size === 2,
    '实际 = ' + [...p3].join(','));
  ck('M-④ 判据不恒真：把 data 补上 ghostBinding 后即放行', (() => {
    const fake2 = new Set(['definedOne', 'ghostBinding']);
    return [...pure].filter(k => !fake2.has(k) && !locals.has(k)).length === 0;
  })());
}

console.log('\n===== 页面顶层绑定守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) { console.log('失败项：' + fails.join(' / ')); process.exit(1); }
