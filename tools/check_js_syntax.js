#!/usr/bin/env node
// tools/check_js_syntax.js —— R122 · 全仓 .js **语法编译**守卫（round99 新增）
//
// ============ 为什么要有这条（2026-09-22 出码事故 · 真实触发，不是假想）============
// round97 T1 的插入脚本把 `pages/month/input.js` 的 require 解构**拆成了两条**
//   （第 13 行已用 `}` 收尾，第 14 行又接一段 `mkByPlatTotal, mkByPlatFilled } = ...`）
// ⇒ 微信开发者工具出码时**编译失败** `Unexpected token (14:32)`，小程序根本起不来。
// 而当时 `verify_all.js` 报的是 **94/94 全绿**。缺口在哪：
//   - `tools/check_requires.js` 只查「require 路径**存在**」——**路径存在 ≠ 文件可编译**；
//   - 全部 selftest / check_* 都是**文本级 grep**，从不编译任何东西；
//   - 42 个云函数各带 selftest、会 require 自己的模块，但**前端 `pages/` 与 `miniprogram/`
//     没有任何套件 require**（它们只在真机/模拟器里跑）⇒ **前端语法是零覆盖区**，本次就落在这里。
// ⇒ 判据：**每个受管 .js 至少能被 JavaScript 引擎编译一次**。
//
// ============ 实现选择：vm.Script 而不是 `node --check` ============
// 一次一进程的 spawn 版实测会被**回收/超时**（688 个文件），本仓已有前车之鉴（沙箱里 spawn 丢）。
// 改用 `new vm.Script(src)`：**同进程编译、不执行、不落地、不联网**，688 个文件秒级完成。
// ⚠️ `vm.Script` 只编译「顶层脚本」：**不认** `import`/`export`（.mjs 语法）。本仓为 CommonJS
//    （云函数 + 小程序），无 .mjs ⇒ 够用。若将来引入 .mjs，本守卫须同步改造（否则会假红）。
//
// ============ 两个必须自己处理的语言细节 ============
// ① **shebang**：`#!/usr/bin/env node` 在 V8 里不是合法语法（Node 的模块加载器会剥离它，
//    `vm.Script` **不会**）⇒ 会误报 3 个带 shebang 的工具。故编译前把首行替换为**等长空格**（保行号）。
// ② **BOM**：UTF-8 BOM 会让 V8 在首行报 `Invalid or unexpected token` ⇒ 编译前剥掉（与 R74/R79 同处置）。
//
// ============ 扫描面与排除面（**排除面显式声明**，不许静默放宽）============
// 扫描面（生产面）：仓根 *.js + miniprogram/ + pages/ + utils/ + cloudfunctions/ + tools/ + specs/
// 排除面：node_modules / .git / .workbuddy / **review/**
//   - `review/` 是**历史归档面**（与 R109「review/ 为历史档案只作弱面明示」同一政策）：
//     其中存有**变异回灌期故意写坏的脚本快照**——例如
//     `review/evidence/selfdrive_20260920_r61/_mut_r61.js` 带**顶层 `return`**（片段式脚本）。
//     它们是**证据**，不是要运行的代码；把它们判红等于要求"证据不能保留故障形态"。
//
// ============ 下界护栏（防扫描面被悄悄写窄 ⇒ 假绿）============
// ① 文件数 ≥ MIN_FILES；② 必须命中 ANCHORS 里逐个点名的**已知生产文件**（含本次事故文件）。
//   两者任一不满足即判红 —— 沿用 R85/R110 的「断言不得恒真」哲学：守卫自己失效也算失败。
//
// 运行：node tools/check_js_syntax.js      （EXIT 0 = 全绿）

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = ['miniprogram', 'pages', 'utils', 'cloudfunctions', 'tools', 'specs'];
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.workbuddy', 'review']);

const MIN_FILES = 400;

// 锚点：这些文件必须出现在扫描结果里。`pages/month/input.js` = 本次事故现场。
const ANCHORS = [
  'pages/month/input.js',
  'app.js',
  'utils/takeaway.js',
  'cloudfunctions/initDb/collections.js',
  'tools/check_requires.js',
  'verify_all.js',
];

function walk(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
}

const raw = [];
for (const d of SCAN_DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, raw);
}
// 仓根 *.js（app.js / verify_all.js / 各工具入口）
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith('.js')) raw.push(path.join(ROOT, e.name));
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const list = [...new Set(raw.map(rel))].sort();

// —— 编译前规范化：剥 BOM、抹 shebang（等长空格，保行号）——
function normalize(src) {
  let s = src;
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = (nl < 0 ? ' '.repeat(s.length) : ' '.repeat(nl) + s.slice(nl));
  }
  return s;
}

const fails = [];
let compiled = 0;
let shebang = 0;
const anchorSeen = new Set();

for (const r of list) {
  if (ANCHORS.indexOf(r) >= 0) anchorSeen.add(r);
  const abs = path.join(ROOT, r);
  let src;
  try {
    src = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    fails.push({ rel: r, line: 0, msg: '读取失败：' + String(e.message).split('\n')[0] });
    continue;
  }
  const norm = normalize(src);
  if (norm !== src) shebang++;
  try {
    new vm.Script(norm, { filename: r });
    compiled++;
  } catch (e) {
    const stack = String(e.stack || '');
    const m = /\((\d+):(\d+)\)/.exec(stack) || /:(\d+)\n/.exec(stack);
    const line = m ? Number(m[1]) : 0;
    const lines = src.split(/\r?\n/);
    const from = Math.max(0, line - 2);
    const ctx = line > 0
      ? lines.slice(from, Math.min(lines.length, line + 1))
        .map((s, i) => (from + i + 1) + '| ' + s.trim().slice(0, 110)).join('  ⏎  ')
      : '';
    fails.push({ rel: r, line, msg: String(e.message).split('\n')[0], ctx });
  }
}

// —— 下界护栏：扫描面不得被写窄 ——
const guard = [];
if (list.length < MIN_FILES) {
  guard.push(`扫描面仅 ${list.length} 个 .js（下界 ${MIN_FILES}）—— 疑似扫描面被写窄，判红`);
}
const missingAnchors = ANCHORS.filter((a) => !anchorSeen.has(a));
if (missingAnchors.length) {
  guard.push(`未命中锚点文件 ${missingAnchors.length} 个：${missingAnchors.join('、')}—— 扫描面已失守，判红`);
}

const bad = fails.length > 0 || guard.length > 0;

process.stdout.write(`\n[js-syntax R122] 编译 ${list.length} 个 .js`
  + `（扫描面：仓根 + ${SCAN_DIRS.join(' / ')}；排除：${[...EXCLUDED_DIRS].join(' / ')}；`
  + `已规范化 shebang ${shebang} 个）\n`);

if (bad) {
  for (const g of guard) process.stdout.write(`  ❌ 护栏：${g}\n`);
  for (const f of fails) {
    process.stdout.write(`  ❌ ${f.rel}${f.line ? ':' + f.line : ''}\n      ↳ ${f.msg}\n`);
    if (f.ctx) process.stdout.write(`      ${f.ctx}\n`);
  }
} else {
  process.stdout.write(`✅ 全部 ${list.length} 个 .js 语法可编译`
    + `（含锚点 ${anchorSeen.size}/${ANCHORS.length} 个、下界 ${MIN_FILES} 满足；R122）\n`);
}

// 🔒 R69 收尾行：`verify_all.js` 要求套件输出末尾 3 个非空行含「N 通过」，
//   否则判「疑似提前退出」（要么补这行、要么进 NO_SUMMARY_TAIL 豁免清单）。
//   本条守卫只有一个判据（编译通过与否）⇒ 通过数恒为 1 或 0，失败数 = 文件失败 + 护栏失败。
const failCount = fails.length + guard.length;
process.stdout.write(bad
  ? `❌ 语法编译守卫：0 通过 / ${failCount} 失败（可编译 ${compiled} / 共 ${list.length}）\n`
  : `✅ 语法编译守卫：1 通过 / 0 失败\n`);

process.exit(bad ? 1 : 0);
