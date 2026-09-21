// tools/check_rate_limit_params.js —— 【R113】限流阈值口径守卫（声明 ≡ 代码单源 ≡ 42 份副本 ≡ 引用，双向）
// 运行：node tools/check_rate_limit_params.js
//
// 为什么需要它（**同族病第 20 例**，2026-09-22 round82 防回潮扫描发现）：
//   `RATE_LIMITED` 的触发阈值「写操作 > 60 次/分钟（openid 维度）」是**批次 0 投喂基线 §2.2.5 明写的口径**，
//   且落在这份**统一错误码表**（对外契约）里 —— 李老师照它验收、写码 AI 照它实现。
//   代码单源 `cloudfunctions/common/rateLimit.js`（`WINDOW_MS = 60 * 1000` / `MAX_WRITES = 60`），
//   42 份扁平副本 `cx_rateLimit.js` 分布在各云函数目录。
//
//   实扫证据（round82，回源实扫、不采信任何自述）：
//   ① 全仓 `MAX_WRITES = 60` / `WINDOW_MS = 60 * 1000` 各 **43 处**（1 单源 + 42 副本）⇒ 当前**零漂移**；
//   ② 声明 3 处：`core/09:33`（表格行）、`core/16:48`（「建议 >60 次/分钟触发」）、投喂包:46；
//   ③ `grep -rln "MAX_WRITES|rateLimit" tools/ specs/dev-specs/prototype/ verify_all.js` ⇒ **零命中**
//      ⇒ 该阈值**长期零守卫**：把 `MAX_WRITES` 改成 600（限流形同虚设、成本与滥用敞口）
//        或改成 6（正常用户被拒），本表仍写 60，门禁全绿、无人报警。
//
//   ⇒ 后果定位：与 round67 第 11 例（集合权限＝越权边界）、round70 第 14 例（锁阈值/token TTL＝鉴权强度边界）
//     同族 —— **防护性边界口径**。它不是文案错，是「防护强度与对外承诺不符」。
//   ⇒ **「缺守卫」与「已违规」分开上报**（round55 纪律）：当前实扫零漂移，本守卫做的是**防复发**。
//
// 判据（双向，缺一不可）：
//   A1 扫描面 fail-closed：单源文件存在非空；副本数 ≥ COPY_MIN；扫描面 .md ≥ SCAN_MIN（路径写错 = 扫空 ⇒ 红）。
//   A2 语义标记「限流阈值口径」+「唯一声明处」可解析出次数 N 与窗口 W（删声明 = 口径消失 ⇒ 红）。
//   A3 声明 N ≡ 单源 `MAX_WRITES` 实算；声明 W ≡ 单源 `WINDOW_MS` 实算（改一侧不跟另一侧 ⇒ 双向都红）。
//   A4 全部扁平副本的 `MAX_WRITES` / `WINDOW_MS` ≡ 单源（防只改一处副本造成本地漂移）。
//   A5 全仓当前态声明（行内含限流类锚点、且「N 次/分钟」就近 ±WIN 字符）全部 ≡ N，且有命中数下限（fail-closed）。
//   A6 两条前提守卫：①扫描面确含目标文档（自指排除没误伤）②副本集确含已知函数目录（副本面没打错）。
//   A7 唯一声明处不扩散（其它 .md 的同一行不得同时含「唯一声明处」+ 本口径标记）。
//   W  弱面：`core/16:48` 的维度是「IP + admin_id」（admin 后台场景）而单源是「openid 维度」（C 端场景），
//      经 round82 实读判定为**两套场景的口径**，不构成漂移 ⇒ 只明示不判红。
//
// 🔴 **为什么用「语义标记」，而不是裸扫「60」**（round62 坑⑭ / round63 / round66 / round81 多轮复现）：
//    裸扫数字当场误杀 `WINDOW_MS = 60 * 1000` 里的 60、字号 60rpx、`REMIND_WINDOW_MS` 的 7 天/24h 等合法口径
//    ⇒ 口径**编码进文本**：带 `限流阈值口径` 标记的行才是单源；引用行靠「限流 / RATE_LIMITED / 次/分钟」**就近**锚定
//      （round65 坑⑯：「同行即锚」也会误杀，锚点必须就近）。
// ⚠️ 明写边界：本守卫不保证 `review/` 下历史 NOTE 里的旧数字正确（按「只增不改」放行）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DECL_REL = 'specs/dev-specs/core/09_统一错误码表.md';
const SRC_REL = 'cloudfunctions/common/rateLimit.js';
const COPY_NAME = 'cx_rateLimit.js';
const CF_DIR = path.join(ROOT, 'cloudfunctions');
const SCAN_DIR = path.join(ROOT, 'specs', 'dev-specs');

const MIN_BYTES = 300;
const SCAN_MIN = 25;   // 扫描面至少这么多 .md（round80/81/82 实测 30 份）
const COPY_MIN = 40;   // 扁平副本至少这么多（round82 实测 42）
const CLAIM_MIN = 3;   // 当前态声明至少 3 处（core/09 表格行 + 声明行 + core/16 + 投喂包 ⇒ 实测 4）
const WIN = 40;        // 锚点就近窗口（坑⑯）

const MARK_KEY = '限流阈值口径';
const MARK_RE = new RegExp(MARK_KEY + '[\\s\\S]{0,160}?\\*{0,2}(\\d+)\\*{0,2}\\s*次\\s*/\\s*分钟');
const WINDOW_RE = /窗口\s*\*{0,2}(\d+)\*{0,2}\s*ms/;
const UNIQUE_RE = /唯一声明处/;

const CLAIM_RE = /\*{0,2}(\d+)\*{0,2}\s*次\s*\/\s*分钟/g;
const ANCHOR_RE = /限流|RATE_LIMIT|触发阈值|次\/分钟/g;
const HIST_RE = /原写|旧副本|漏计|此前|历史|曾写|校订|更正|作废|误计|演进/;

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}

function readRel(rel) {
  const p = path.join(ROOT, rel);
  const ok = fs.existsSync(p);
  const size = ok ? fs.statSync(p).size : 0;
  return { p, ok, size, text: ok ? fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '') : '' };
}

// 只接受由数字/空白/*/+-/()组成的纯算术表达式（防 eval 注入）
function evalNum(expr) {
  if (!/^[\d\s*+/()-]+$/.test(expr)) return NaN;
  try { return Function(`"use strict";return (${expr});`)(); } catch (_) { return NaN; }
}

function parseRateValues(text) {
  const mw = /const\s+MAX_WRITES\s*=\s*([^;]+);/.exec(text);
  const wm = /const\s+WINDOW_MS\s*=\s*([^;]+);/.exec(text);
  return {
    maxWrites: mw ? evalNum(mw[1]) : NaN,
    windowMs: wm ? evalNum(wm[1]) : NaN,
  };
}

function walkMd(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkMd(p, out); }
    else if (/\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}

console.log('===== R113 · 限流阈值口径守卫 =====');

// —— A1 扫描面 fail-closed
const src = readRel(SRC_REL);
check('A1-① 代码单源存在且非空', src.ok && src.size >= MIN_BYTES, `${SRC_REL} · ${src.size}B`);
const decl = readRel(DECL_REL);
check('A1-② 声明文档存在且非空', decl.ok && decl.size >= MIN_BYTES, `${DECL_REL} · ${decl.size}B`);

const copies = [];
try {
  for (const e of fs.readdirSync(CF_DIR, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(CF_DIR, e.name, COPY_NAME);
    if (fs.existsSync(p)) copies.push({ dir: e.name, p });
  }
} catch (_) { /* A1-③ 会红 */ }
check(`A1-③ 扁平副本数 ≥ ${COPY_MIN}（副本扫描面失效即红）`, copies.length >= COPY_MIN, `${copies.length} 份`);

const mdFiles = walkMd(SCAN_DIR, []);
check(`A1-④ 扫描面 .md 数 ≥ ${SCAN_MIN}（排除 review/，路径写错即红）`, mdFiles.length >= SCAN_MIN, `${mdFiles.length} 个`);

// —— A2 语义标记解析（fail-closed）
const mh = MARK_RE.exec(decl.text);
const N = mh ? Number(mh[1]) : -1;
check('A2-① 语义标记「限流阈值口径」可解析出次数 N（fail-closed）', mh !== null,
  mh ? `N=${N}` : '零命中');
const declBlock = mh ? decl.text.slice(mh.index, mh.index + 200) : '';
const wh = WINDOW_RE.exec(declBlock);
const W = wh ? Number(wh[1]) : -1;
check('A2-② 声明内可解析出窗口 W（ms，fail-closed）', wh !== null, wh ? `W=${W}` : '零命中');
const uniqLines = decl.text.split(/\r?\n/).filter((l) => UNIQUE_RE.test(l) && l.includes(MARK_KEY));
check('A2-③ 「唯一声明处」在 core/09 内恰 1 行', uniqLines.length === 1, `${uniqLines.length} 行`);

// —— A3 声明 ≡ 单源实算
const sv = parseRateValues(src.text);
check('A3-① 单源可解析出 MAX_WRITES / WINDOW_MS（fail-closed）',
  Number.isFinite(sv.maxWrites) && Number.isFinite(sv.windowMs),
  `MAX_WRITES=${sv.maxWrites} / WINDOW_MS=${sv.windowMs}`);
check(`A3-② 声明次数 N=${N} ≡ 单源 MAX_WRITES=${sv.maxWrites}`, N === sv.maxWrites, `声明 ${N} / 实算 ${sv.maxWrites}`);
check(`A3-③ 声明窗口 W=${W} ≡ 单源 WINDOW_MS=${sv.windowMs}`, W === sv.windowMs, `声明 ${W} / 实算 ${sv.windowMs}`);
check('A3-④ 窗口恰为一分钟（60000ms，「次/分钟」口径自洽）', sv.windowMs === 60000, `${sv.windowMs} ms`);

// —— A4 全部副本 ≡ 单源
const badCopies = [];
for (const c of copies) {
  let t = '';
  try { t = fs.readFileSync(c.p, 'utf8'); } catch (_) { continue; }
  const v = parseRateValues(t);
  if (v.maxWrites !== sv.maxWrites || v.windowMs !== sv.windowMs) {
    badCopies.push(`${c.dir}(${v.maxWrites}/${v.windowMs})`);
  }
}
check(`A4 全部 ${copies.length} 份副本 ≡ 单源（防只改一处副本）`, badCopies.length === 0,
  badCopies.length ? badCopies.slice(0, 6).join(' | ') : `${copies.length} 份同值 ${sv.maxWrites}/${sv.windowMs}`);

// —— A5 全仓当前态声明 ≡ N（锚点就近 ±WIN）
const claims = [];
let skippedHist = 0;
for (const f of mdFiles) {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  t.split(/\r?\n/).forEach((line, i) => {
    ANCHOR_RE.lastIndex = 0;
    const anchors = [];
    let a;
    while ((a = ANCHOR_RE.exec(line)) !== null) anchors.push(a.index);
    if (!anchors.length) return;
    CLAIM_RE.lastIndex = 0;
    const hits = [];
    let n;
    while ((n = CLAIM_RE.exec(line)) !== null) {
      if (anchors.some((p) => Math.abs(n.index - p) <= WIN + 8)) hits.push(Number(n[1]));
    }
    if (!hits.length) return;
    if (HIST_RE.test(line)) { skippedHist++; return; }
    hits.forEach((v) => claims.push({
      f: path.relative(ROOT, f).replace(/\\/g, '/'), line: i + 1, v, txt: line.trim().slice(0, 70),
    }));
  });
}
const badClaims = claims.filter((c) => c.v !== N);
check(`A5-① 当前态声明全部 ≡ ${N}（共 ${claims.length} 处，HIST 放行 ${skippedHist} 行）`, badClaims.length === 0,
  badClaims.length ? badClaims.map((c) => `${c.f}:${c.line} 写 ${c.v}`).join(' | ') : `${claims.length} 处一致`);
check(`A5-② 当前态声明命中数 ≥ ${CLAIM_MIN}（正则/扫描面失效即零命中假绿）`, claims.length >= CLAIM_MIN, `${claims.length} 处`);

// —— A6 两条前提守卫
check('A6-① 前提：扫描面确含声明文档（自指排除没误伤）',
  mdFiles.some((f) => path.relative(ROOT, f).replace(/\\/g, '/') === DECL_REL), DECL_REL);
check('A6-② 前提：副本集确含已知函数目录（副本面没打错）',
  copies.some((c) => c.dir === 'adminLogin') && copies.some((c) => c.dir === 'adminExport'),
  copies.slice(0, 3).map((c) => c.dir).join(','));

// —— A7 单源唯一性（行级，坑⑯：不看整文件）
const otherUnique = [];
for (const f of mdFiles) {
  if (path.relative(ROOT, f).replace(/\\/g, '/') === DECL_REL) continue;
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  t.split(/\r?\n/).forEach((line, i) => {
    if (UNIQUE_RE.test(line) && line.includes(MARK_KEY)) {
      otherUnique.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}`);
    }
  });
}
check('A7 唯一声明处不扩散（其它 .md 同行不得同时自称单源 + 本口径）', otherUnique.length === 0,
  otherUnique.length ? otherUnique.join(' | ') : '仅 core/09 一处');

// —— W 弱面（只明示不判红；round82 实读：core/16 是 admin 侧另一场景口径）
console.log(`\n===== W 弱面（只明示不判红）=====`);
// 注意：core/16:48 的「IP + admin_id」写在「限流」二字**之前** ⇒ 只能做同行双词判定，不能写顺序正则
const adminDim = readRel('specs/dev-specs/core/16_后台鉴权规范.md').text
  .split(/\r?\n/).some((l) => /限流/.test(l) && /(IP|admin_id)/.test(l));
console.log(`  ⚠️ core/16:48 的维度（IP + admin_id，admin 后台）与单源（openid，C 端）是**两套场景**`);
console.log(`     （round82 实读判定：不是漂移；单源注释明写「批次 0 §2.2.5」，与 core/09 表格行口径一致）`);
console.log(`     ⇒ 弱面只打印；硬判据是 A3（声明≡单源）、A4（副本≡单源）、A5（全仓引用≡N）。`);
check('W-① 弱面已打印（坑⑭/⑯ 印证：裸扫数字必误杀）', adminDim && claims.length >= 1,
  `admin 维度描述命中=${adminDim} / 当前态声明 ${claims.length} 处`);

console.log(`\n===== 限流阈值口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
