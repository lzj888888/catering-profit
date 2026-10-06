// tools/check_dish_key_single_source.js —— R232 C-9 · 菜品名归一（dish_key）单源守卫
// 运行：node tools/check_dish_key_single_source.js   （由 verify_all.js 的 [dish-key-single] 套件调用）
//
// ===== 为什么需要它（失效是**静默**的）=====
// 写侧 importSalesBill/service.js 内联过一份 normalizeDishName，
// 读侧 getDishReview/index.js 又内联过一份 normName（注释只写「与 service.js 同口径」），
// 环上**零守卫**。一旦任一侧改了归一规则（哪怕只是多 trim 一个字符）：
//   写侧写进库的 dish_key  ≠  读侧拿去匹配成本卡的 key
//   ⇒ **所有菜都匹配不上** ⇒ 用户看到「所有菜都没成本」
//   ⇒ 而且**没有任何报错**（只是 unmatched 变多）—— 这是最坏的一类 bug。
// ⇒ 单源上提到 cloudfunctions/common/dishKey.js，两侧一律引用；本守卫把这条钉死。
//
// ===== 🔴 守卫写法纪律：判行为不判字面 =====
// 本轮实证（V4）：只查函数名/字面串的判据会被**我自己写的注释**喂成恒绿
// （注释里提到 common.dishKey ⇒ 字面匹配命中 ⇒ 删了实现也不红），且换名即绕过。
// ⇒ ① 一律先 stripComments() 再做结构判据；
//    ② 行为等价用**函数引用恒等（`===`）**判定，而不是重算一遍再跟自己比；
//    ③ 本地内联检测查**算法特征串**（`.normalize('NFKC')`）而非函数名，改名也抓得住。
//
// ===== 🔴 输出纪律 =====
// 顶部横幅**不得**用 `===== … =====` 装饰：R66 的 SECTION_HEAD 会把它识别成
// 一个「零 ✅ 的段标题」（非末段不豁免）⇒ 断言全绿也判红。保持纯文本。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SINGLE_REL = 'cloudfunctions/common/dishKey.js';
const INDEX_REL = 'cloudfunctions/common/index.js';
const WRITE_REL = 'cloudfunctions/importSalesBill/service.js';
const READ_REL = 'cloudfunctions/getDishReview/index.js';

let pass = 0, failN = 0;
const sec = (t) => console.log('\n===== ' + t + ' =====');
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// 剥注释（块注释 + 行注释）—— 防止「注释里的字面量把字面判据喂成恒绿」
function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*/gm, '')
    .replace(/[ \t]+\/\/[^\n]*/g, '');
}
const rd = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '');

// ---------- 加载单源与聚合入口（fail-closed）----------
let single = null, agg = null;
try { single = require(path.join(ROOT, SINGLE_REL)); } catch (e) { single = null; }
try { agg = require(path.join(ROOT, INDEX_REL)); } catch (e) { agg = null; }

console.log('# R232 C-9 守卫 —— 菜品名归一(dish_key)单源（分叉 = 全菜匹配不上且不报错）');

sec('① 单源可达（fail-closed）');
check('1-① common/dishKey.js 可加载且导出 normalizeDishName',
  !!(single && typeof single.normalizeDishName === 'function'),
  single && typeof single.normalizeDishName === 'function' ? 'function' : '🔴 单源不可达');
check('1-② 聚合入口 common/index.js 已导出 dishKey + normalizeDishName（漏导 ⇒ 真云 TypeError）',
  !!(agg && agg.dishKey && typeof agg.normalizeDishName === 'function'),
  agg ? (agg.dishKey ? 'dishKey ✓ / normalizeDishName ' + typeof agg.normalizeDishName : '🔴 漏导 dishKey') : '🔴 入口加载失败');

// common/ 全层零外部依赖 —— 否则 importSalesBill/service.js（只 stub xlsx）与本地守卫都加载不了
const commonDir = path.join(ROOT, 'cloudfunctions', 'common');
const extDeps = [];
for (const f of fs.readdirSync(commonDir)) {
  if (!f.endsWith('.js')) continue;
  const src = stripComments(rd('cloudfunctions/common/' + f));
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) if (!/^\.\.?\//.test(m[1])) extDeps.push(f + '→' + m[1]);
}
check('1-③ common/ 全层零外部依赖（否则纯逻辑层被污染、本地守卫加载不了）',
  extDeps.length === 0, extDeps.length === 0 ? '0 个外部 require' : '🔴 ' + extDeps.join(', '));

sec('② 两侧不得再有本地内联（剥离注释后 · 查算法特征串而非函数名）');
const writeCode = stripComments(rd(WRITE_REL));
const readCode = stripComments(rd(READ_REL));
const FEATURE = "normalize('NFKC')";   // 该归一算法的特征实现；改名/换行都抓得住

check('2-① 写侧代码里无本地归一实现（不得含 .normalize(\'NFKC\')）',
  !!writeCode && writeCode.indexOf(FEATURE) < 0,
  writeCode.indexOf(FEATURE) < 0 ? '无本地实现' : '🔴 仍内联了一份（改了就分叉）');
check('2-② 读侧代码里无本地归一实现（原 normName 已删除）',
  !!readCode && readCode.indexOf(FEATURE) < 0 && !/function\s+normName\b/.test(readCode),
  readCode.indexOf(FEATURE) < 0 ? '无本地实现' : '🔴 仍内联了一份');
check('2-③ 两侧均从单源取（写侧 require(\'./common\')；读侧 common.dishKey / common.normalizeDishName）',
  /require\(\s*['"]\.\/common['"]\s*\)/.test(writeCode)
  && /common\.dishKey|common\.normalizeDishName/.test(readCode),
  '写侧 ' + (/require\(\s*['"]\.\/common['"]\s*\)/.test(writeCode) ? '✓' : '✗')
  + ' / 读侧 ' + (/common\.dishKey|common\.normalizeDishName/.test(readCode) ? '✓' : '✗'));

sec('③ 行为等价（函数引用恒等 · 不是重算一遍跟自己比）');
let svc = null;
try {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  try { svc = require(path.join(ROOT, WRITE_REL)); } finally { Module._load = orig; }
} catch (e) { svc = null; }

// ⚠️ 这里**不能**用 `===`：本仓是「单源 + 扁平派生」范式 ——
//   本守卫 require 的是单源 cloudfunctions/common/dishKey.js，
//   而 service.js 经 require('./common') 拿到的是派生副本 importSalesBill/cx_dishKey.js，
//   **两个独立文件 ⇒ 必然是两个函数对象**，`===` 恒不成立（本轮首跑就红在这）。
//   ⇒ 只能判**行为等价**：喂同一组样本，断言两侧返回值逐一相同。
const CASES_EARLY = [
  ['  Ａ１  ', 'A1'], ['耙牛肉（大份）', '耙牛肉(大份)'], ['  小面  ', '小面'],
  [null, ''], [undefined, ''], [123, '123'], ['', ''], ['Ａ-Ｂ　Ｃ', 'A-B C'],
];
let wEq = true, wDiff = [];
if (svc && single) {
  for (const [inp] of CASES_EARLY) {
    const a = svc.normalizeDishName(inp), b = single.normalizeDishName(inp);
    if (a !== b) { wEq = false; wDiff.push(JSON.stringify(inp) + ': 写侧' + JSON.stringify(a) + ' vs 单源' + JSON.stringify(b)); }
  }
} else { wEq = false; wDiff.push('加载失败'); }
check('3-① 写侧 service.js 导出的 normalizeDishName 与单源**行为等价**（8 样本返回值全等）',
  wEq, wEq ? '8/8 行为一致（派生副本 ⇒ 不能比引用，只能比行为）' : '🔴 ' + wDiff.join(' ; '));
check('3-② 聚合入口 normalizeDishName ≡ 单源函数（=== ⇒ 读侧从 common 取即必然同口径）',
  !!(agg && single && agg.normalizeDishName === single.normalizeDishName),
  agg && single ? (agg.normalizeDishName === single.normalizeDishName ? '同一引用' : '🔴 不同实现') : '🔴 加载失败');

// 行为样本（口径写死）：trim + NFKC 归一；⚠️ NFKC 会把全角括号转成半角，但**不删除**括号/规格后缀
const CASES = [
  ['  Ａ１  ', 'A1', '全角→半角 + 首尾 trim'],
  ['耙牛肉（大份）', '耙牛肉(大份)', '括号与规格后缀**保留**（NFKC 仅转半角，不删）'],
  ['  小面  ', '小面', '纯 trim'],
  [null, '', 'null ⇒ 空串（不得 throw）'],
  [undefined, '', 'undefined ⇒ 空串'],
  [123, '123', '数字 ⇒ 字符串'],
];
let allOk = true, gotList = [];
for (const [inp, want] of CASES) {
  const got = single ? single.normalizeDishName(inp) : null;
  gotList.push(JSON.stringify(inp) + '→' + JSON.stringify(got));
  if (got !== want) allOk = false;
}
check('3-③ 单源行为符合口径（6 个样本：trim / NFKC / 保留括号 / null / undefined / 数字）',
  allOk, allOk ? '6/6 —— ' + gotList.slice(0, 3).join(' , ') : '🔴 ' + gotList.join(' , '));

sec('④ 自失效护栏（样本有效 · 分叉确会静默失效）');
// 4-① 样本必须有区分力：若不做归一，'  Ａ１  ' 会保持原样 ⇒ 与 'A1' 不同
const rawKeep = '  Ａ１  ';
check('4-① 样本有区分力（未归一则 ≠ 归一眼 ⇒ 本守卫非恒绿）',
  rawKeep !== 'A1', JSON.stringify(rawKeep) + ' ≠ "A1"');
// 4-② 模拟「任一侧改了规则」：变体多做一个「去括号内容」⇒ 同一菜名得到不同 key ⇒ 匹配不上。
//   ⚠️ 首版用 toLowerCase 做变体，但**中文没有大小写** ⇒ 变体结果与单源完全相同、无区分力（假绿）。
//   必须选一个对中文菜名**确实有作用**的规则改动。
const variant = (n) => String(n == null ? '' : String(n).trim().normalize('NFKC')).replace(/[（(][^）)]*[）)]/g, '');
const dishName = '耙牛肉（大份）';
const kWrite = single.normalizeDishName(dishName);
const kReadVariant = variant(dishName);
check('4-② 规则分叉 ⇒ 写侧 key 与读侧 key 不等价（正是「全菜匹配不上且不报错」的成因）',
  kWrite !== kReadVariant,
  '写侧 ' + JSON.stringify(kWrite) + ' vs 变体读侧 ' + JSON.stringify(kReadVariant));
// 4-③ stripComments 自证有效（否则 ② 段判据会被注释骗过 —— V4 实证）
const probe = "line\n// " + FEATURE + "\n/* " + FEATURE + " */\ncode";
check('4-③ stripComments 确能剥掉注释里的特征串（否则 ② 段会被注释喂成恒绿）',
  stripComments(probe).indexOf(FEATURE) < 0,
  '剥后不含 ' + FEATURE);

console.log(`\n===== dish_key 单源守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
