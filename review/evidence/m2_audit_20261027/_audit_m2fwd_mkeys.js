// _audit_m2fwd_mkeys.js —— 只读取证：index.js 里 `M.<key>` / `TERMS.<seg>.<key>` 的引用
//   vs 实际 TERMS 对象里存在的键（差集 = 恒 undefined ⇒ 静默空白）
const fs = require('fs');
const path = require('path');
const { TERMS } = require('./miniprogram/i18n/terms.js');

const js = fs.readFileSync(path.join(__dirname, 'subpkg/tools/sandbox/index.js'), 'utf8');
const M = TERMS.m2;

const reM = /\bM\.([A-Za-z_][A-Za-z0-9_]*)/g;
const reads = new Map();
let m;
while ((m = reM.exec(js)) !== null) {
  const k = m[1];
  const line = js.slice(0, m.index).split('\n').length;
  if (!reads.has(k)) reads.set(k, line);
}
const miss = [];
for (const [k, line] of reads) if (!(k in M)) miss.push([k, line]);

console.log('=== TERMS.m2 键数 = ' + Object.keys(M).length + '；index.js 引用 M.* 键数 = ' + reads.size + ' ===');
console.log('--- 引用了但 TERMS.m2 里不存在（恒 undefined）---');
if (!miss.length) console.log('   （无）');
miss.forEach(([k, l]) => console.log('   M.' + k + '  (index.js:' + l + ')'));

// 反向：m2 里定义但本页未引用（不算 bug，仅列出便于判断僵尸文案）
const unused = Object.keys(M).filter((k) => !reads.has(k) && typeof M[k] !== 'object');
console.log('\n--- TERMS.m2 中本页未引用的字符串键（' + unused.length + ' 个，非缺陷）---');
console.log('   ' + unused.join(', '));

// 对象型键（字典）逐个核二级键
console.log('\n--- TERMS.m2 对象型字典 ---');
Object.keys(M).forEach((k) => {
  if (M[k] && typeof M[k] === 'object' && !Array.isArray(M[k])) {
    console.log('   M.' + k + ' → ' + Object.keys(M[k]).length + ' 键: ' + Object.keys(M[k]).join(','));
  }
});

// TERMS 其它段引用
const reT = /\bTERMS\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
const tmiss = [];
while ((m = reT.exec(js)) !== null) {
  const seg = m[1], key = m[2];
  if (!TERMS[seg] || !(key in TERMS[seg])) {
    const line = js.slice(0, m.index).split('\n').length;
    tmiss.push('TERMS.' + seg + '.' + key + ' (index.js:' + line + ')');
  }
}
console.log('\n--- TERMS.<seg>.<key> 引用缺失 ---');
console.log(tmiss.length ? '   ' + tmiss.join('\n   ') : '   （无）');
