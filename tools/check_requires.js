// tools/check_requires.js —— 静态校验：所有相对 require 目标必须存在（防 A8 类“路径写错”）
// 背景：批次 0 复审核出 app.js:3 原写 require('./config/env.js') 指向不存在路径（真实位置 miniprogram/config/env.js），
//       A–K 门禁只守 specs/、batch0_selfcheck 只载 cloudfunctions/，前端入口处于覆盖盲区 → 加了这层静态检查兜底。
//
// R28（round 12 清）：扫描面从「小程序侧」扩到 **云函数侧**。
//   理由：本项目“模块找不到”咬过两次（require('../common') 云端 MODULE_NOT_FOUND、子目录被拼成 common\xxx.js），
//         两次都在云函数侧，而原脚本只扫 app.js/pages/miniprogram/utils —— 盲区正是出过事的地方。
//   两条配套（复审方点名的前置条件）：
//     ① 先剥注释再匹配：否则注释里的示例路径（如 cx_index.js:4 的 require('./common')）会误报。
//     ② 显式豁免表：故意写错的探测性 require（smokeTest 的历史 fallback）逐条登记，不静默放过。
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

// —— 剥注释（R28①）：块注释 /* */ + 行注释 // …
//    ⚠️ 朴素实现：字符串字面量里的 "//" 也会被当行注释剥掉。本项目当前无此类写法；
//       若将来出现（如 URL），要么改用真正的词法分析，要么把该文件登记进 EXEMPT 并注明。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))          // 块注释：保留换行、内容抹平，行号不变
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length)); // 行注释：等长空格，列号不变
}

// —— 豁免表（R28②）：只允许「故意的、有据可查的」require，按 相对路径 + spec 精确登记，不写通配符。
const EXEMPT = [
  {
    file: 'cloudfunctions/smokeTest/index.js',
    spec: './common/index.js',
    why: '探针故意保留的历史 fallback：扁平化后 common/ 目录已不存在，此行永不可能成功，'
       + '它的价值正是「用它的失败来证明目录解析在云端不可用」。真判据见 fsDiag.hasCommonFile（R29）。',
  },
];
const isExempt = (relFile, spec) => EXEMPT.some((e) => e.file === relFile && e.spec === spec);

// —— 采集扫描目标：小程序侧（原范围）+ 云函数侧（R28 新增）
const files = [];
const APP = path.join(ROOT, 'app.js');
if (fs.existsSync(APP)) files.push(APP);
const mpSide = [];
for (const d of ['pages', 'miniprogram', 'utils']) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walkJs(abs, mpSide);
}
const cfRoot = path.join(ROOT, 'cloudfunctions');
const cfSide = [];
if (fs.existsSync(cfRoot)) walkJs(cfRoot, cfSide);
files.push(...mpSide, ...cfSide);

const RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const hits = [];
let total = 0, relCount = 0, exemptUsed = 0;
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const rf = rel(f);
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(src)) !== null) {
    total++;
    const spec = m[1];
    if (spec.charAt(0) !== '.') continue; // 只查相对路径
    relCount++;
    if (isExempt(rf, spec)) { exemptUsed++; continue; }
    const target = path.resolve(path.dirname(f), spec);
    const ok = fs.existsSync(target)
      || fs.existsSync(target + '.js')
      || fs.existsSync(path.join(target, 'index.js'));
    if (!ok) hits.push(rf + "  ->  require('" + spec + "')  ->  解析为 " + rel(target));
  }
}

if (hits.length) {
  console.log('❌ 相对 require 目标缺失 ' + hits.length + ' 处：');
  hits.forEach((h) => console.log('   ' + h));
  process.exit(1);
}
const mpCount = mpSide.length + (fs.existsSync(APP) ? 1 : 0);
console.log(
  '✅ 相对 require 全部可解析（扫描 ' + files.length + ' 个 .js'
  + '：小程序侧 ' + mpCount + ' / 云函数侧 ' + cfSide.length
  + '；require 语句 ' + total + ' 条，其中相对引用 ' + relCount
  + ' 条，豁免 ' + exemptUsed + ' 条）'
);
