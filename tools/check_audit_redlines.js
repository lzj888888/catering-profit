// tools/check_audit_redlines.js —— 【R112】微信审核硬红线口径守卫（声明 ≡ 实算 ≡ 引用，双向）
// 运行：node tools/check_audit_redlines.js
//
// 为什么需要它（**同族病第 19 例**，2026-09-21 round81 防回潮扫描发现）：
//   `core/11_微信审核自查清单.md` §2 的「店算微信审核硬红线清单」自称「**权威计数**」，
//   明写「审核前逐条打勾，任一项缺失即驳回」—— 它是**提审前李老师逐条勾的面**，
//   与 round64 第 8 例（`core/04` §C 红线复核 12 条）**同形态、同后果**（少查一条就提审 ⇒ 驳回返工）。
//
//   实扫证据（round81，回源实扫、不采信任何自述）：
//   ① §2 清单实算 **6** 条（`> N. ` 形式，序号 1..6 连续）；
//   ② 全仓 `grep -rn "硬红线"`（排除 review/）**仅 1 处命中** = 该清单标题行本身
//      ⇒ **计数 6 未在任何第二处出现**，当前**零漂移**；
//   ③ `grep -rln "11_微信审核自查清单|微信审核自查" tools/ specs/dev-specs/prototype/ verify_all.js` ⇒ **零命中**；
//      `grep -rln "硬红线" tools/ specs/dev-specs/prototype/` ⇒ **零命中**
//      ⇒ 既有的 R100 `check_redline_inventory.js` 只守 `core/04_核对清单.md` §C（其 LIST_REL 写死 04），
//        **不看 core/11 一个字** ⇒ 该口径**长期零守卫**。
//
//   ⇒ **「缺守卫」与「已违规」必须分开上报**（round55 纪律）：本轮实扫证明当前无漂移、
//     无错误数据；本守卫做的是**防复发**—— 今后任一侧改数字都会当场判红，不再靠人记。
//
// 判据（双向，缺一不可）：
//   A1 扫描面 fail-closed：core/11 存在且非空；`specs/dev-specs` 下 .md ≥ SCAN_MIN（路径写错 = 扫空 ⇒ 红）。
//   A2 语义标记「审核硬红线口径」+「唯一声明处」可解析出数字 N（删声明 = 口径消失 ⇒ 红）。
//   A3 声明 N ≡ §2 清单**实算**行数（改清单不改声明 / 改声明不改清单 ⇒ 双向都红）。
//   A4 §2 序号连续 1..N 且不重复（防跳号/重号把计数抬高）。
//   A5 每条非空（防空行混入把计数抬高）。
//   A6 全仓**当前态声明**（「审核硬红线」±30 字符内出现「N 条」）全部 ≡ N，且有命中数下限（fail-closed）。
//   A7 两条前提守卫：①扫描面确含目标文件（自指排除没误伤）②§6 勾选条数 ≥ N（「与待办表一致」的弱形式）。
//   A8 唯一声明处不扩散（其它 .md 的**同一行**不得同时含「唯一声明处」+ 本口径标记）。
//   W  弱面：§6 提审前自检勾选条数与 §2 硬红线条数是**两张清单**（round73 已实读判定），只明示不判红。
//
// 🔴 **为什么用「语义标记」，而不是裸扫「N 条红线」**（round62 坑⑭ / round63 / round66 / round81 多轮复现）：
//    裸扫 `(\d+)条` + 红线类关键词当场误杀重启键「套件数会漂」演进链里的历史值（12 条 / 11 条…），
//    那些是**另一口径的历史快照**。机器无法从字面区分「当前口径 / 历史快照 / 否定式引用」
//    ⇒ 口径**编码进文本**：带 `审核硬红线口径` 标记的行才是单源；引用行靠「审核硬红线」**就近 ±30 字符**锚定
//      （round65 坑⑯：「同行即锚」也会误杀，锚点必须就近）。
// ⚠️ 明写边界：本守卫不保证 `review/` 下历史 NOTE 里的旧数字正确（按「只增不改」放行）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIST_REL = 'specs/dev-specs/core/11_微信审核自查清单.md';
const SCAN_DIR = path.join(ROOT, 'specs', 'dev-specs');
const MIN_BYTES = 800;
const SCAN_MIN = 25;    // 扫描面至少这么多 .md（round80/81 实测 30 份）
const CLAIM_MIN = 2;    // 当前态声明至少 2 处（core/11 声明行 + core/13 引用行）
const WIN = 30;         // 锚点就近窗口（坑⑯）

// 语义标记：锚「审核硬红线口径」+ 其后 60 字内的数字（换措辞仍命中，改数字即红）
const MARK_RE = /审核硬红线口径[^。\n]{0,60}?\*{0,2}(\d+)\*{0,2}\s*条/g;
const UNIQUE_RE = /唯一声明处/;
const MARK_KEY = '审核硬红线口径';

// 当前态声明：行内含「审核硬红线」，且数字在关键词 ±WIN 字符内（双向）
const KW_RE = /审核硬红线/g;
const NUM_RE = /\*{0,2}(\d+)\*{0,2}\s*条/g;
// 历史 / 校订 / 否定式上下文：命中即按「只增不改」放行（不是当前口径）
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

console.log('===== R112 · 微信审核硬红线口径守卫 =====');

// —— A1 扫描面 fail-closed
const list = readRel(LIST_REL);
check('A1-① 单源文件存在且非空', list.ok && list.size >= MIN_BYTES, `${LIST_REL} · ${list.size}B`);
const mdFiles = walkMd(SCAN_DIR, []);
check('A1-② 扫描面 .md 数 ≥ ' + SCAN_MIN + '（排除 review/，路径写错即红）', mdFiles.length >= SCAN_MIN, `${mdFiles.length} 个`);

// —— A2 语义标记 + 唯一声明处
const markHits = [];
let m;
MARK_RE.lastIndex = 0;
while ((m = MARK_RE.exec(list.text)) !== null) markHits.push(Number(m[1]));
check('A2-① 语义标记「审核硬红线口径」可解析出数字（fail-closed）', markHits.length >= 1,
  markHits.length ? `命中 ${markHits.length} 处：${markHits.join(',')}` : '零命中');
const uniqLines = list.text.split(/\r?\n/).filter((l) => UNIQUE_RE.test(l) && l.includes(MARK_KEY));
check('A2-② 「唯一声明处」在 core/11 内恰 1 行', uniqLines.length === 1, `${uniqLines.length} 行`);
const N = markHits.length ? markHits[0] : -1;

// —— A3 声明 ≡ 实算行数
const lines = list.text.split(/\r?\n/);
const headIdx = lines.findIndex((l) => l.includes('店算微信审核硬红线清单'));
const rows = [];
if (headIdx >= 0) {
  for (const l of lines.slice(headIdx, headIdx + 15)) {
    const mm = /^>\s*(\d+)\.\s*(.+)$/.exec(l);
    if (mm) rows.push({ n: Number(mm[1]), txt: mm[2].trim() });
  }
}
check('A3-① 解析到 §2 硬红线清单条目（fail-closed）', rows.length >= 1, `${rows.length} 条`);
check(`A3-② 声明 N=${N} ≡ 实算条数 ${rows.length}`, N === rows.length, `声明 ${N} / 实算 ${rows.length}`);

// —— A4 序号连续且不重复
const nums = rows.map((r) => r.n);
const seq = nums.length ? nums.join(',') === Array.from({ length: nums.length }, (_, i) => i + 1).join(',') : false;
check(`A4-① 序号连续 1..${nums.length}`, seq, nums.join(','));
check('A4-② 序号不重复', new Set(nums).size === nums.length, `去重后 ${new Set(nums).size} / ${nums.length}`);

// —— A5 每条非空
const badRows = rows.filter((r) => r.txt.replace(/[*`>]/g, '').trim().length < 8);
check('A5 每条正文非空（≥8 字符，防空行混入抬高计数）', badRows.length === 0,
  badRows.length ? badRows.map((r) => r.n).join(',') : `${rows.length} 条齐全`);

// —— A6 全仓当前态声明 ≡ N（锚点就近 ±WIN）
const claims = [];
let skippedHist = 0;
for (const f of mdFiles) {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  t.split(/\r?\n/).forEach((line, i) => {
    KW_RE.lastIndex = 0;
    const kwPos = [];
    let k;
    while ((k = KW_RE.exec(line)) !== null) kwPos.push(k.index);
    if (!kwPos.length) return;
    NUM_RE.lastIndex = 0;
    const hits = [];
    let n;
    while ((n = NUM_RE.exec(line)) !== null) {
      const pos = n.index;
      if (kwPos.some((p) => Math.abs(pos - p) <= WIN + 6)) hits.push(Number(n[1]));
    }
    if (!hits.length) return;
    if (HIST_RE.test(line)) { skippedHist++; return; }
    hits.forEach((v) => claims.push({
      f: path.relative(ROOT, f).replace(/\\/g, '/'), line: i + 1, v, txt: line.trim().slice(0, 80),
    }));
  });
}
const badClaims = claims.filter((c) => c.v !== N);
check(`A6-① 当前态声明全部 ≡ ${N}（共 ${claims.length} 处）`, badClaims.length === 0,
  badClaims.length ? badClaims.map((c) => `${c.f}:${c.line} 写 ${c.v}`).join(' | ') : `${claims.length} 处一致`);
check(`A6-② 当前态声明命中数 ≥ ${CLAIM_MIN}（正则/扫描面失效即零命中假绿）`, claims.length >= CLAIM_MIN, `${claims.length} 处`);

// —— A7 两条前提守卫
check('A7-① 前提：扫描面确含目标文件（自指排除没误伤）',
  mdFiles.some((f) => path.relative(ROOT, f).replace(/\\/g, '/') === LIST_REL), LIST_REL);
const cbCount = lines.filter((l) => l.startsWith('- [ ]')).length;
check(`A7-② 前提：§6 提审前自检勾选条数 ≥ N=${N}（「与待办表一致」的弱形式）`, cbCount >= N && N > 0,
  `§6 勾选 ${cbCount} 条 / 硬红线 ${N} 条`);

// —— A8 单源唯一性（行级，坑⑯：不看整文件）
const otherUnique = [];
for (const f of mdFiles) {
  if (path.relative(ROOT, f).replace(/\\/g, '/') === LIST_REL) continue;
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  t.split(/\r?\n/).forEach((line, i) => {
    if (UNIQUE_RE.test(line) && line.includes(MARK_KEY)) {
      otherUnique.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}`);
    }
  });
}
check('A8 唯一声明处不扩散（其它 .md 同行不得同时自称单源 + 本口径）', otherUnique.length === 0,
  otherUnique.length ? otherUnique.join(' | ') : '仅 core/11 一处');

// —— W 弱面（只明示，不判红；round73 已实读：§6 与 §2 是两张清单，不构成漂移）
console.log(`\n===== W 弱面（只明示不判红）=====`);
console.log(`  ⚠️ §6「提审前自检清单」勾选 ${cbCount} 条 与 §2「审核硬红线」${rows.length} 条 是**两张不同清单**`);
console.log(`     （round73 实读判定：6 vs 11 不构成漂移；core/11:44 自称「与待办表(§6)一致」指口径一致而非条数相等）`);
console.log(`     ⇒ 裸扫「N 条」必误杀，故弱面只打印；硬判据是 A3（声明≡实算）与 A6（全仓引用≡N）。`);
check(`W-① 弱面已打印（坑⑭/⑯ 印证：裸扫数字必误杀）`, cbCount >= 1 && rows.length >= 1,
  `§6 ${cbCount} 条 / §2 ${rows.length} 条`);

console.log(`\n===== 微信审核硬红线口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
