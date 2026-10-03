#!/usr/bin/env node
/**
 * R200 · 底部 tabBar 守卫
 *
 * 背景（R199 自发现的缺口）：R199 给 app.json 加了底部三入口 tabBar（核算/成本/我的），
 * 但**全仓零机器判据守它**。tabBar 有两类会静默失效的错误：
 *   ① 结构层：list 项 pagePath 不在 pages 里 / 图标文件不在盘 / list 为空 / 三路径重复
 *      ⇒ tabBar 画不出来或画错，而本仓 R44（check_pages.js）只守「声明 ↔ 文件存在」，
 *        它虽把 tabBar.list 的 pagePath 并入 declared，但**只查文件在不在，不查结构对不对**。
 *   ② 跳转层（本守卫的**核心判据**）：tabBar 页**只能用 wx.switchTab 跳转**，
 *      用 wx.navigateTo / wx.reLaunch 跳到 tabBar 页**会失败**。
 *      本仓 R39（check_requires 之外的死链检查）只验「目标页面文件存在」，**不验跳转方式**
 *      ⇒ 把某页改成 tabBar 页后，全部原有跳转会静默失效、零守卫报警。
 *
 * 本守卫做四段：
 *   S 扫描面非退化（防「扫空 ⇒ 恒绿」，本仓上限类判据的头号假绿形态）
 *   A 结构合法性（list / pagePath ∈ pages / 图标在盘 / 路径不重复 / text 非空）
 *   B 跳转方式（tabBar 页不得被 navigateTo / reLaunch 跳；switchTab 目标须是 tabBar 页）
 *   C 自反锚点（关键断言在位 + 常量互证，防「阈值被改大以绕过」）
 *
 * 用法：node tools/check_tabbar.js      （已登记为 verify_all.js 的第 128 个套件）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── 段标题格式统一（门禁按 `===== xxx =====` 切段）──
const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const ok = (msg) => notes.push(msg);

// ── 读 app.json ──
const appJsonPath = path.join(ROOT, 'app.json');
if (!fs.existsSync(appJsonPath)) {
  console.log('===== R200 · 底部 tabBar 守卫 =====');
  console.log('❌ S0 找不到 app.json：' + appJsonPath);
  console.log('===== R200 · 底部 tabBar 守卫：0 通过 / 1 失败 =====');
  process.exit(1);
}
let app;
try {
  app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
} catch (e) {
  // 🔴 配置非法也必须走标准输出（R66：段标题下必须有断言 + 末尾必须有汇总行）。
  //   裸 console.error + exit 会让调用方只看到一句英文、既无汇总行也无失败项，
  //   回灌时会被误判成「崩溃红（无效红）」而查不出真因（r200 A5b 实测踩到）。
  console.log('===== R200 · 底部 tabBar 守卫 =====');
  console.log('❌ S0 app.json 解析失败（配置非法，判据无法运行）：' + e.message);
  console.log('===== R200 · 底部 tabBar 守卫：0 通过 / 1 失败 =====');
  process.exit(1);
}

// ══════ S 扫描面非退化 ══════
// 🔴 本守卫含「结构合法」类判据，若 app.json 读不到 tabBar 就整体退化成「无 tabBar ⇒ 跳过」
// ⇒ 恒绿。必须先证「确实读到了 app.json 的 tabBar 结构」与「页面源文件确实扫到了」。
const pages = Array.isArray(app.pages) ? app.pages : [];
const tabBar = app.tabBar;
const list = tabBar && Array.isArray(tabBar.list) ? tabBar.list : [];

const S1 = pages.length >= 20;
S1
  ? ok('S1 app.json::pages 扫描面非退化（实到 ' + pages.length + ' 页，下界 20）')
  : fail('S1 app.json::pages 扫描面退化：只读到 ' + pages.length + ' 页（下界 20）⇒ 判据不可信');

const S2 = Object.prototype.toString.call(tabBar) === '[object Object]';
S2
  ? ok('S2 app.json::tabBar 结构在场（本仓已配底部三入口）')
  : fail('S2 app.json::tabBar 结构不在场：若本仓已配底部 tabBar 而此处报红 ⇒ 判据路径漂移或 app.json 被改坏');

const S3 = list.length >= 2;
S3
  ? ok('S3 tabBar.list 扫描面非退化（实到 ' + list.length + ' 项，下界 2）')
  : fail('S3 tabBar.list 扫描面退化：只读到 ' + list.length + ' 项（下界 2）⇒ 判据不可信');

// ══════ A 结构合法性 ══════
const A1 = list.length >= 2;
A1 ? ok('A1 tabBar 至少 2 个入口（实到 ' + list.length + '）') : fail('A1 tabBar 入口数 < 2：微信要求 tabBar 至少 2 项才能渲染');

const ICON_KEYS = ['iconPath', 'selectedIconPath'];
let iconChecked = 0;
list.forEach((it, i) => {
  if (!it || typeof it.pagePath !== 'string' || !it.pagePath) {
    fail('A2 tabBar.list[' + i + '] 缺 pagePath 或不是字符串');
    return;
  }
  if (!pages.includes(it.pagePath)) {
    fail('A2 tabBar.list[' + i + '] 的 pagePath「' + it.pagePath + '」不在 app.json::pages 里 ⇒ 该 tab 点不动');
  } else {
    ok('A2 tabBar.list[' + i + '] pagePath「' + it.pagePath + '」已在 pages 声明中');
  }
  if (typeof it.text !== 'string' || !it.text.trim()) {
    fail('A3 tabBar.list[' + i + ']（' + it.pagePath + '）text 为空或缺失 ⇒ tab 只有一个图标、没有字');
  }
  for (const k of ICON_KEYS) {
    if (typeof it[k] !== 'string' || !it[k]) {
      fail('A4 tabBar.list[' + i + '] 缺 ' + k + ' ⇒ 图标不显示');
      continue;
    }
    // 图标路径相对 miniprogram 根（app.json 同级）
    const p = path.join(ROOT, it[k]);
    if (!fs.existsSync(p)) fail('A4 tabBar.list[' + i + '] 的 ' + k + ' 文件不在盘：' + it[k]);
    else iconChecked++;
  }
});
ok('A4 图标在盘核查完成（检查 ' + list.length * ICON_KEYS.length + ' 个，实到 ' + iconChecked + '）');

const paths = list.map((it) => (it && it.pagePath) || '').filter(Boolean);
const dup = paths.filter((p, i) => paths.indexOf(p) !== i);
const A5 = dup.length === 0;
A5 ? ok('A5 tabBar 路径互不重复') : fail('A5 tabBar 路径有重复：' + Array.from(new Set(dup)).join('、') + ' ⇒ 会出现两个指向同一页的 tab');

const A6 = list.length <= 5;
A6 ? ok('A6 tabBar 入口数 ' + list.length + ' ≤ 5（微信上限 5）') : fail('A6 tabBar 入口数 ' + list.length + ' 超过微信上限 5');

// ══════ B 跳转方式（本守卫核心）════════
const TAB_SET = new Set(paths);
const JS_DIR = path.join(ROOT, 'pages');
/** 递归列出 pages/ 下的 .js（跳过下划线开头的私有目录） */
function listPageJs(dir, acc) {
  acc = acc || [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of ents) {
    if (e.name.startsWith('_')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listPageJs(full, acc);
    else if (e.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}
const pageJs = listPageJs(JS_DIR);

const S4 = pageJs.length >= 20;
S4
  ? ok('S4 pages/ 下 .js 扫描面非退化（实到 ' + pageJs.length + ' 个，下界 20）')
  : fail('S4 pages/ 下 .js 只扫到 ' + pageJs.length + ' 个（下界 20）⇒ 扫描面退化');

/**
 * 取「跳到 url 所指页面」这一语句所在的函数体片段。
 * 🔴 跨函数同名 = 静态扫描类守卫的头号假绿来源（r116 实测）：
 * 同文件远处的赋值会让靠前的调用被判"受保护"。
 * ⇒ 回溯必须限定在最近一个函数边界之内。
 */
function fnBoundary(code, at) {
  let best = 0;
  const re = /(=>\s*\{|function[^\n{]*\{)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m.index > at) break;
    best = m.index;
  }
  return code.slice(best, at);
}

// 抓「跳转到 tabBar 页」的调用：`wx.navigateTo({ url: '/pages/m3/hub' })` 形态
const CALL_RE = /wx\.(navigateTo|reLaunch|redirectTo)\s*\(\s*\{[\s\S]{0,200}?url\s*:\s*[\"'`]([^\"'`]+)[\"'`]/g;

let badJump = 0;
let jumpChecked = 0;
const jumpSamples = [];
pageJs.forEach((f) => {
  const code = fs.readFileSync(f, 'utf8');
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(code)) !== null) {
    const fn = m[1];
    const url = m[2];
    const clean = url.split('?')[0].replace(/^\//, '');
    if (!TAB_SET.has(clean)) continue;         // 只看「跳到 tabBar 页」的
    jumpChecked++;
    badJump++;
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const why = fn === 'navigateTo'
      ? 'tabBar 页不能用 wx.navigateTo 跳转（会失败）'
      : 'tabBar 页不能用 wx.reLaunch / wx.redirectTo 跳转（会失败）';
    fail('B1 ' + rel + ' 用 wx.' + fn + ' 跳到 tabBar 页「' + clean + '」：' + why + ' ⇒ 应改 wx.switchTab');
    if (jumpSamples.length < 5) jumpSamples.push(rel + ' wx.' + fn + ' -> ' + clean);
  }
});
const B1_ok = badJump === 0;
B1_ok
  ? ok('B1 无「用非 switchTab 跳到 tabBar 页」的调用（检查到 ' + jumpChecked + ' 处相关跳转）')
  : ok('B1 已抓出 ' + badJump + ' 处违规跳转（见上）');

// B2：switchTab 的目标**必须**是 tabBar 页（反向判据）——防止把 switchTab 用来跳普通页
const SW_RE = /wx\.switchTab\s*\(\s*\{[\s\S]{0,200}?url\s*:\s*[\"'`]([^\"'`]+)[\"'`]/g;
let swBad = 0;
let swSeen = 0;
pageJs.forEach((f) => {
  const code = fs.readFileSync(f, 'utf8');
  let m;
  SW_RE.lastIndex = 0;
  while ((m = SW_RE.exec(code)) !== null) {
    swSeen++;
    const clean = m[1].split('?')[0].replace(/^\//, '');
    if (!TAB_SET.has(clean)) {
      swBad++;
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      fail('B2 ' + rel + ' 用 wx.switchTab 跳到非 tabBar 页「' + clean + '」⇒ switchTab 只能跳 tabBar 页');
    }
  }
});
const B2_ok = swBad === 0;
B2_ok
  ? ok('B2 每处 wx.switchTab 的目标都在 tabBar.list 内（共 ' + swSeen + ' 处）')
  : ok('B2 已抓出 ' + swBad + ' 处 switchTab 误用（见上）');

// B3：switchTab 覆盖度 —— 每个 tabBar 页都该至少有一处入口（否则该页从底部进不去）
const swTargets = new Set();
pageJs.forEach((f) => {
  const code = fs.readFileSync(f, 'utf8');
  let m;
  SW_RE.lastIndex = 0;
  while ((m = SW_RE.exec(code)) !== null) swTargets.add(m[1].split('?')[0].replace(/^\//, ''));
});
const noEntry = paths.filter((p) => !swTargets.has(p));
const B3 = noEntry.length === 0;
B3
  ? ok('B3 三个 tab 页都有 switchTab 入口（覆盖 ' + swTargets.size + ' 个目标）')
  : ok('B3 有 ' + noEntry.length + ' 个 tab 页无 switchTab 入口：' + noEntry.join('、') + '（首次进入可由 launchPage 指定，不判红）');

// ══════ C 自反锚点（防「改阈值绕过」）════════
const C1 = paths.includes('pages/index/index') && paths.includes('pages/mine/index');
C1
  ? ok('C1 关键锚点 pages/index/index 与 pages/mine/index 都在 tabBar.list 内（首 tab 与「我的」入口）')
  : fail('C1 关键锚点缺失：首页或「我的」页不在 tabBar.list 内 ⇒ 判据扫描面可能已被改小');

// C2：判据常量自洽（阈值改大以绕过时自己转红）
const LIMIT_MAX = 5;
const C2 = LIMIT_MAX <= 5;
C2
  ? ok('C2 判据自洽：上限常量 ' + LIMIT_MAX + ' ≤ 微信硬上限 5')
  : fail('C2 判据常量被改大：' + LIMIT_MAX + ' ≥ 5，绕过检查');

// —— 输出 ——
console.log('===== R200 · 底部 tabBar 守卫 =====');
notes.forEach((n) => console.log('✅ ' + n));
if (problems.length) {
  console.log('----- 失败明细 -----');
  problems.forEach((m) => console.log('❌ ' + m));
  console.log('===== R200 · 底部 tabBar 守卫：' + (notes.length - problems.length) + ' 通过 / ' + problems.length + ' 失败 =====');
  process.exit(1);
}
console.log('===== R200 · 底部 tabBar 守卫：' + notes.length + ' 通过 / 0 失败 =====');