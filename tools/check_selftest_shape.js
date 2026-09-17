#!/usr/bin/env node
// tools/check_selftest_shape.js —— R66 · 自测文件「静态形状」守卫（fail-closed）
//
// 背景（R65）：cloudfunctions/adminExport/selftest.js 曾有**两个顶层 IIFE**：
//   A 段（R49 分页累取）用 await 链、B 段（R51 where=null）用假集合（微任务即完成）且**尾部调 process.exit**。
//   ⇒ B 段先落地并退出进程，把 A 段**十余条断言腰斩**；症状 = **exit code 0、总览全绿、断言静默不跑**（假绿）。
//   根因：同一文件里的多个顶层 IIFE **执行顺序不被保证**，任一 `process.exit` 都可能腰斩其它块。
//
// 本守卫把它变成**静态可见**（纯文本 + 括号配平，不跑代码）：
//   R1  顶层 IIFE（裸语句形态 `( ... )();`）**≤ 1 个** —— 直接命中 R65（该 bug 正是"把一个 IIFE 拆成两个"造出来的）。
//   R2  `process.exit` 不得出现在**非末个顶层块**中，除非该块是「函数/类声明」（body 需被调用才执行，不构成腰斩）。
//   R3  全文无 `process.exit` / `process.exitCode` ⇒ 断言失败时退出码仍为 0（fail-open）。**提示级**，不阻断。
//   R67 自测文件 ↔ `verify_all.js` 的 SUITES **双向差集**：任一方向非空即红（整个文件静默不跑 / 孤儿条目）。
//   R68 顶层块切分**不确定即 fail-closed**（缺分号会让其后整片并入同块 ⇒ R2 被绕过，见函数首注）。
//
// ⚠️ "读不到给不出结论"一律判红，绝不静默给绿 —— 本工具自己若不可信，比它要防的漏洞更危险
//    （首版两个 bug 都属此类：ⓐ 除号被误判成正则起点、吞掉半篇代码；ⓑ IIFE 收尾正则多一个 `\)`、R1 永不触发。
//     两者在基线全绿时**完全静默**，靠变异回灌才现形 ⇒ 新增/修改本守卫必须做变异回灌，见 review/README.md §7。）
//
// ⚠️ 边界（诚实声明，别当它更强）：R1/R2 是**形状**守卫，证不了"每条断言都真跑了"。
//   运行期那一半由 `verify_all.js` 的「段标题下零断言即判红」（R66 主体）承担；两者互补，缺一不可。
//   R1 也不是"最多一个 async 块"——`async` 函数声明 + 调用是常规写法，不受限。
//
// 实现要点：字符串/注释**先剥除**（等长空格替换，行列号不变）；剥离器**识别正则字面量**
//   （否则 `/[",\r\n]/` 里的引号会把解析带偏 —— 首版即踩此坑，导致漏报/误报）。
//
// 运行：node tools/check_selftest_shape.js      （EXIT 0 = 全绿）
// 接入：verify_all.js 的 SUITES 内。**不得**把会再跑一遍全套件的脚本接进来（R66 原话）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 扫描面 = SUITES 里「代码自测」类：所有 selftest.js + 批次 0 自检 + 前端工具自测
// 🔒 判据必须与 R67 的 SUITES 侧分类**用同一个函数**（matchesSelftest）：两侧各有一套文件名规则 ⇒ 差集必然失真。
function matchesSelftest(base) {
  return /^selftest\.js$/.test(base) || /^selftest.*\.js$/.test(base) || /selfcheck.*\.js$/.test(base);
}
// ⚠️ **已知假红面（保守方向，2026-09-17 复审方备注）**：名字长得像自测的 **helper / 夹具**（例如
//   `selftest_helpers.js`、`foo_selfcheck_fixture.js`）也会被算进扫描面 ⇒ 它没被挂进 SUITES 时报「漏挂」。
//   方向是保守的（宁可红、不可漏跑），处置 = 改名（去掉 selftest/selfcheck 前缀）或真的挂进 SUITES；
//   **不要**因此放宽判据 —— 放宽后"漏挂"就会从红变绿，那才是危险方向。

function collect() {
  const out = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(path.join(dir, e.name)); continue; }
      const fp = path.join(dir, e.name);
      if (!/\.js$/.test(e.name)) continue;
      if (matchesSelftest(e.name)) out.push(fp);
    }
  };
  walk(path.join(ROOT, 'cloudfunctions'));
  try {
    for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) if (matchesSelftest(f)) out.push(path.join(ROOT, 'tools', f));
  } catch (e) { /* ignore */ }
  return out.sort();
}

// 🔒 R67：SUITES 登记完整性 —— collect() 与 verify_all.js 的 SUITES 做**双向差集**。
// 背景（比 R65 上一层粒度）：树里有 selftest.js **却没写进 SUITES** ⇒ 该文件**整份静默不跑**，
//   而三者仍全绿 —— 运行期审计只看"跑过的套件"、形状守卫扫文件系统但**不比对 SUITES**、
//   guardSuiteCount 只核对注释里的数字。⇒ 只有这一次双向比较能看见。
// ⚠️ `tools/check_selftest_shape.js` **不是**自测文件（basename 不以 selftest/selfcheck 开头），
//    与 `tools/selftest_batch7.js`（是）分属两侧 —— 同判据故不会假红。
function readSuiteRels() {
  const vp = path.join(ROOT, 'verify_all.js');
  let src;
  try { src = fs.readFileSync(vp, 'utf8'); } catch (e) {
    return { err: `读取 verify_all.js 失败：${String(e.message).split('\n')[0]}` };
  }
  const anchor = src.indexOf('const SUITES = [');
  if (anchor < 0) return { err: 'verify_all.js 中找不到标记「const SUITES = [」—— 守卫生效前提已失，故不下任何结论' };
  const b0 = src.indexOf('[', anchor);
  let depth = 0, end = -1;
  for (let i = b0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return { err: 'SUITES 数组方括号未配平' };
  let arr;
  try { arr = (new Function('return ' + src.slice(b0, end + 1)))(); } catch (e) {
    return { err: `SUITES 求值失败：${String(e.message).split('\n')[0]}` };
  }
  if (!Array.isArray(arr) || arr.some((p) => !Array.isArray(p) || typeof p[1] !== 'string')) {
    return { err: 'SUITES 形态非法（应为 [[展示名, 相对路径], ...]）' };
  }
  return { rels: arr.map((p) => p[1]) };
}

// 剥除注释 / 字符串 / 正则字面量（等长空格替换，保留换行 → 行列号不变）
// 返回 { text, eofMode }：eofMode !== null 表示引号/正则/注释未配平 ⇒ **本次剥离不可信**（调用方必须判红）。
function strip(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = null;          // null | 'line' | 'block' | 'sq' | 'dq' | 'tpl' | 're' | 'reclass'
  let lastSig = '';         // 最近一个"有意义的"原始字符（判断 / 是除号还是正则起点）
  let lastWord = '';
  // `/` 前面出现这些字符时，`/` 只可能是正则起点（不可能以除号结尾）
  // ⚠️ 首版曾误把 'r' / 'n' 放进来 —— 会让 `unit_cost_fen / 100` 这类除号被当成正则，
  //    进而 lexer 失配吞掉后面整片代码（实测 calcBom 因此漏报 process.exit）。别再加字母。
  const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n', '']);
  const REGEX_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'case']);
  const pushBlank = (ch) => { out += (ch === '\n') ? '\n' : ' '; };

  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (mode === null) {
      if (c === '/' && d === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === '/') {
        // 正则起点？= 前一个有意义字符属于「不可能以除号结尾」的集合，或前一个词是 return/typeof/...
        if (REGEX_PREV.has(lastSig) || REGEX_WORDS.has(lastWord)) { mode = 're'; out += ' '; i += 1; continue; }
        out += c; lastSig = c; lastWord = ''; i += 1; continue;
      }
      if (c === "'") { mode = 'sq'; out += ' '; i += 1; continue; }
      if (c === '"') { mode = 'dq'; out += ' '; i += 1; continue; }
      if (c === '`') { mode = 'tpl'; out += ' '; i += 1; continue; }
      out += c;
      if (!/\s/.test(c)) {
        lastSig = c;
        lastWord = /[A-Za-z_$]/.test(c) ? (lastWord + c) : '';
      } else if (c === '\n') { lastWord = ''; }
      i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = null; lastWord = ''; } pushBlank(c); i += 1; continue; }
    if (mode === 'block') { if (c === '*' && d === '/') { mode = null; out += '  '; i += 2; continue; } pushBlank(c); i += 1; continue; }
    if (mode === 're') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === '[') { mode = 'reclass'; pushBlank(c); i += 1; continue; }
      if (c === '/') { mode = null; out += ' '; i += 1; continue; }
      pushBlank(c); i += 1; continue;
    }
    if (mode === 'reclass') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === ']') { mode = 're'; pushBlank(c); i += 1; continue; }
      pushBlank(c); i += 1; continue;
    }
    // 引号内
    if (c === '\\') { out += '  '; i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) { mode = null; out += ' '; i += 1; continue; }
    pushBlank(c); i += 1; continue;
  }
  return { text: out, eofMode: mode };
}

// 顶层块切分：深度 0 的非空行起，累计深度回到 0 且以 ; 或 } 收尾为止。
// 🔒 R68：**切分不确定 → fail-closed**（与 strip() 的 eofMode 同一哲学：要么给准结论，要么不给结论）。
//   背景：收尾条件 `/[;}]$/` 不满足时（典型 = 顶层语句**缺分号**，或跨行表达式），原实现会**继续往下吞**
//   ⇒ 其后整片语句并进同一块 ⇒ 落在该块里的 `process.exit` 会被 R2 当成「末块内的 exit」而**放过**，
//   这正是 R65 的逃逸口。⇒ 现在遇到不确定边界就停手报 ERROR（请补齐分号或改写），而不是猜着合并。
// ⚠️ **已知假红面（保守方向，2026-09-17 复审方备注）**：**缺分号的跨行顶层调用**也会被判"不确定"
//   （例如 `const X = cond ? a\n  : b;`，或一段没写分号的多行表达式）。42 个真实文件实测 **0 误报**
//   （本仓顶层语句一律以 `;` / `}` 收尾），故不为此放宽；真遇到时**补分号**即可，别改判据。合并。
function topLevelChunks(stripped) {
  const chunks = [];
  let cur = null, depth = 0, ln = 0;
  let uncertain = null;
  for (const line of stripped.split('\n')) {
    ln++;
    if (cur === null) {
      if (line.trim() === '') continue;
      cur = { text: line, start: ln };
    } else { cur.text += '\n' + line; }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
    }
    if (depth === 0) {
      const t = cur.text.replace(/\s+$/, '');
      if (/[;}]$/.test(t)) { chunks.push(cur); cur = null; }
      else { chunks.push(cur); cur = null; uncertain = { line: ln, tail: t.slice(-48) }; break; }
    }
  }
  if (cur !== null) {
    const t = cur.text.replace(/\s+$/, '');
    chunks.push(cur);
    if (!uncertain && !/[;}]$/.test(t)) uncertain = { line: ln, tail: 'EOF 处未以 ; 或 } 收尾' };
  }
  return { chunks, uncertain };
}

// 块类别：iife（裸语句 IIFE）| funcdecl（函数/类声明，body 需被调用）| other（裸语句）
//   IIFE 收尾形态 = `})();`：`}` → `)` → `(` → `)` → `;`。
//   ⚠️ 首版误写成 `\}\)\s*\)\s*\(\s*\)`（多一个 `\)`，要求 `}) )`）⇒ **所有 IIFE 都被判成 other**，
//      R1 永不触发（实测把 R65 故障文件放回去仍报"42 个全绿"）。别改这行而不跑变异。
function kindOf(t) {
  if (/^\s*(async\s+)?function\b/.test(t) || /^\s*class\b/.test(t)) return 'funcdecl';
  if (/^\s*[(!;]/.test(t) && /\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(t)) return 'iife';
  return 'other';
}

const problems = [];
const list = collect();

// ===== R67：自测文件 ↔ SUITES 双向差集（整文件静默不跑的最后一道）=====
let r67 = null;
{
  const got = readSuiteRels();
  if (got.err) {
    problems.push({ level: 'ERROR', rel: 'verify_all.js',
      msg: `R67 无法核对登记完整性（fail-closed，不下结论）：${got.err}` });
  } else {
    const relOf = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
    const suiteSelf = got.rels.filter((r) => matchesSelftest(path.basename(r)));
    const treeSet = new Set(list.map(relOf));
    const missing = list.map(relOf).filter((r) => !suiteSelf.includes(r)); // 树里有、SUITES 没挂
    const orphan = suiteSelf.filter((r) => !treeSet.has(r));               // SUITES 挂了、树里没有
    if (missing.length) {
      problems.push({ level: 'ERROR', rel: 'verify_all.js',
        msg: `R67 自测文件已存在但未接入 SUITES（整文件静默不跑，而 53/53 仍全绿）${missing.length} 个：${missing.join('、')}` });
    }
    if (orphan.length) {
      problems.push({ level: 'ERROR', rel: 'verify_all.js',
        msg: `R67 SUITES 指向的自测文件在树里不存在（孤儿条目）${orphan.length} 个：${orphan.join('、')}` });
    }
    r67 = { inTree: treeSet.size, inSuite: suiteSelf.length, missing: missing.length, orphan: orphan.length };
  }
}

for (const fp of list) {
  const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
  let src;
  try { src = fs.readFileSync(fp, 'utf8'); } catch (e) {
    problems.push({ level: 'ERROR', rel, msg: `读取失败：${String(e.message).split('\n')[0]}` });
    continue;
  }
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
  const { text: clean, eofMode } = strip(src);
  if (eofMode !== null) {
    // fail-closed：剥离器失配时**不得**给出任何结论（否则守卫自己成了新的不可信事实源）
    problems.push({ level: 'ERROR', rel,
      msg: `剥离器在 EOF 仍处于「${eofMode}」模式（引号/正则/注释未配平）—— 本文件形状结论不可信，须人工复核` });
    continue;
  }
  const { chunks, uncertain } = topLevelChunks(clean);
  if (uncertain) {
    problems.push({ level: 'ERROR', rel,
      msg: `R68 顶层块切分在第 ${uncertain.line} 行无法定界（块尾既非 ; 也非 }，典型 = 顶层语句缺分号）—— `
        + '其后语句会被并入同一块，落在该块内的 process.exit 可能被 R2 误判成「末块内的 exit」而放过（R65 逃逸口）；'
        + `块尾原文 …${uncertain.tail}　⇒ 补齐分号或改写后重试；本文件形状结论不下（fail-closed）` });
    continue;
  }
  const last = chunks.length;

  const iifeIdx = [], exitIdx = [];
  chunks.forEach((ch, i) => {
    if (kindOf(ch.text) === 'iife') iifeIdx.push(i + 1);
    if (/process\s*\.\s*exit\s*\(/.test(ch.text)) exitIdx.push(i + 1);
  });

  if (iifeIdx.length > 1) {
    problems.push({ level: 'ERROR', rel,
      msg: `R1 顶层 IIFE = ${iifeIdx.length} 个（应 ≤1）：第 ${iifeIdx.join(' / ')} 个顶层块；`
        + '多个顶层 IIFE 的执行顺序不被保证，任一 process.exit 都可能腰斩其它块的断言（R65 根因）' });
  }
  const bad = exitIdx.filter((i) => i !== last && kindOf(chunks[i - 1].text) !== 'funcdecl');
  if (bad.length) {
    problems.push({ level: 'ERROR', rel,
      msg: `R2 process.exit 出现在第 ${bad.join(' / ')} 个顶层块（共 ${last} 块，该类块会在本块内同步执行）—— `
        + '只允许出现在**最后一块**或函数声明体内；更早退出会腰斩其后的断言（R65）' });
  }
  if (exitIdx.length === 0 && !/process\s*\.\s*exitCode/.test(clean)) {
    problems.push({ level: 'WARN', rel, msg: 'R3 全文无 process.exit / process.exitCode —— 断言失败时退出码仍为 0（fail-open）' });
  }
}

const errs = problems.filter((p) => p.level === 'ERROR');
const warns = problems.filter((p) => p.level === 'WARN');

process.stdout.write(`\n[形状守卫 R66/R67/R68] 扫描自测文件 ${list.length} 个（R1 顶层 IIFE ≤1 / R2 exit 仅在末块或函数声明体内 / R3 退出码存在）\n`);
if (r67) {
  process.stdout.write(`  [R67 登记完整性] 树内 ${r67.inTree} 个 ↔ SUITES 内 ${r67.inSuite} 个；`
    + `漏挂 ${r67.missing} / 孤儿 ${r67.orphan}\n`);
}
for (const p of problems) process.stdout.write(`  ${p.level === 'ERROR' ? '❌' : '⚠️'} ${p.rel}\n      ↳ ${p.msg}\n`);
if (!errs.length) {
  process.stdout.write(`✅ 全部 ${list.length} 个自测形状合规（R1/R2 通过）`);
  if (r67 && r67.missing === 0 && r67.orphan === 0) process.stdout.write(`，且 Δ(SUITES) 双向为零（R67）`);
  process.stdout.write(warns.length ? `；另有 ${warns.length} 条 WARN（不阻断）：${warns.map((w) => w.rel).join('、')}\n` : '\n');
}
process.exit(errs.length === 0 ? 0 : 1);
