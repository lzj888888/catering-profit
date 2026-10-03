// tools/check_uri_codec_pairs.js —— 路由「编解码配对」守卫（R203）
//
// 【为什么需要它】R203 真机反馈：原料库点「涨价影响面」→ 页面顶部出现一长串
//   `%E7%82%B8%E9%B8%A1%E8%85%BF`（李老师描述为「很多英文以及百分号」）。
//   根因 = 跳转侧 `encodeURIComponent()` 编过，目标页**没有** `decodeURIComponent()` 解回来。
//   ⚠️ 这个缺陷在仓里长期存在却从未暴露：此前店铺鉴权 404 ⇒ impact 页取数必失败 ⇒
//      页面从没真正渲染出来过。**"修好上游"会把下游的老毛病一并照亮** —— 所以本守卫来钉死它。
//
// 守三条不变式（缺一条就红）：
//   A. 凡是「url 里带 `encodeURIComponent(...)` 的跳转」，其**目标页 js 必须出现 `decodeURIComponent(`**；
//   B. 扫描面必须非退化（pages/**/*.js 达量 + 至少存在 0 处编码跳转时不得"因为扫不到所以恒绿"）；
//   C. 关键锚点在位（impact.js 在扫描面内、且确实解码）—— 防「改名/挪路径后判据自动放行」。
//
// 影子用例（S 组）：把判据抽成纯函数，正/负样本各一条 —— 判据被削弱时本套件自红。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');

let pass = 0;
let fail = 0;
const fails = [];

function check(name, ok) {
  if (ok) { pass += 1; console.log('  ✅ ' + name); } else { fail += 1; fails.push(name); console.log('  ❌ ' + name); }
}

/* ================= 判据（抽成纯函数，供影子用例直接调） ================= */

/** 目标页源码是否具备「把 URL 参数解回来」的能力。 */
function judgeHasDecode(src) {
  return /decodeURIComponent\s*\(/.test(String(src || ''));
}

/**
 * 从「含 encodeURIComponent 的那一行」里提取目标页面路径。
 * 覆盖三种写法：'…url: "/pages/a/b?x=" + encodeURIComponent(y)'、模板串、多段拼接。
 */
function judgeTargetPath(line) {
  const m = String(line || '').match(/['"`]\/?(pages\/[A-Za-z0-9_/-]+)\?/);
  return m ? m[1] : '';
}

/** 整条不变式：给定「跳转行 + 目标页源码」，是否配对。 */
function judgePair(line, targetSrc) {
  const t = judgeTargetPath(line);
  if (!t) return true; // 不是「带 ? 的页面跳转」⇒ 不归本守卫管
  return judgeHasDecode(targetSrc);
}

/* ================= 收集扫描面 ================= */

function walkJs(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const pageFiles = fs.existsSync(PAGES_DIR) ? walkJs(PAGES_DIR, []) : [];
const srcCache = new Map();
for (const f of pageFiles) srcCache.set(f, fs.readFileSync(f, 'utf8'));

/* ================= A 组：编解码必须配对 ================= */

const encoders = []; // { file, relTarget, lineNo }
for (const f of pageFiles) {
  const lines = srcCache.get(f).split(/\r?\n/);
  lines.forEach((l, i) => {
    if (l.indexOf('encodeURIComponent') < 0) return;
    const t = judgeTargetPath(l);
    if (!t) return;
    encoders.push({ file: f, relTarget: t, lineNo: i + 1, line: l });
  });
}

const decodeFiles = pageFiles.filter((f) => judgeHasDecode(srcCache.get(f)));

check('A-① 扫描面非退化：pages/**/*.js 至少 10 个（实际 ' + pageFiles.length + '）', pageFiles.length >= 10);
check('A-② 存在「带中文参数的编码跳转」至少 1 处（实际 ' + encoders.length + '）', encoders.length >= 1);
check('A-③ 至少 1 个页面具备解码能力（实际 ' + decodeFiles.length + '）', decodeFiles.length >= 1);

for (const e of encoders) {
  const abs = path.join(ROOT, e.relTarget + '.js');
  const src = srcCache.get(abs);
  const rel = path.relative(ROOT, e.file).replace(/\\/g, '/');
  check(
    'A-④ ' + rel + ':' + e.lineNo + ' 编码跳转 → 目标页 ' + e.relTarget + '.js 必须解码',
    !!src && judgeHasDecode(src),
  );
}

/* ================= C 组：自反锚点（防判据被绕过） ================= */

const IMPACT = path.join(PAGES_DIR, 'metrics', 'impact.js');
check('C-① 关键锚点 pages/metrics/impact.js 在扫描面内', srcCache.has(IMPACT));
check('C-② impact.js 确实解了 URL 参数名（decodeURIComponent 在位）',
  srcCache.has(IMPACT) && judgeHasDecode(srcCache.get(IMPACT)));
check('C-③ impact.js 的 onLoad 用了解码后的值（material_name 不再直接吃 q.name）',
  srcCache.has(IMPACT)
  && !/material_name:\s*\(\s*q\s*&&\s*q\.name\s*\)\s*\|\|\s*''/.test(srcCache.get(IMPACT)));

/* ================= S 组：影子用例（判据削弱 ⇒ 自红） ================= */

const GOOD_SRC = "const n = decodeURIComponent(q.name); // 正确：解码";
const BAD_SRC = "const n = q.name; // 错误：直接吃编码串";
const GOOD_LINE = "wx.navigateTo({ url: '/pages/metrics/impact?material_id=1&name=' + encodeURIComponent(m.name || '') });";

check('S-① 影子正样本：合规实现被判绿', judgePair(GOOD_LINE, GOOD_SRC) === true);
check('S-② 影子负样本：违规实现被判红', judgePair(GOOD_LINE, BAD_SRC) === false);
check('S-③ 影子：非页面跳转行不误伤（无 ? ⇒ 不归本守卫管）',
  judgePair("const a = encodeURIComponent(x);", BAD_SRC) === true);
check('S-④ 影子：目标路径提取准确',
  judgeTargetPath(GOOD_LINE) === 'pages/metrics/impact');
check('S-⑤ 影子：裸 decodeURIComponent 也算解码能力（不依赖某个具体函数名）',
  judgeHasDecode("const x = decodeURIComponent (s);") === true);

/* ================= 汇总 ================= */

console.log('');
console.log('[uri-codec] ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail > 0) {
  console.log('[uri-codec] 失败清单：');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
