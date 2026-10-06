// tools/check_fn_deps.js —— R233 · 云函数「外部依赖声明」守卫
// 运行：node tools/check_fn_deps.js   （由 verify_all.js 的 [fn-deps] 套件调用）
//
// ===== 为什么立这条（R233 变动面审计后立项）=====
// 云函数部署到微信云端时，**只有 package.json 里声明的依赖会被云端安装**。
// 漏声明的后果不是"报错"，而是**容器起不来** —— `wx.cloud.callFunction` 直接 fail，
// 前端 `utils/api.js` 只能收到一个 cloud 调用失败 ⇒ 页面显示「网络不可用 / 请检查网络连接」。
// 这条故障是**本仓有真实记录的**：api.js 里那段 2026-09-20 诊断注释写得很清楚
// （真机事故的真实原因是"部署漏带依赖导致容器起不来"，却只显示网络错误，排查了一整轮）。
//
// 而 `xlsx`（R181l 引入于 importSalesBill）是**全仓第一个、也是当前唯一一个非原生依赖**
// ⇒ "require 了却没声明"这一类风险**刚刚变成活的**：
//   · 此前所有云函数只 require 相对路径 + node 内置 + wx-server-sdk（wx-server-sdk 是模板自带的）；
//   · 现在多了一个"需要云端装包"的依赖，而**没有任何守卫在看 package.json 与 require 是否对得上**。
//
// 实测两个方向都没人守（R233 逐个确认过）：
//   · `tools/check_requires.js` 只验**相对路径**目标文件是否存在（管不到裸模块名）；
//   · `tools/check_fn_inventory.js` 只验「契约文档 ↔ 函数目录名」+ selftest 覆盖面；
//   · `tools/check_fn_public_surface.js` 只验鉴权分类；
//   · 于是 `dependencies` 这一层是**门禁盲区**。
//
// ===== 判据（双向，缺一不可）=====
//   S 扫描面（全部 fail-closed —— 上限/计数类判据一旦扫空就恒绿）：
//     S-① 函数目录数 ≥ MIN_FN；S-② 扫到的 .js 数 ≥ MIN_JS；
//     S-③ **非原生 require 条数 ≥ 1 且必须含锚点 `importSalesBill:xlsx`**
//         —— 这一条是自失效护栏：把扫描写窄（例如只扫 index.js）会让 S-③ 直接红。
//   A 正向（require ⊆ deps）：每个 require 到的非原生模块**必须**在该函数的 dependencies 里。
//   B 反向（deps ⊆ require）：每个声明的包**必须**真的被 require —— 防"声明了没用"的僵尸依赖
//     （同族于 §10.7：配置型单源要反向查多余，不能只正向查存在）。
//   C 自检：合成样本证明判定函数**有分辨力**（未声明要报、已声明要放行、内置/相对不得误伤）+
//     断言数下界（防"删断言"）。
//
// 🔴 **不判"字面"判"事实"**：require 一律先剥注释再扫；`node:` 前缀与 `mod.x` 子路径都要归一
//    （`require('xlsx/xlsx.js')` 与 `require('xlsx')` 是同一个包）。

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');

// 非函数目录（共享模块 / admin 复用内核）—— 与 check_fn_public_surface.js::NON_FN 同口径
const NON_FN = ['common', '_adminCore'];

const MIN_FN = 40;      // 实测 46 的保守下沿
const MIN_JS = 250;     // 实测约 300 的保守下沿

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ===== 剥注释（必须先做：注释里的示例 require 会自我命中）=====
// 块注释整体去掉；行注释只剥「行首或空白后紧接 //」的那种 —— 避免把 `http://…` 后半行吃掉。
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

// ===== 内置模块判定（含 node: 前缀）=====
const BUILTIN = new Set(Module.builtinModules || []);
function isBuiltin(mod) {
  return BUILTIN.has(mod) || BUILTIN.has(mod.replace(/^node:/, ''));
}

// ===== 从一个 .js 源码里解析「非原生（需外部安装）模块名」=====
// 归一：去掉 node: 前缀；子路径 `xlsx/lib` → 取首段 `xlsx`（scoped 包取两段）；同一文件内去重。
function externalsOf(code) {
  const seen = new Set();
  const out = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    let spec = m[1];
    if (spec.startsWith('.')) continue;                 // 相对路径 ⇒ check_requires.js 管
    if (/^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/')) continue;  // 绝对路径
    if (spec.startsWith('node:')) spec = spec.slice(5);
    if (isBuiltin(spec)) continue;
    const parts = spec.split('/');
    const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    out.push(pkg);
  }
  return out;
}

// ===== 收集函数目录 =====
const fnDirs = fs.readdirSync(CF, { withFileTypes: true })
  .filter((d) => d.isDirectory() && NON_FN.indexOf(d.name) < 0)
  .map((d) => d.name).sort();

function jsFilesOf(dir) {
  const out = [];
  (function walk(p) {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const q = path.join(p, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith('.js')) out.push(q);
    }
  })(dir);
  return out;
}

// ===== 核心判定：一个函数（dir=目录名，abs=绝对路径）→ 判定结果 =====
function judgeDir(dir, abs) {
  const files = jsFilesOf(abs);
  const required = new Set();
  for (const f of files) {
    for (const pkg of externalsOf(stripComments(fs.readFileSync(f, 'utf8')))) required.add(pkg);
  }
  const pjPath = path.join(abs, 'package.json');
  let declared = null, parseErr = null;
  if (!fs.existsSync(pjPath)) {
    parseErr = 'NO_PACKAGE_JSON';
  } else {
    try {
      const j = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
      const d = j.dependencies;
      if (!d || typeof d !== 'object' || Array.isArray(d)) parseErr = 'NO_DEPENDENCIES';
      else declared = d;
    } catch (e) { parseErr = 'BAD_JSON:' + e.message; }
  }
  const declaredKeys = declared ? Object.keys(declared).sort() : [];
  const miss = declared ? [...required].filter((r) => declaredKeys.indexOf(r) < 0).sort() : [];
  const extra = declared ? declaredKeys.filter((k) => !required.has(k)) : [];
  const badVer = declared ? declaredKeys.filter((k) => typeof declared[k] !== 'string' || !declared[k].trim()) : [];
  return { dir, files: files.length, required: [...required].sort(), declared: declaredKeys, miss, extra, badVer, parseErr };
}

console.log('===== S · 扫描面（fail-closed）=====');
check('S-① 函数目录数 ≥ ' + MIN_FN, fnDirs.length >= MIN_FN, '实测 ' + fnDirs.length + ' 个');

const results = fnDirs.map((d) => judgeDir(d, path.join(CF, d)));
const totalJs = results.reduce((s, r) => s + r.files, 0);
check('S-② 扫到的 .js 文件数 ≥ ' + MIN_JS, totalJs >= MIN_JS, '实测 ' + totalJs + ' 个');

// 🔴 S-③ 自失效护栏：非原生 require 必须真的被扫到，且锚点在集合里。
//   若有人把扫描写窄（只扫 index.js / 只白名单某几个目录），锚点会消失 ⇒ 本条直接红。
const extPairs = [];
results.forEach((r) => r.required.forEach((p) => extPairs.push(r.dir + ':' + p)));
const hasAnchor = extPairs.indexOf('importSalesBill:xlsx') >= 0;
check('S-③ 非原生 require 扫描非退化（条数 ≥ 1 且含锚点 importSalesBill:xlsx）',
  extPairs.length >= 1 && hasAnchor,
  extPairs.length + ' 条' + (hasAnchor ? ' · 锚点在位' : ' · ❌ 锚点缺失（扫描面可能被写窄）'));

console.log('\n===== A · 正向：require 的非原生模块必须已声明（否则云端不装包 ⇒ 容器起不来）=====');
const noPj = results.filter((r) => r.parseErr === 'NO_PACKAGE_JSON').map((r) => r.dir);
check('A-① 每个函数目录都有 package.json', noPj.length === 0,
  noPj.length ? '缺：' + noPj.join(', ') : results.length + ' 个全有');

const badPj = results.filter((r) => r.parseErr && r.parseErr !== 'NO_PACKAGE_JSON');
check('A-② 每个 package.json 可解析且含非空 dependencies 对象', badPj.length === 0,
  badPj.length ? '异常：' + badPj.map((r) => r.dir + '(' + r.parseErr + ')').join(', ') : '全部可解析');

const missAll = [];
results.forEach((r) => r.miss.forEach((p) => missAll.push(r.dir + ' → ' + p)));
check('A-③ 每个被 require 的非原生模块都在该函数 dependencies 里', missAll.length === 0,
  missAll.length ? '缺声明：' + missAll.join(' | ') : extPairs.length + ' 处 require 全部有声明');

const badVerAll = [];
results.forEach((r) => r.badVer.forEach((k) => badVerAll.push(r.dir + ':' + k)));
check('A-④ 每个声明的依赖版本号是非空字符串', badVerAll.length === 0,
  badVerAll.length ? '版本号异常：' + badVerAll.join(', ') : '版本号齐备');

console.log('\n===== B · 反向：声明的每个包都必须真被 require（防僵尸依赖）=====');
const extraAll = [];
results.forEach((r) => r.extra.forEach((k) => extraAll.push(r.dir + ' → ' + k)));
check('B-① 每个声明的包都被实际 require（多余声明即红）', extraAll.length === 0,
  extraAll.length ? '声明未用：' + extraAll.join(' | ') : '无僵尸依赖');

console.log('\n===== C · 自检（判定函数必须对合成样本有分辨力）=====');
const SYN_UNDECLARED = "const X = require('left-pad');\nmodule.exports = { X };";
const SYN_DECLARED = "const X = require('chalk');\nrequire('chalk/lib/x.js');\nconst c = require('crypto');\nconst l = require('./cx_utilTime');\nmodule.exports = { X, c, l };";
const eUnd = externalsOf(SYN_UNDECLARED);
const eDec = externalsOf(SYN_DECLARED);

check('C-① 合成样本：未声明模块被解析出来（否则 A-③ 恒绿）',
  eUnd.length === 1 && eUnd[0] === 'left-pad', JSON.stringify(eUnd));
check('C-② 合成样本：已声明模块 + 子路径归一 + 内置/相对被剔除',
  eDec.length === 1 && eDec[0] === 'chalk', JSON.stringify(eDec));
check('C-③ 合成样本：注释里的 require 必须被剥掉（否则误报）',
  externalsOf(stripComments("// const a = require('ghost-a');\n/* require('ghost-b') */\nconst r = 1;")).length === 0,
  '注释内 require 已剔除');

const TOTAL = pass + failN + 1;   // +1 = 本条自身
check('C-④ 断言数 ≥ 11（防"删断言"；实测 12 的保守下沿）', TOTAL >= 11, '实测 ' + TOTAL + ' 条');

console.log('\n===== 云函数外部依赖声明守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
