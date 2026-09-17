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
function collect() {
  const out = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { walk(fp); continue; }
      if (!/\.js$/.test(e.name)) continue;
      if (/^selftest\.js$/.test(e.name) || /selfcheck.*\.js$/.test(e.name) || /^selftest.*\.js$/.test(e.name)) out.push(fp);
    }
  };
  walk(path.join(ROOT, 'cloudfunctions'));
  try {
    for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) if (/^selftest.*\.js$/.test(f)) out.push(path.join(ROOT, 'tools', f));
  } catch (e) { /* ignore */ }
  return out.sort();
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

// 顶层块切分：深度 0 的非空行起，累计深度回到 0 且以 ; 或 } 收尾为止
function topLevelChunks(stripped) {
  const chunks = [];
  let cur = null, depth = 0;
  for (const ln of stripped.split('\n')) {
    if (cur === null) {
      if (ln.trim() === '') continue;
      cur = { text: ln };
    } else { cur.text += '\n' + ln; }
    for (const ch of ln) {
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
    }
    if (depth === 0) {
      const t = cur.text.replace(/\s+$/, '');
      if (/[;}]$/.test(t)) { chunks.push(cur); cur = null; }
    }
  }
  if (cur !== null) chunks.push(cur);
  return chunks;
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
  const chunks = topLevelChunks(clean);
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

process.stdout.write(`\n[形状守卫 R66] 扫描自测文件 ${list.length} 个（R1 顶层 IIFE ≤1 / R2 exit 仅在末块或函数声明体内 / R3 退出码存在）\n`);
for (const p of problems) process.stdout.write(`  ${p.level === 'ERROR' ? '❌' : '⚠️'} ${p.rel}\n      ↳ ${p.msg}\n`);
if (!errs.length) {
  process.stdout.write(`✅ 全部 ${list.length} 个自测形状合规（R1/R2 通过）`);
  process.stdout.write(warns.length ? `；另有 ${warns.length} 条 WARN（不阻断）：${warns.map((w) => w.rel).join('、')}\n` : '\n');
}
process.exit(errs.length === 0 ? 0 : 1);
