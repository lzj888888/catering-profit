// tools/check_wxkey_stable.js —— R606-bis：行级可编辑循环的稳定身份键 守卫
//
// 事故模型（R606 及其同族缺陷，每条都有"静默失效"路径）：
//
//   行级 `wx:for` 用 `wx:key="index"`（位置键）+ 每次按键 `setData` 整体重赋值数组
//   （`slice()`→改某下标→`setData({整个数组})`）⇒ 原生 `<input>` 按下标复用 DOM 节点
//   ⇒ 重渲染后节点身份错位 ⇒ 首行能填、下方行"填不进/丢焦点"。
//
//   R606（M1 外卖录入 month/input.wxml）是首个真事故；审计发现同族未修页面共 5 处对象数组循环：
//     · takeaway items/packs、card comboLines、card lines（wx:key="idx" 字面量更糟）、dishreview splitRows
//       —— 均为「对象数组 + 每按键整体重赋值」，机制与 R606 完全一致，已全部注入稳定 rid 键闭环。
//
//   ⚠️ matrix 五个维度档位（rent/labor/margin/target/other）曾一并改为对象包裹 [{v, rid}]，但经权威守卫
//   （check_m2_matrix.js / check_m2_partial_behavior.js 以标量 dims 调 onGenerate、云端 onGenerate 标量契约）
//   实测：标量档位在键入时按位更新（dims[dim][idx] = val），数组长度/顺序在键入过程中**不变**，
//   不会触发「节点身份错位/填不进」；对象化反而破坏既有标量契约。故 matrix 改回原始标量数组，
//   并在本守卫列入白名单（见 WHITELIST），仅作「非 R606 形态」的显式豁免；若 matrix 将来改为可重排/可增删行，须撤销此豁免。
//
// 判据（纯函数 + 正负互证 + 扫描面下界，对齐 check_list_ux.js 输出纪律）：
//   · 全仓扫描 *.wxml，凡是「含 <input>/<textarea> 的 wx:for 循环」不得用位置键 `index`/`idx`；
//   · 稳定键用渲染层专属的 `rid`（或既有业务主键）：重渲染节点身份恒定 ⇒ 输入框不再错位。
//   · 扫描面下界：wxml 文件数须 >= 20，否则 walk 失效会"0 文件 ⇒ 恒真假绿"。
//   · C1~C5 反恒真：喂坏样本必红、喂等价改写（wx:key="rid"）必绿。
//
// ⚠️ 输出纪律（R145 教训，同 check_list_ux.js）：中间行不得出现「N 通过 / M 失败」字样，
//   否则 check_suite_assert_counts 会把第一条中间文案当成套件总口径。

'use strict';
const fs = require('fs');
const path = require('path');

// ---------- 纯函数：从一段 wxml 抽取所有 wx:for 循环 ----------
function stripComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

// 找到某个 wx:for 标签对应的「闭合位置」（按同名标签深度匹配）
function findClose(src, openTag, fromPos) {
  const openRe = new RegExp('<' + openTag + '(?=[\\s/>])', 'g');
  const closeRe = new RegExp('</' + openTag + '>', 'g');
  let depth = 1;
  let idx = fromPos;
  const rest = src.slice(fromPos);
  while (idx < src.length) {
    const o = rest.indexOf('<' + openTag, idx - fromPos);
    const c = rest.indexOf('</' + openTag + '>', idx - fromPos);
    if (c === -1) return -1;
    if (o !== -1 && o < c) { idx = o + fromPos + openTag.length; depth++; }
    else {
      idx = c + fromPos + ('</' + openTag + '>').length; depth--;
      if (depth === 0) return idx;
    }
  }
  return -1;
}

function findLoops(src) {
  const loops = [];
  const re = /<(\w+)((?:[^>"']|"[^"]*"|'[^']*')*?)\s+wx:for\b\s*=\s*("[^"]*"|'[^']*')((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[1];
    const attrs = m[2] + m[4];
    const selfClose = m[5] === '/';
    const line = src.slice(0, m.index).split('\n').length;
    const km = attrs.match(/\bwx:key\s*=\s*("[^"]*"|'[^']*')/);
    const key = km ? km[1].slice(1, -1) : (/\bwx:key\b/.test(attrs) ? '(empty)' : '(none)');
    let body = '';
    const start = m.index + m[0].length;
    if (!selfClose) {
      const end = findClose(src, tag, start);
      body = end > start ? src.slice(start, end) : '';
    }
    loops.push({ tag, key, body, line, attrs, forExpr: m[3] });
  }
  return loops;
}

// 核心判据：给定 wxml 源码，返回所有「含输入的循环却用了位置键」的违规
function judgeWxml(src) {
  const clean = stripComments(src);
  const loops = findLoops(clean);
  const bad = [];
  for (const lp of loops) {
    const hasInput = /<input\b/.test(lp.body) || /<textarea\b/.test(lp.body);
    if (!hasInput) continue;
    const k = lp.key;
    if (k === 'index' || k === 'idx') {
      bad.push({ line: lp.line, tag: lp.tag, key: k });
    }
  }
  return bad;
}

// ---------- 影子样本自证（套件先验证自己的判据，再扫真实仓库）----------
let pass = 0;
let fail = 0;
function ok(name) { pass++; console.log('  ✅ ' + name); }
function bad(name, extra) { fail++; console.log('  ❌ ' + name + (extra ? ' （' + extra + '）' : '')); }

console.log('===== R606-bis wx:key 稳定性 守卫 · 影子样本自检 =====');

// C1 坏样本：位置键 + <input> ⇒ 必须判红
{
  const s1 = '<view wx:for="{{items}}" wx:key="index"><input value="{{item.q}}" /></view>';
  const r1 = judgeWxml(s1);
  r1.length === 1 && r1[0].key === 'index' ? ok('C1 影子样本「位置键 index + <input>」判红') : bad('C1 判据放过位置键循环（假绿）', JSON.stringify(r1));
}
// C2 好样本：R606 真实修法（wx:key="rid"）⇒ 必须判绿（不误杀等价改正）
{
  const s2 = '<view wx:for="{{items}}" wx:key="rid"><input value="{{item.q}}" /></view>';
  const r2 = judgeWxml(s2);
  r2.length === 0 ? ok('C2 影子样本「wx:key="rid" + <input>」判绿（等价改正不误杀）') : bad('C2 真实修法形态被判红', JSON.stringify(r2));
}
// C3 坏样本：字面量 "idx" 键（比 index 更糟，所有行同键）⇒ 必须判红
{
  const s3 = '<view wx:for="{{lines}}" wx:key="idx"><input value="{{item.v}}" /></view>';
  const r3 = judgeWxml(s3);
  r3.length === 1 && r3[0].key === 'idx' ? ok('C3 影子样本「字面量 idx 键 + <input>」判红') : bad('C3 判据放过字面量 idx 键（假绿）', JSON.stringify(r3));
}
// C4 好样本：循环里没有 <input> ⇒ 位置键也不报（不扩大打击面）
{
  const s4 = '<view wx:for="{{tags}}" wx:key="index"><text>{{item}}</text></view>';
  const r4 = judgeWxml(s4);
  r4.length === 0 ? ok('C4 影子样本「无 <input> 的位置键循环」判绿（不误伤静态列表）') : bad('C4 误伤无输入循环', JSON.stringify(r4));
}
// C5 好样本：注释里举例的错法（文档不是缺陷）⇒ 必须判绿（证明剥注释生效）
{
  const s5 = '<!-- 原式 wx:key="index" 已修 -->\n<view wx:for="{{items}}" wx:key="rid"><input value="{{item.q}}" /></view>';
  const r5 = judgeWxml(s5);
  r5.length === 0 ? ok('C5 影子样本「注释里的举例写法」判绿（剥注释生效，不误杀文档）') : bad('C5 把说明性注释判红了', JSON.stringify(r5));
}
// C6 坏样本：嵌套在循环体内的 <input> 也要抓到（真实 R606 形态：view 包 input）
{
  const s6 = '<view wx:for="{{rows}}" wx:key="index"><view class="row"><input value="{{rows[index].q}}" /></view></view>';
  const r6 = judgeWxml(s6);
  r6.length === 1 ? ok('C6 影子样本「循环体内嵌套 <input>」判红（子树抓取生效）') : bad('C6 漏抓嵌套 input', JSON.stringify(r6));
}

// ---------- 真实仓库扫描 ----------
console.log('\n===== R606-bis wx:key 稳定性 守卫 · 全仓扫描 =====');
const ROOT = path.resolve(__dirname, '..');
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (f === 'node_modules' || f === '.git') continue;
      walk(p, out);
    } else if (p.endsWith('.wxml')) {
      out.push(p);
    }
  }
}
const files = [];
walk(ROOT, files);
const MIN_FILES = 20; // 扫描面下界：低于即视为 walk 失效，fail-closed
if (files.length < MIN_FILES) {
  bad('扫描面下界：wxml 文件数 ' + files.length + ' < ' + MIN_FILES + '（walk 可能失效，拒绝假绿）');
} else {
  ok('扫描面下界：扫描 ' + files.length + ' 个 wxml 文件');
}

// ⚪ 白名单：明确「非 R606 形态」的已知位置键循环（经审计确认无需改）。
//   subpkg/tools/sandbox/matrix.wxml：五个维度档位为标量数组，编辑时按位更新（dims[dim][idx] = val），
//   数组长度/顺序在键入过程中不变 ⇒ 不会触发 R606「节点身份错位/填不进」；对象化包裹 {v, rid} 会破坏
//   M2 矩阵行为守卫（check_m2_matrix.js / check_m2_partial_behavior.js 以标量 dims 调 onGenerate）与
//   云端 onGenerate 标量契约 ⇒ 显式豁免，不误伤。若 matrix 将来改为可重排/可增删行，须撤销此豁免。
const WHITELIST = new Set([
  'subpkg/tools/sandbox/matrix.wxml',
]);
let skipped = [];

let violations = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (WHITELIST.has(rel)) { skipped.push(rel); continue; }
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  const bads = judgeWxml(src);
  for (const b of bads) {
    violations.push({ file: rel, line: b.line, key: b.key });
  }
}
for (const s of skipped) console.log('  ⚪ 白名单跳过：' + s + '（标量维度档位，位置键安全）');

// 锚点：R606 修复的 input.wxml 4 处 g.rows 必须 wx:key="rid"（回归锁）
{
  const f = path.join(ROOT, 'subpkg/biz/month/input.wxml');
  if (fs.existsSync(f)) {
    const src = fs.readFileSync(f, 'utf8');
    const clean = stripComments(src);
    const loops = findLoops(clean);
    // 只匹配「for 表达式本身就是 g.rows」的循环（不误伤外层遍历 g 分组的循环，其 body 内含 g.rows 子循环）
    const gRows = loops.filter((l) => l.forExpr && /g\.rows/.test(l.forExpr));
    const badRows = gRows.filter((l) => l.key !== 'rid');
    if (gRows.length === 0) bad('锚点缺失：input.wxml 未找到 g.rows 循环（R606 修复点漂移）');
    else if (badRows.length) bad('锚点回退：input.wxml 存在 g.rows 循环非 wx:key="rid"', JSON.stringify(badRows));
    else ok('锚点命中：input.wxml ' + gRows.length + ' 处 g.rows 循环均为 wx:key="rid"（R606 回归锁）');
  } else {
    bad('锚点文件缺失：subpkg/biz/month/input.wxml');
  }
}

if (violations.length) {
  console.log('\n⛔ 发现 ' + violations.length + ' 处「含输入的循环使用位置键」缺陷：');
  for (const v of violations) {
    console.log('   · ' + v.file + ':' + v.line + '  wx:key="' + v.key + '"');
  }
} else {
  console.log('\n✅ 全仓无「含输入的循环使用位置键」缺陷（R606 同族已闭环）');
}

const totalFail = fail + violations.length;
console.log('\n===== R606-bis wx:key 稳定性 守卫结果：' + pass + ' 通过 / ' + totalFail + ' 失败 =====');
process.exit(totalFail === 0 ? 0 : 1);
