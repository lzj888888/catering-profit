#!/usr/bin/env node
/**
 * check_amount_input_row.js —— 金额输入框「被同行元素挤窄」同族病守卫（R119，round92）
 *
 * 背景（**同一个毛病在本仓已复发三次**，李老师三次真机反馈都在说同一件事）：
 *   · 2026-09-20 其他收入细项  —— 金额框只剩 220rpx（李老师真机反馈）
 *   · 2026-09-21 堂食分项      —— 金额框只剩 240rpx（同款反馈，改两行布局收口）
 *   · 2026-09-22 外卖分项（R85 新写）—— 金额框实测仅 **181.7px**（375px 屏下占容器 55.6%）
 *   根因：`.wxml` 把「字段名 / 金额输入框 / 操作按钮」写成**同一层容器的兄弟节点**，
 *        按钮与字段名各占固定宽，剩下的才轮到金额框 ⇒ 屏幕越窄挤得越狠。
 *   为什么现在才补守卫：前两次都是**事后逐个修**、只在 wxss 里留了注释禁令，
 *        **没有任何机器判据** ⇒ 新页面照着旧写法抄一遍就复发（本例即第 3 次）。
 *       与 R115 同型根因：**「明令 X」而零守卫 = 必然漂**。
 *
 * 判据（5 组 16 条）：
 *   A0 扫描面登记：.wxml 与 `val-input` 的量化计数（每项都带断言，不是只打印）
 *   A1 硬判据（本守卫唯一目的）：全仓**不存在**「`val-input` 与其 `<button>` 同为某一父元素直接子元素」
 *   A2 结构不变量：外卖字段必须是「head（标签 + 粘贴）+ 金额整行」两行结构（tw-field ≡ tw-field-head ≥ 3）
 *   A3 前提护栏：扫描面下界（文件数 / val-input 实例数 / button 实例数 / 关键文件在面内）
 *   A4 正负样本互证：同一判定函数喂内嵌样本 —— 正例必红、负例必绿、无关形态不得误杀
 *
 * ⚠️ 已知坑的对应处理：
 *   · 坑⑭/⑯ 裸扫数字必误杀：本守卫只解析标签与 class，不扫任何裸数字。
 *   · **误杀边界**：`pages/**` 里 `.sub-item-inp`（细项名）与 `.btn-del`（删除键）同层是**合法**设计，
 *     故判据**只认 `val-input`**（金额框），不得扩大到所有 `<input>` —— A4 有专门样本钉住这条。
 *   · **恒真风险**（R115 的 A3-③ 教训）：A3 的下界必须来自实测，且 A4 用正例证明判定函数真会红。
 *   · R66：断言消息里不出现 ✅ / ❌ 字面。
 *   · 坑⑱ `git ls-files` 只扫 index：本守卫一律**工作树递归**。
 *
 * 运行：node tools/check_amount_input_row.js   （由 verify_all.js 的 [amount-input-row] 套件调用）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = ['node_modules', 'miniprogram_npm', '.git', 'tools', 'review', 'prototype', 'specs'];
const KEY_WXML = 'pages/month/input.wxml';

// 前提下界：取自 2026-09-22 实测（14 / 5 / 32 / 48），留出余量但不留到"恒真"。
const MIN_WXML = 12;
const MIN_FILES_WITH_VAL = 4;
const MIN_VAL_INSTANCES = 24;
const MIN_BUTTONS = 36;

let pass = 0;
let failN = 0;
const ok = (id, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✅ ' + id + (detail ? '  (' + detail + ')' : '')); }
  else { failN += 1; console.log('  ❌ ' + id + (detail ? '  (' + detail + ')' : '')); }
};
const section = (t) => console.log('\n===== ' + t + ' =====');

function walkWxml(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (SKIP.indexOf(e.name) >= 0) continue; walkWxml(p, out); }
    else if (e.name.endsWith('.wxml')) out.push(p);
  }
  return out;
}

/** 剥掉 <!-- --> 注释（按行等长替换为空格，保留行号）。计数与解析**都必须**先过它 ——
 *  ⚠️ R119 变异 M4 实测：A2 若裸扫源码，注释里写一条反例结构就会误报（字段数 +1、head 不变）。 */
function stripComments(src) {
  return String(src).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
}

/** 取标签里的 class 属性值；无则 '' */
function clsOf(attrs) {
  const m = /class\s*=\s*"([^"]*)"/.exec(attrs || '');
  return m ? m[1] : '';
}

/**
 * 解析 wxml 的 view/input/button 树，返回带 parent 的元素列表。
 * 注释先按行等长替换为空格（保留行号），避免注释里的示例标签被当成真结构。
 * parent = 父 view 在返回数组里的下标；顶层 = -1。
 */
function parseNodes(src) {
  const s = stripComments(src);
  const nodes = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(s))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    const selfClose = m[4] === '/';
    if (closing) { if (tag === 'view' && stack.length) stack.pop(); continue; }
    const parent = stack.length ? stack[stack.length - 1] : -1;
    if (tag === 'view') {
      const idx = nodes.length;
      nodes.push({ tag, cls: clsOf(attrs), parent, line: s.slice(0, m.index).split('\n').length });
      if (!selfClose) stack.push(idx);
    } else if (tag === 'input' || tag === 'button') {
      nodes.push({ tag, cls: clsOf(attrs), parent, line: s.slice(0, m.index).split('\n').length });
    }
  }
  return nodes;
}

/** 冲突 = 某个 val-input 的**直接父元素**里还有 button（同层 = 同行 = 金额框被挤窄）。 */
function rowConflicts(src) {
  const nodes = parseNodes(src);
  const out = [];
  for (const n of nodes) {
    if (n.tag !== 'input' || !/(^|\s)val-input(\s|$)/.test(n.cls)) continue;
    const sib = nodes.filter((b) => b.tag === 'button' && b.parent === n.parent);
    if (sib.length) out.push({ line: n.line, input: n.cls, button: sib[0].cls });
  }
  return out;
}

const files = walkWxml(ROOT, []);
let withVal = 0;
let valInstances = 0;
let buttonInstances = 0;
const allConflicts = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const v = (src.match(/class="[^"]*val-input[^"]*"/g) || []).length;
  if (v > 0) withVal += 1;
  valInstances += v;
  buttonInstances += (src.match(/<button\b/g) || []).length;
  for (const c of rowConflicts(src)) allConflicts.push(rel + ':' + c.line + '  input=' + c.input + '  button=' + c.button);
}

section('A0 · 扫描面登记（.wxml 工作树递归）');
ok('A0-① 扫描面 .wxml 文件数', files.length >= MIN_WXML, files.length + ' 个（下界 ' + MIN_WXML + '）');
ok('A0-② 含 val-input 的文件数', withVal >= MIN_FILES_WITH_VAL, withVal + ' 个（下界 ' + MIN_FILES_WITH_VAL + '）');
ok('A0-③ 扫描面含关键页 ' + KEY_WXML,
  files.map((f) => path.relative(ROOT, f).split(path.sep).join('/')).indexOf(KEY_WXML) >= 0);

section('A1 · 金额框不得与按钮同层（同层 = 同行 = 被挤窄）');
if (allConflicts.length) allConflicts.forEach((c) => console.log('      · ' + c));
ok('A1 全仓 val-input 与 button 同父的块数 = 0', allConflicts.length === 0,
  allConflicts.length ? allConflicts.length + ' 处' : '0 处（' + valInstances + ' 个金额框全过）');

section('A2 · 外卖字段两行结构不变量（head = 标签 + 粘贴）');
const inputWxmlRaw = fs.readFileSync(path.join(ROOT, KEY_WXML), 'utf8');
const inputWxml = stripComments(inputWxmlRaw);
const twField = (inputWxml.match(/class="tw-field"/g) || []).length;
const twHead = (inputWxml.match(/class="tw-field-head"/g) || []).length;
ok('A2-① 分项字段容器 tw-field ≥ 3（每平台三框）', twField >= 3, twField + ' 个');
ok('A2-② 每个字段都有 head（两行结构没被合并回一行）', twHead === twField && twHead >= 3, 'head=' + twHead + ' / field=' + twField);
const headHasBtn = /<view class="tw-field-head">[\s\S]{0,200}?<button class="btn-small paste-btn"/.test(inputWxml);
ok('A2-③ 粘贴按钮在 head 内（而非与金额框同层）', headHasBtn);

section('A3 · 前提护栏（防扫描面被改小而恒真）');
ok('A3-① val-input 实例数', valInstances >= MIN_VAL_INSTANCES, valInstances + ' 个（下界 ' + MIN_VAL_INSTANCES + '）');
ok('A3-② button 实例数', buttonInstances >= MIN_BUTTONS, buttonInstances + ' 个（下界 ' + MIN_BUTTONS + '）');
ok('A3-③ 空白输入下判定函数不抛异常且判无冲突', rowConflicts('').length === 0);

section('A4 · 正负样本互证（证明判定函数不是恒真 / 不误杀）');
const S_POS = '<view class="tw-field"><text class="tw-field-lbl">商品总价</text><input class="val-input" type="digit" /><button class="btn-small paste-btn">粘贴</button></view>';
const S_NEG = '<view class="tw-field"><view class="tw-field-head"><text class="tw-field-lbl">商品总价</text><button class="btn-small paste-btn">粘贴</button></view><input class="val-input" type="digit" /></view>';
ok('A4-① 正例（金额框与按钮同层）必判冲突', rowConflicts(S_POS).length === 1);
ok('A4-② 负例（两行结构）必判无冲突', rowConflicts(S_NEG).length === 0);
ok('A4-③ 无金额框的块不误报', rowConflicts('<view class="x"><button>a</button></view>').length === 0);
ok('A4-④ 非 val-input 的输入框与按钮同层不误杀（细项名 + 删除键是合法设计）',
  rowConflicts('<view class="sub-line1"><input class="sub-item-inp" /><button class="btn-del">×</button></view>').length === 0);
ok('A4-⑤ 注释里写的示例结构不计入判定', rowConflicts('<!-- <view class="tw-field"><input class="val-input" /><button>x</button></view> --><view></view>').length === 0);

console.log('\n==== 金额框同行守卫：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
