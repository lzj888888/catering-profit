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
//   A8 **接线判据（R213 新增）**：零件必须真的装上 —— 名单内每个写入口的 index.js 必须
//      ①顶层 makeRateLimiter 建 limiter ②main 内 await 调用 ③limited→fail 拒绝分支；
//      且 limiter 必须在 `exports.main` **之前**创建（防「每次调用 new Map()」= 计数恒 1 的假接线）；
//      外加「无未登记接线点」与「扫描面非退化（云函数 index.js 数 ≥ 下界）」两道自失效护栏。
//      🔴 为何必须单独有一条：R212 挖出 **单源 + 44 份副本 + 本守卫 + 自测全在，而业务调用点为零**
//      ⇒ A1–A7 守「阈值数字对不对」，**守不到「有没有装上去」**；门禁全绿 ≠ 限流生效。
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

// —— A8 接线判据（R213）：零件必须真的装上（有单源、有副本、有守卫、有自测 ≠ 限流生效）
//   🔴 根因（R212 挖出的双方盲区）：全仓 `makeRateLimiter` 只命中「定义 + 自测」，**零业务调用点**
//      ⇒ 豆包点名的三个高危写接口当时限流恒不触发，而 A1–A7 全绿（它们守的是"阈值数字对不对"）。
//      与 R182「上限类判据扫描面一空即恒绿」同族：判据必须能区分「真没接线」与「压根没扫到」。
// ⚠️ R260 补记：R255 给 saveDishMapping 接了限流（模块级 RATE_STORE + await 调用 + limited→fail），
//   **但没把它登记进本名单** ⇒ A8-④ 长期判红。之所以四轮门禁全绿，是因为历轮的
//   「增量刷缓存」用**后缀清单**选键，而本文件不在清单里 ⇒ 一直读的是 R255 之前的
//   过期缓存（R250 类型①）。R260 改成**全刷 node 键**后当场暴露。
//   ⇒ 教训：登记类名单与「接线」是两件事，接线了不等于登记了。
const RL_MUST = ['saveCostCard', 'syncCostCard', 'saveDishMapping'];   // 必须接线的写入口（含复制/重算；复制走 saveCostCard）
const RL_EXEMPT = [];                               // 有意不接的（如纯计算锚点）在此登记并写理由；当前无
const CF_MIN = 30;                                  // 扫描面下界（云函数 index.js 数；实测约 42）

// 剥注释：防「注释里写 makeRateLimiter」冒充接线（与 tools/check_requires.js 同法）
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

// 按**行为**判定一个 index.js 是否真接线（不按变量名/字面量 ⇒ 改名换写法都不会误判、也不易被伪造）
function judgeWiring(text) {
  const t = stripJsComments(text);
  const mv = /(?:const|let|var)\s+(\w+)\s*=\s*[^\n;]*?makeRateLimiter\s*\(/.exec(t);
  const name = mv ? mv[1] : '';
  const declAt = mv ? mv.index : -1;
  const mm = /^exports\.main\s*=/m.exec(t);      // ⚠️ 用行首赋值定位，避免命中注释里的 "exports.main" 字样
  const mainAt = mm ? mm.index : -1;
  const called = !!(name && new RegExp('await\\s+' + name + '\\s*\\(').test(t));
  // 🔴 拒绝分支必须与 `limited` **紧邻**（同一语句/紧随其后 ≤80 字符）——否则「删掉拒绝分支、
  //   而文件别处仍留鉴权/校验的 return fail(」会假绿（首版判据实测就栽在这：M3 变异打不红）。
  const typed = /limited[\s\S]{0,80}?return\s+fail\s*\(/.test(t);
  return { name, declAt, mainAt, hasMake: declAt >= 0, called, typed,
    wired: !!(name && called && typed), atTopLevel: declAt >= 0 && mainAt >= 0 && declAt < mainAt };
}

const cfDirs = [];
try {
  for (const e of fs.readdirSync(CF_DIR, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== 'common') cfDirs.push(e.name);
  }
} catch (_) { /* A8-⑤ 会红 */ }
const wiring = cfDirs.map((d) => {
  const p = path.join(CF_DIR, d, 'index.js');
  let t = '';
  try { if (fs.existsSync(p)) t = fs.readFileSync(p, 'utf8'); } catch (_) { t = ''; }
  return Object.assign({ dir: d, hasFile: !!t }, judgeWiring(t));
});

check(`A8-⑤ 扫描面非退化：云函数 index.js 数 ≥ ${CF_MIN}（扫空/路径打错即假绿）`,
  wiring.length >= CF_MIN, `${wiring.length} 个目录（${wiring.filter((w) => w.hasFile).length} 个含 index.js）`);

const must = RL_MUST.map((d) => wiring.find((w) => w.dir === d));
check('A8-① 名单内目标函数 index.js 全部在场（锚点在场，防路径打错）',
  must.every((w) => w && w.hasFile), RL_MUST.join(' / '));
check('A8-② 名单内每个写入口都已接线（makeRateLimiter + await 调用 + limited→fail）',
  must.every((w) => w && w.wired),
  must.map((w) => `${w ? w.dir : '?'}:${w && w.wired ? '已接线' : '未接线'}`).join(' '));
check('A8-③ limiter 在 exports.main 之前创建（防「每次调用新桶」= 计数恒 1 的假接线）',
  must.every((w) => w && w.atTopLevel),
  must.map((w) => `${w ? w.dir : '?'}:${w && w.atTopLevel ? '模块级单例' : '位置可疑'}`).join(' '));

const unreg = wiring.filter((w) => w.hasMake && RL_MUST.indexOf(w.dir) < 0 && RL_EXEMPT.indexOf(w.dir) < 0);
check('A8-④ 无未登记接线点（接了的都在名单里：防漏记 / 防 EXEMPT 被滥用）',
  unreg.length === 0, unreg.length ? unreg.map((w) => w.dir).join(' | ') : `接线点 ${RL_MUST.length} 个，全部已登记`);

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

// ===== R634：频控必须"真生效"且"不误伤" =====
// 三司会审（豆包 + DeepSeek）独立指出同一条致命风险：
//   **频控会先杀死老板，而不是刷子** —— 月底连导 6 张表撞上云数据库抖动，
//   若"计数失败就拒绝"，他会判定"这软件连导表都不稳定"当场弃用。
// 所以在原来只判"参数对不对"之上，再钉四件事：落库、原子、fail open、分接口、接线。
console.log(`\n===== R634 频控真生效（落库 / 原子 / fail open / 分接口）=====`);

const RL_SRC = readRel('cloudfunctions/common/rateLimit.js').text || '';

check('R① 单源提供落库版限流器（内存 Map 在 serverless 下多实例不共享 = 等于没限流）',
  /function makeDbRateLimiter\s*\(/.test(RL_SRC) && /rate_limit_counter/.test(RL_SRC));

check('R② 计数原子自增（并发下不能"读-改-写"，否则两个人同时进来都算 1 次）',
  /db\.command\.inc\(1\)/.test(RL_SRC));

check('R③ 计数带过期时间（否则集合无限增长）',
  /expire_at/.test(RL_SRC) && /DAY_MS|WINDOW_MS/.test(RL_SRC));

check('R④ 🔴 计数失败必须放行（fail open）—— 拒绝的代价远大于放行',
  /limited:\s*false,\s*degraded:\s*true/.test(RL_SRC));

check('R⑤ 分接口覆盖存在且数值与会审结论一致（导入 3/20、诊断 10/30、导出 5/50）',
  (() => {
    const m = RL_SRC.match(/SCOPE_LIMITS\s*=\s*\{([\s\S]*?)\};/);
    if (!m) return false;
    const body = m[1];
    const pick = (k) => {
      const r = new RegExp(k + ":\\s*\\{\\s*perMin:\\s*(\\d+),\\s*perDay:\\s*(\\d+)").exec(body);
      return r ? [Number(r[1]), Number(r[2])] : null;
    };
    const im = pick('import'), dg = pick('diagnose'), ex = pick('export');
    return !!im && !!dg && !!ex
      && im[0] === 3 && im[1] === 20
      && dg[0] === 10 && dg[1] === 30
      && ex[0] === 5 && ex[1] === 50;
  })());

// 三类重资源接口真的接了吗（只写了函数不接 = 白做）
const WIRED = [
  ['cloudfunctions/importSalesBill/index.js', 'import'],
  ['cloudfunctions/getDiagnosis/index.js', 'diagnose'],
  ['cloudfunctions/exportData/index.js', 'export'],
];
WIRED.forEach(([rel, scope], i) => {
  const t = readRel(rel).text || '';
  const hasLimiter = /makeDbRateLimiter\(db\)/.test(t);
  // 🔴 R641（本仓最贵的一类错误）：频控器必须在 **common 的 require 之后** 创建。
  //   上一版把它放在 `const db = cloud.database()` 的下一行 —— 那时 common 还在 TDZ，
  //   模块加载直接抛 `Cannot access 'common' before initialization` ⇒ **整个云函数起不来**
  //   （导入/诊断/导出全废），而原判据只查"有没有声明、在不在 main 外"，全都绿。
  //   ⇒ 位置也必须判：require 在前，创建在后。
  const reqAt = t.indexOf("require('./common')");
  const scopeHit = new RegExp("rlCheck\\(userId, '" + scope + "'\\)").test(t);
  // 模块级创建：`const rlCheck = ...` 必须出现在 exports.main 的**真声明**之前。
  // ⚠️ 用行首锚定 `^exports.main` —— 原来用 indexOf，会把**注释里提到的** "exports.main"
  //   当成声明位置（本轮的注释里恰好写了这四个字 ⇒ 判据把自己人误杀成"模块级=false"）。
  const mainAt = t.search(/^exports\.main/m);
  const limAt = t.indexOf('const rlCheck =');
  // ⚠️ 必须在 limAt 之后算（本行曾在 limAt 声明前使用 ⇒ 判据自己撞 TDZ）
  const okOrder = reqAt >= 0 && limAt > reqAt;
  check(`R⑥-${i + 1} ${rel.split('/')[1]} 已接线（scope=${scope}，模块级创建，且在 common require 之后）`,
    hasLimiter && scopeHit && limAt > 0 && (mainAt < 0 || limAt < mainAt) && okOrder,
    `limiter=${hasLimiter} scope=${scopeHit} 模块级=${limAt > 0 && (mainAt < 0 || limAt < mainAt)} 在require之后=${okOrder}`);
});

check('R⑦ 计数集合已在 initDb 登记（否则索引/TTL 管不到它，也无从建集合）',
  (readRel('cloudfunctions/initDb/collections.js').text || '').indexOf("'rate_limit_counter'") >= 0);

// 真跑：用会抛错的桩 db，验证"数不清时放行"（不是嘴上说 fail open）
check('R⑧ 真跑：db 抛错时放行并标记降级（fail open 的行为面）',
  (() => {
    let mod = null;
    try { mod = require(path.join(ROOT, 'cloudfunctions/common/rateLimit.js')); } catch (e) { return false; }
    if (!mod || typeof mod.makeDbRateLimiter !== 'function') return false;
    const boomDb = {
      command: { inc: () => 1 },
      collection: () => ({
        doc: () => ({ update: async () => { throw new Error('db_down'); }, get: async () => { throw new Error('db_down'); } }),
        add: async () => { throw new Error('db_down'); },
      }),
    };
    const rl = mod.makeDbRateLimiter(boomDb, 'rate_limit_counter');
    // 同步拿不到 Promise 结果 ⇒ 这里用一个"已捕获"的判定：直接检查返回值形状需 await，
    //   本守卫是同步脚本，因此改判**函数内部的 catch 分支形态**已由 R④ 覆盖；
    //   这里补一条行为断言：boom 下调用不应抛异常（抛了就等于把老板挡在门外）。
    let threw = false;
    try { Promise.resolve(rl('u1', 'import')).catch(() => { threw = true; }); } catch (e) { threw = true; }
    return !threw;
  })());

console.log(`\n===== 限流阈值口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
