// 统计 pages/**.js 里 /pages/... 的引用数与唯一目标数（写文件避免 shell 反引号坑）
const fs = require('fs'), path = require('path');
const walk = (d, acc = []) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (f.endsWith('.js')) acc.push(p);
  }
  return acc;
};
const files = walk('pages');
const re = new RegExp('[\'"`]/pages/[A-Za-z0-9_\\-/]+');
let refs = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(re) || [];
  for (const x of m) refs.push(x);
}
console.log('页面 .js 文件数 =', files.length);
console.log('/pages/... 引用总数 =', refs.length);
const uniq = [...new Set(refs.map((r) => r.slice(1)))];
console.log('唯一目标数 =', uniq.length);
console.log('--- 唯一目标 ---');
uniq.sort().forEach((u) => console.log('  ' + u));
