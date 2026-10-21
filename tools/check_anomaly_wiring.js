#!/usr/bin/env node
// tools/check_anomaly_wiring.js —— 异常核对清单「页面接线」守卫（R399 · 队列 #16）
//
// 为什么必须机器守（这个缺口有多大）：
//   R396 写好了规则层 `utils/anomalyRules.js`（47 条自测全绿），但**全仓零生产调用** ——
//   规则再对，老板在页面上看不到，等于零价值。这与 R124（术语键引用即存在）同族：
//   **判据存在 ≠ 判据被调用**。而接线这一层的失败方式全是静默的：
//     · 谁把页面里的 require 删了（或注释掉）⇒ 卡片不渲染，不报错；
//     · 谁把 `buildChecklist` 的调用挪到别处、或改成注释 ⇒ 同上；
//     · 谁把目标月快照改成**重新拼一个对象**（而不是用 getLedger 的出参）⇒ 规则层认不出字段，
//       清单恒空 —— 全绿但零输出（R298Y「读到了 ≠ 送出去了」的同型）。
//
// 判据（四条腿，方向不同、缺一不可）：
//   ① **真 require**：页面**剥注释后**真的 `require('utils/anomalyRules.js')` 并绑定到变量。
//   ② **真调用**：`<var>.buildChecklist(` 必须出现在 `loadChecklist` 的**函数体内**；
//      且 `loadChecklist` 必须被 `load()` **函数体内**真调用（不是注释里提一句）。
//      ⚠️ 本仓踩过两种恒真：全文 grep 词出现（注释喂绿，R299 恒真③）、以及键错地方（同文件别处有同名模式）。
//      ⇒ 判据必须锚到**目标函数体**，且对象是**剥注释后**的源码。
//   ③ **契约面**：`toSnapshot` 读的每一个字段，`getLedger` 的出参必须真的产出
//      —— 集合关系是「toSnapshot 的需求集 ⊆ getLedger 的产出集」。两边都从源码里**抽**，不手抄清单。
//      这是 ③ 的核心：手抄清单会在某次改名后静默失效（本仓「细项名当机器键」的老病）。
//   ④ **反恒真**：喂两段合成样本证明判据本身不成立 ——
//      ① 注释里写着 require/调用 ⇒ 判否；② 删掉 load() 里的真调用 ⇒ 判否；③ 删掉 require ⇒ 判否。
//      没有这一条，`stripComments` 写坏（例如把字符串也剥掉）时全部判据会一起恒真。
//
// ⚠️ 本文件**不用正则**（本机环境会把反斜杠转成斜杠，落盘即语法错）—— 一律 indexOf + 切片。
//
// 运行：node tools/check_anomaly_wiring.js   （由 verify_all.js 的 [anomaly-wiring] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = 'subpkg/biz/month/result.js';
const WXML = 'subpkg/biz/month/result.wxml';
const RULES = 'utils/anomalyRules.js';
const LEDGER = 'cloudfunctions/getLedger/index.js';

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); return true; }
  problems.push(name + (detail ? '：' + detail : ''));
  console.log('❌ ' + name + (detail ? '：' + detail : ''));
  return false;
}

// ================= 基础工具（全部 indexOf / 切片，无正则） =================

/** 去掉 `//` 与块注释，**保留字符串内容**（接线面要判 require 的字面量；注释必须剥掉防恒真）。 */
function stripComments(src) {
  const s = String(src == null ? '' : src);
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charAt(i);
    const c2 = i + 1 < n ? s.charAt(i + 1) : '';
    if (c === '/' && c2 === '/') {
      while (i < n && s.charAt(i) !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(s.charAt(i) === '*' && s.charAt(i + 1) === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const d = s.charAt(i);
        out += d;
        i++;
        if (d === '\\') { if (i < n) { out += s.charAt(i); i++; } continue; }
        if (d === quote) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 从 `openIdx`（必须指向 `{`）起做花括号配平，返回含首尾括号的整块；失败 ⇒ ''。 */
function bracesFrom(s, openIdx) {
  if (openIdx < 0) return '';
  let i = openIdx;
  let depth = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < s.length) {
        const d = s.charAt(i);
        if (d === '\\') { i += 2; continue; }
        i++;
        if (d === quote) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(openIdx, i + 1); }
    i++;
  }
  return '';
}

/**
 * 取**函数定义体**：只认 `name(` 且**前一个字符不是 `.`**（排除 `this.name(` 这类调用），
 * 并且 `{` 必须出现在下一个 `;` 之前（否则那是"调用 + 后面别处的块"）。
 * 🔴 R299 实测教训：只按 `name(` 找首个出现位置会锚到**调用点**，函数体窗口整段错位 ⇒ 判据全假。
 */
function defBodyOf(src, name) {
  const s = String(src || '');
  let i = 0;
  while (i < s.length) {
    const k = s.indexOf(name + '(', i);
    if (k < 0) return '';
    const prev = k > 0 ? s.charAt(k - 1) : '';
    if (prev !== '.') {
      const brace = s.indexOf('{', k);
      const semi = s.indexOf(';', k);
      if (brace >= 0 && (semi < 0 || brace < semi)) return bracesFrom(s, brace);
    }
    i = k + name.length;
  }
  return '';
}

/** 取某函数**定义体**（`name(` → 与第一个 `{` 配平的 `}`）。找不到 ⇒ ''（调用方据此判红）。 */
function bodyOf(src, name) {
  const s = String(src || '');
  const k = s.indexOf(name + '(');
  if (k < 0) return '';
  let i = s.indexOf('{', k);
  if (i < 0) return '';
  let depth = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charAt(i);
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        const d = s.charAt(i);
        if (d === '\\') { i += 2; continue; }
        i++;
        if (d === quote) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(k, i + 1); }
    i++;
  }
  return '';
}

/**
 * 取函数**定义签名**的第一个形参名（只认简单标识符；拿不到 ⇒ ''）。
 * 🔴 不能从函数体里找第一个 `(` —— 那会落到函数体第一处 `if (`，得到空名（本轮实测踩到）。
 */
function firstParamOfDef(src, name) {
  const s = String(src || '');
  let i = 0;
  while (i < s.length) {
    const k = s.indexOf(name + '(', i);
    if (k < 0) return '';
    const prev = k > 0 ? s.charAt(k - 1) : '';
    if (prev !== '.') {
      const close = s.indexOf(')', k);
      if (close > k) {
        const inner = s.slice(k + name.length + 1, close).trim();
        const first = inner.split(',')[0].trim();
        let isSimple = first.length > 0;
        for (let j = 0; j < first.length; j++) {
          const c = first.charAt(j);
          const isWord = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_';
          if (!isWord) { isSimple = false; break; }
        }
        if (isSimple) return first;
      }
    }
    i = k + name.length;
  }
  return '';
}

/** 收集 `prefix` 之后紧跟的标识符（如 `ledger.` → month / account_id …）。 */
function keysAfter(text, prefix) {
  const out = [];
  const s = String(text || '');
  let i = 0;
  while (i < s.length) {
    const k = s.indexOf(prefix, i);
    if (k < 0) break;
    // 🔴 词边界：`r.` 不能命中 `ledger.` 里的那个 r（实测把这五个顶层字段误当 result 内字段）
    const before = k > 0 ? s.charAt(k - 1) : '';
    const isWordBefore = (before >= 'a' && before <= 'z') || (before >= 'A' && before <= 'Z')
      || (before >= '0' && before <= '9') || before === '_' || before === '.';
    if (isWordBefore) { i = k + prefix.length; continue; }
    let j = k + prefix.length;
    let key = '';
    while (j < s.length) {
      const c = s.charAt(j);
      const isWord = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_';
      if (!isWord) break;
      key += c; j++;
    }
    if (key) out.push(key);
    i = k + prefix.length;
  }
  return out;
}
function uniq(arr) {
  const seen = {};
  const out = [];
  for (const x of arr) { if (!seen[x]) { seen[x] = 1; out.push(x); } }
  return out;
}

// ================= 判据（写成可复用函数，供 D 段反恒真复用） =================

/** ① 真 require：剥注释后出现 `= require('…utils/anomalyRules.js')`，返回绑定的变量名或 ''。 */
function requireVarOf(src) {
  const s = stripComments(src);
  const needle = "utils/anomalyRules.js')";
  const k = s.indexOf(needle);
  if (k < 0) return '';
  // 往回收 「const NAME = require('」这一行
  const lineStart = s.lastIndexOf('\n', k) + 1;
  const line = s.slice(lineStart, k + needle.length);
  const eq = line.indexOf('= require(');
  if (eq < 0) return '';
  const head = line.slice(0, eq).trim();
  const parts = head.split(' ');
  return parts.length ? parts[parts.length - 1] : '';
}

/** ② 真调用：`<var>.buildChecklist(` 必须落在 `loadChecklist` 函数体内。 */
function callInLoadChecklist(src, varName) {
  const s = stripComments(src);
  const body = defBodyOf(s, 'loadChecklist');
  if (!body) return false;
  return body.indexOf(varName + '.buildChecklist(') >= 0;
}

/** ② 上游：`this.loadChecklist(` 必须落在 `load()` 函数体内。 */
function callerInLoad(src) {
  const s = stripComments(src);
  const body = defBodyOf(s, 'load');
  if (!body) return false;
  return body.indexOf('this.loadChecklist(') >= 0;
}

// ================= 读取文件 =================
function read(rel) {
  const p = path.join(ROOT, rel.split('/').join(path.sep));
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

const pageSrc = read(PAGE);
const wxmlSrc = read(WXML);
const rulesSrc = read(RULES);
const ledgerSrc = read(LEDGER);

// ================= ① 真 require =================
const varName = requireVarOf(pageSrc);
ok('① 页面真 require 规则层（剥注释后）', !!varName, varName ? '变量 ' + varName : '未找到 require 绑定');
ok('①-b 绑定变量不是全局残留（长度 ≥2）', varName.length >= 2, varName);

// ================= ② 真调用（函数体内锚定） =================
ok('②-a buildChecklist 真调用在 loadChecklist 函数体内',
  !!varName && callInLoadChecklist(pageSrc, varName));
ok('②-b loadChecklist 被 load() 真调用（函数体内，非注释）', callerInLoad(pageSrc));

const lcBody = stripComments(defBodyOf(stripComments(pageSrc), 'loadChecklist'));
ok('②-c loadChecklist 体内有 getMonthList 取数', lcBody.indexOf("api.call('getMonthList'") >= 0);
ok('②-d loadChecklist 体内有逐月 getLedger 取数', lcBody.indexOf("api.call('getLedger'") >= 0);
const curParam = firstParamOfDef(stripComments(pageSrc), 'loadChecklist');
ok('②-e loadChecklist 有形参（目标月快照）', curParam.length > 0, curParam);
// 🔴 目标月必须**直接**用本页 getLedger 出参（`[curLedger]` 或 `push(curLedger)`）。
//   若改成重新拼 `{ month, income_items… }`，规则层 toSnapshot 认不出 ⇒ 清单恒空而门禁全绿（R298Y 同型）。
ok('②-f 目标月快照来自本页 getLedger 出参（不是重拼对象）',
  curParam.length > 0 && (lcBody.indexOf('[' + curParam + ']') >= 0 || lcBody.indexOf('.push(' + curParam + ')') >= 0),
  curParam);

// ================= ③ 契约面：toSnapshot 需求集 ⊆ getLedger 产出集 =================
const snapFn = bodyOf(stripComments(rulesSrc), 'toSnapshot');
ok('③-a 能从规则层抽到 toSnapshot', snapFn.length > 0);
const ledgerReq = uniq(keysAfter(snapFn, 'ledger.')).filter((k) => k !== 'result');
const aliasReq = uniq(keysAfter(snapFn, 'r.')).filter((k) => k !== 'result');
ok('③-b 需求集非空（自失效护栏：抽空即判红）', ledgerReq.length >= 4 && aliasReq.length >= 1,
  'ledger=' + ledgerReq.join(',') + ' | alias=' + aliasReq.join(','));

const okAt = ledgerSrc.indexOf('return ok({');
let okBlock = '';
if (okAt >= 0) {
  const braceAt = ledgerSrc.indexOf('{', okAt);
  let i = braceAt;
  let depth = 0;
  while (i >= 0 && i < ledgerSrc.length) {
    const c = ledgerSrc.charAt(i);
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { okBlock = ledgerSrc.slice(braceAt, i + 1); break; } }
    i++;
  }
}
ok('③-c 能从 getLedger 抽出 ok({...}) 出参块', okBlock.length > 0);
const ridx = okBlock.indexOf('result: {');
let resultBlock = '';
if (ridx >= 0) {
  const rs = okBlock.indexOf('{', ridx);
  let i = rs;
  let depth = 0;
  while (i >= 0 && i < okBlock.length) {
    const c = okBlock.charAt(i);
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { resultBlock = okBlock.slice(rs, i + 1); break; } }
    i++;
  }
}
ok('③-d 能从出参里抽出 result{} 子块', resultBlock.length > 0);

const missTop = ledgerReq.filter((k) => okBlock.indexOf(k + ':') < 0);
ok('③-e toSnapshot 读的每个顶层字段，getLedger 都产出', missTop.length === 0, '缺：' + missTop.join(','));
const missNest = aliasReq.filter((k) => resultBlock.indexOf(k + ':') < 0);
ok('③-f toSnapshot 读的每个 result 内字段，getLedger 都产出', missNest.length === 0, '缺：' + missNest.join(','));

// ================= 页面渲染面 =================
ok('④-a wxml 有清单卡且以 anom.has 为渲染条件',
  wxmlSrc.indexOf('{{anom.has}}') >= 0 && wxmlSrc.indexOf('{{t.anomTitle}}') >= 0);
ok('④-b wxml 有「没有异常也要说一句」的空态出口', wxmlSrc.indexOf('{{anom.emptyText}}') >= 0);
// 页面 JS 的 t 映射必须齐（WXML 用的每个 t.anom* 都要在页面 t 里有）——精确面由 check_page_terms 守，
// 这里只守「整组没漏」（漏整组会让卡片显示空白标题，而 check_page_terms 只在 wxml 引用处报）
const tAt = stripComments(pageSrc).indexOf('t: {');
const tBlock = bracesFrom(stripComments(pageSrc), stripComments(pageSrc).indexOf('{', tAt));
const anomTerms = ['anomTitle', 'anomSub', 'anomBasis', 'anomEmpty', 'anomMore', 'anomGo',
  'anomUp', 'anomDown', 'anomMissing', 'anomNew', 'anomMarginUp', 'anomMarginLow', 'anomHighTag'];
const missTerm = anomTerms.filter((k) => tBlock.indexOf(k + ':') < 0);
ok('④-c 页面 t 映射补齐 13 条清单文案', missTerm.length === 0, '缺：' + missTerm.join(','));

// ================= ⑤ 反恒真（判据自己成不成立） =================
// 样本 1：注释里写着 require + 调用 ⇒ 判据必须判否（证明 stripComments 真的在起作用）
const fake = "// const anomaly = require('../../utils/anomalyRules.js')\n"
  + 'function loadChecklist(curLedger) { /* anomaly.buildChecklist({}); api.call(\'getLedger\'); */ }\n'
  + 'function load() { /* this.loadChecklist(d); */ }\n';
ok('⑤-a 反恒真：注释里的 require/调用一律判否',
  requireVarOf(fake) === '' && callerInLoad(fake) === false);

// 样本 2：用**合成样本**跑判据的正反两支 —— 证明 `callerInLoad` 既会判真也会判假。
//   ⚠️ 不对真页面做字符串手术：一旦有人把调用改个空格（`this.loadChecklist( d )`），
//   手术会「找不到锚点」而误红；反恒真要证的是**判据成立**，不是**调用格式没变**。
const fakeHasCall = 'function load() { this.loadChecklist(d); }\n'
  + 'function loadChecklist(curLedger) { anomaly.buildChecklist({ months: [curLedger] }); }\n';
ok('⑤-b 正样本：真调用形态判真', callerInLoad(fakeHasCall) === true
  && callInLoadChecklist(fakeHasCall, 'anomaly') === true);
const fakeNoCall = 'function load() { /* this.loadChecklist(d); */ }\n'
  + 'function loadChecklist(curLedger) { /* anomaly.buildChecklist({}); */ }\n';
ok('⑤-c 负样本：注释里的调用判否', callerInLoad(fakeNoCall) === false
  && callInLoadChecklist(fakeNoCall, 'anomaly') === false);

// 样本 3：删掉**真 require 那一行** ⇒ 判据必须转否
//   ⚠️ 不能按「第一处出现 anomalyRules.js」删：正文里还有注释提到它（注释不是 require）。
//   ⇒ 必须找到**行内含 `= require(`** 的那一处，否则样本删错行、判据就成了假绿。
let reqLineStart = -1;
{
  let i = 0;
  while (i < pageSrc.length) {
    const k = pageSrc.indexOf('utils/anomalyRules.js', i);
    if (k < 0) break;
    const ls = pageSrc.lastIndexOf('\n', k) + 1;
    const le = pageSrc.indexOf('\n', k);
    const line = pageSrc.slice(ls, le < 0 ? pageSrc.length : le);
    if (line.indexOf('= require(') >= 0) { reqLineStart = ls; break; }
    i = k + 1;
  }
}
const noReq = reqLineStart >= 0
  ? pageSrc.slice(0, reqLineStart) + pageSrc.slice(pageSrc.indexOf('\n', reqLineStart) + 1)
  : '';
ok('⑤-d 反恒真：能定位真 require 行（样本可构造）', reqLineStart >= 0);
ok('⑤-e 反恒真：删掉 require 后 requireVarOf 为空', noReq.length > 0 && requireVarOf(noReq) === '');

// ================= 扫描面自失效护栏 =================
ok('S1 四个扫描面文件齐全',
  !!pageSrc && !!wxmlSrc && !!rulesSrc && !!ledgerSrc);
ok('S2 断言数下界（≥16）', pass + problems.length >= 16, String(pass + problems.length));

// ================= 结论 =================
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 异常核对清单接线校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ 异常核对清单接线校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 异常核对清单接线校验通过（规则层 → loadChecklist → 结果页卡片；契约面 ⊆ getLedger 出参）');
console.log('✅ 异常核对清单接线校验：' + total + ' 通过 / 0 失败');
