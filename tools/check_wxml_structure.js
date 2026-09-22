#!/usr/bin/env node
// tools/check_wxml_structure.js —— R123 · WXML 结构完整性守卫（round100 新增）
//
// ============ 为什么要有这条（2026-09-22 真机事故 · 真实触发，不是假想）============
// 真机开发版「月度录入 → 运营费用 / 人工费用」的每一行金额右侧，整片渲染出**英文属性串**：
//     data-kind="expense" data-gidx="0" data-ridx="0" bindinput="onSubAmount"
//     disabled="false" adjust-position="true" cursor-spacing="20" />
// 根因：`pages/month/input.wxml` 的该 `<input>` 在**属性集合中间就被 `/>` 收掉了**，
//      紧随其后的属性行失去了归属，成了**文本节点**；而 WXML 的文本节点**仍会插值** `{{}}`，
//      ⇒ 屏上看到的是**求值后**的 `data-gidx="0"` / `disabled="false"`（不是字面量 `{{gi}}`），
//      这正是「渲染出英文」却不出现双花括号的原因。
// 同一支插入脚本（round97 T1，为 R85 营销小计补互斥 `disabled`）**同一轮**也把
//      `pages/month/input.js` 的 require 解构拆成两条（R122 记）。
//      ⇒ 一次「追加式插入」同时伤了两层：JS 语法（R122）+ WXML 结构（本条）。
// 缺口在哪：95 个套件里**没有任何一条读 `.wxml`** —— R122 只覆盖 `.js`；真机页面无人编译。
//
// ============ 两条判据 ============
// 【判据 A · 裸属性行】某非空行形如 `attr="…"`（属性名 = [A-Za-z_][\w:.-]*），
//   而其**上一个非空行以 `>` 或 `/>` 结尾** ⇒ 标签已闭合，该属性行无处归属 ⇒ 判红。
//   这是本次事故的**直接形态**，能在字面层面点名到行。
// 【判据 B · 标签配平】骨架化后做单趟 tag 栈：
//   `<name …>` 未自闭合入栈 / `<name …/>` 不入栈 / `</name>` 弹栈并比名；
//   收尾栈非空 或 结束标签对不上 或 缺 `>` ⇒ 判红。
//   —— 覆盖本类病灶的另一半（「标签压根没闭合」）。
//
// ============ 骨架化（抹内容但**保行号**）============
// 抹 `{{…}}`（跨行、非贪婪）与 `<!--…-->`，替换为**等长空格但保留 \n**：
//   ⇒ 行号/列位与源文件一一对应，报警不漂移。
//   为什么必须抹：① `data-kind="{{gi}}"` 里的引号会干扰属性行识别；
//                 ② `{{a > b}}` 会伪造出「上一行以 > 结尾」的假象。
//
// ============ 标签名识别（防把正文里的 `<` 当标签）============
// ① `<` 后**不得是空白**（XML 里 `< tag` 非法；正文 `价格 < 100` 因此不会命中）；
// ② 标签名须以 `[A-Za-z]` 起头。
// 两者任一不满足 ⇒ 视为正文，跳过该 `<`。
//
// ============ 扫描面与下界护栏（**不得静默放宽**）============
// 扫描面：仓根 *.wxml + {pages,miniprogram,components}/**/*.wxml
// 排除面：node_modules / .git / .workbuddy / review（历史归档面，同 R109/R122 政策）
// 下界：文件数 ≥ MIN_FILES **且**命中 ANCHORS 逐个点名的已知页面（含本次事故现场）。
//   任一不满足 = 守卫自己失效 ⇒ 判红（沿用 R85/R110/R122 的「断言不得恒真」哲学）。
//
// 运行：node tools/check_wxml_structure.js     （EXIT 0 = 全绿）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = ['pages', 'miniprogram', 'components'];
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.workbuddy', 'review']);

const MIN_FILES = 10;

// 锚点：必须出现在扫描结果里。`pages/month/input.wxml` = 本次事故现场。
const ANCHORS = [
  'pages/month/input.wxml',
  'pages/month/result.wxml',
  'pages/month/amortize.wxml',
  'pages/shop/setting.wxml',
];

function walk(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.wxml')) out.push(p);
  }
}

const raw = [];
for (const d of SCAN_DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, raw);
}
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith('.wxml')) raw.push(path.join(ROOT, e.name));
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const list = [...new Set(raw.map(rel))].sort();

const blankKeepNl = (s) => s.replace(/[^\n]/g, ' ');

function skeleton(src) {
  let s = src;
  s = s.replace(/\{\{[\s\S]*?\}\}/g, blankKeepNl);
  s = s.replace(/<!--[\s\S]*?-->/g, blankKeepNl);
  return s;
}

const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

const ATTR_RE = /^[A-Za-z_][\w:.\-]*\s*=\s*"/;

const aHits = [];   // 判据 A
const bErrs = [];   // 判据 B
const anchorSeen = new Set();
let files = 0;

for (const r of list) {
  if (ANCHORS.indexOf(r) >= 0) anchorSeen.add(r);
  const abs = path.join(ROOT, r);
  let src;
  try {
    src = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    bErrs.push({ rel: r, line: 0, msg: '读取失败：' + String(e.message).split('\n')[0] });
    continue;
  }
  files++;
  const sk = skeleton(src);
  const skLines = sk.split('\n');

  // —— 判据 A：裸属性行 ——
  for (let i = 0; i < skLines.length; i++) {
    const cur = skLines[i].trim();
    if (!cur || !ATTR_RE.test(cur)) continue;
    let j = i - 1;
    while (j >= 0 && !skLines[j].trim()) j--;
    if (j < 0) continue;
    const prev = skLines[j].trim();
    if (prev.endsWith('/>') || prev.endsWith('>')) {
      aHits.push({
        rel: r, line: i + 1, prevLine: j + 1,
        prev: prev.slice(0, 100), cur: cur.slice(0, 100),
      });
    }
  }

  // —— 判据 B：标签配平 ——
  const stack = [];
  let i = 0;
  while (i < sk.length) {
    const lt = sk.indexOf('<', i);
    if (lt < 0) break;
    const nxt = sk[lt + 1];
    if (nxt === undefined || nxt === ' ' || nxt === '\t' || nxt === '\n' || nxt === '\r') {
      i = lt + 1; continue;
    }
    const gt = sk.indexOf('>', lt);
    if (gt < 0) {
      bErrs.push({ rel: r, line: lineOf(sk, lt), msg: '标签缺少结束符 >' });
      break;
    }
    const body = sk.slice(lt + 1, gt);
    if (nxt === '/') {
      const name = body.slice(1).trim();
      if (!stack.length) {
        bErrs.push({ rel: r, line: lineOf(sk, lt), msg: `多余的结束标签 </${name}>（无对应开标签）` });
      } else {
        const top = stack.pop();
        if (top.name !== name) {
          bErrs.push({
            rel: r, line: lineOf(sk, lt),
            msg: `标签错配：</${name}> 对上了 <${top.name}>（开于第 ${top.line} 行）`,
          });
        }
      }
    } else {
      const m = /^[A-Za-z][\w:.\-]*/.exec(body);
      if (!m) { i = lt + 1; continue; }
      if (!body.trimEnd().endsWith('/')) stack.push({ name: m[0], line: lineOf(sk, lt) });
    }
    i = gt + 1;
  }
  for (const t of stack) {
    bErrs.push({ rel: r, line: t.line, msg: `<${t.name}> 未闭合` });
  }
}

// —— 下界护栏：扫描面不得被写窄 ——
const guard = [];
if (list.length < MIN_FILES) {
  guard.push(`扫描面仅 ${list.length} 个 .wxml（下界 ${MIN_FILES}）—— 疑似扫描面被写窄，判红`);
}
const missingAnchors = ANCHORS.filter((a) => !anchorSeen.has(a));
if (missingAnchors.length) {
  guard.push(`未命中锚点文件 ${missingAnchors.length} 个：${missingAnchors.join('、')}—— 扫描面已失守，判红`);
}

const bad = aHits.length > 0 || bErrs.length > 0 || guard.length > 0;

process.stdout.write(`\n[wxml-struct R123] 扫描 ${list.length} 个 .wxml`
  + `（判据 A 裸属性行 / 判据 B 标签配平；排除：${[...EXCLUDED_DIRS].join(' / ')}）\n`);

if (bad) {
  for (const g of guard) process.stdout.write(`  ❌ 护栏：${g}\n`);
  for (const h of aHits) {
    process.stdout.write(`  ❌ ${h.rel}:${h.line} 裸属性行（上一非空行 L${h.prevLine} 已闭合）\n`);
    process.stdout.write(`      L${h.prevLine}| ${h.prev}\n`);
    process.stdout.write(`      L${h.line}| ${h.cur}\n`);
  }
  for (const e of bErrs) {
    process.stdout.write(`  ❌ ${e.rel}${e.line ? ':' + e.line : ''} ${e.msg}\n`);
  }
} else {
  process.stdout.write(`✅ ${files} 个 .wxml 结构完好`
    + `（裸属性行 0；锚点 ${anchorSeen.size}/${ANCHORS.length} 个、下界 ${MIN_FILES} 满足；R123）\n`);
}

// 🔒 R69 收尾行：`verify_all.js` 要求套件输出末尾 3 个非空行含「N 通过」，
//   否则判「疑似提前退出」。本守卫两条判据（A/B）+ 一条护栏 ⇒ 通过数 = 2 或 0。
const failCount = aHits.length + bErrs.length + guard.length;
process.stdout.write(bad
  ? `❌ WXML 结构守卫：0 通过 / ${failCount} 失败（裸属性行 ${aHits.length} / 标签问题 ${bErrs.length} / 护栏 ${guard.length}）\n`
  : `✅ WXML 结构守卫：2 通过 / 0 失败\n`);

process.exit(bad ? 1 : 0);
