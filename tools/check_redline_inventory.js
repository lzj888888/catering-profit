// tools/check_redline_inventory.js —— 【R100】红线复核条数口径守卫（文档声明 ≡ 实扫，双向）
// 运行：node tools/check_redline_inventory.js
//
// 为什么需要它（**同族病第 8 例**）：
//   `core/04_核对清单.md` 的 §C「红线复核表（一票否决）」是**交付打回的门槛**，实扫该表 = **12** 行
//   （末行「操作必留痕」）。而 2026-09-12 的校订（04 第 265 行）早已明写「原写 11 条红线…漏计 1 条」，
//   更正**只落在一处**：2026-09-20 round64 回源实扫发现另有 **3 处仍写 11 条**
//   —— `core/05_审计单.md`（"11 条红线复核：通过 ____ / 11"）、
//      `core/06_工程治理与运维规范.md`（"红线复核 11 条全过"，且它就印在 **v1.0.0 提审发布**那一行）、
//      `写码阶段启动执行手册_v1.0.md`（阶段 5 收尾项）。
//   后果不是文字瑕疵：06 那一行是**提审发布判据**，照它执行会少查 1 条红线（操作必留痕）就放行。
//   与 R59「套件数」/ round61「重启键套件数」/ R98「云函数清单」/ R99「隐私占位符」**完全同构**：
//   同一事实在多处人工抄写、零机器校验，更正一次只改到一处。
//
// 判据（双向，缺一不可）：
//   P1 扫描面 fail-closed：04 存在且非空；`specs/dev-specs` 下 .md 扫描数 ≥ SCAN_MIN（路径写错 = 扫空 ⇒ 红）。
//   P2 语义标记「红线全集口径」+「唯一声明处」命中且能解析出数字 N（删声明 = 口径消失 ⇒ 红）。
//   P3 声明 N ≡ §C 表格**实算**行数（改表不改声明 / 改声明不改表 ⇒ 双向都红）。
//   P4 §C 每条三字段（红线 / 检查方法 / 不符后果）非空（防空行混入把计数抬高）。
//   P5 全仓**当前态声明**（`X 条红线` / `红线复核 X 条`）全部 ≡ N（换措辞仍绿、改数字即红）。
//   P6 排除面前提：确有 ≥1 条**历史/校订类**陈述被排除 ⇒ 证明「靠上下文标记放行历史件」这层排除没打错
//      （round56 ⑦ 同族：每写一条排除，就要守住它的前提；打错 ⇒ 守卫静默失明）。
//   P7 当前态声明命中数 ≥ CLAIM_MIN（fail-closed：扫描面/正则失效 ⇒ 零命中假绿 ⇒ 红）。
//   P8 唯一声明处恰 1 处且在 04 内（口径单源，其它处只能是引用）。
//
// 🔴 **为什么用「语义标记 + 口径编码进文本」，而不是裸扫「N 条红线」**（round62 坑⑭ / round63 第三次复现）：
//    裸扫会当场误杀 04 第 265 行的**校订说明**（「原写「11 条红线 / AD-1~AD-21」，漏计 1 条红线」）——
//    那句是**否定式/历史式引用**，不是当前口径。机器无法从字面区分「当前口径 / 历史快照 / 否定式引用」，
//    ⇒ 正确做法 = ① 把口径**编码进文本**（带 `红线全集口径` 标记的行才是单源，round62/63 同一手法）；
//      ② 对散落的引用行，仅在**行内含历史/校订标记词**时放行，并用 P6 证明这层排除真的命中了东西。
// ⚠️ 明写边界：本守卫**不保证 review/ 下历史 NOTE 里的旧数字正确**（按「只增不改」放行）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIST_REL = 'specs/dev-specs/core/04_核对清单.md';
const SCAN_DIR = path.join(ROOT, 'specs', 'dev-specs');
const MIN_BYTES = 800;
const SCAN_MIN = 20;   // 扫描面至少这么多 .md，否则视为路径/环境异常
const CLAIM_MIN = 3;   // 当前态声明至少这么多处（04 交付判据行 + 05 + 06 + 手册 …）

// 语义标记：锚「红线全集口径」+ 其后 80 字内的数字（换措辞仍命中，改数字即红）
const MARK_RE = /红线全集口径[^。\n]{0,80}?\*{0,2}(\d+)\*{0,2}\s*条/g;
const UNIQUE_RE = /唯一声明处/;
// 当前态声明：`11 条红线` / `红线复核 12 条`（允许 ** 加粗）
const CLAIM_RE = /(\*{0,2})(\d+)(\*{0,2})\s*条红线|红线复核\s*(\*{0,2})(\d+)/g;
// 历史 / 校订 / 否定式上下文：命中即按「只增不改」放行（不是当前口径）
const HIST_RE = /原写|旧副本|漏计|此前|历史|曾写|校订|更正|作废|误计/;

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

console.log('===== R100 · 红线复核条数口径守卫 =====');

// —— P1 扫描面 fail-closed
const list = readRel(LIST_REL);
check('P1-① 单源文件存在且非空', list.ok && list.size >= MIN_BYTES, `${LIST_REL} · ${list.size}B`);
const mdFiles = walkMd(SCAN_DIR, []);
check('P1-② 扫描面 .md 数 ≥ ' + SCAN_MIN + '（排除 review/，路径写错即红）', mdFiles.length >= SCAN_MIN, `${mdFiles.length} 个`);

// —— P2 语义标记 + 唯一声明处
const markHits = [];
let m;
MARK_RE.lastIndex = 0;
while ((m = MARK_RE.exec(list.text)) !== null) markHits.push(Number(m[1]));
check('P2-① 语义标记「红线全集口径」可解析出数字（fail-closed）', markHits.length >= 1,
  markHits.length ? `命中 ${markHits.length} 处：${markHits.join(',')}` : '零命中');
const uniqLines = list.text.split(/\r?\n/).filter((l) => UNIQUE_RE.test(l) && MARK_RE.test(l));
check('P2-② 「唯一声明处」在 04 内恰 1 行', uniqLines.length === 1, `${uniqLines.length} 行`);
const N = markHits.length ? markHits[0] : -1;

// —— P3 声明 ≡ 实算行数
const secMatch = /^## C\. 红线复核表[\s\S]*?(?=\n## )/m.exec(list.text);
const secText = secMatch ? secMatch[0] : '';
const rows = secText.split(/\r?\n/).filter((l) => /^\|\s*.+\|/.test(l) && !/^\|\s*-{2,}/.test(l) && !/^\|\s*红线\s*\|/.test(l));
check('P3-① 解析到 §C 表格数据行', rows.length >= 1, `${rows.length} 行`);
check(`P3-② 声明 N=${N} ≡ 实算行数 ${rows.length}`, N === rows.length, `声明 ${N} / 实算 ${rows.length}`);

// —— P4 三字段非空
const badRows = rows.filter((l) => {
  const cells = l.split('|').slice(1, -1).map((s) => s.trim());
  return cells.length < 3 || cells.slice(0, 3).some((c) => c === '');
});
check('P4 §C 每行三字段（红线/检查方法/不符后果）非空', badRows.length === 0, badRows.length ? badRows.join(' | ') : `${rows.length} 行齐全`);

// —— P5 全仓当前态声明 ≡ N
const claims = [];
let skippedHist = 0;
for (const f of mdFiles) {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  t.split(/\r?\n/).forEach((line, i) => {
    CLAIM_RE.lastIndex = 0;
    const hits = [];
    let mm;
    while ((mm = CLAIM_RE.exec(line)) !== null) hits.push(Number(mm[2] || mm[5]));
    if (!hits.length) return;
    if (HIST_RE.test(line)) { skippedHist++; return; }
    hits.forEach((v) => claims.push({ f: path.relative(ROOT, f).replace(/\\/g, '/'), line: i + 1, v, txt: line.trim().slice(0, 90) }));
  });
}
const badClaims = claims.filter((c) => c.v !== N);
check(`P5 当前态声明全部 ≡ ${N}（共 ${claims.length} 处）`, badClaims.length === 0,
  badClaims.length ? badClaims.map((c) => `${c.f}:${c.line} 写 ${c.v}`).join(' | ') : `${claims.length} 处一致`);

// —— P6 排除面前提
check('P6 排除面前提：确有历史/校订类陈述被放行（证明排除面没打错）', skippedHist >= 1, `${skippedHist} 行`);
// —— P7 命中数 fail-closed
check(`P7 当前态声明命中数 ≥ ${CLAIM_MIN}（正则/扫描面失效即零命中假绿）`, claims.length >= CLAIM_MIN, `${claims.length} 处`);
// —— P8 单源唯一性（其它文件不得自称唯一声明处）
const otherUnique = mdFiles.filter((f) => {
  if (path.relative(ROOT, f).replace(/\\/g, '/') === LIST_REL) return false;
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { return false; }
  return UNIQUE_RE.test(t) && /红线全集口径/.test(t);
});
check('P8 唯一声明处不扩散（其它 .md 不得再自称单源）', otherUnique.length === 0,
  otherUnique.length ? otherUnique.map((f) => path.relative(ROOT, f).replace(/\\/g, '/')).join(' | ') : '仅 04 一处');

console.log(`\n===== 红线复核条数口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
