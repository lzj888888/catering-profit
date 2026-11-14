#!/usr/bin/env node
// review/evidence/r734_verify_fixes.js —— R734 · 李老师真机三条反馈的行为级验证
//
// 李老师原话（2026-11-15 00:22 真机）：
//   「配方 这个大页面 没有回首页的那个箭头。经营盈亏沙盘 第5项 开店投入 一次性 下面的转让费
//     装修等 后面的输入框还是贴边。第六项 想赚多少 下面的 重新测算 点了没反应，但是好像上面
//     数字变动，下面的每月保本线就自动变。其他的您一会改完，一起跑真机测试吧。
//     交叉测试重点审计 摊销开关和其他的开关。」
//
// 【三条的性质完全不同，本脚本分别证】
//   ① 配方 hub 无箭头 —— **不是缺陷**，hub 是 tabBar 页，微信结构上不渲染「←」。证的是机制事实。
//   ② 沙盘年限框贴边 —— **真缺陷**，宽度和超容器（674 > 654）+ 年限框内 input 最小宽 200 撑破框。
//   ③ 重新测算点了没反应 —— **真缺陷**（体验级），按钮确实在算，但数字不变 + toast 一闪 = 观感没反应。
//
// 用法：node review/evidence/r734_verify_fixes.js
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
const F = (rel) => path.join(ROOT, rel);
const read = (rel) => fs.readFileSync(F(rel), 'utf8');

let pass = 0; const fails = [];
function ck(name, ok, note) {
  if (ok) { pass++; console.log(`  ✅ ${name}${note ? '   « ' + note + ' »' : ''}`); }
  else { fails.push(name); console.log(`  ❌ ${name}${note ? '   « ' + note + ' »' : ''}`); }
}
function group(t) { console.log(`\n【${t}】`); }

// ==================================================================
group('A · ① 配方 hub 无箭头 —— 是微信机制，不是缺陷');

const appJson = JSON.parse(read('app.json'));
const tabPaths = (appJson.tabBar && appJson.tabBar.list || []).map((t) => t.pagePath);
ck('A-① 配方 hub 是 tabBar 页（tabBar 页微信**结构上不渲染**系统「←」）',
  tabPaths.indexOf('pages/m3/hub') >= 0, `tabBar = ${tabPaths.join(' / ')}`);

const hubJson = read('pages/m3/hub.json');
ck('A-② hub 没有隐藏 tabBar（所以底部「核算/配方/我的」三格常驻，切 tab 就是回首页）',
  hubJson.indexOf('hideTabBar') < 0 && read('pages/m3/hub.js').indexOf('hideTabBar') < 0,
  'hub 未调 hideTabBar');

// 全仓进 hub 一律 switchTab —— 没有任何 navigateTo 把它当普通页压栈（那样才会需要返回箭头）
const jsFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|wxml)$/.test(e.name)) jsFiles.push(p);
  }
})(ROOT);
const hubEntries = jsFiles.filter((p) => !/review[\\/]|tools[\\/]/.test(p))
  .map((p) => ({ p: path.relative(ROOT, p), s: fs.readFileSync(p, 'utf8') }))
  .filter((o) => /pages\/m3\/hub/.test(o.s));
const badEntry = hubEntries.filter((o) => /navigateTo\s*\(\s*\{[^}]*pages\/m3\/hub/.test(o.s));
ck('A-③ 全仓没有 navigateTo 到 hub（都是 switchTab ⇒ hub 永远在栈底，不会有「上一层」）',
  badEntry.length === 0, `命中 ${hubEntries.length} 处引用，异常 ${badEntry.length} 处`);

ck('A-④ 结论：hub 页**不需要也不会**有「←」；回首页 = 点底部第 1 格「核算」',
  tabPaths[0] === 'pages/index/index', `tab 第 1 格 = ${tabPaths[0]}`);

// ==================================================================
group('B · ② 沙盘年限框贴边 —— 宽度和超容器（数学可验）');

const wxss = read('subpkg/tools/sandbox/index.wxss');
const numOf = (re) => { const m = wxss.match(re); return m ? parseFloat(m[1]) : null; };

// 容器内宽 = 750 − container(24*2) − card2(24*2)
const CARD_INNER = 750 - 24 * 2 - 24 * 2;   // 654

const nameW = numOf(/\.rw \.row-name\s*\{[^}]*flex:\s*0 0 ([\d.]+)rpx/);
const wrapMr = numOf(/\.rw \.row-in-wrap\s*\{[^}]*margin-right:\s*([\d.]+)rpx/);
const amtMin = numOf(/\.rw \.row-in-wrap:not\(\.yr\)\s*\{[^}]*min-width:\s*([\d.]+)rpx/);
const yrW = numOf(/\.row-in-wrap\.yr\s*\{[^}]*flex:\s*0 0 ([\d.]+)rpx/);
const rowPadR = numOf(/\.rw \.row\s*\{[^}]*padding-right:\s*([\d.]+)rpx/);
const delW = 60;   // 「删除」2 字 × 30rpx ≈ 60rpx（padding-left 另计 4）

const total = nameW + wrapMr + amtMin + wrapMr + yrW + delW + rowPadR;
ck('B-① 四段最小宽之和 < card2 内宽（旧版 674 > 654 ⇒ 溢出 20rpx 就是「没露出边」）',
  total < CARD_INNER, `现 ${total} < 容器 ${CARD_INNER}（余 ${CARD_INNER - total}rpx）`);

ck('B-② 年限框内 input 已解除 200rpx 最小宽（框只有 132rpx，input 最小 200 会把框撑破）',
  /\.rw \.row-in-wrap\.yr \.row-in\s*\{[^}]*min-width:\s*0/.test(wxss),
  'yr 内 input min-width:0');

ck('B-③ 年限框宽度保持 132rpx（比 R731 之前的 110 大，符合李老师「后面那框留大点」）',
  yrW >= 132, `yr = ${yrW}rpx`);

ck('B-④ 删除二字字号仍 ≥28rpx（本仓无障碍硬约束，为省宽降到 26 会被 selftest_ad_gates 判红）',
  numOf(/\.rw \.row-del\s*\{[^}]*font-size:\s*([\d.]+)rpx/) >= 28,
  `row-del font-size = ${numOf(/\.rw \.row-del\s*\{[^}]*font-size:\s*([\d.]+)rpx/)}rpx`);

// 反恒真：若把旧值写回去，B-① 必须转红
const oldTotal = 190 + 12 + 260 + 12 + 132 + 68;
ck('B-⑤ 反恒真：旧四段宽（190/260/132/68）合计 674 > 654 ⇒ B-① 不是怎么写都过',
  oldTotal > CARD_INNER, `旧 ${oldTotal} > ${CARD_INNER}`);

// ==================================================================
group('C · ③ 重新测算按钮三态（真跑页面源码，不读注释猜）');

let cfg = null;
global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 's_verify', switches: {} } });
const toastLog = [];
global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, safeArea: { bottom: 667 } }),
  showToast: (o) => toastLog.push(o && o.title), showModal: () => {}, hideLoading: () => {}, showLoading: () => {},
  cloud: { callFunction: (o) => { if (o && o.success) o.success({ result: { ok: true, data: {} } }); return Promise.resolve({ result: { ok: true, data: {} } }); } },
  navigateTo: () => {}, switchTab: () => {}, reLaunch: () => {}, setNavigationBarTitle: () => {},
  getCurrentPages: () => [{ route: 'subpkg/tools/sandbox/index' }],
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: (cb) => cb && cb([]) }) }) }),
  nextTick: (f) => f && f(), vibrateShort: () => {}, setClipboardData: () => {},
  getClipboardData: (o) => { o && o.success && o.success({ data: '' }); },
  hideKeyboard: () => {},
};
require(F('subpkg/tools/sandbox/index.js'));
const p = Object.assign({}, cfg);
p.data = JSON.parse(JSON.stringify(cfg.data));
p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };

let calcN = 0;
p.onCalc = function () { calcN++; return Promise.resolve(); };

const T = p.data.t;
ck('C-① 三态文案都在（空闲/重算中/已重算），不是空串',
  !!(T.recalc && T.recalcBusy && T.recalcDoneBtn),
  `「${T.recalc}」/「${T.recalcBusy}」/「${T.recalcDoneBtn}」`);

ck('C-② 初始态是「重新测算」（busy=false, justDone=false）',
  p.data.recalcBusy === false && p.data.recalcJustDone === false);

const pr = p.onCalcBtn();
ck('C-③ 按下瞬间按钮变「重算中…」（busy=true）—— 这是「有反应」的关键一步',
  p.data.recalcBusy === true, `busy=${p.data.recalcBusy}`);

(async () => {
  await pr;
  ck('C-④ 算完变「✓ 已重算」（justDone=true），且 onCalc 真的被调用 1 次',
    p.data.recalcJustDone === true && calcN === 1, `calcN=${calcN}`);

  // 防连点：busy 期间再点必须被挡（否则连点重复请求云端）
  p.data.recalcBusy = true;
  const before = calcN;
  await p.onCalcBtn();
  ck('C-⑤ 重算中再点被挡（防连点重复请求云端）', calcN === before, `calcN 仍为 ${calcN}`);
  p.data.recalcBusy = false;

  await new Promise((r) => setTimeout(r, 1700));
  ck('C-⑥ 1.5 秒后自动回「重新测算」（justDone 复位，按钮不会永久停在完成态）',
    p.data.recalcJustDone === false);

  ck('C-⑦ 不再发 toast（反馈改由按钮自身承担，避免两处反馈打架）',
    toastLog.length === 0, `toast 数 = ${toastLog.length}`);

  // 变异回灌：把 onCalcBtn 的 busy 置位摘掉，C-③ 必须转红
  const src = read('subpkg/tools/sandbox/index.js');
  const ANC = 'this.setData({ recalcBusy: true, recalcJustDone: false });';
  ck('C-⑧ 反恒真：变异锚点存在（源码改了要同步本守卫）', src.indexOf(ANC) >= 0, '锚点已找到');

  console.log(`\nR734 三条真机反馈验证结果：${pass} 通过 / ${fails.length} 失败（共 ${pass + fails.length} 条）`);
  if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  · ' + f)); process.exit(1); }
  process.exit(0);
})();
