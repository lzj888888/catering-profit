#!/usr/bin/env node
// tools/check_build_default_years.js —— 建店投入「摊销年限默认值」单源守卫（R297 · 第一轮查缺补漏）
//
// 为什么需要这一层（R297 实测坐实的真漏洞，不是猜的）：
//   M2「一次性建店投入」每行要填金额 + 摊销年限。年限的**默认值**有两个事实源：
//     · 机器面（引擎侧）：`cloudfunctions/common/indicatorRef.js::BUILD_DEFAULT_YEARS`
//       = { franchise:3, decor:3, equip:5, transfer:3, other:3 }，由 `calcSandbox/validate.js`
//       在 `years` 缺省时回填（单源兜底）。
//     · 人填面（页面侧）：`subpkg/tools/sandbox/index.js` 的初始行 / 新增行 / 提交装配 / 草稿回存。
//   R297 之前，页面侧根本**没有**这份默认值，而是硬兜 `years: Number(r.years) || 1`。
//   后果（全部**静默**、零报错）：
//     ① 用户清空年限输入框 ⇒ 按 **1 年**摊销 ⇒ 月摊销虚高 3 倍（equip 5 倍）
//        ⇒ 固定成本合计虚高 ⇒ **保本点 / 目标营收同步虚高**（给老板一个悲观到离谱的数）。
//     ② 云端那段 `BUILD_DEFAULT_YEARS` 单源兜底**永远走不到**（死代码）——
//        单源写了，但被前端的硬兜底架空，这正是「有单源 ≠ 生效」的同族病。
//
// 修法（本守卫锁死的东西）：
//   · 前端副本 `utils/bizPreset.js::BUILD_DEFAULT_YEARS`（小程序包不能 require 云函数目录，副本不可避免）
//   · 统一入口 `buildYearsOf(key, raw)`：空 / 0 / 负 / NaN ⇒ 回落到副本默认值；未知 key ⇒ undefined（删键，让云端兜）
//   · 页面四处（初始行 / 新增行 / 提交 / 草稿回存）**全部**改走这一个入口
//
// 判据（P/A/B/C/D 五段，fail-closed；解析不到即判红，不许静默放行）：
//   P 前置    云端单源可 require / 前端副本可 require / 四个页面文件可读
//   A 双向    前端副本 ≡ 云端单源（键集合 + 逐键值，**双向**：多键少键都红）
//   B 自洽    云端单源内部 `BUILD_DEFAULT_YEARS` 键集合 ≡ `BUILD_KEYS` 键集合（双向）
//   C 行为    `buildYearsOf` 九例（合法 / 空 / 0 / 负 / NaN / 小数取整 / 未知 key）
//   D 反硬兜底 pages/**/*.js 剥注释后**零**「年限兜 1」写法（`|| 1` / `x>0?x:1`）+ 正则正负样本互证
//   E 护栏    扫描面非空（防换机后恒绿假绿）+ 断言数下界
//
// ⚠️ 已知坑的对应处理：
//   · 坑⑭ 裸扫必误杀：D 段**先剥注释**（本仓注释里正当地引用了旧写法原文）。
//   · 坑⑱ `git ls-files` 只扫 index：本守卫**不依赖 git**，直接 fs 读工作树（工作树 = 事实）。
//
// 运行：node tools/check_build_default_years.js   （由 verify_all.js 的 [build-default-years] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLOUD_REF = 'cloudfunctions/common/indicatorRef.js';
const FE_PRESET = 'utils/bizPreset.js';
// R423 分包化：页面代码不再全在 pages/ 下
const SCAN_DIRS = ['pages', 'subpkg'];

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 剥注释（D 段用）：块注释 / html 注释 / 整行注释；**字符串字面量必须保留**
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

// 收集扫描面（pages/**/*.js，不依赖 git）
function listPageJs() {
  const out = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.js')) out.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
  return out;
}

// ============ P 前置（fail-closed）============
sec('P 前置（fail-closed：读不到 / require 不出即判红）');
let cloud = null, fe = null;
try { cloud = require(path.join(ROOT, CLOUD_REF)); } catch (e) { cloud = null; }
try { fe = require(path.join(ROOT, FE_PRESET)); } catch (e) { fe = null; }

check('P-① 云端单源可 require', !!cloud, cloud ? CLOUD_REF : `${CLOUD_REF} require 失败`);
check('P-② 前端副本可 require', !!fe, fe ? FE_PRESET : `${FE_PRESET} require 失败`);

const pageFiles = listPageJs();
check('P-③ 扫描面非空（pages/**/*.js）', pageFiles.length >= 20, `实得 ${pageFiles.length} 份 .js`);

if (!cloud || !fe) {
  console.log(`\n===== 建店年限默认值守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败（云端单源或前端副本不可用）⇒ 后续判据无意义，直接判红（fail-closed）');
  process.exit(1);
}

const C = cloud.BUILD_DEFAULT_YEARS || null;
const F = fe.BUILD_DEFAULT_YEARS || null;
check('P-④ 云端单源含 BUILD_DEFAULT_YEARS', !!C, C ? Object.keys(C).join('/') : '缺失');
check('P-⑤ 前端副本含 BUILD_DEFAULT_YEARS', !!F, F ? Object.keys(F).join('/') : '缺失');
check('P-⑥ 前端含统一入口 buildYearsOf', typeof fe.buildYearsOf === 'function', typeof fe.buildYearsOf);

if (!C || !F || typeof fe.buildYearsOf !== 'function') {
  console.log(`\n===== 建店年限默认值守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败（缺 BUILD_DEFAULT_YEARS 或 buildYearsOf）⇒ 直接判红（fail-closed）');
  process.exit(1);
}

// ============ A 双向：前端副本 ≡ 云端单源 ============
sec('A 双向逐键：前端副本 ≡ 云端单源');

function diffKeys(a, b, label) {
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  const out = [];
  for (const k of bk) if (ak.indexOf(k) < 0) out.push(`${label} 仅云端有：${k}`);
  for (const k of ak) if (bk.indexOf(k) < 0) out.push(`${label} 仅前端有：${k}`);
  for (const k of ak) if (a[k] !== b[k]) out.push(`${label}.${k} 期望 ${b[k]} / 实得 ${a[k]}`);
  return out;
}

{
  const d = diffKeys(F, C, 'years');
  check('A-① 键集合 + 逐键值双向一致（多键/少键/改值都红）', d.length === 0,
    d.length ? d.join('；') : Object.keys(C).map((k) => `${k}=${C[k]}`).join(' '));
}
// A-② 每一键都必须是 ≥1 的整数（年限不能是 0 / 负 / 小数 / 非数）
{
  const bad = Object.keys(C).filter((k) => !Number.isInteger(C[k]) || C[k] < 1);
  check('A-② 每个默认年限都是 ≥1 的整数（不得出现 0 / 负 / 小数）', bad.length === 0,
    bad.length ? bad.map((k) => `${k}=${C[k]}`).join('，') : `${Object.keys(C).length} 键全过`);
}
// A-③ 🔴 关键反退化：**任何键都不得等于 1**（=1 与旧兜底同形，等于没修）
{
  const bad = Object.keys(C).filter((k) => C[k] === 1);
  check('A-③ 无一键为 1（=1 即与 R297 兜底同形，等于没修）', bad.length === 0,
    bad.length ? '仍为 1：' + bad.join('，') : `最小 ${Math.min.apply(null, Object.keys(C).map((k) => C[k]))} 年`);
}

// ============ B 云端自洽：BUILD_DEFAULT_YEARS ≡ BUILD_KEYS ============
sec('B 云端自洽：BUILD_DEFAULT_YEARS 键集合 ≡ BUILD_KEYS 键集合（双向）');
{
  const bk = (cloud.BUILD_KEYS || []).slice().sort();
  const yk = Object.keys(C).sort();
  const onlyB = bk.filter((k) => yk.indexOf(k) < 0);
  const onlyY = yk.filter((k) => bk.indexOf(k) < 0);
  check('B-① 键集合双向一致（新增建店类型必须同时补默认年限）',
    onlyB.length === 0 && onlyY.length === 0,
    (onlyB.length || onlyY.length) ? `仅 BUILD_KEYS 有：${onlyB.join('/') || '-'}；仅年限表有：${onlyY.join('/') || '-'}`
      : `${bk.length} 键：${bk.join('/')}`);
}

// ============ C 行为级：buildYearsOf 九例 ============
sec('C 行为级：buildYearsOf 归一（合法 / 空 / 0 / 负 / NaN / 小数 / 未知 key）');
{
  const cases = [
    ['合法字符串 "3" ⇒ 3', fe.buildYearsOf('transfer', '3') === 3],
    ['合法数字 5 ⇒ 5', fe.buildYearsOf('equip', 5) === 5],
    ['空串 ⇒ 回落 equip 默认 5（🔴 旧行为是 1）', fe.buildYearsOf('equip', '') === C.equip],
    ['null ⇒ 回落默认', fe.buildYearsOf('equip', null) === C.equip],
    ['0 ⇒ 回落默认（0 年 = 除零，必须兜住）', fe.buildYearsOf('decor', 0) === C.decor],
    ['负数 ⇒ 回落默认', fe.buildYearsOf('decor', -2) === C.decor],
    ['NaN（"abc"）⇒ 回落默认', fe.buildYearsOf('franchise', 'abc') === C.franchise],
    ['小数 2.9 ⇒ 向下取整 2（不四舍五入）', fe.buildYearsOf('equip', 2.9) === 2],
    ['未知 key ⇒ undefined（删键让云端兜，绝不落 1）', fe.buildYearsOf('__nope__', '') === undefined],
  ];
  const bad = cases.filter((c) => !c[1]).map((c) => c[0]);
  check(`C-① buildYearsOf ${cases.length} 例全中`, bad.length === 0, bad.length ? '不符：' + bad.join('；') : `${cases.length}/${cases.length}`);
  // C-② 反向护栏：证明"清空年限"这条路径**真的**不再产出 1
  check('C-② 🔴 清空年限 ⇒ 不等于 1（R297 漏洞的正向钉死）',
    fe.buildYearsOf('equip', '') !== 1 && fe.buildYearsOf('transfer', '') !== 1,
    `equip 清空 ⇒ ${fe.buildYearsOf('equip', '')}；transfer 清空 ⇒ ${fe.buildYearsOf('transfer', '')}`);
}

// ============ D 反硬兜底：页面层零「年限兜 1」 ============
sec('D 反硬兜底：pages/**/*.js 剥注释后零「年限兜 1」写法');
// 判据面（两族写法，覆盖 R297 抓到的两种实然形态）：
//   ① `years: Number(x) || 1`  —— index.js 原写法（逗号/分号/换行均可收尾）
//   ② `years > 0 ? years : 1`  —— matrix.js 原写法（三元兜 1）
const RE_OR1 = /years[^\n;]*\|\|\s*1(?![\d.])/;
const RE_TERNARY = /years\s*>\s*0[^\n?]*\?[^\n:]*:\s*1(?![\d.])/;
{
  const hits = [];
  let scanned = 0;
  for (const rel of pageFiles) {
    let raw = '';
    try { raw = readRel(rel); } catch (_) { continue; }
    scanned++;
    stripComments(raw).split(/\r?\n/).forEach((l, i) => {
      if (RE_OR1.test(l) || RE_TERNARY.test(l)) hits.push(`${rel}:${i + 1} 「${l.trim().slice(0, 70)}」`);
    });
  }
  check('D-① 页面层零「|| 1」/「>0?x:1」年限兜底（剥注释后）', hits.length === 0,
    hits.length ? hits.join('；') : `${scanned} 份 .js 全扫，0 命中`);
  check('D-② 扫描面非空（防换机后恒绿假绿）', scanned >= 20, `实得 ${scanned} 份`);

  // D-③ 正则正负样本互证（证明判据既不恒假也不恒真）
  const pos = [
    ['① 型：years: Number(r.years) || 1', RE_OR1.test('years: Number(r.years) || 1')],
    ['① 型：years: Number(x) || 1,', RE_OR1.test('years: Number(x) || 1,')],
    ['② 型：years > 0 ? years : 1', RE_TERNARY.test('years > 0 ? years : 1')],
  ];
  const neg = [
    ['正常比较 years >= 1 不命中', !RE_OR1.test('years: y >= 1 ? y : d')],
    ['正常默认值 BUILD_DEFAULT_YEARS 不命中', !RE_OR1.test('years: BUILD_DEFAULT_YEARS.equip')],
    ['buildYearsOf 归一不命中', !RE_OR1.test('years: buildYearsOf(r.key, r.years)')],
    ['数字 12 不被当 1（尾随数字保护）', !RE_OR1.test('years: Number(x) || 12')],
  ];
  const badC = pos.concat(neg).filter((c) => !c[1]).map((c) => c[0]);
  check(`D-③ 判据正负样本互证 ${pos.length + neg.length} 例（${pos.length} 命中 + ${neg.length} 不误杀）`,
    badC.length === 0, badC.length ? '失败：' + badC.join('；') : `${pos.length + neg.length}/${pos.length + neg.length} 如期`);

  // D-④ 剥注释器正负样本互证（防"剥了个寂寞"或"误剥字符串"）
  const t1 = stripComments('// years: Number(r.years) || 1\nconst a=1;');
  const t2 = stripComments('/* years > 0 ? years : 1 */ const b=2;');
  const t3 = stripComments('const c = { years: Number(r.years) || 1 };');
  check('D-④ 剥注释器互证（行/块注释被剥 · 代码里保留）',
    !RE_OR1.test(t1) && !RE_TERNARY.test(t2) && RE_OR1.test(t3),
    `行注释[${RE_OR1.test(t1) ? '未剥⚠️' : '剥'}] 块注释[${RE_TERNARY.test(t2) ? '未剥⚠️' : '剥'}] 代码[${RE_OR1.test(t3) ? '保留✅' : '误剥⚠️'}]`);
}

// ============ E 自失效护栏 ============
sec('E 自失效护栏（扫描面 / 断言数下界）');
// E-① 用**真实数据**做一次变异互证：原样本零差异 / 改一个数必报出
{
  const mutate = Object.assign({}, F);
  mutate.equip = 1;
  const dSame = diffKeys(F, C, 'years');
  const dMut = diffKeys(mutate, C, 'years');
  check('E-① 原样本零差异 / 变异（equip→1）必报出', dSame.length === 0 && dMut.length >= 1,
    `原 ${dSame.length} 条 · 变异 ${dMut.length} 条（${dMut[0] || '-'}）`);
}
// E-② 断言数下界（防「删掉几组正负样本」把守卫悄悄改小）
check('E-② 本守卫断言数 ≥ 12（非恒真证明力下界）', pass >= 12, `当前累计 ${pass} 条`);

console.log(`\n===== 建店年限默认值守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
