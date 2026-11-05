// _audit_m2fwd_keys2.js —— 补扫：js 里 `const t = this.data.t` 之后的 `t.X` 读取
const fs = require('fs');
const path = require('path');
const { PAGE } = require('./_audit_m2fwd_harness.js');

const js = fs.readFileSync(path.join(__dirname, 'subpkg/tools/sandbox/index.js'), 'utf8');
const tSet = new Set(Object.keys(PAGE.data.t));

// 只取 `t.xxx` 形式（前面不是字母/数字/下划线/点），排除 this.data.t.xxx（已扫过）
const re = /(^|[^A-Za-z0-9_.])t\.([A-Za-z_][A-Za-z0-9_]*)/g;
const miss = new Map();
let m;
while ((m = re.exec(js)) !== null) {
  const k = m[2];
  if (tSet.has(k)) continue;
  const line = js.slice(0, m.index).split('\n').length;
  const ctx = js.split('\n')[line - 1].trim().slice(0, 120);
  if (!miss.has(k)) miss.set(k, line + ': ' + ctx);
}
console.log('=== js 中 `t.X` 读取但 data.t 里没有的键（含局部变量的假阳性，需人工判）===');
if (!miss.size) console.log('   （无）');
for (const [k, v] of miss) console.log('   t.' + k.padEnd(28) + ' @ ' + v);

// 反向：data.t 中值为 undefined / null / '' 的键（映射了但没值 ⇒ 渲染空白）
console.log('\n=== data.t 中值异常的键 ===');
const bad = [];
for (const [k, v] of Object.entries(PAGE.data.t)) {
  if (v === undefined || v === null || v === '') bad.push(k + ' = ' + JSON.stringify(v));
}
console.log(bad.length ? '   ' + bad.join('\n   ') : '   （无）');
