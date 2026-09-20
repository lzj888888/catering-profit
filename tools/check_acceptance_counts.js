/**
 * check_acceptance_counts.js —— 验收自检通过数口径守卫（R105，round69）
 *
 * 背景（同族病第 13 例，与 round61「重启键套件数」/ round63 隐私占位符 / round64 红线条数同族）：
 *   《02_模拟测试数据集.md》是**验收唯一标准**，`specs/dev-specs/prototype/verify_seed_data.js` 是它的
 *   机器可消费落点（本机一跑即知 S1~S4 全部锚点是否命中）。它的通过数被 5 处文档记成 **41**，
 *   而实跑早已是 **48** —— 更讽刺的是同一份 `★知识存储点` 里 §1.1 行写 `verify_seed_data 48/48`、
 *   另一处却仍写 `41/41`（同文件自相矛盾），`verify_all.js` 的收尾注释里也早写着 48。
 *
 * 后果（为什么必须守）：「期望通过数」被写低 = **下界保护失效** —— 断言从 48 掉回 41 时，
 *   文档仍说「41 通过即符合预期」 ⇒ 7 条断言静默丢失而**验收照旧判绿**。反向也伤人：
 *   验收人看到实际 48 而文档写 41，会先当异常去查一轮（虚惊）。
 *
 * 判据（三条腿，沿用 round63~68 已验证的模板）：
 *   ① 实算单源：**实跑** verify_seed_data.js 并解析 `验收自检结果：N 通过 / M 失败`（不抄任何字面量，fail-closed）。
 *   ② 唯一声明处：`core/14_种子数据与验收脚本规范.md` 的语义标记 `验收自检口径（唯一声明处）`。
 *   ③ 引用面：全仓（index ∪ 工作树）.md 里**锚点就近**的当前态陈述必须 ≡ 实算；
 *      历史陈述（`git commit` 示例行等）按 HIST 放行，并配**前提守卫**证明排除确实生效。
 *
 * ⚠️ 两个已踩过的坑在本守卫里的对应处理：
 *   · 坑⑪ CJK 八进制转义：`git -c core.quotepath=false ls-files` + 出现 `\NNN` 即判红（不许 catch 静默跳过）。
 *   · 坑⑱ `git ls-files` 只扫 index：扫描面 = index ∪ 工作树递归，并加**非恒真前提**（补面须 ≥N 个文件）。
 *   · 坑⑭/⑯ 裸扫数字必误杀：只认 `N/N 全绿` 与 `N 通过 / M 失败` 两种**该指标专属**句式，
 *     且锚点（`verify_seed_data`/`verify`/`验收自检`/`验收套件`/`seed_data`）须**就近**（≤120 字符）；
 *     够不着的归入弱面，只打印 ⚠️ 明示、不判红（宁可少判红，不可误杀）。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DECL_REL = 'specs/dev-specs/core/14_种子数据与验收脚本规范.md';
const SCRIPT_REL = 'specs/dev-specs/prototype/verify_seed_data.js';
const DECL_MARK = '验收自检口径（唯一声明处）';

// 锚点：只有这些词出现在数字附近，才把该数字当成"验收自检通过数"的当前态陈述
const ANCHORS = ['verify_seed_data', 'verify', '验收自检', '验收套件', 'seed_data'];
const NEAR = 120;
// 历史/非当前态陈述的放行词：行内含其一即视为 HIST（演进链、commit 示例、否定式引用）
const HIST = ['git commit', 'commit -m', '原写', '此前', '曾写', '旧值', '历史'];

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

function readAbs(abs) { return fs.readFileSync(abs, 'utf8'); }

/** 扫描面 = index ∪ 工作树（坑⑱）；返回 .md 绝对路径数组 */
function scanMdFiles() {
  const set = new Set();
  let idx = [];
  try {
    idx = execSync('git -c core.quotepath=false ls-files', { cwd: ROOT, encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);
  } catch (e) { /* 下面用 fail-closed 断言兜 */ }
  let escaped = 0;
  for (const rel of idx) {
    if (/\\\d{3}/.test(rel)) { escaped++; continue; }           // 坑⑪：转义路径直接判红，不静默跳过
    if (!/\.md$/.test(rel)) continue;
    if (rel.startsWith('review/')) continue;
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) set.add(abs);
  }
  // 工作树补面（未 git add 的新文件也要扫到）
  let treeAdded = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name === 'review' || e.name === 'node_modules' || e.name === '.git') continue; walk(abs); }
      else if (e.name.endsWith('.md') && !set.has(abs)) { set.add(abs); treeAdded++; }
    }
  };
  walk(path.join(ROOT, 'specs'));
  walk(ROOT);
  return { files: [...set], escaped, idxCount: idx.length, treeAdded };
}

/** 从文本里解析 "N 通过 / M 失败" 或 "N/M 全绿" */
function findClaims(text) {
  const out = [];
  // 两种句式语义不同，必须分别归一化后再比：
  //   「N 通过 / M 失败」→ pass=N, fail=M
  //   「N/M 全绿」      → pass=N, fail=M-N（第二个数是**总数**，不是失败数）
  const forms = [
    { re: /(\d+)\s*通过\s*\/\s*(\d+)\s*失败/g, kind: 'pf' },
    { re: /(\d+)\s*\/\s*(\d+)\s*全绿/g, kind: 'tot' },
  ];
  for (const f of forms) {
    let m;
    f.re.lastIndex = 0;
    while ((m = f.re.exec(text)) !== null) {
      const a = Number(m[1]), b = Number(m[2]);
      const item = f.kind === 'pf'
        ? { pass: a, fail: b, a, b }
        : { pass: a, fail: b - a, a, b };
      item.idx = m.index; item.raw = m[0]; item.kind = f.kind;
      out.push(item);
    }
  }
  return out;
}

function nearestAnchor(text, idx) {
  let best = Infinity;
  for (const w of ANCHORS) {
    let p = text.indexOf(w);
    while (p !== -1) { best = Math.min(best, Math.abs(p - idx)); p = text.indexOf(w, p + 1); }
  }
  return best;
}

// ============ A0 实算单源：真跑脚本 ============
section('A0 实算单源（真跑 verify_seed_data.js，不抄字面量）');
let actual = null;
try {
  const abs = path.join(ROOT, SCRIPT_REL);
  const out = execFileSync(process.execPath, [abs], {
    cwd: path.dirname(abs), encoding: 'utf8', maxBuffer: 1 << 24,
  });
  const m = out.match(/验收自检结果\s*[:：]\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
  if (m) actual = { pass: Number(m[1]), fail: Number(m[2]) };
} catch (e) { /* 落到 fail-closed */ }
if (actual) ok('A1-①', `实跑可解析（fail-closed） —— ${actual.pass} 通过 / ${actual.fail} 失败`);
else no('A1-①', '实跑结果解析失败（fail-closed：拿不到实算就不许放行）');

if (actual && actual.fail === 0) ok('A1-②', '实跑失败数为 0（验收锚点当前全绿）');
else if (actual) no('A1-②', `实跑存在失败断言：${actual.fail} 条`);

// ============ A2 扫描面 ============
section('A2 扫描面（index ∪ 工作树 · CJK 不得被转义跳过）');
const { files, escaped, idxCount, treeAdded } = scanMdFiles();
if (escaped === 0) ok('A2-①', `无 CJK 八进制转义路径（坑⑪） —— git ls-files ${idxCount} 条`);
else no('A2-①', `出现 ${escaped} 条八进制转义路径（CJK 文件会被静默跳过）`);
if (files.length >= 25) ok('A2-②', `扫描面非空（路径写错即零覆盖，非恒真） —— ${files.length} 个 .md（工作树补 ${treeAdded} 个）`);
else no('A2-②', `扫描面仅 ${files.length} 个 .md，疑似路径写错（非恒真前提守卫）`);

// ============ A3 唯一声明处 ============
section('A3 唯一声明处 ≡ 实算');
const declAbs = path.join(ROOT, DECL_REL);
let declHits = [];
for (const abs of files) {
  const t = readAbs(abs);
  const lines = t.split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (ln.includes(DECL_MARK)) declHits.push({ abs, rel: path.relative(ROOT, abs).replace(/\\/g, '/'), line: i + 1, text: ln });
  });
}
if (declHits.length === 1) ok('A3-①', `唯一声明处恰 1 处 —— ${declHits[0].rel}:${declHits[0].line}`);
else if (declHits.length === 0) no('A3-①', '找不到唯一声明处（fail-closed：声明被删即红）');
else no('A3-①', `唯一声明处出现 ${declHits.length} 处，口径单源不唯一`);

let declVal = null;
if (declHits.length >= 1) {
  const m = declHits[0].text.match(/\*\*(\d+)\*\*\s*通过\s*\/\s*\*\*(\d+)\*\*\s*失败/);
  if (m) declVal = { pass: Number(m[1]), fail: Number(m[2]) };
}
if (declVal) ok('A3-②', `声明可解析出通过/失败数（fail-closed） —— 声明 ${declVal.pass} 通过 / ${declVal.fail} 失败`);
else no('A3-②', '声明行解析不出「**N** 通过 / **M** 失败」（fail-closed）');

if (declVal && actual) {
  if (declVal.pass === actual.pass) ok('A4-①', `声明通过数 ≡ 实算 —— 声明 ${declVal.pass} / 实跑 ${actual.pass}`);
  else no('A4-①', `声明通过数 ${declVal.pass} ≠ 实跑 ${actual.pass}（期望通过数被写低 ⇒ 断言被删也判绿）`);
  if (declVal.fail === actual.fail) ok('A4-②', `声明失败数 ≡ 实算 —— 均为 ${actual.fail}`);
  else no('A4-②', `声明失败数 ${declVal.fail} ≠ 实跑 ${actual.fail}`);
}

// ============ A5 引用面（当前态陈述 ≡ 实算）============
section('A5 全仓当前态引用 ≡ 实算');
const strong = [], weak = [], hist = [];
for (const abs of files) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const t = readAbs(abs);
  const lines = t.split(/\r?\n/);
  lines.forEach((ln, i) => {
    const claims = findClaims(ln);
    if (!claims.length) return;
    if (ln.includes(DECL_MARK)) return;                       // 声明行本身不计入引用面
    const isHist = HIST.some((h) => ln.includes(h));
    for (const c of claims) {
      const d = nearestAnchor(ln, c.idx);
      const item = { rel, line: i + 1, a: c.a, b: c.b, pass: c.pass, fail: c.fail, raw: c.raw, dist: d, text: ln.trim().slice(0, 90) };
      if (isHist) hist.push(item);
      else if (d <= NEAR) strong.push(item);
      else weak.push(item);
    }
  });
}
if (strong.length >= 3) ok('A5-①', `引用面命中 ≥3（扫描面/句式写错即零命中，非恒真） —— ${strong.length} 处`);
else no('A5-①', `引用面仅命中 ${strong.length} 处，疑似句式或扫描面写错（前提守卫）`);

let bad = 0;
for (const s of strong) {
  if (!actual) { bad++; continue; }
  if (s.pass !== actual.pass || s.fail !== actual.fail) {
    bad++;
    no('A5-②', `${s.rel}:${s.line} 写「${s.raw}」（归一 ${s.pass} 通过 / ${s.fail} 失败）≠ 实算 ${actual.pass}/${actual.fail} —— ${s.text}`);
  }
}
if (bad === 0 && actual) ok('A5-②', `全部 ${strong.length} 处当前态引用 ≡ 实算 ${actual.pass}/${actual.fail}`);

if (hist.length >= 1) ok('A6-①', `HIST 排除面生效（确有历史/非当前态陈述被放行，非恒真） —— ${hist.length} 处：${hist.map((h) => h.rel + ':' + h.line).join(', ')}`);
else no('A6-①', 'HIST 排除面零命中 —— 要么历史陈述已被清干净，要么排除词写错（前提守卫）');
hist.slice(0, 6).forEach((h) => console.log(`     [HIST 放行] ${h.rel}:${h.line} 「${h.raw}」 —— ${h.text}`));

if (weak.length) {
  console.log(`  ⚠️ 弱面（锚点不就近，只明示不判红，可能是子集/另一口径）${weak.length} 处：`);
  weak.slice(0, 8).forEach((w) => console.log(`     ${w.rel}:${w.line} 写 ${w.a}/${w.b}（最近锚点 ${w.dist} 字符） —— ${w.text}`));
} else {
  console.log('  ⚠️ 弱面 0 处（无够不着锚点的可疑陈述）');
}

// ============ A7 单源不扩散 ============
section('A7 口径单源不扩散');
const spread = files.filter((abs) => {
  if (abs === declAbs) return false;
  return readAbs(abs).includes(DECL_MARK);
});
if (spread.length === 0) ok('A7-①', '仅 core/14 一处自称本口径单源');
else no('A7-①', `另有 ${spread.length} 处自称本口径单源：${spread.map((a) => path.relative(ROOT, a).replace(/\\/g, '/')).join(', ')}`);

console.log(`\n===== 验收自检通过数口径守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
