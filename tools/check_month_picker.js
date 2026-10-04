// tools/check_month_picker.js —— 【R209】月份选择器守卫（picker 下标 ≠ 值 / 历史月必须能选）
// 运行：node tools/check_month_picker.js
//
// ─────────────────────────────────────────────────────────────────────────────
// 【为什么要有这个守卫】R209 李老师真机反馈「月度盈利核算选月份只能选本月，选以前月份提示填写错误」。
//   查出来是个**纯前端类型 bug**，而且当时全站 13 处 selector picker 里只有这一处走漏：
//
//     pages/month/index.js::onMonthChange 旧实现：
//       const month = e.detail.value;          // ← selector 的 detail.value 是**下标数字**
//       this.loadMonth(month);                 // ← 于是 getLedger 收到 month = 0 / 1 / 2
//
//   后端 `getLedger/validate.js` 判 `typeof src.month !== 'string'` ⇒ INVALID_PARAM
//   ⇒ 前端 `api.toastError` 弹 ERR.INVALID_PARAM「填写有误，请检查后重试」。
//   用户看到的就是「一点月份就说填写有误」，而**本月**（页面刚进来 bootstrap 直接用
//   `ui.nowMonth()` 字符串拉的那次）是好的 ⇒ 观感完全等于「只能选本月」。
//
// 🔴 这一**不是产品限制**： Ελλ 后端对历史月份从来不设卡（本守卫 B 组实跑证明 '2026-09' 直接放行）。
//   错在那个偷懒的一行赋值。同族写法 recon/index.js 一直是对的（`Number(e.detail.value)` 取元素），
//   所以这里同时也是「同类写法不许再退化」的回归门。
//
// ─────────────────────────────────────────────────────────────────────────────
// 判据（fail-closed；读不到 / 解析不到 / 抽不出函数体一律判红，不许静默放行）：
//   S  扫描面护栏：目标文件在位、剥注释后达长度下界、全仓 picker 扫描面非退化（防扫空假绿，R182）。
//   A  根因修复（**实跑真函数体**：把 handler 抠出来用伪造 Page 上下文调用，判行为不判字面）：
//      选中下标 ⇒ 传出去的必须是 months[i] 字符串；重复选 / 越界 ⇒ 不许发起请求；picker 高亮要跟随。
//   B  后端口径实跑（require 生产 validate.js）：历史月放行（证明不是产品卡历史月）、数字拒、
//      月份越界拒、形态错拒。
//   C  全仓同类回归：所有 `picker mode="selector"` 的 bindchange handler 必须用下标取数组，
//      且月历页 handler 必须落在扫描面内（关键锚点在场）。
//   D  UI 一致：wxml 的 value 用 monthIndex 变量（不依赖 WXML 里的 `months.indexOf()` 表达式）。
//
// ⚠️ banner 一律不用 `===== x =====` 形态：R66 会做「段标题下零断言即判红」（R207 已踩过）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, failN = 0;
const ensure = (id, msg, cond, why) => {
  if (cond) { pass += 1; console.log('  ✅ ' + id + ' ' + msg); }
  else { failN += 1; console.log('  ❌ ' + id + ' ' + msg + (why ? ' —— ' + why : '')); }
};

function read(rel) {
  try {
    const p = path.join(ROOT, rel);
    const st = fs.statSync(p);
    return { text: fs.readFileSync(p, 'utf8'), bytes: st.size, ok: true };
  } catch (_) { return { text: '', bytes: 0, ok: false }; }
}
// 剥注释（带 `:` 前置判定，避免把 URL 当行注释；与本仓 R102/R117 同款实现）
function stripComment(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function walk(dir, out) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return out; }
  for (const n of names) {
    const p = path.join(dir, n);
    let st = null;
    try { st = fs.statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const MONTH_JS = 'pages/month/index.js';
const MONTH_WXML = 'pages/month/index.wxml';
const VALIDATE = 'cloudfunctions/getLedger/validate.js';

const F_MONTH_JS = read(MONTH_JS);
const F_MONTH_WXML = read(MONTH_WXML);
const CODE_MONTH_JS = stripComment(F_MONTH_JS.text);
const CODE_MONTH_WXML = F_MONTH_WXML.text;

console.log('R209 · 月份选择器守卫（picker 下标 ≠ 值 / 历史月必须能选 / 同类写法不许退化）');
console.log('目标 ' + MONTH_JS + ' / ' + MONTH_WXML + ' / ' + VALIDATE + ' / pages/**/*.wxml');

// ── 抽出 onMonthChange 真函数体 ──────────────────────────────────────────────
function extractFn(code, name) {
  const re = new RegExp('(?:async\\s+)?' + name + '\\s*\\(\\s*e\\s*\\)\\s*\\{');
  const m = re.exec(code);
  if (!m) return null;
  const start = m.index + m[0].length - 1;   // 指向 '{'
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') { depth -= 1; if (depth === 0) return code.slice(start, i + 1); }
  }
  return null;
}

const MONTH_BODY = extractFn(CODE_MONTH_JS, 'onMonthChange');

// 伪造 Page 上下文跑 handler（避免 require 整个页面 —— 顶部 getApp() 在 node 下必炸）
function runHandler(body, detailValue, months, curMonth) {
  const calls = { setData: [], loadMonth: [] };
  const ctx = {
    data: { months, monthIndex: 0, curMonth, t: {} },
    setData(patch) { calls.setData.push(patch); },
    loadMonth(m) { calls.loadMonth.push(m); return Promise.resolve(); },
  };
  let threw = null;
  try {
    const fn = new Function('e', body);       // body 是 `{ ... }` 块语句
    fn.call(ctx, { detail: { value: detailValue }, currentTarget: { dataset: {} } });
  } catch (e) { threw = e && e.message; }
  calls.threw = threw;
  return calls;
}

const MO_LIST = ['2026-10', '2026-09', '2026-08'];
const MO_CUR = '2026-10';

// ══ S 扫描面护栏 ══════════════════════════════════════════════════════════════
console.log('\nS · 扫描面护栏');
ensure('S-①', '四份目标文件在位（月历 js / wxml / 后端 validate / pages 目录）',
  F_MONTH_JS.ok && F_MONTH_WXML.ok && fs.existsSync(path.join(ROOT, VALIDATE)) && fs.existsSync(path.join(ROOT, 'pages')),
  '目标文件缺失 ⇒ 后续判据全是假绿');
ensure('S-②', '月历 js 剥注释后长度达下界（≥3000 字符，防读空）',
  CODE_MONTH_JS.length >= 3000, '实际 ' + CODE_MONTH_JS.length + ' 字符');
ensure('S-③', '能抽出 onMonthChange 函数体（抽不出 ⇒ 不许静默放行）',
  !!MONTH_BODY, '正则未命中函数定义');
const allWxml = walk(path.join(ROOT, 'pages'), []).filter((p) => p.endsWith('.wxml'));
ensure('S-④', '全仓 wxml 扫描面非退化（≥20 个文件，防扫空恒绿）',
  allWxml.length >= 20, '实际 ' + allWxml.length + ' 个 .wxml');

// ══ A 根因修复（实跑 handler） ════════════════════════════════════════════════
console.log('\nA · 根因修复（实跑抽取出的 handler，判行为不判字面）');
if (MONTH_BODY) {
  const r1 = runHandler(MONTH_BODY, 1, MO_LIST, MO_CUR);
  ensure('A-①', '选中下标 1 ⇒ 传给 loadMonth 的是 months[1]「2026-09」，不是数字 1',
    r1.loadMonth.length === 1 && r1.loadMonth[0] === '2026-09',
    '实际传参 ' + JSON.stringify(r1.loadMonth) + (r1.threw ? ' · 抛错 ' + r1.threw : ''));
  ensure('A-②', '传给 loadMonth 的值类型必须是 string（后端只认 YYYY-MM 字符串）',
    r1.loadMonth.length === 1 && typeof r1.loadMonth[0] === 'string',
    '实际类型 ' + (r1.loadMonth.length ? typeof r1.loadMonth[0] : '(未调用)'));
  const rSame = runHandler(MONTH_BODY, 0, MO_LIST, MO_CUR);
  ensure('A-③', '重复选中当前月 ⇒ 不发起请求（不重拉、不闪 loading）',
    rSame.loadMonth.length === 0, '实际调用 ' + rSame.loadMonth.length + ' 次');
  const rOob = runHandler(MONTH_BODY, 99, MO_LIST, MO_CUR);
  ensure('A-④', '越界下标 ⇒ 不发起请求（fail-closed，不许把 undefined 透给后端）',
    rOob.loadMonth.length === 0, '实际传参 ' + JSON.stringify(rOob.loadMonth));
  const anyIdx = r1.setData.filter((p) => p && typeof p.monthIndex === 'number');
  ensure('A-⑤', '会同步更新 monthIndex（picker 高亮跟随，不然再点开停在旧项）',
    anyIdx.length === 1 && anyIdx[0].monthIndex === 1,
    'setData=' + JSON.stringify(r1.setData));
} else {
  for (const id of ['A-①', 'A-②', 'A-③', 'A-④', 'A-⑤']) {
    ensure(id, '（依赖 A 前置：函数体未抽出）', false, 'handler 抽取失败');
  }
}

// ══ B 后端口径实跑 ════════════════════════════════════════════════════════════
console.log('\nB · 后端口径实跑（require 生产 getLedger/validate.js）');
let validateInput = null;
try { validateInput = require(path.join(ROOT, VALIDATE)).validateInput; } catch (e) { validateInput = null; }
if (validateInput) {
  const hist = validateInput({ shop_id: 's1', month: '2026-09' });
  ensure('B-①', '历史月份「2026-09」后端直接放行（证明产品从没限制选历史月）',
    hist && hist.error === null, 'error=' + (hist && hist.error));
  const num = validateInput({ shop_id: 's1', month: 1 });
  ensure('B-②', 'month 传数字 ⇒ INVALID_PARAM（这正是前端「填写有误」的来源）',
    num && num.error === 'INVALID_PARAM', 'error=' + (num && num.error));
  const oob = validateInput({ shop_id: 's1', month: '2026-13' });
  ensure('B-③', 'month「2026-13」越界 ⇒ 拒', oob && oob.error === 'INVALID_PARAM', 'error=' + (oob && oob.error));
  const bad = validateInput({ shop_id: 's1', month: '202609' });
  ensure('B-④', 'month「202609」形态错 ⇒ 拒', bad && bad.error === 'INVALID_PARAM', 'error=' + (bad && bad.error));
} else {
  for (const id of ['B-①', 'B-②', 'B-③', 'B-④']) {
    ensure(id, '（依赖 B 前置：require 失败）', false, '无法 require ' + VALIDATE);
  }
}

// ══ C 全仓同类回归 ════════════════════════════════════════════════════════════
console.log('\nC · 全仓同类回归（picker mode="selector" 的 handler 必须用下标取数组）');
const found = [];      // { file, handler }
for (const wxmlPath of allWxml) {
  const text = fs.readFileSync(wxmlPath, 'utf8');
  const re = /<picker\b[^>]*?>/gs;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tag = m[0];
    if (!/mode\s*=\s*"selector"/.test(tag)) continue;
    const h = /bindchange\s*=\s*"([A-Za-z0-9_]+)"/.exec(tag);
    if (!h) continue;
    found.push({ file: path.relative(ROOT, wxmlPath).replace(/\\/g, '/'), handler: h[1] });
  }
}
ensure('C-①', '扫描面非退化：命中 ≥10 个 selector picker（半仓扫描靠不住）',
  found.length >= 10, '实际命中 ' + found.length + ' 个');

const bad = [];
const jsCache = {};
for (const it of found) {
  const jsRel = it.file.replace(/\.wxml$/, '.js');
  if (!(jsRel in jsCache)) {
    const j = read(jsRel);
    jsCache[jsRel] = j.ok ? stripComment(j.text) : '';
  }
  const code = jsCache[jsRel];
  if (!code) { bad.push(it.file + '::' + it.handler + '（找不到同名 js）'); continue; }
  const body = extractFn(code, it.handler);
  if (!body) { bad.push(it.file + '::' + it.handler + '（抽不出函数体）'); continue; }
  // 🔴 判**行为形态**：必须先把 detail.value 转成下标再取数组元素。
  //    只写 `const month = e.detail.value` 直接往下传 = R209 那个 bug 的原形态。
  const usesIndex = /Number\(\s*e\.detail\.value\s*\)/.test(body)
    || /\[\s*(?:Number\(\s*)?e\.detail\.value\s*\)\s*\]/.test(body)
    || /\[\s*e\.detail\.value\s*\]/.test(body);
  if (!usesIndex) bad.push(it.file + '::' + it.handler);
}
ensure('C-②', '全部 ' + found.length + ' 处都用下标取数组元素（无裸传 detail.value）',
  bad.length === 0, '违规：' + bad.join(' / '));
ensure('C-③', '关键锚点在场：月历页的 onMonthChange 落在扫描面内（否则这条回归形同虚设）',
  found.some((x) => x.file === MONTH_WXML && x.handler === 'onMonthChange'),
  '扫描面里没有 ' + MONTH_WXML + ' 的 onMonthChange');

// ══ D UI 一致 ════════════════════════════════════════════════════════════════
console.log('\nD · UI 一致（picker 选中项不被 WXML 表达式绑架）');
const pickerTag = (/<picker\b[^>]*?bindchange\s*=\s*"onMonthChange"[^>]*?>/s.exec(CODE_MONTH_WXML) || [''])[0];
ensure('D-①', 'wxml 的 picker value 用 monthIndex 变量（不再写 months.indexOf(...) 表达式）',
  !!pickerTag && /value\s*=\s*"\{\{monthIndex\}\}"/.test(pickerTag),
  '实际：' + (pickerTag.slice(0, 120) || '(未找到 picker 标签)'));
ensure('D-②', 'js data 里声明 monthIndex 初值（picker 打开就有正确高亮）',
  /monthIndex:\s*0/.test(CODE_MONTH_JS), 'data 中缺 monthIndex 声明');

// ⚠️ 收尾行必须写成「N 通过 / M 失败」形态：R69 审计要求输出末行含「N 通过」，
//    写成「总览：18/18 全部通过」会被判「未走完收尾」而整套件判红（R209 首跑踩到）。
console.log('===== 月份选择器守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
