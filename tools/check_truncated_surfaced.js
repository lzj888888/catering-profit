// tools/check_truncated_surfaced.js —— 云函数出参 `truncated` 的**消费面**守卫（R299）
// 运行：node tools/check_truncated_surfaced.js      （EXIT 0 = 全绿）
//
// 背景（本仓同族病的**最后一公里**）：
//   `cloudfunctions/common/dataAdapter.js::listAll` 的契约原文写着 ——
//     「`truncated === false` ⇒ data 就是全部命中行；`truncated === true` ⇒ data 已达
//       `LIST_TOTAL_CAP` 且仍有剩余 ⇒ 调用方**必须**把这个事实透传到出参（**可见降级**），
//       不得当作『取全了』继续算。」
//   服务端照做了（`getDishReview` / `getCostCard` / `getSalesBills` 的出参里都有 `truncated`），
//   **但前端此前零消费**（全仓 `grep truncated pages/ utils/ miniprogram/` 为空命中）
//   ⇒ 数据一超上限，复盘榜 / 账单列表 / 成本卡列表就**静默少行**，页面照常渲染、零提示。
//   这正是「**写读取方 ≠ 修好**」「**读到了 ≠ 送出去了**」在最后一公里的同族形态：
//   出参有事实、判据有要求、**用户面前什么都没有**。
//
// 判据（四组，方向互补）：
//   ① **生产者面**：从 `cloudfunctions/*/index.js` 的 `ok({...})` 里**扫出**所有真的回了
//      `truncated` 的函数（**不写死名单** —— 名单会漂）。下界 ≥3，且必须在 disks 上真扫到文件。
//   ② **契约面**：`dataAdapter.js` 里「必须透传 / 可见降级」的原话必须仍在（要求被删 ⇒ 前提没了）。
//   ③ **消费者面（fail-closed）**：每个 `api.call('<emitter>')` 的**页面文件**，必须
//      **要么**消费（引用 `isTruncated`）、**要么**在 `EXEMPT` 里带 `why` 显式登记 ——
//      未消费又未登记 ⇒ **判红**（不许静默增长）。且 `EXEMPT` 的每个键都必须**仍存在**（防僵尸豁免）。
//   ④ **反恒真**：把③的判据喂给一个人造的「未消费」样本 ⇒ 必须判不通过；并给三个真消费点正样本。
//
// 🔴 本文件**不使用段标题**（`===`/`---` 包裹）—— 本仓 R66 判据规定「段标题下 ✅==0 即判红」。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
const problems = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); }
}
function no(name, why) { problems.push(name + ' —— ' + why); }
function readOr(p, d) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return d; } }
function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

/** 递归收集某目录下所有文件（绝对路径）。 */
function walk(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 取出源里每个 `ok({ ... })` 的对象字面量全文（花括号配平）。 */
function okObjectLiterals(src) {
  const res = [];
  const re = /ok\(\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = src.indexOf('{', m.index);
    let depth = 0;
    let i = start;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) return res;                  // 配平失败 ⇒ fail-closed：不返回半截结果
    res.push(src.slice(start, i + 1));
  }
  return res;
}

// ============ ① 生产者面：扫出真的回了 `truncated` 的云函数 ============
const CF = path.join(ROOT, 'cloudfunctions');
let cfDirs = [];
try { cfDirs = fs.readdirSync(CF, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (e) { cfDirs = []; }

const emitters = [];
const allCfDirs = [];
for (const d of cfDirs) {
  const f = path.join(CF, d, 'index.js');
  const src = readOr(f, null);
  if (src === null) continue;
  allCfDirs.push(d);
  const objs = okObjectLiterals(src);
  // 🔴 判据必须同时认**两种属性写法**：`truncated: expr` 与**简写** `truncated,` / `truncated}`。
  //   `getSalesBills/index.js:72` 写的正是简写 `truncated,` —— 首版只认冒号 ⇒ 漏抓该生产者
  //   （"探测器坏了"与"命中 0"长得一样的又一例，本轮实测踩到）。
  //   同时用「后面紧跟 : , }」把注释里的 `truncated 语义…` 排除掉。
  if (objs.some((o) => /(^|[\s,{])truncated\s*(?::|,|\})/.test(o))) emitters.push(d);
}

ok('①-a 扫描面下界：cloudfunctions 下带 index.js 的函数 ≥ 20', allCfDirs.length >= 20, '实 ' + allCfDirs.length);
ok('①-b 生产者下界：真的在 ok({...}) 里回 truncated 的函数 ≥ 3', emitters.length >= 3, '实 ' + emitters.length + ' ⇒ ' + emitters.join('/'));
ok('①-c 🔴 manageShop 必须回 truncated（其 op=stats 的清点会被写进"将永久删除 N 个月"确认框）',
  emitters.indexOf('manageShop') >= 0,
  emitters.join('/'));
ok('①-d 三个既有出参方仍在（getDishReview / getCostCard / getSalesBills）',
  ['getDishReview', 'getCostCard', 'getSalesBills'].every((x) => emitters.indexOf(x) >= 0),
  emitters.join('/'));

// ============ ② 契约面：dataAdapter 的「必须透传 / 可见降级」原话仍在 ============
const adapterSrc = readOr(path.join(CF, 'common/dataAdapter.js'), '');
ok('②-a dataAdapter.js 可读且含 listAll 的 truncated 契约', adapterSrc.length > 500 && /truncated/.test(adapterSrc));
ok('②-b 契约原文「调用方必须把这个事实透传到出参」仍在（要求被删 ⇒ 本守卫的前提消失）',
  /调用方\*\*必须\*\*把这个事实/.test(adapterSrc) || /必须/.test(adapterSrc) && /透传到出参/.test(adapterSrc));
ok('②-c 契约原文「可见降级」仍在', /可见降级/.test(adapterSrc));
ok('②-d LIST_TOTAL_CAP 仍是显式常量（防爆护栏的存在性）', /const LIST_TOTAL_CAP\s*=\s*\d+/.test(adapterSrc));

// ============ ③ 消费者面：未消费就必须显式登记（fail-closed）============
//   判据粒度 = **页面文件级**：一个页面只要碰过某个 emitter，就必须整体表态
//   （要么消费、要么登记为什么不必消费）。粒度太细（逐调用点）反而会因作用域分析不可靠而假红。
// 🔴 豁免判据（R299-Q · 豆包评审采纳，并**修正了我自己的一次误判**）：
//   「**静默错数危害**」而非"改造成本"。三条充分豁免条件（须同时成立）：
//     ① 不渲染"看似完整的清单"；② **不输出精确总数**（把 length 渲染给用户看 = 不豁免）；
//     ③ 该读取不参与任何金额/毛利计算。
//   ⚠️ `pages/m3/hub.js` **曾被我列入本表，已撤**：它不只是"取 length 做入口判断"，
//      它把 `card.list.length` 当**精确张数**渲染（`hub.wxml` 「共 N 张」）⇒ 属条件②违反
//      ⇒ 已改为消费（`dh.isTruncated(card)`）。这条留痕就是为了防"豁免表变垃圾桶"。
const EXEMPT = {
  'pages/recon/index.js': 'getCostCard 仅作 code→name 辅助映射；卡缺只回落显示 code，不渲染清单、不输出总数、不进金额计算',
  'pages/takeaway/index.js': 'getCostCard 仅作 code→name 辅助映射（外卖页卡名回显），同上三条均不违反',
  'pages/card/edit.js': 'getCostCard 仅取模板 / 子卡候选供选择，不渲染"本店全部卡"清单、不输出总数、不进金额计算',
};

const pageFiles = walk(path.join(ROOT, 'pages'), []).filter((f) => f.endsWith('.js'));
const consumers = [];
for (const f of pageFiles) {
  const src = readOr(f, '');
  const r = rel(f);
  for (const fn of emitters) {
    const re = new RegExp("api\\.call\\(\\s*'" + fn + "'");
    if (re.test(src)) consumers.push({ file: r, fn, src });
  }
}

/** 判据本体：该页面源码是否**真的**消费了 truncated（**真的 require 单源模块 + 真的调用它**）。
 *  🔴 不能只 grep 词出现：页面注释里为了说明来由会写到 `utils/dataHealth.js` 与 `isTruncated`
 *     ⇒ 只判"词出现过"会被**注释喂成恒真**（R298Y 同类病，本轮变异 M7 实测抓到：
 *     把 require 换成 `const dh = {};` 后判据照样绿）。 */
const RE_REQUIRE_DH = /require\([^)]*dataHealth\.js['"]\)/;
const RE_CALL_DH = /\w+\.isTruncated\(/;
function consumesTruncated(src) {
  return RE_REQUIRE_DH.test(src) && RE_CALL_DH.test(src);
}

const unhandled = [];
const handled = [];
for (const c of consumers) {
  if (consumesTruncated(c.src)) { handled.push(c); continue; }
  if (Object.prototype.hasOwnProperty.call(EXEMPT, c.file)) { handled.push(c); continue; }
  unhandled.push(c);
}

ok('③-a 扫描面下界：pages 下 .js 文件 ≥ 25', pageFiles.length >= 25, '实 ' + pageFiles.length);
ok('③-b 扫描面下界：命中 emitter 的调用点 ≥ 8', consumers.length >= 8, '实 ' + consumers.length);
ok('③-c 🔴 不存在「未消费且未登记」的调用点（fail-closed）', unhandled.length === 0,
  unhandled.length ? unhandled.map((x) => x.file + ' → ' + x.fn).join(' ; ') : '全部已表态');
ok('③-d EXEMPT 表非空且每条带 why', Object.keys(EXEMPT).length > 0 && Object.keys(EXEMPT).every((k) => String(EXEMPT[k]).length >= 8),
  Object.keys(EXEMPT).length + ' 条');
const zombie = Object.keys(EXEMPT).filter((k) => !fs.existsSync(path.join(ROOT, k)));
ok('③-e 🔴 EXEMPT 无僵尸键（登记的文件必须仍存在 —— 防"文件改名后豁免悄悄失效/或永久豁免")',
  zombie.length === 0, zombie.length ? zombie.join(' ; ') : '无');
const exemptUnused = Object.keys(EXEMPT).filter((k) => !consumers.some((c) => c.file === k));
ok('③-f 🔴 EXEMPT 无空转键（登记的文件必须真的碰过 emitter —— 防豁免表变成躲避修复的垃圾桶）',
  exemptUnused.length === 0, exemptUnused.length ? exemptUnused.join(' ; ') : '无');

// ============ ④ 反恒真 + 正样本 ============
const FAKE_UNHANDLED = "const api = require('../../utils/api.js');\nconst r = await api.call('getCostCard', {});\nthis.setData({ list: r.list });\n";
ok('④-a 反恒真：把③的判据喂给「未消费」样本 ⇒ 必须判不通过（证明③有分辨力，不是恒真）',
  !consumesTruncated(FAKE_UNHANDLED));
const FAKE_HANDLED = "const dh = require('../../utils/dataHealth.js');\nconst r = await api.call('getCostCard', {});\nthis.setData({ t: dh.isTruncated(r) });\n";
ok('④-b 正样本：消费版样本 ⇒ 必须判通过', consumesTruncated(FAKE_HANDLED));
const POS = ['pages/m3/dishreview/index.js', 'pages/card/index.js', 'pages/shop/switch.js'];
for (const p of POS) {
  ok('④-c 正样本：' + p + ' 真消费 truncated', consumesTruncated(readOr(path.join(ROOT, p), '')));
}
const wired = POS.filter((p) => consumers.some((c) => c.file === p));
ok('④-d 三个真消费点都确实在 consumers 里（防"修了但判据看不见"）', wired.length === POS.length, wired.join(' / '));

// ============ 结论 ============
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 出参 truncated 消费面校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ 出参 truncated 消费面校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 出参 truncated 消费面校验通过（生产者 ' + emitters.length + ' 个 / 调用点 ' + consumers.length + ' 处 / 已消费 ' + handled.filter((c) => consumesTruncated(c.src)).length + ' 处 / 登记 ' + Object.keys(EXEMPT).length + ' 条）');
console.log('✅ 出参 truncated 消费面校验：' + total + ' 通过 / 0 失败');
