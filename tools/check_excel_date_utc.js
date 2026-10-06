#!/usr/bin/env node
// tools/check_excel_date_utc.js —— R232 C-11/C-10 时间口径守卫（Excel 日期单元格 + 月份铁律）
// 运行：node tools/check_excel_date_utc.js   （由 verify_all.js 的 [excel-date-utc] 套件调用）
//
// ===== 为什么需要它（本轮是「验收后才发现」的真缺口，不是纸面演练）=====
//   R232 给批次 G 做端到端审查时，发现时间口径两处错：
//
//   C-11（潜伏雷 · 实证修前 0/4 全错）
//     Node 里 `new Date(1899, 11, 30)` 落在 **GMT+0805** —— 1899 年中国尚未采用标准时区，
//     tzdata 保留的是 LMT 地方平时（比 +0800 少约 5′43″）。SheetJS（xlsx, cellDates:true）
//     正是用这个 basedate 做 setTime(serial*86400000 + basedate) ⇒ 整整一天的时间戳落在
//     **23:54:17** 而非午夜 ⇒ 取日历日时**系统性早一天**。
//     ⇒ 整张表的 biz_date 错位一天、且**全程零报错**。
//
//   C-10（现在就算错）
//     getDishReview 重写了一份 monthOf()（本地时区），而单源 common/utilTime.js::toMonth
//     用 UTC，且 utilTime 文件头明文写着「铁律：时间统一 UTC」。
//     ⇒ 每月 1 日 00:00~08:00（UTC+8）创建的成本卡，snapshot_month 算出**上一个**月。
//
// ===== 🔴 守卫写法纪律：判行为不判字面 =====
//   我最初设计的判据是「扫描源码里的 getFullYear() / getMonth() 并判红」—— **这个判据是错的**！
//   因为两种数据来源要求相反的读法：
//     · created_at（nowUtc()，真 UTC 时间戳）   → **必须** getUTC*
//     · SheetJS cellDates 的 Date（本地构造）   → **必须** get*（改成 getUTC* 反而更错）
//   ⇒ 按字面判据落地会把 **正确** 的实现改成 **错误**（反向伤害二型）。
//   本守卫因此**不扫字面**，改为：把真实 Excel 序列号喂进**生产函数**，断言**返回值**（行为判据）。
//
// 判据：fail-closed（读不到模块 / 取不到函数一律判红，不静默放行）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVC_REL = 'cloudfunctions/importSalesBill/service.js';
const REVIEW_REL = 'cloudfunctions/getDishReview/index.js';
const UTIL_REL = 'cloudfunctions/common/utilTime.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 加载 service.js（stub xlsx：本地无该外部包，与 check_m333_parse.js 同手法）----------
let svc = null;
try {
  svc = require(path.join(ROOT, SVC_REL));
} catch (e) {
  if (/xlsx/.test(String(e.message || ''))) {
    const Module = require('module');
    const orig = Module._load;
    Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
    try { svc = require(path.join(ROOT, SVC_REL)); } catch (e2) { svc = null; }
    finally { Module._load = orig; }
  }
}

// ---------- 工具：复现 SheetJS 实际吐出的 Date ----------
// SheetJS 的 basedate 用**本地时区**构造（→ 历史时区偏移），这里如实复现，才能验到真实入口值。
function sheetJsDate(serial) {
  const basedate = new Date(1899, 11, 30, 0, 0, 0);
  const d = new Date();
  d.setTime(serial * 86400000 + basedate.getTime());
  return d;
}

// 注意：此处横幅不能用 `===== ... =====` 装饰 —— R66 的 SECTION_HEAD 会把它识别成一个
// 「零 ✅ 的段标题」并判红（本轮首次全量 145/146 就是被它打下来的）。保持纯文本横幅。
console.log('# R232 时间口径守卫 —— Excel 日期单元格失准(C-11) + 月份 UTC 铁律(C-10)');

sec('① 模块可达（fail-closed）');
check('1-① service.js 可加载', !!svc, svc ? Object.keys(svc).length + ' 个导出' : '加载失败');
check('1-② fmtCell 已导出（否则守卫无法验证日期口径）',
  !!(svc && typeof svc.fmtCell === 'function'),
  svc && typeof svc.fmtCell === 'function' ? 'function' : '🔴 未导出 —— 修了也无人可验');
check('1-③ 生产存在有效的时区偏移（本机应非零，否则本守卫失去意义）',
  new Date(2026, 8, 16).getTimezoneOffset() !== 0,
  'offset(min) = ' + new Date(2026, 8, 16).getTimezoneOffset());

// ---------- C-11：真实营业日闭环 ----------
// 期望值由 Python 侧独立算出（date(1899,12,30) + serial 天），与本守卫形成交叉验证。
sec('② C-11 · Excel 日期单元格 → biz_date 不得早一天');
const cases = [
  [46278, '2026-09-13'],
  [46272, '2026-09-07'],
  [46296, '2026-10-01'],
  [46250, '2026-08-16'],
  [1, '1899-12-31'],
];
if (svc && typeof svc.fmtCell === 'function') {
  let ok = 0;
  for (const [s, want] of cases) {
    const got = svc.fmtCell(sheetJsDate(s));
    if (got === want) ok++;
    else console.log(`      · serial ${s}: 期望 ${want} / 实返 ${got}`);
  }
  check(`2-① fmtCell 对 ${cases.length} 个真实序列号全部读出正确日历日`, ok === cases.length, `${ok}/${cases.length}`);

  // 非日期分支不得被破坏
  check('2-② 非 Date 入参仍走字符串分支（不得误伤）',
    svc.fmtCell('2026-09-13') === '2026-09-13' && svc.fmtCell(null) === '' && svc.fmtCell(123) === '123',
    `'2026-09-13' / null / 123 均正确`);
} else {
  check('2-① fmtCell 日期闭环', false, 'fmtCell 不可达');
  check('2-② 字符串分支', false, 'fmtCell 不可达');
}

// ---------- 🔴 自失效护栏：样本必须真的跑到被测代码 ----------
// 教训：R232 前 C-11 之所以长期无人发现，正因为**没有任何样本走 fmtCell 的 Date 分支**。
sec('③ 自失效护栏（样本有效性 —— 防止本守卫恒绿）');
check('3-① 传入的确实是 Date 实例（会命中 instanceof Date 分支）',
  sheetJsDate(46278) instanceof Date, 'instanceof Date = true');
check('3-② 样本确实带历史时区偏移（SheetJS 引入缺陷的前提仍成立）',
  (() => {
    const d = sheetJsDate(46278);
    // 若偏移量已被抹平，说明环境变了、本守卫失去意义 ⇒ 必须显式报告
    return d.getHours() === 23 && d.getMinutes() === 54;
  })(),
  '落在 23:54 ⇒ 正是导致早一天的时刻');
check('3-③ basedate 基准为 UTC 构造（不得是 new Date(1899,11,30)）',
  (() => {
    if (!svc || svc.EXCEL_UTC_BASE === undefined) return false;
    return svc.EXCEL_UTC_BASE === Date.UTC(1899, 11, 30);
  })(),
  svc && svc.EXCEL_UTC_BASE !== undefined
    ? 'EXCEL_UTC_BASE = ' + svc.EXCEL_UTC_BASE + (svc.EXCEL_UTC_BASE === Date.UTC(1899, 11, 30) ? ' ≡ Date.UTC(1899,11,30)' : ' ≠ Date.UTC(1899,11,30)')
    : '未导出 EXCEL_UTC_BASE');

// ---------- C-10：getDishReview 不得重写月份格式化 ----------
sec('④ C-10 · 月份口径必须走单源 toMonth（UTC 铁律）');
const reviewSrc = fs.existsSync(path.join(ROOT, REVIEW_REL))
  ? fs.readFileSync(path.join(ROOT, REVIEW_REL), 'utf8') : '';
const utilSrc = fs.existsSync(path.join(ROOT, UTIL_REL))
  ? fs.readFileSync(path.join(ROOT, UTIL_REL), 'utf8') : '';

// 🔴🔴 结构判据**必须在剥离注释后**进行 —— 否则会被注释里的字面骗过。
//   实证（本守卫自变异 V4）：检查 `/common\.utilTime/` 时，源文件**注释**里恰好写了
//   「用法与 adminExport 一致（const { ... } = common.utilTime）」 ⇒ 即使把他体的引用删光、
//   换成一份本地重写，该判据**依然绿**。守卫被自己的注释绕过 —— 与 réel 缺陷零区别。
//   ⇒ 纪律：凡检查「某符号是否出现在源码里」，一律先 stripComments()。
function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/^[ \t]*\/\/[^\n]*/gm, '')  // 整行注释
    .replace(/[ \t]+\/\/[^\n]*/g, '');   // 行尾注释
}
const reviewCode = stripComments(reviewSrc);

check('4-① 单源 utilTime.js 仍用 UTC（getUTC* 取月份）',
  /getUTCFullYear\(\)/.test(utilSrc) && /getUTCMonth\(\)/.test(utilSrc),
  'toMonth 用 getUTC*');
check('4-② getDishReview **代码里**（非注释）确从 common.utilTime 取 toMonth',
  /common\.utilTime/.test(reviewCode) && /toMonth/.test(reviewCode),
  '剥离注释后仍命中 `common.utilTime` + `toMonth`');
// 🔴 不查「函数名是不是 monthOf」—— 换个名字（如也叫 toMonth）就绕过了（V4 实证）。
//    改为查**本地 YYYY-MM 拼装**形态：任何用 getFullYear()+getMonth() 拼月份的写法。
const localYm = /getFullYear\(\)[\s\S]{0,120}?getMonth\(\)/;
check('4-③ getDishReview 代码里不存在本地 YYYY-MM 拼装（不论函数叫什么名）',
  !localYm.test(reviewCode),
  localYm.test(reviewCode) ? '🔴 检出本地月份拼装' : '无本地 getFullYear()+getMonth() 拼装');

// 🔴 这才是真正的**行为**判据：**调用单源 toMonth 本体**（不是自己重算一遍再断言自己的答案）。
// UTC+8 ⇒ 本地 2026-10-01 07:00 的卡必须归属 **2026-09**（UTC），若用本地口径会得到 2026-10。
let toMonth = null;
try { toMonth = require(path.join(ROOT, UTIL_REL)).toMonth; } catch (e) { toMonth = null; }
check('4-④ 单源 toMonth 可达', typeof toMonth === 'function', typeof toMonth);

if (typeof toMonth === 'function') {
  const localBoundary = new Date(2026, 9, 1, 7, 0, 0).getTime();   // 本地 2026-10-01 07:00 CST
  const got = toMonth(localBoundary);
  check('4-⑤ 边界时间戳经**单源 toMonth** 归属 2026-09（本地口径会错成 2026-10）',
    got === '2026-09',
    new Date(localBoundary).toISOString() + ' ⇒ ' + got);

  // 对照：同时间戳按本地口径应得到 2026-10 —— 证明这条样本**确实能区分**两种口径
  const lb = new Date(localBoundary);
  const p = (n) => String(n).padStart(2, '0');
  const asLocal = `${lb.getFullYear()}-${p(lb.getMonth() + 1)}`;
  check('4-⑥ 自失效护栏：同一时间戳用本地口径确会得到 2026-10（⇒ 样本有区分力，非恒绿）',
    asLocal === '2026-10' && got === '2026-09',
    `本地 ${asLocal} ≠ UTC ${got}`);
} else {
  check('4-⑤ toMonth 边界判据', false, 'toMonth 不可达');
  check('4-⑥ 样本区分力护栏', false, 'toMonth 不可达');
}

console.log(`\n===== 时间口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
