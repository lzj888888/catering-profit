// _audit_m2fwd_deadkeys2.js —— 死键**严格**判定：术语键是否在「真实渲染/逻辑」里被用到
// 严格 = ① 出现在任意 wxml（页面真实渲染表达式）；② 出现在 js 的**非注释行**、且不在 `t:{}` 映射块内。
const fs = require('fs');
const path = require('path');
const { PAGE } = require('./_audit_m2fwd_harness.js');

const dead = [];
{
  const DIR = path.join(__dirname, 'subpkg/tools/sandbox');
  const wxml = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
  const read = new Set();
  let m;
  for (const re of [/\bt\.([A-Za-z_][A-Za-z0-9_]*)/g, /\bT\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /this\.data\.t\.([A-Za-z_][A-Za-z0-9_]*)/g, /(^|[^A-Za-z0-9_.])t\.([A-Za-z_][A-Za-z0-9_]*)/g]) {
    while ((m = re.exec(wxml + '\n' + js)) !== null) read.add(m[1] || m[2]);
  }
  for (const k of Object.keys(PAGE.data.t)) if (!read.has(k)) dead.push(k);
}

// 收集全部 wxml 文本
const wxmlAll = [];
// 收集全部 js 的「非注释、非 t 映射块」文本
const jsClean = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    const src = fs.readFileSync(p, 'utf8');
    if (/\.wxml$/.test(f)) { wxmlAll.push(src); continue; }
    if (/\.js$/.test(f)) {
      const lines = src.split('\n');
      const tStart = lines.findIndex((l) => /^\s{2,6}t:\s*\{/.test(l));
      let tEnd = -1;
      if (tStart >= 0) for (let i = tStart + 1; i < lines.length; i++) if (/^\s{2,6}\},?\s*$/.test(lines[i])) { tEnd = i; break; }
      const keep = (tStart >= 0 && tEnd > tStart)
        ? lines.slice(0, tStart).concat(lines.slice(tEnd + 1)) : lines;
      jsClean.push(keep.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'));
    }
  }
};
walk(path.join(__dirname, 'pages'));
walk(path.join(__dirname, 'subpkg'));

const W = wxmlAll.join('\n');
const J = jsClean.join('\n');

const still = [], orphan = [];
for (const k of dead) {
  const re = new RegExp('\\b' + k + '\\b');
  if (re.test(W) || re.test(J)) still.push(k); else orphan.push(k);
}
console.log('=== 死键 ' + dead.length + ' 个的严格判定 ===');
console.log('\n--- 术语仍在「真实渲染/逻辑」中被用到：只删 index.js 的 t 映射，terms.js 保留（' + still.length + ' 个）---');
console.log('   ' + still.join(', '));
console.log('\n--- 术语在全前端 wxml/非注释 js 中**零命中**：t 映射与 terms.js 可一并清理（' + orphan.length + ' 个）---');
console.log('   ' + (orphan.length ? orphan.join(', ') : '（无）'));
