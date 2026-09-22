/**
 * tools/check_takeaway_paste_cases.js —— 外卖账单「粘贴形态」用例表守卫（R120，round93）
 *
 * 根因（同族病第 24 例 · 静默算错钱第 3 例）：
 *   `extractPaste` 的合计护栏写在**行**上 —— `if (/合计|总计|total|小计/i.test(line)) { hasTotal = true; continue; }`
 *   只在「标签与金额同行」（Excel 常规复制 `合计⇥7140.00`）时生效。
 *   平台账单里**标签占一行、金额在下一行**的写法（`合计` ⏎ `7140.00`）护栏完全不触发 ⇒
 *   合计值被当普通明细加进求和：4380+2760+7140 = **14280（翻倍）**，而界面照旧提示「已提取并填入」。
 *   同一份账单换个写法就翻倍、且零告警 —— 与 R85 两例（`firstNumber` 截断 / 账期列被当金额）同一条链。
 *
 * 为什么这次不满足于点补丁（本条是立此守卫的理由）：
 *   前两例都只改了「一处正则」，所以第三例照旧复发。⇒ 本守卫把**账单形态**钉成用例表
 *   （`tools/paste_cases.js`，单源），此后任何对 extractPaste / pasteFillValue 的改动都必须让全表绿。
 *   新增形态只需往表里加一行，守卫自动覆盖。
 *
 * 判据（六段）：
 *   A0 前提护栏：用例表存在且条数 ≥24、B 组（换行合计）≥4、C 组（只有合计）≥3、E 组（边界）≥10
 *      —— 表被改小即转红（防「删用例换绿」）。
 *   A1 逐条实跑：pasteFillValue(extractPaste(input)) ≡ 期望 fill（全表必须零红）。
 *   A2 排除专项（根因判据）：含合计的用例必须 **numbers 不含 totalValue**，
 *      且 `totalValue` 确实被识别出来（≠null）—— 防「靠没认出合计来蒙对」。
 *   A3 兜底专项：只有合计 ⇒ pasteFilledFromTotal=true；无合计 ⇒ false（防兜底判断恒真/恒假）。
 *   A4 不可填边界：fill='' 的用例，pasteFillValue 与 pasteFilledFromTotal 必须**同时**为空/假
 *      （防「提示已填入但值为空」或「值为空却提示已填入」）。
 *   A5 页面接线：判据走 fill === ''（不再是 numbers.length === 0）、引用 pasteFilledFromTotal、
 *      映射 twPasteFromTotal、terms 双副本一致且新键非空。
 *
 * ⚠️ 坑（round92 立的纪律）：扫描/计数类判据**先剥注释再判** —— 本文件 A5 若裸扫，
 *   修复时我写在源码注释里的旧写法 `res.numbers.length === 0` 会把守卫自己判红（已实测）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { PASTE_CASES } = require('./paste_cases.js');
const tw = require('../utils/takeaway.js');

let pass = 0, fail = 0;
// ⚠️ 断言标记**必须**用 ✅/❌（R66 的 auditAssertions 靠这两个字符计数；
//   换成 [PASS]/[FAIL] 会被判「段标题下零断言」而整条套件转红 —— 本轮实测踩过）。
//   纪律的另一半：**消息正文里不得再出现 ✅/❌ 字面**（会污染计数），正文一律用文字描述。
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');
const readAbs = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥掉 JS 注释（保留字符串字面量）—— 扫描类判据必须先剥注释再判 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let quote = null;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += (c2 === undefined ? '' : c2); i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '/' && c2 === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && c2 === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

// ============ A0 前提护栏 ============
section('A0 前提护栏（用例表面宽 —— 被改小即转红）');
const byGroup = (g) => PASTE_CASES.filter((c) => String(c.id)[0] === g);
const gA = byGroup('A'), gB = byGroup('B'), gC = byGroup('C'), gD = byGroup('D'), gE = byGroup('E');
if (PASTE_CASES.length >= 24) ok('A0-①', `用例表 ${PASTE_CASES.length} 条 ≥ 24`);
else no('A0-①', `用例表仅 ${PASTE_CASES.length} 条 < 24 ⇒ 覆盖不足`);
if (gB.length >= 4) ok('A0-②', `B 组（换行合计，R120 主缺陷面）${gB.length} 条 ≥ 4`);
else no('A0-②', `B 组仅 ${gB.length} 条 < 4 ⇒ 主缺陷面覆盖不足`);
if (gC.length >= 3) ok('A0-③', `C 组（只有合计 → 兜底）${gC.length} 条 ≥ 3`);
else no('A0-③', `C 组仅 ${gC.length} 条 < 3 ⇒ 兜底面覆盖不足`);
if (gE.length >= 10) ok('A0-④', `E 组（误填/吞 0/非金额边界）${gE.length} 条 ≥ 10`);
else no('A0-④', `E 组仅 ${gE.length} 条 < 10 ⇒ 边界覆盖不足`);

// ============ A1 逐条实跑 ============
section('A1 逐条实跑（形态 → 期望填入值）');
let red = 0;
for (const c of PASTE_CASES) {
  let got;
  try { got = tw.pasteFillValue(tw.extractPaste(c.input)); }
  catch (e) { got = 'THROW:' + e.message; }
  if (got === c.fill) ok('A1-' + c.id, `${c.form} → ${JSON.stringify(got)}`);
  else { no('A1-' + c.id, `${c.form} 期望 ${JSON.stringify(c.fill)} 实测 ${JSON.stringify(got)}`); red++; }
}
if (red === 0) ok('A1-总', `${PASTE_CASES.length} 条全绿（零红）`);

// ============ A2 排除专项（根因判据）============
section('A2 排除专项（含合计的用例：numbers 不得含 totalValue，且 totalValue 须真被识别）');
const totalCases = PASTE_CASES.filter((c) => /合计|总计|total|小计/i.test(c.input));
if (totalCases.length >= 8) ok('A2-①', `含合计字样的用例 ${totalCases.length} 条 ≥ 8`);
else no('A2-①', `含合计字样的用例仅 ${totalCases.length} 条 < 8 ⇒ 根因面覆盖不足`);
for (const c of totalCases) {
  const res = tw.extractPaste(c.input);
  if (res.totalValue === null || res.totalValue === undefined) {
    // 允许：合计标签悬空且后面没有数字（E8/E9 类）——此时 numbers 里本就不该有它
    if (c.id === 'E8' || c.id === 'E9') { ok('A2-' + c.id, '合计标签无金额 ⇒ totalValue 允许为 null'); continue; }
    no('A2-' + c.id, `含合计却未识别出 totalValue（护栏没认出来，排除是蒙的）`);
    continue;
  }
  const contained = res.numbers.some((v) => Math.abs(Number(v) - Number(res.totalValue)) < 0.001);
  if (!contained) ok('A2-' + c.id, `numbers 已排除合计值 ${res.totalValue}（明细 ${JSON.stringify(res.numbers)}）`);
  else no('A2-' + c.id, `numbers 含合计值 ${res.totalValue} ⇒ 会重复计入（翻倍）`);
}

// ============ A3 兜底专项 ============
section('A3 兜底专项（也只有合计才兜底）');
for (const c of gC) {
  const res = tw.extractPaste(c.input);
  if (tw.pasteFilledFromTotal(res) === true) ok('A3-C-' + c.id, `${c.form} → 走合计兜底`);
  else no('A3-C-' + c.id, `${c.form} 应走合计兜底（number.length=0 但有合计值）`);
}
for (const c of gD) {
  const res = tw.extractPaste(c.input);
  if (tw.pasteFilledFromTotal(res) === false) ok('A3-D-' + c.id, `${c.form} → 正常明细求和（非兜底）`);
  else no('A3-D-' + c.id, `${c.form} 有明细却被判成合计兜底`);
}
// 反例互证：A 组（明细+同行合计）不得被判成兜底
for (const c of gA) {
  const res = tw.extractPaste(c.input);
  if (tw.pasteFilledFromTotal(res) === false) ok('A3-A-' + c.id, `${c.form} → 有明细，非兜底`);
  else no('A3-A-' + c.id, `${c.form} 有明细却被判成合计兜底 ⇒ 会漏掉确认弹窗`);
}

// ============ A4 不可填边界 ============
section('A4 不可填边界（值空 ⟺ 非兜底；不得「提示已填而值为空」）');
const emptyCases = PASTE_CASES.filter((c) => c.fill === '');
if (emptyCases.length >= 5) ok('A4-①', `不可填用例 ${emptyCases.length} 条 ≥ 5`);
else no('A4-①', `不可填用例仅 ${emptyCases.length} 条 < 5`);
for (const c of emptyCases) {
  const res = tw.extractPaste(c.input);
  const v = tw.pasteFillValue(res);
  const ft = tw.pasteFilledFromTotal(res);
  if (v === '' && ft === false) ok('A4-' + c.id, `${c.form} → 值空且非兜底（提示「未提取到数字」）`);
  else no('A4-' + c.id, `${c.form} 期望 值空+非兜底，实测 ${JSON.stringify(v)} / fromTotal=${ft}`);
}

// ============ A5 页面接线 ============
section('A5 页面接线与文案单源');
const inputJsRaw = readAbs('pages/month/input.js');
const inputJs = stripComments(inputJsRaw);   // ⚠️ 先剥注释：修复注释里就写着旧判据原文
if (/const fill = pasteFillValue\(res\);/.test(inputJs) && /if \(fill === ''\)/.test(inputJs))
  ok('A5-①', '判据走 fill === \'\'（「最终能不能填出值」）');
else no('A5-①', '页面判据未改为 fill === \'\'');
if (!/res\.numbers\.length === 0/.test(inputJs) && !/res\.numbers\.length\s*===\s*0/.test(inputJs))
  ok('A5-②', '页面不再用 numbers.length === 0 作判据');
else no('A5-②', '页面仍在用 numbers.length === 0（旧判据会把纯合计误判为未提取）');
if (/pasteFilledFromTotal\(res\)/.test(inputJs)) ok('A5-③', '页面引用 pasteFilledFromTotal');
else no('A5-③', '页面未引用 pasteFilledFromTotal');
if (/twPasteFromTotal: TERMS\.ledger\.takeawayMode\.pasteFromTotal,/.test(inputJs))
  ok('A5-④', '映射 twPasteFromTotal（合计兜底专用提示）');
else no('A5-④', '未映射 twPasteFromTotal');
if (/fromTotal \? TERMS\.ledger\.takeawayMode\.pasteFromTotal : TERMS\.ledger\.takeawayMode\.pasteDone/.test(inputJs))
  ok('A5-⑤', 'toast 按 fromTotal 分两种提示');
else no('A5-⑤', 'toast 未按 fromTotal 分流');
if (/if \(res\.hasTotal && !fromTotal\)/.test(inputJs))
  ok('A5-⑥', '确认弹窗只在「有明细+有合计」时触发（纯兜底不再多问一次）');
else no('A5-⑥', '确认弹窗触发条件未收紧');

const t1 = readAbs('miniprogram/i18n/terms.js');
const t2 = readAbs('specs/dev-specs/i18n/terms.js');
if (t1 === t2) ok('A5-⑦', 'terms 双副本逐字节一致');
else no('A5-⑦', 'terms 双副本不一致');
const T = require('../miniprogram/i18n/terms.js');
const tm = T.TERMS.ledger.takeawayMode;
if (typeof tm.pasteFromTotal === 'string' && tm.pasteFromTotal.length > 0)
  ok('A5-⑧', `pasteFromTotal 非空：${tm.pasteFromTotal}`);
else no('A5-⑧', 'pasteFromTotal 缺失或为空');
if (tm.pasteEmpty && tm.pasteDone && tm.pasteConfirmBody)
  ok('A5-⑨', 'pasteEmpty / pasteDone / pasteConfirmBody 三键仍在（未被误删）');
else no('A5-⑨', '既有粘贴文案键缺失');

// ============ A6 前提证明（用例真的能区分对错）============
section('A6 前提证明（B/C 组用例对旧实现必须转红 —— 证明本表非恒真）');
// B 组：期望值必须 ≠「把所有数字都加起来」的值（旧实现的输出）
let discriminative = 0;
for (const c of gB) {
  const all = (c.input.match(/-?\d{1,3}(?:,\d{3})+|-?\d+(?:\.\d+)?/g) || [])
    .map((s) => Number(s.replace(/,/g, '')))
    .filter((v) => Number.isFinite(v));
  const allSum = all.reduce((s, v) => s + v, 0).toFixed(2);
  if (allSum !== c.fill) discriminative++;
  else no('A6-' + c.id, `${c.form}：期望值恰等于「所有数字求和」⇒ 该用例无法区分新旧实现`);
}
if (discriminative === gB.length) ok('A6-①', `B 组 ${gB.length} 条全部可与「全数字求和」区分（旧实现必转红）`);
// C 组：旧实现输出空串 ⇒ 期望值必须非空（天然可区分）
const cDisc = gC.filter((c) => tw.pasteFillValue(tw.extractPaste(c.input)) === c.fill && c.fill !== '').length;
if (cDisc === gC.length) ok('A6-②', `C 组 ${gC.length} 条期望值均非空（旧实现输出空串，必转红）`);
else no('A6-②', `C 组有 ${gC.length - cDisc} 条无法区分旧实现`);

console.log(`\n===== 外卖粘贴形态用例表守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
