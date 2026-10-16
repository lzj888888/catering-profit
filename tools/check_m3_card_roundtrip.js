// tools/check_m3_card_roundtrip.js —— M3 成本卡「出参 → 页面映射 → 提交入参」**往返保真**守卫（R298Y）
// 运行：node tools/check_m3_card_roundtrip.js      （EXIT 0 = 全绿）
//
// 背景（本仓「同族病」第 4 型：**修了一半** —— 补了字段 A 却漏了字段 B、补了写入方却漏了读取方）：
//   两处真实缺陷，全部 175 个套件**零覆盖**（`tools/` 下 `sub_card_ref|line_type|card_type` 仅在
//   `selftest_m3_combo.js`（只测**引擎层**三函数）与 `check_paywall_coverage.js` 命中）：
//
//   · 缺陷 B（功能必失败）：`pages/card/index.js::onCopy` 把**套餐子卡行**当成「手工行」送出
//     （丢了 `sub_card_ref`）⇒ `saveCostCard/validate.js:51` 对 `card_type=3` 的每一行强制要求
//     `sub_card_ref` ⇒ 后端报「套餐明细行必须提供 sub_card_ref」⇒ **复制套餐卡 100% 失败**。
//   · 缺陷 C（**空修复**，本轮最大发现）：R297-⑥ 在 `pages/card/version.js::doRestore` 里写下了
//     `card_type: v.card_type === 3 ? 3 : 1` / `specs: v.specs || []`，注释还声称"恢复正常"——
//     但 `load()` 的 list 映射**从来没赋值过** `card_type`/`specs` 两键 ⇒ 恒 `undefined`
//     ⇒ 该修复整轮**空转**，实际行为仍是它自己描述的那个 bug（恢复套餐卡静默降级成单品）。
//     **写读取方 ≠ 修好**：只 grep「`card_type` 这个词出现过」在改前就是绿的（注释里有该词）。
//
// 判据（四条腿：跨层集合包含 + 形态 + 扫描面下界 + 反恒真正样本）：
//   ① **卡级往返**：`doRestore` 用到的每个 `v.X`（剥注释后取）必须 ∈
//      「`load()` 映射字面量的**顶层键** ∪ 该字面量里直接引用的 `v.X`」——
//      后半部分是为了容纳 `calc_mode_key: v.calc_mode || 'A'` 这类**派生键**。
//   ② **行级往返**（同族，卡级漏了行级就等于没修）：`doRestore` 用到的每个 `l.X` 必须 ∈
//      `load()` 里 lines 映射字面量的顶层键 ∪ 其引用；且必须 ∈ **出参层** `getCardVersions::lineToOut` 的键。
//   ③ **复制面**：`onCopy` 用到的每个 `l.X` 必须 ∈ 出参层 `getCostCard::lineToOutput` 的键；
//      且函数体内必须出现 `sub_card_ref` 与 `line_type`（防"复制丢子卡引用"回流），
//      并**独立**守「提交字面量里有 `sub_card_ref`」——「读到了」不等于「送出去了」（实测：
//      保留 `if (l.sub_card_ref)` 判据、把 `return { sub_card_ref }` 删掉，引用集合**不变**）。
//   ④ **反恒真护栏**：函数体抽取失败即 fail-closed；各集合设**下界**（抽坏=空集 ⇒ 包含关系恒真）；
//      并设正样本锚点（派生键 `calc_mode_key` 必须真的被这套机制覆盖到）。
//
// ⚠️ 剥注释是**判据成立的前提**，不是美化：改前 `doRestore` 的注释里就写着 `v.card_type`，
//   若不剥注释，`used` 会被注释"喂饱"、`mapped` 也会被注释喂饱 ⇒ 缺陷 C 永远抓不出来（实测）。
// ⚠️ 输出**不以 `===` 包裹段标题**（R66 按段标题审计「段内 ✅ == 0」）；末行以 `N 通过 / M 失败` 收尾（R69）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const F_IDX = 'pages/card/index.js';
const F_VER = 'pages/card/version.js';
const F_GETCOST = 'cloudfunctions/getCostCard/service.js';
const F_GETVER = 'cloudfunctions/getCardVersions/service.js';

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('✅ ' + name + (detail ? '（' + detail + '）' : '')); }
  else { problems.push(name + (detail ? '（' + detail + '）' : '')); console.log('❌ ' + name + (detail ? '（' + detail + '）' : '')); }
}
const no = (name, detail) => ok(name, false, detail);
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; } };

// —— 剥注释（**保字符串内容**；不剥会让注释里的字段名喂饱集合 ⇒ 判据恒真）——
function stripComments(s) {
  let out = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const nx = s[i + 1];
    if (q) {
      out += ch;
      if (ch === '\\') { out += (nx || ''); i += 1; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; out += ch; continue; }
    if (ch === '/' && nx === '/') { while (i < s.length && s[i] !== '\n') i += 1; out += '\n'; continue; }
    if (ch === '/' && nx === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1; i += 1; out += ' '; continue; }
    out += ch;
  }
  return out;
}

// —— 从签名处取函数体（花括号配平；不认正则字面量，本文件所涉函数体内无 `{`/`}` 型正则）——
//   ⚠️ 签名正则**已含 `{`** ⇒ 起点必须回退到 `m[0]` 的最后一个字符（否则从**体内**下一个 `{` 起算，
//      抽到的是某个内层块，长度骤降、集合空掉 ⇒ 包含关系恒真 = 假绿。实测踩过：load() 只抽到 15 字符）。
function fnBody(src, sigRe) {
  const m = sigRe.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length - 1;
  if (src[i] !== '{') { while (i < src.length && src[i] !== '{') i += 1; }
  if (i >= src.length) return null;
  const start = i;
  let depth = 0;
  let q = null;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (q) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return src.slice(start + 1, i); }
  }
  return null;
}

// —— 锚点之后第一个对象字面量的**内容**（花括号配平）——
function objAfter(src, anchorRe) {
  const m = anchorRe.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < src.length && src[i] !== '{') i += 1;
  if (i >= src.length) return null;
  const start = i;
  let depth = 0;
  let q = null;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (q) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return src.slice(start + 1, i); }
  }
  return null;
}

// —— 顶层键：按**深度 0 的逗号**切块，取块首的标识符 ——
function splitTopLevel(s) {
  const out = [];
  let cur = '';
  let depth = 0;
  let q = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === '\\') { cur += (s[i + 1] || ''); i += 1; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
const KEY_RE = /^\s*(["']?)([A-Za-z_$][\w$]*)\1\s*:/;
function topKeys(literalBody) {
  const set = new Set();
  for (const chunk of splitTopLevel(literalBody)) {
    const m = KEY_RE.exec(chunk);
    if (m) set.add(m[2]);
  }
  return set;
}
// —— 某标识符的 `.字段` 引用集合（`\b` 保证 `src.lines` 这类前缀不误命中）——
function refsOf(text, ident) {
  const re = new RegExp('\\b' + ident + '\\.([A-Za-z_$][\\w$]*)', 'g');
  const set = new Set();
  let m = re.exec(text);
  while (m) { set.add(m[1]); m = re.exec(text); }
  return set;
}
const missing = (need, have) => Array.from(need).filter((x) => !have.has(x));
const listOf = (arr) => arr.join(' / ');
// —— 函数体内**所有对象字面量的键** ——
//   ⚠️ 与「`l.X` 引用集合」是两件事：**读到了 ≠ 送出去了**。只删提交键、保留判据里的读取
//      （`if (l.sub_card_ref)` 还在、`return { qty }` 里没了）时，引用集合**不变** ⇒ 必须独立守这一面。
function emittedKeys(text) {
  const re = /(?:[{,]\s*)([A-Za-z_$][\w$]*)\s*:/g;
  const set = new Set();
  let m = re.exec(text);
  while (m) { set.add(m[1]); m = re.exec(text); }
  return set;
}

// ============ 读取 + 剥注释 ============
const rawIdx = read(F_IDX);
const rawVer = read(F_VER);
const rawGetCost = read(F_GETCOST);
const rawGetVer = read(F_GETVER);
ok('P0 四个源文件均可读', !!rawIdx && !!rawVer && !!rawGetCost && !!rawGetVer, F_IDX + ' / ' + F_VER + ' / ' + F_GETCOST + ' / ' + F_GETVER);
if (!rawIdx || !rawVer || !rawGetCost || !rawGetVer) {
  no('P0 前置：源文件缺失 ⇒ fail-closed', '后续判据无法执行');
  console.log('❌ M3 成本卡往返保真校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
const srcIdx = stripComments(rawIdx);
const srcVer = stripComments(rawVer);
const srcGetCost = stripComments(rawGetCost);
const srcGetVer = stripComments(rawGetVer);

// ============ 抽取 ============
const verLoad = fnBody(srcVer, /async\s+load\s*\(\s*\)\s*\{/);
const verRestore = fnBody(srcVer, /async\s+doRestore\s*\([^)]*\)\s*\{/);
const idxCopy = fnBody(srcIdx, /async\s+onCopy\s*\([^)]*\)\s*\{/);

ok('P1 load() 函数体已抽取', !!verLoad && verLoad.length >= 400, verLoad ? verLoad.length + ' 字符' : '未找到');
ok('P2 doRestore() 函数体已抽取', !!verRestore && verRestore.length >= 300, verRestore ? verRestore.length + ' 字符' : '未找到');
ok('P3 onCopy() 函数体已抽取', !!idxCopy && idxCopy.length >= 300, idxCopy ? idxCopy.length + ' 字符' : '未找到');
if (!verLoad || !verRestore || !idxCopy) {
  no('P4 前置：函数体抽取失败 ⇒ fail-closed', '防止"抽不到 ⇒ 空集 ⇒ 包含关系恒真"的假绿');
  console.log('❌ M3 成本卡往返保真校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}

// 卡级映射字面量 / 行级映射字面量（version.js::load）
const cardLit = objAfter(verLoad, /\(d\.list \|\| \[\]\)\.map\(\(v\) => \(/);
const lineLit = objAfter(verLoad, /lines\s*:\s*\(v\.lines \|\| \[\]\)\.map\(\(l\) => \(/);
ok('P5 卡级映射字面量已抽取', !!cardLit && cardLit.length >= 200, cardLit ? cardLit.length + ' 字符' : '未找到');
ok('P6 行级映射字面量已抽取', !!lineLit && lineLit.length >= 200, lineLit ? lineLit.length + ' 字符' : '未找到');
if (!cardLit || !lineLit) {
  no('P7 前置：映射字面量抽取失败 ⇒ fail-closed', 'load() 的映射形态可能被改写');
  console.log('❌ M3 成本卡往返保真校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}

// 出参层
const cardOutC = objAfter(srcGetCost, /function\s+cardToOutput\s*\([^)]*\)\s*\{\s*return/);
const lineOutC = objAfter(srcGetCost, /function\s+lineToOutput\s*\([^)]*\)\s*\{\s*return/);
const cardOutV = objAfter(srcGetVer, /function\s+cardToOut\s*\([^)]*\)\s*\{\s*return/);
const lineOutV = objAfter(srcGetVer, /function\s+lineToOut\s*\([^)]*\)\s*\{\s*return/);
ok('P8 出参层四个字面量已抽取', !!cardOutC && !!lineOutC && !!cardOutV && !!lineOutV);

// 集合
const mappedCards = new Set([...topKeys(cardLit), ...refsOf(cardLit, 'v')]);
const usedCards = refsOf(verRestore, 'v');
const mappedLines = new Set([...topKeys(lineLit), ...refsOf(lineLit, 'l')]);
const usedLines = refsOf(verRestore, 'l');
const copyLines = refsOf(idxCopy, 'l');
const lineOutKeysC = topKeys(lineOutC || '');
const lineOutKeysV = topKeys(lineOutV || '');
const cardOutKeysC = topKeys(cardOutC || '');

// ============ ④ 反恒真护栏（下界 + 正样本）============
ok('⑤-a 下界 mappedCards ≥ 12', mappedCards.size >= 12, 'size=' + mappedCards.size);
ok('⑤-b 下界 usedCards ≥ 8', usedCards.size >= 8, 'size=' + usedCards.size);
ok('⑤-c 下界 mappedLines ≥ 8', mappedLines.size >= 8, 'size=' + mappedLines.size);
ok('⑤-d 下界 usedLines ≥ 4', usedLines.size >= 4, 'size=' + usedLines.size);
ok('⑤-e 下界 copyLines ≥ 5', copyLines.size >= 5, 'size=' + copyLines.size);
ok('⑤-f 下界 出参层行级键 ≥ 10（两份）', lineOutKeysC.size >= 10 && lineOutKeysV.size >= 10, 'cost=' + lineOutKeysC.size + ' ver=' + lineOutKeysV.size);
ok('⑤-g 下界 出参层卡级键 ≥ 12', cardOutKeysC.size >= 12, 'size=' + cardOutKeysC.size);
// 正样本：**派生键**这条路必须真的被覆盖到（否则"键 ∪ 引用"的写法可能形同虚设）
ok('⑤-h 正样本：派生键 calc_mode_key 被 doRestore 使用', usedCards.has('calc_mode_key'));
ok('⑤-i 正样本：派生键 calc_mode_key 在映射产物内', mappedCards.has('calc_mode_key'));
ok('⑤-j 正样本：card_type / specs 在映射产物内（R298Y 修复点）', mappedCards.has('card_type') && mappedCards.has('specs'));
ok('⑤-k 正样本：card_type / specs 被 doRestore 使用', usedCards.has('card_type') && usedCards.has('specs'));

// ============ ① 卡级往返 ============
const missCards = missing(usedCards, mappedCards);
ok('① 卡级往返：doRestore 的 v.X ⊆ load() 映射产物', missCards.length === 0,
  missCards.length ? '缺失字段：' + listOf(missCards) + '（读未赋值字段 ⇒ 恒 undefined ⇒ 静默降级）' : usedCards.size + ' 个字段全部有来源');

// ============ ② 行级往返 ============
const missLines = missing(usedLines, mappedLines);
ok('②-a 行级往返：doRestore 的 l.X ⊆ load() 行映射产物', missLines.length === 0,
  missLines.length ? '缺失字段：' + listOf(missLines) : usedLines.size + ' 个字段全部有来源');
const missLinesOut = missing(usedLines, lineOutKeysV);
ok('②-b 行级往返：doRestore 的 l.X ⊆ 出参层 getCardVersions::lineToOut', missLinesOut.length === 0,
  missLinesOut.length ? '出参层没有这些字段：' + listOf(missLinesOut) : '全部可出参');

// ============ ③ 复制面 ============
const missCopy = missing(copyLines, lineOutKeysC);
ok('③-a 复制面：onCopy 的 l.X ⊆ 出参层 getCostCard::lineToOutput', missCopy.length === 0,
  missCopy.length ? '出参层没有这些字段：' + listOf(missCopy) : copyLines.size + ' 个字段全部可出参');
ok('③-b onCopy 体含 sub_card_ref（防"复制丢子卡引用"回流）', /sub_card_ref/.test(idxCopy));
ok('③-c onCopy 体含 line_type（子卡行判定依据）', /line_type/.test(idxCopy));
ok('③-d onCopy 体按行分流（line_type === 2 判子卡行）', /line_type\s*===\s*2/.test(idxCopy));
ok('③-e doRestore 体含 sub_card_ref', /sub_card_ref/.test(verRestore));
ok('③-f doRestore 体含 line_type', /line_type/.test(verRestore));
ok('③-g 出参层两份 service 均给出 sub_card_ref', /sub_card_ref\s*:/.test(srcGetCost) && /sub_card_ref\s*:/.test(srcGetVer));
ok('③-h 出参层两份 service 均给出 line_type', /line_type\s*:/.test(srcGetCost) && /line_type\s*:/.test(srcGetVer));
// ③-i..③-l：**「送出去了吗」** —— 只看 `l.X` 引用集合抓不到「保留判据、删掉提交键」这种变异（实测）。
const emitCopy = emittedKeys(idxCopy);
const emitRestore = emittedKeys(verRestore);
ok('③-i onCopy **提交字面量**含 sub_card_ref（读到了 ≠ 送出去了）', emitCopy.has('sub_card_ref'), 'emitted=' + emitCopy.size + ' 键');
ok('③-j onCopy **提交字面量**含 card_type（R297-⑥ 修复点，防回流）', emitCopy.has('card_type'));
ok('③-k doRestore **提交字面量**含 sub_card_ref（读到了 ≠ 送出去了）', emitRestore.has('sub_card_ref'), 'emitted=' + emitRestore.size + ' 键');
ok('③-l doRestore **提交字面量**含 card_type / specs（R298Y 修复点，防回流）', emitRestore.has('card_type') && emitRestore.has('specs'));
ok('③-m 下界 提交字面量键数（防抽取器抽空 ⇒ 以上四条恒真）', emitCopy.size >= 6 && emitRestore.size >= 8, 'copy=' + emitCopy.size + ' restore=' + emitRestore.size);

// ============ 结论 ============
const total = pass + problems.length;
if (problems.length) {
  console.log('❌ M3 成本卡往返保真校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  console.log('❌ M3 成本卡往返保真校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ M3 成本卡往返保真校验通过（卡级 ' + usedCards.size + ' 字段 / 行级 ' + usedLines.size + ' 字段 / 复制面 ' + copyLines.size + ' 字段 全部有来源，子卡行往返齐备）');
console.log('✅ M3 成本卡往返保真校验：' + total + ' 通过 / 0 失败');
