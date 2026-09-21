/**
 * check_admin_auth_params.js —— 后台鉴权安全参数口径守卫（R106，round71）
 *
 * 背景（同族病第 14 例，与 round61 套件数 / round63 隐私占位符 / round64 红线条数 /
 *       round66 商业化额度 / round67 集合权限 / round69 验收通过数同族）：
 *   `cloudfunctions/_adminCore/adminAuth.js` 里三个**安全边界常量**
 *     · LOCK_AFTER_FAILS   = 5            （连续 5 次密码错误锁号）
 *     · LOCK_DURATION_MS   = 30 * 60*1000 （锁 30 分钟）
 *     · TOKEN_TTL_MS       = 7 * 24*3600*1000（token 7 天有效）
 *   被抄进 6 份 .md（`core/09` 三处 / `core/10` 两处 / `core/16` 四处 / 投喂包两处 / 重启键一处），
 *   而 `tools/` + `prototype/` 对「adminAuth|后台鉴权参数|LOCK_AFTER_FAILS」的**口径守卫零命中** ——
 *   既有的 `tools/check_admincore.js`（R50）只守「11 份副本 ≡ 单源逐字节一致」，**不看常量取值**；
 *   A–L 只守错误码 wire↔i18n 映射，也**不看参数值**。
 *
 * 后果（为什么必须守）：这是**管理端安全强度**的对外口径。改 `LOCK_AFTER_FAILS = 10`（放松）
 *   或 `TOKEN_TTL_MS = 30 天`（放松）后，文档仍写 5 / 7 ⇒ 李老师按文档验收与对外承诺的强度
 *   **与实际运行值不符**；反向（代码收紧而文档未跟）则验收人白查一轮。
 *   ⚠️ **「缺守卫」与「已违规」分开**：本守卫首跑三值全部一致（零违规），补的是**零守卫**。
 *
 * 判据（三条腿，沿用 round63~69 已验证的模板）：
 *   ① 实算单源：正则解析 `_adminCore/adminAuth.js` 三个常量（**不抄字面量**，解析不到即红 fail-closed）。
 *   ② 唯一声明处：`core/16_后台鉴权规范.md` 的语义标记 `后台鉴权参数口径（唯一声明处）`。
 *   ③ 引用面：全仓（index ∪ 工作树）.md 里**锚点就近**（≤40 字符）且**参数类别明确**的
 *      当前态陈述必须 ≡ 实算；够不着的归入弱面，只打印 ⚠️ 明示、**不判红**（坑⑯ 定式）。
 *
 * ⚠️ 已踩过的坑在本守卫里的对应处理：
 *   · 坑⑪ CJK 八进制转义：`git -c core.quotepath=false ls-files` + 出现 `\NNN` 即红（不许 catch 静默跳过）。
 *   · 坑⑱ `git ls-files` 只扫 index：扫描面 = index ∪ 工作树递归，并加**非恒真前提**（≥30 个 .md）。
 *   · 坑⑭/⑯ 裸扫数字必误杀：必须「单位 + 类别锚点 + admin 锚点」三者同时就近才判红；
 *     否则只 ⚠️ 明示（宁可少判红，不可误杀）。
 *   · 坑⑫/⑮ 自指：扫描面只含 .md，守卫自身是 .js，天然不在面内。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_REL = 'cloudfunctions/_adminCore/adminAuth.js';
const DECL_REL = 'specs/dev-specs/core/16_后台鉴权规范.md';
const DECL_MARK = '后台鉴权参数口径（唯一声明处）';

const NEAR = 40;
// admin 语义锚点：证明这句话讲的是后台鉴权，而不是别的"5 次/30 分钟/7 天"
const ADMIN_ANCHORS = ['ADMIN_LOCKED', 'ADMIN_TOKEN_EXPIRED', 'locked_until', 'adminAuth',
  'adminLogin', '管理员', '管理端', '后台鉴权', '超管', 'token', '令牌'];
// 类别锚点 + 单位：三者同时成立才判红
const CAT = {
  fails: { unit: '次', words: ['密码错', '密码错误', '失败', '错'] },
  lockMin: { unit: '分钟', words: ['锁', 'locked_until', 'ADMIN_LOCKED', '锁定'] },
  lockMin2: { unit: '分', words: ['锁', 'locked_until', 'ADMIN_LOCKED', '锁定'] },
  ttlDay: { unit: '天', words: ['token', '令牌', '登录态', '有效期', '有效'] },
};
// ⚠️ 允许 `**5** 次` 这类加粗写法（单源声明行就是加粗的），但要防 `5 → 45` 这类跨数字误吃
const NUM_RE = /(\d+)\s*\*{0,2}\s*(次|分钟|分|天|小时)/g;

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

function readRel(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/** 扫描面 = index(git, quotepath=false) ∪ 工作树递归；返回 .md 相对路径数组 */
function scanFiles() {
  const set = new Set();
  let out = '';
  try {
    out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'],
      { cwd: ROOT, encoding: 'utf8' });
  } catch (_) { /* 非 git 环境：退化为纯工作树扫描 */ }
  for (const l of out.split('\n')) {
    const f = l.trim();
    if (f.endsWith('.md')) set.add(f.replace(/\\/g, '/'));
  }
  const roots = ['specs', 'review', 'docs', 'delivery'];
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); }
      else if (e.name.endsWith('.md')) set.add(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  return [...set].filter((f) => !f.startsWith('node_modules/'));
}

function nearWindow(line, idx) {
  return line.slice(Math.max(0, idx - NEAR), idx + NEAR);
}

// ============ P1 实算单源（解析，不抄字面量） ============
section('P1 实算单源：_adminCore/adminAuth.js 常量解析');
let actual = null;
try {
  const src = readRel(SRC_REL);
  const mTtl = src.match(/TOKEN_TTL_MS\s*=\s*(\d+)\s*\*\s*24/);
  const mFails = src.match(/LOCK_AFTER_FAILS\s*=\s*(\d+)/);
  const mLock = src.match(/LOCK_DURATION_MS\s*=\s*(\d+)\s*\*\s*60/);
  if (mTtl && mFails && mLock) {
    actual = { ttlDay: Number(mTtl[1]), fails: Number(mFails[1]), lockMin: Number(mLock[1]) };
    ok('P1-①', `实算解析成功（不抄字面量） —— 锁阈值 ${actual.fails} 次 / 锁时长 ${actual.lockMin} 分钟 / token ${actual.ttlDay} 天`);
  } else {
    no('P1-①', `常量解析失败（fail-closed）：TOKEN_TTL_MS=${!!mTtl} / LOCK_AFTER_FAILS=${!!mFails} / LOCK_DURATION_MS=${!!mLock} —— 单源被改名或改写法即失守`);
  }
} catch (e) {
  no('P1-①', `读不到单源 ${SRC_REL}（fail-closed）：${e.message}`);
}

// ============ P2 唯一声明处 ≡ 实算 ============
section('P2 唯一声明处（core/16 语义标记）≡ 实算');
let declAbs = path.join(ROOT, DECL_REL);
let declTxt = '';
try { declTxt = fs.readFileSync(declAbs, 'utf8'); } catch (_) { declTxt = ''; }
if (!declTxt) {
  no('P2-①', `唯一声明文件缺失 ${DECL_REL}（fail-closed）`);
} else {
  const line = declTxt.split(/\r?\n/).find((l) => l.includes(DECL_MARK));
  if (!line) {
    no('P2-②', `「${DECL_MARK}」声明行缺失（fail-closed）—— 口径无人声明，全仓引用无锚点可校`);
  } else if (!actual) {
    no('P2-②', '实算未取得，无法比对声明');
  } else {
    const got = {};
    NUM_RE.lastIndex = 0;
    let m;
    while ((m = NUM_RE.exec(line)) !== null) {
      const v = Number(m[1]);
      if (m[2] === '次') got.fails = v;
      else if (m[2] === '分钟' || m[2] === '分') got.lockMin = v;
      else if (m[2] === '天') got.ttlDay = v;
    }
    const bad = [];
    for (const k of ['fails', 'lockMin', 'ttlDay']) {
      if (got[k] === undefined) bad.push(`${k} 声明缺失`);
      else if (got[k] !== actual[k]) bad.push(`${k} 声明 ${got[k]} ≠ 实算 ${actual[k]}`);
    }
    if (bad.length === 0) ok('P2-②', `声明 ≡ 实算（${actual.fails}/${actual.lockMin}/${actual.ttlDay}）`);
    else no('P2-②', bad.join('；'));
  }
}

// ============ P3 全仓当前态引用 ≡ 实算（锚点就近） ============
section('P3 全仓当前态引用 ≡ 实算（锚点就近 ≤' + NEAR + ' 字符）');
const files = scanFiles();
const escaped = files.filter((f) => /\\[0-7]{3}/.test(f));
if (escaped.length) no('P3-①', `扫描面出现八进制转义路径 ${escaped.length} 个（坑⑪）—— 请用 core.quotepath=false`);
else ok('P3-①', `扫描面 ${files.length} 个 .md（index ∪ 工作树，无八进制转义）`);

if (files.length < 30) no('P3-②', `扫描面仅 ${files.length} 个 .md（<30）—— 根路径写错则扫了个寂寞（前提守卫）`);
else ok('P3-②', `扫描面文件数 ${files.length} ≥ 30（前提守卫，非恒真）`);

// P3-⑤：关键文件必须在扫描面内（fail-closed）—— 否则"扫了个空壳"而条数仍达标
const MUST = [DECL_REL, 'specs/dev-specs/core/09_统一错误码表.md', 'specs/dev-specs/core/10_云函数清单与接口契约.md'];
const missMust = MUST.filter((m) => !files.includes(m));
if (missMust.length === 0) ok('P3-⑤', `关键文件均在扫描面（${MUST.length} 个，fail-closed）`);
else no('P3-⑤', `关键文件不在扫描面：${missMust.join(', ')}（fail-closed）`);

const strong = [];
const weak = [];
const reviewHits = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let txt = '';
  try { txt = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
  const lines = txt.split(/\r?\n/);
  lines.forEach((line, i) => {
    const hasAdmin = ADMIN_ANCHORS.some((a) => line.includes(a));
    NUM_RE.lastIndex = 0;
    let m;
    while ((m = NUM_RE.exec(line)) !== null) {
      const unit = m[2];
      const keys = Object.keys(CAT).filter((k) => CAT[k].unit === unit);
      if (!keys.length) continue;
      const win = nearWindow(line, m.index);
      const winHasAdmin = ADMIN_ANCHORS.some((a) => win.includes(a));
      const catKey = keys.find((k) => CAT[k].words.some((w) => win.includes(w)));
      const field = catKey === 'lockMin2' ? 'lockMin' : (catKey === 'lockMin' ? 'lockMin' : catKey);
      if (!catKey || !winHasAdmin) {
        if (hasAdmin || winHasAdmin) weak.push({ rel, line: i + 1, v: m[1] + unit, text: line.trim().slice(0, 90) });
        continue;
      }
      const rec = { rel, line: i + 1, field, v: Number(m[1]), text: line.trim().slice(0, 90) };
      if (rel.startsWith('review/')) reviewHits.push(rec);
      else strong.push(rec);
    }
  });
}

if (strong.length >= 5) ok('P3-③', `强面（可判红的当前态陈述）${strong.length} 处 ≥ 5（扫描面/句式写错即零命中，非恒真）`);
else no('P3-③', `强面仅 ${strong.length} 处 < 5 —— 锚点或句式写错会导致零覆盖（前提守卫）`);

let bad = 0;
for (const s of strong) {
  if (!actual) { bad++; continue; }
  if (s.v !== actual[s.field]) {
    bad++;
    console.log(`     [不符] ${s.rel}:${s.line} ${s.field} 写 ${s.v} ≠ 实算 ${actual[s.field]} —— ${s.text}`);
  }
}
if (!actual) no('P3-④', '实算未取得，无法比对引用面');
else if (bad === 0) ok('P3-④', `全部 ${strong.length} 处当前态引用 ≡ 实算（${actual.fails}/${actual.lockMin}/${actual.ttlDay}）`);
else no('P3-④', `${bad} 处当前态引用与实算不符`);

// ============ P4 排除面前提（review/ 确有同类陈述被排除） ============
section('P4 排除面前提（review/ 确有同类陈述，证明排除没打错）');
if (reviewHits.length >= 1) ok('P4-①', `review/ 下确有 ${reviewHits.length} 处同类陈述被排除（前提守卫，非恒真）`);
else no('P4-①', 'review/ 零命中同类陈述 —— 要么已清干净，要么排除面写错（前提守卫）');
reviewHits.slice(0, 4).forEach((h) => console.log(`     [已排除] ${h.rel}:${h.line} ${h.field}=${h.v}`));

// ============ P5 单源不扩散 ============
section('P5 口径单源不扩散');
const spread = files.filter((rel) => {
  if (rel === DECL_REL) return false;
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(DECL_MARK); } catch (_) { return false; }
});
if (spread.length === 0) ok('P5-①', '仅 core/16 一处自称本口径单源');
else no('P5-①', `另有 ${spread.length} 处自称本口径单源：${spread.join(', ')}`);

// ============ 弱面：只明示，不判红 ============
if (weak.length) {
  console.log(`  ⚠️ 弱面（类别锚点/admin 锚点够不着，只明示不判红）${weak.length} 处：`);
  weak.slice(0, 8).forEach((w) => console.log(`     ${w.rel}:${w.line} 写 ${w.v} —— ${w.text}`));
} else {
  console.log('  ⚠️ 弱面 0 处');
}

console.log(`\n===== 后台鉴权安全参数口径守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
