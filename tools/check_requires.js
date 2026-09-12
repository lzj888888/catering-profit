// tools/check_requires.js —— 静态校验：小程序侧所有相对 require 目标必须存在（防 A8 类“路径写错”）
// 背景：批次 0 复审核出 app.js:3 原写 require('./config/env.js') 指向不存在路径（真实位置 miniprogram/config/env.js），
//       A–K 门禁只守 specs/、batch0_selfcheck 只载 cloudfunctions/，前端入口处于覆盖盲区 → 加了这层静态检查兜底。
// 运行：node tools/check_requires.js  （退出码 0=全部可解析，1=有缺失）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function walkJs(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walkJs(p, out);
    } else if (e.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

const files = [];
const APP = path.join(ROOT, 'app.js');
if (fs.existsSync(APP)) files.push(APP);
for (const d of ['pages', 'miniprogram', 'utils']) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walkJs(abs, files);
}

const RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const hits = [];
let total = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(src)) !== null) {
    total++;
    const spec = m[1];
    if (spec.charAt(0) !== '.') continue; // 只查相对路径
    const target = path.resolve(path.dirname(f), spec);
    const ok = fs.existsSync(target)
      || fs.existsSync(target + '.js')
      || fs.existsSync(path.join(target, 'index.js'));
    if (!ok) hits.push(rel(f) + "  ->  require('" + spec + "')  ->  解析为 " + rel(target));
  }
}

if (hits.length) {
  console.log('❌ 相对 require 目标缺失 ' + hits.length + ' 处：');
  hits.forEach((h) => console.log('   ' + h));
  process.exit(1);
}
console.log('✅ 小程序侧相对 require 全部可解析（扫描 ' + files.length + ' 个 .js，相对引用 ' + total + ' 条）');
