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
//    ⚠️ 朴素实现：字符串字面量里的 "//" 也会被当行注释剥掉。例如 `const p = "a//b";`
//       之后若还有 `require(...)`，会连同 // 一起被抹成注释 → 静默漏检（round13 复核登记）。
//       本项目当前无此类写法；若将来出现（如 URL、含 // 的字符串字面量），要么改用真正的
//       词法分析，要么把该文件登记进 EXEMPT 并注明。
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

// =====================================================================
// §2 · common 解构符号「导出完整性」守卫（2026-09-18 真云事故伴侣）
// 背景：cloudfunctions/common/auth.js 早已 export genId，但聚合入口 common/index.js
//       **漏导**；7 个云函数写 `const { ..., genId } = common` ⇒ 云端运行期
//       `TypeError: genId is not a function`，且 getShopContext 建店分支首当其冲
//       ⇒ **全新用户首次进入必崩**。
//       而门禁 L 只守「扁平副本 ≡ 单源」（副本忠实 = 漏导也被忠实地复制了），
//       check_requires §1 只守「require 路径存在」（路径存在 ≠ 符号存在）⇒ 两层都漏。
// 判据：从单源 common/index.js 静态解析出导出键集合；凡云函数里解构/点取的符号不在其中 ⇒ 判红。
// ⚠️ 为什么静态解析而不是 require()：auth.js 会拉 wx-server-sdk，node 侧跑不起来。
// =====================================================================
const COMMON_INDEX = path.join(ROOT, 'cloudfunctions', 'common', 'index.js');
const strip = (s) => stripComments(s);

function exportedKeys(src) {
  const keys = new Set();
  const body = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?\s*$/m);
  if (!body) return keys;
  for (const line of body[1].split('\n')) {
    let m = line.match(/^\s*([A-Za-z_]\w*)\s*:/);          // key: value
    if (m) { keys.add(m[1]); continue; }
    m = line.match(/^\s*([A-Za-z_]\w*)\s*,/);              // 简写 key,
    if (m) keys.add(m[1]);
  }
  return keys;
}

let s2Fail = 0;
if (fs.existsSync(COMMON_INDEX)) {
  const KEYS = exportedKeys(strip(fs.readFileSync(COMMON_INDEX, 'utf8')));
  const used = [];   // { file, sym, how }
  for (const f of cfSide) {
    const rf = rel(f);
    if (rf.startsWith('cloudfunctions/common/')) continue;      // 单源自身不参与
    if (/(^|\/)cx_[a-zA-Z]+\.js$/.test(rf)) continue;           // 扁平副本 = 被检查对象，不是使用方
    if (rf.endsWith('/common.js')) continue;                    // 派生入口桩
    const src = strip(fs.readFileSync(f, 'utf8'));
    // 解构：const { a, b } = common;
    for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*common\s*;/g)) {
      for (const raw of m[1].split(',')) {
        const s = raw.trim().split(/\s+as\s+/)[0].trim();
        if (s) used.push({ file: rf, sym: s, how: '解构' });
      }
    }
    // 点取：common.xxx
    for (const m of src.matchAll(/\bcommon\.([A-Za-z_]\w*)/g)) {
      if (m[1] === 'js') continue;                              // './common.js' 之类的字符串噪声
      used.push({ file: rf, sym: m[1], how: '点取' });
    }
  }
  const missing = used.filter((u) => !KEYS.has(u.sym));
  // 断言不得恒真：单源至少得解析出已知键，否则说明解析写歪了（守卫自己失效）
  const MIN_KEYS = ['ok', 'fail', 'ERROR_CODES', 'resolveAuth', 'assertShopOwner', 'genId'];
  const absent = MIN_KEYS.filter((k) => !KEYS.has(k));
  if (absent.length || KEYS.size < 8) {
    console.log('❌ §2 守卫自失效：单源 common/index.js 解析出的导出键不足/缺 '
      + absent.join(',') + '（实际 ' + KEYS.size + ' 个）⇒ 解析逻辑写歪，不许算通过');
    s2Fail++;
  }
  if (missing.length) {
    console.log('❌ common 解构了未导出的符号 ' + missing.length + ' 处（云端运行期必 TypeError）：');
    for (const u of missing) console.log(`   ${u.file}  ${u.how}  common.${u.sym}`);
    s2Fail++;
  } else {
    const uniq = new Set(used.map((u) => u.sym));
    console.log('✅ §2 common 解构符号均已导出（引用 ' + used.length + ' 处 / '
      + uniq.size + ' 个符号；单源导出 ' + KEYS.size + ' 个键）');
  }
} else {
  console.log('❌ §2 找不到单源 cloudfunctions/common/index.js ⇒ 守卫无法生效，判红');
  s2Fail++;
}

if (hits.length || s2Fail) {
  if (hits.length) {
    console.log('❌ 相对 require 目标缺失 ' + hits.length + ' 处：');
    hits.forEach((h) => console.log('   ' + h));
  }
  process.exit(1);
}
const mpCount = mpSide.length + (fs.existsSync(APP) ? 1 : 0);
console.log(
  '✅ 相对 require 全部可解析（扫描 ' + files.length + ' 个 .js'
  + '：小程序侧 ' + mpCount + ' / 云函数侧 ' + cfSide.length
  + '；require 语句 ' + total + ' 条，其中相对引用 ' + relCount
  + ' 条，豁免 ' + exemptUsed + ' 条）'
);
