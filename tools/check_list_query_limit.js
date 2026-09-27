// tools/check_list_query_limit.js —— R154：列表查询**必须有显式条数上限**守卫
//
// 事故模型（本轮要防的**形态缺陷**）：
//   微信云开发官方口径（cloud.tencent.com/document/product/590/19368）：
//     小程序端默认且**最多** 20 条；**云函数端默认 100 条、最多 1000 条**。
//   ⇒ `db.collection('x').where(cond).get()` **不写 .limit()** 时，云函数端默认只返回 **100 条**，
//     **第 101 条起被静默截断** —— 不报错、不告警、日志无任何线索，页面上只是"少了几条"。
//   本仓实测后果：菜品卡超过 100 道 / 原料超过 100 种 ⇒ 列表凭空少一截，老板以为数据丢了。
//   它不是性能问题，是**数据正确性缺陷**（且 109 套件门禁原本一条都没覆盖 ⇒ 属门禁盲区）。
//
// 第二个坑是**42 份同源副本漂移**：cx_dataAdapter.js 由 common/dataAdapter.js 同步生成，
//   只改其中一份 ⇒ 其余 41 份继续截断，而且看起来"改过了"。
//
// 判据（纯函数化 + 正负互证 + 反查真实单源 + 解析器自带钉死样本）：
//   L1 单源在位：cloudfunctions/common/dataAdapter.js 声明 LIST_LIMIT 且 ≤ 平台硬上限 1000
//   L2 行为正确：list() / listIncludingDeleted() 两个出口都带 .limit(LIST_LIMIT)
//   L3 副本同源：全部 cx_dataAdapter.js 副本 md5 一致且都含 limit（改一漏 41 即红）
//   L4 全仓扫描：cloudfunctions/**/*.js 里每条 collection(...).get() 要么有 .limit() 要么是 .doc() 单条取
//   L5 替身保真：本地 mock db 必须实现 limit —— 替身比平台宽容正是本缺陷长期隐身的根因之一
//   S1~S3 自失效护栏（扫描面 / 命中数 / 替身注册数下界，防"扫了空集所以全绿"）
//   C1~C6 反恒真：喂「不带 limit 的列表查询」与「缺 limit 的替身」必红；「单条 .doc().get()」「等价改写」必绿
//
// ⚠️ 输出纪律（R145 教训）：中间行不得出现「N 通过 / M 失败」字样，
//   否则 check_suite_assert_counts 会把第一条中间文案当成套件总口径。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass++; };
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}
// 去行注释（http:// 这类字符串里的双斜杠不剥；够用且可预测）
function stripComments(src) {
  return String(src || '').split(/\r?\n/).map((l) => l.replace(/(^|[^:"'`])\/\/[^\n]*$/, '$1')).join('\n');
}
// 拉平换行 ⇒ 跨行书写的链式调用也能被同一条判据覆盖（否则换行就能绕过）
function flatten(src) { return stripComments(src).replace(/\r?\n/g, ' '); }

// ===================== 判据（纯函数，可被反恒真样本直接调用） =====================
// 判据 L4：**一次 .get() 是否会被平台默认上限截断**。
//   白名单三种免罚形态：
//     ① `.doc(id).get()` —— 按主键取单条，不存在"截断"概念；
//     ② `.count()` —— 计数，本报告只看 .get()；
//     ③ 链式里带了 `.limit(<值>)` —— 显式声明了上限。
//   ⚠️ 判「有没有显式上限」，不判「上限是多少」—— 具体数值由 L1 单独守（不许超过平台 1000）。
const LOOKBACK = 320;
function judgeGetOnce(flat, getIdx) {
  const win = flat.slice(Math.max(0, getIdx - LOOKBACK), getIdx);
  const at = win.lastIndexOf('collection(');
  if (at < 0) return { ok: true, why: '本次 .get() 前没有 collection( ⇒ 不是集合查询（跳过）', skipped: true };
  const chain = win.slice(at);
  if (/\.doc\s*\(/.test(chain)) return { ok: true, why: '按 _id 取单条（.doc(...).get()），不存在截断', skipped: true };
  if (/\.limit\s*\(\s*[A-Za-z0-9_]+\s*\)/.test(chain)) return { ok: true, why: '链式里带显式 .limit(...)' };
  return { ok: false, why: '集合查询没写 .limit() ⇒ 云函数端默认只返 100 条，第 101 条起静默消失', snippet: chain.slice(-90) };
}
// 判据 L2：一个 list 出口（list / listIncludingDeleted）的函数体是否带了上限
function judgeListFn(body, name) {
  if (!body) return { ok: false, why: name + ' 函数体解析不到（fail-closed）' };
  const tail = body.slice(body.lastIndexOf('return'));
  if (!/\.get\s*\(\s*\)/.test(tail)) return { ok: false, why: name + ' 的 return 语句里没有取数（形态变了，判据需同步）' };
  if (!/\.limit\s*\(\s*LIST_LIMIT\s*\)/.test(tail)) return { ok: false, why: name + ' 取值没带 .limit(LIST_LIMIT)' };
  return { ok: true, why: name + ' 带 .limit(LIST_LIMIT)' };
}

// 判据 L5：**本地替身是否实现了 limit**。
//   为什么判它：本轮缺陷（列表默认只返 100 条）之所以长期无人察觉，除了门禁盲区，还有一条——
//   **本地替身比平台宽容**：替身 `where().get()` 会把容器里的记录全给回来，于是"取全 vs 取 100"
//   在本地根本测不出差别。⇒ 替身必须至少**不缺方法**，否则真加了 `.limit()` 反而TypeError、
//   而正确的用法在真云又测不到。
function judgeDouble(src) {
  if (src == null) return { ok: false, why: '替身文件读不到（fail-closed）' };
  if (!/collection\s*\(/.test(src)) return { ok: false, why: '不像数据库替身（缺 collection(）' };
  const hasLimit = /limit\s*\(\s*\w+\s*\)\s*\{/.test(src);
  if (!hasLimit) return { ok: false, why: '替身没有实现 limit(n) ⇒ 链式调用会 TypeError，且本地测不出平台默认上限的差异' };
  return { ok: true, why: '替身实现了 limit(n)' };
}

const CF = 'cloudfunctions';
const COMMON = CF + '/common/dataAdapter.js';
const commonSrc = read(COMMON);

console.log('===== R154 · 列表查询条数上限守卫（云函数默认 100 条截断） =====');

// ---------- L1 单源在位：LIST_LIMIT 声明且不超过平台硬上限 ----------
if (!commonSrc) {
  bad('L1 ' + COMMON + ' 不存在（列表查询没有统一出入口）');
} else {
  const m = /const\s+LIST_LIMIT\s*=\s*(\d+)\s*;/.exec(commonSrc);
  if (!m) bad('L1 ' + COMMON + ' 没有声明 LIST_LIMIT（本轮修复被删掉了）');
  else {
    const v = Number(m[1]);
    if (!(v > 100)) bad('L1 LIST_LIMIT=' + v + ' 不大于默认值 100 ⇒ 等于没修（云函数端默认就是 100）');
    else if (v > 1000) bad('L1 LIST_LIMIT=' + v + ' 超过平台硬上限 1000 ⇒ 运行时会直接报错');
    else ok('L1 ' + COMMON + ' 声明 LIST_LIMIT=' + v + '（>默认 100 且 ≤平台硬上限 1000）');
  }
}

// ---------- L2 行为：两个列表出口都带上限 ----------
if (commonSrc) {
  for (const fn of ['list', 'listIncludingDeleted']) {
    const b = fnBody(commonSrc, 'async function ' + fn);
    const r = judgeListFn(b, fn);
    if (r.ok) ok('L2 ' + fn + '() 带 .limit(LIST_LIMIT) —— ' + r.why);
    else bad('L2 ' + fn + '() —— ' + r.why);
  }
}

// ---------- L3 副本同源：42 份 cx_dataAdapter.js 不许漂移 ----------
const copies = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name);
    if (e.isDirectory()) walk(fp);
    else if (e.name === 'cx_dataAdapter.js') copies.push(fp);
  }
})(path.join(ROOT, CF));

if (copies.length < 10) {
  bad('L3 只找到 ' + copies.length + ' 份 cx_dataAdapter.js（扫描面异常，低于 10 ⇒ 大概率路径变了）');
} else {
  const groups = {};
  for (const f of copies) {
    const h = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
    (groups[h] = groups[h] || []).push(f);
  }
  const keys = Object.keys(groups);
  if (keys.length !== 1) bad('L3 cx_dataAdapter.js 副本漂移：' + keys.length + ' 种内容（改动 ' + COMMON + ' 后必须跑 tools/sync_common.js）—— ' + keys.map((k) => groups[k].length + '份').join(' / '));
  else {
    const one = fs.readFileSync(copies[0], 'utf8');
    if (!/\.limit\s*\(\s*LIST_LIMIT\s*\)/.test(one)) bad('L3 副本里没有 .limit(LIST_LIMIT) —— 同步到了旧版本');
    else ok('L3 ' + copies.length + ' 份 cx_dataAdapter.js 内容一致且都带 .limit(LIST_LIMIT)（单源同步在位）');
  }
}

// ---------- L4 全仓扫描：任何集合查询的 .get() 都不得裸奔 ----------
const offenders = [];
let scannedFiles = 0;
let getHits = 0;
(function scan(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name);
    if (e.isDirectory()) { scan(fp); continue; }
    if (!/\.js$/.test(e.name)) continue;
    const src = read(path.relative(ROOT, fp).replace(/\\/g, '/'));
    if (src == null || src.indexOf('collection(') < 0) continue;
    scannedFiles++;
    const flat = flatten(src);
    const re = /\.get\s*\(\s*\)/g;
    let m;
    while ((m = re.exec(flat))) {
      const r = judgeGetOnce(flat, m.index);
      if (r.skipped) continue;
      getHits++;
      if (!r.ok) offenders.push(path.relative(ROOT, fp).replace(/\\/g, '/') + '：' + r.snippet);
    }
  }
})(path.join(ROOT, CF));

if (offenders.length) bad('L4 有 ' + offenders.length + ' 处集合查询没带上限（第 101 条起静默消失）：\n     ' + offenders.slice(0, 8).join('\n     '));
else ok('L4 全仓云函数集合查询均已带显式上限（含 .doc() 单条取已正确豁免）');

// ---------- L5 替身保真：本地 mock db 不得缺 limit ----------
const doubles = [];
(function scanDoubles(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name);
    if (e.isDirectory()) { scanDoubles(fp); continue; }
    if (!/\.js$/.test(e.name)) continue;
    const src = read(path.relative(ROOT, fp).replace(/\\/g, '/'));
    if (src == null) continue;
    // 替身识别：既定义了集合入口，又自己 Promise.resolve({ data: … }) —— 这两条同时出现才是"手写替身"
    if (!/collection\s*\(/.test(src) || !/Promise\.resolve\(\{\s*data\s*:/.test(src)) continue;
    doubles.push({ rel: path.relative(ROOT, fp).replace(/\\/g, '/'), src });
  }
})(path.join(ROOT, CF));

if (doubles.length === 0) {
  bad('L5 一个数据库替身都没找到（扫描面异常 ⇒ 要么全仓改写成了其它形态、要么判据写窄）');
} else {
  const lacking = doubles.filter((d) => !judgeDouble(d.src).ok);
  if (lacking.length) bad('L5 有 ' + lacking.length + ' 个本地替身没实现 limit(n)（本地比平台宽容 ⇒ 截断类缺陷本地测不出）：' + lacking.map((d) => d.rel).join(' / '));
  else ok('L5 ' + doubles.length + ' 个本地替身均已实现 limit(n)（' + doubles.map((d) => d.rel.split('/').slice(-2).join('/')).join('、') + '）');
}

// ---------- S1~S3 自失效护栏 ----------
if (scannedFiles >= 200) ok('S1 扫描面完整（云函数侧 ' + scannedFiles + ' 个含数据库访问的文件，缩到 <200 即转红）');
else bad('S1 扫描面只有 ' + scannedFiles + ' 个文件（< 200 ⇒ 路径变了或被写窄）');
if (getHits >= 30) ok('S2 集合取数命中 ' + getHits + ' 处 ≥ 30（防"扫了空集所以全绿"）');
else bad('S2 集合取数仅命中 ' + getHits + ' 处（< 30 ⇒ 判据面被写窄）');
if (doubles.length >= 2) ok('S3 替身注册 ' + doubles.length + ' 个 ≥ 2（新增替身不实现 limit 即转红，删到 1 个也转红）');
else bad('S3 替身只找到 ' + doubles.length + ' 个（< 2 ⇒ 替身面被替换/写窄，L5 会退化）');

// ---------- C1~C6 反恒真：同一条判据喂正负样本 ----------
const BAD_LIST = "return db.collection(coll).where(cond).get();";
const GOOD_VAR = "return db.collection(coll).where(cond).limit(LIST_LIMIT).get();";
const GOOD_LIT = "return db.collection(coll).where(cond).limit(1000).get();";
const GOOD_DOC = "return db.collection(coll).doc(id).get();";
const c1 = judgeGetOnce(BAD_LIST, BAD_LIST.indexOf('.get()'));
const c2 = judgeGetOnce(GOOD_VAR, GOOD_VAR.indexOf('.get()'));
const c3 = judgeGetOnce(GOOD_LIT, GOOD_LIT.indexOf('.get()'));
const c4 = judgeGetOnce(GOOD_DOC, GOOD_DOC.indexOf('.get()'));
if (c1.ok) bad('C1 影子样本「裸 .get()」被判绿 ⇒ 判据无分辨力（假绿）');
else ok('C1 影子样本「裸 .get()」被判红 —— ' + c1.why);
if (!c2.ok) bad('C2 影子样本「.limit(LIST_LIMIT)」被判红 ⇒ 判据过严（假红）—— ' + c2.why);
else ok('C2 影子样本「.limit(LIST_LIMIT)」判绿（正常写法不受伤）');
if (!c3.ok) bad('C3 等价改写（写死 .limit(1000) 而非常量）被判红 ⇒ 判据在判名字不判行为 —— ' + c3.why);
else ok('C3 等价改写（.limit(1000) 字面量）判绿 ⇒ 判据判**有没有上限**不判常数名');
if (!c4.ok) bad('C4 单条取数（.doc(id).get()）被判红 ⇒ 误伤（本来不该它带上限）—— ' + c4.why);
else ok('C4 单条取数（.doc(id).get()）正确豁免 —— 它不存在截断问题');

// ---------- C5 解析器自检：注解 stripping 不得把真代码吃掉 ----------
const selfS = "/* x */ const a = db.collection('c').where(w).get(); // trailing";
const flatSelf = flatten(selfS);
const hit = flatSelf.indexOf('.get()');
const c5 = judgeGetOnce(flatSelf, hit);
if (c5.ok) bad('C5 解析器自检失败：真代码里的裸 .get() 没被识别 ⇒ L4 会是空跑');
else ok('C5 解析器自检通过（注释剥离后仍能识别真代码里的裸 .get()）');

// ---------- C6~C7 替身判据的正负样本 ----------
const DBL_BAD = "collection(name){ return { where(c){ const a=s[n].filter(d=>m(d,c)); return { get(){ return Promise.resolve({ data: a }); } }; } }; }";
const DBL_GOOD = DBL_BAD.replace('return { get(){ return Promise.resolve({ data: a }); } };',
  'return { get(){ return Promise.resolve({ data: a }); }, limit(k){ return { get(){ return Promise.resolve({ data: a.slice(0,k) }); } }; } };');
const c6 = judgeDouble(DBL_BAD);
const c7 = judgeDouble(DBL_GOOD);
const dblDiffers = DBL_GOOD !== DBL_BAD;
if (!dblDiffers) bad('C6 影子替身「带 limit」构造失败（replace 没生效）⇒ 该样本等于没跑');
else if (c6.ok) bad('C6 影子替身「缺 limit」被判绿 ⇒ 替身判据无分辨力（假绿）');
else ok('C6 影子替身「缺 limit」被判红（判据有分辨力）—— ' + c6.why);
if (!dblDiffers) bad('C7 影子样本不可用（同上）');
else if (!c7.ok) bad('C7 影子替身「带 limit」被判红 ⇒ 替身判据过严（假红）—— ' + c7.why);
else ok('C7 影子替身「带 limit」判绿（正常替身不受伤）');

// 具名函数体切分（与 check_unit_convert.js 同一套；L2 依赖它）
function fnBody(src, name) {
  if (!src) return null;
  const re = new RegExp('(?:^|[\\s,{])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length - 1;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

console.log('');
console.log('===== 列表查询条数上限守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
