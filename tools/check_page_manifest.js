// tools/check_page_manifest.js —— 【R101】功能页面清单口径守卫（提审材料 ≡ app.json，双向）
// 运行：node tools/check_page_manifest.js
//
// 为什么需要它（**同族病第 9 例**）：
//   `specs/dev-specs/上线材料_提审材料包_v1.md` §4「功能页面清单」是**递交给微信审核的材料**，
//   明写出处 `app.json::pages`、逐行列出页面路径。而 `tools/check_pages.js`（套件 40）只守
//   「app.json 声明 ↔ pages/ 下文件四件套存在」——**它不看这份提审材料一个字**。
//   ⇒ 加/删/改一个页面时：app.json 与 pages/ 同步了（R44 绿），但**提审材料 §4 仍写旧清单**
//     ⇒ 审核材料与实际小程序不符（审核问询面），且零守卫、无人发现。
//   与 R97「套件数」/ R98「云函数清单」/ R99「隐私占位符」/ R100「红线条数」**完全同构**：
//   同一事实在多处人工抄写、零机器校验，更正一次只改到一处。
//
// 判据（双向，缺一不可）：
//   Q1 扫描面 fail-closed：app.json 可解析且 pages 非空；提审材料存在；§4 锚点存在。
//   Q2 语义标记「页面全集口径」+「唯一声明处」命中且可解析出数字 N（删声明 = 口径消失 ⇒ 红）。
//   Q3 声明 N ≡ app.json::pages **实算** 条数（改声明不改代码 / 改代码不改声明 ⇒ 双向都红）。
//   Q4 §4 表格登记行集合 ≡ app.json::pages 集合（**逐条路径双向比对**，只看条数会漏「换了同名数」）。
//   Q5 §4 每行三字段（路径/用途/审核是否必看）非空 + 序号列连续（防空行或错位把计数抬高）。
//   Q6 全仓**当前态全集陈述**全部 ≡ N（强锚点面；换措辞仍绿、改数字即红）。
//   Q7 排除面前提：确有 ≥1 条**子集/历史类**陈述被放行 ⇒ 证明这层排除没打错（round56 ⑦ 同族）。
//   Q8 命中数 fail-closed（正则/扫描面失效 ⇒ 零命中假绿 ⇒ 红）。
//
// 🔴 **Q6 为什么分「强锚点面（判红）/ 弱面（只明示不判红）」**（round62 坑⑭ 第五次印证，首跑当场踩到）：
//    首版裸扫 `N 页` 当场误杀两条**合法的不同语义**：
//      · `core/13:77`「1500 条 ≈ **15 页**往返」= **导出分页的页数**，与小程序页面数无关；
//      · `★知识存储点:311`「**7 页**内联色」= **子集**（有内联色的 7 个页面，不是全集 14）。
//    ⇒ 定式：**只在行内含「全集语义锚点」时才判红**（`个页面` 这种完整量词，或同行出现
//      `app.json` / `清单` / `全量` / `真数据` / `扩展名` / `逐页` 之一 ⇒ 说明这句在说页面全集）；
//      其余 `N 页` 一律**只打印 ⚠️ 明示、不判红**（宁可少判红，不可误杀正确实现 —— round59 铁律）。
//    ⚠️ 由此产生的**已知覆盖缺口**（如实标注，不谎报）：若有人写成「本小程序共 13 页」而全句无任何
//      全集锚点，Q6 抓不到，只会出现在 ⚠️ 明示列表里供人读。真正的硬判据是 Q3（单源声明）与 Q4（表格逐条）。
//
// 🔴 **为什么用「语义标记 + 口径编码进文本」，而不是裸扫「N 页」**（round62 坑⑭ 第五次印证）：
//    裸扫当场误杀 `core/13:156`「其余 **12 页**均为 `wx:if="{{!loading}}"`」—— 那是
//    **子集引用**（14 减去无此分支的 2 页），不是当前全集口径。机器无法从字面区分
//    「当前口径 / 子集 / 历史快照 / 否定式引用」⇒ ① 口径**编码进文本**（带 `页面全集口径` 标记的行为单源）；
//    ② 散落引用行仅在**行内含子集/历史标记词**时放行，并用 Q7 证明这层排除真的命中了东西。
// ⚠️ 明写边界：本守卫**不校验页面用途文案的准确性**（属人工判断），只校验清单与出处的一致性与完整性。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIST_REL = 'specs/dev-specs/上线材料_提审材料包_v1.md';
const SCAN_DIR = path.join(ROOT, 'specs', 'dev-specs');
const MIN_BYTES = 800;
const SCAN_MIN = 20;   // 扫描面至少这么多 .md（路径写错 = 扫空 ⇒ 红）
const CLAIM_MIN = 4;   // 当前态陈述至少这么多处，否则视为正则/扫描面失效

// 语义标记：锚「页面全集口径」+ 其后 80 字内的数字（换措辞仍命中，改数字即红）
const MARK_RE = /页面全集口径[^。\n]{0,80}?\*{0,2}(\d+)\*{0,2}\s*个页面/g;
const UNIQUE_RE = /唯一声明处/;
// 当前态陈述：`<N> 个页面` / `<N> 页`（N 由单源声明解析，**不得写死**；允许 ** 加粗；`页` 后不得紧跟 面/码）
const CLAIM_A_RE = /(\*{0,2})(\d+)(\*{0,2})\s*个页面/g;
const CLAIM_B_RE = /(\*{0,2})(\d+)(\*{0,2})\s*页(?![面])/g;
// 子集 / 历史 / 校订 / 否定式上下文：命中即按「只增不改」放行（不是当前全集口径）
const HIST_RE = /其余|其中|子集|原写|旧副本|漏计|此前|历史|曾写|校订|更正|作废|误计/;
// 全集语义锚点：出现在**数字附近**（±ANCHOR_WIN 字符）⇒ 这句在说「页面全集」；
// 否则只是分页页数 / 子集页数，只明示不判红（同行的 `app.json` 离得远不算锚 —— 见下方注释）
const ANCHOR_SRC = /个页面|app\.json|页面清单|功能页面|全量|真数据|扩展名|逐页/g;
const ANCHOR_WIN = 30;

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

console.log('===== R101 · 功能页面清单口径守卫 =====');

// —— Q1 扫描面 fail-closed
const list = readRel(LIST_REL);
check('Q1-① 提审材料存在且非空', list.ok && list.size >= MIN_BYTES, `${LIST_REL} · ${list.size}B`);

let appPages = [];
let appOk = false;
try {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8').replace(/^\uFEFF/, ''));
  appPages = Array.isArray(app.pages) ? app.pages.slice() : [];
  appOk = true;
} catch (e) {
  appOk = false;
}
check('Q1-② app.json 可解析且 pages 为数组', appOk && appPages.length >= 1, `${appPages.length} 条`);

const SEC_RE = /^## 四、功能页面清单[\s\S]*?(?=\n## )/m;
const secMatch = SEC_RE.exec(list.text);
check('Q1-③ 定位到 §4「功能页面清单」锚点', !!secMatch, secMatch ? '命中' : '零命中（改标题即红）');
const secText = secMatch ? secMatch[0] : '';

const mdFiles = walkMd(SCAN_DIR, []);
check('Q1-④ 扫描面 .md 数 ≥ ' + SCAN_MIN + '（排除 review/，路径写错即红）', mdFiles.length >= SCAN_MIN, `${mdFiles.length} 个`);

// —— Q2 语义标记 + 唯一声明处
const markHits = [];
let m;
MARK_RE.lastIndex = 0;
while ((m = MARK_RE.exec(list.text)) !== null) markHits.push(Number(m[1]));
check('Q2-① 语义标记「页面全集口径」可解析出数字（fail-closed）', markHits.length >= 1,
  markHits.length ? `命中 ${markHits.length} 处：${markHits.join(',')}` : '零命中');
const uniqLines = list.text.split(/\r?\n/).filter((l) => UNIQUE_RE.test(l) && MARK_RE.test(l));
check('Q2-② 「唯一声明处」在提审材料内恰 1 行', uniqLines.length === 1, `${uniqLines.length} 行`);
const N = markHits.length ? markHits[0] : -1;

// —— Q3 声明 ≡ 实算
check(`Q3 声明 N=${N} ≡ app.json::pages 实算 ${appPages.length}`, N === appPages.length,
  `声明 ${N} / 实算 ${appPages.length}`);

// —— Q4 表格登记路径集合 ≡ app.json 集合（双向逐条）
const rowLines = secText.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l));
const rowPaths = [];
for (const l of rowLines) {
  const mm = /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|/.exec(l);
  if (mm) rowPaths.push({ no: Number(mm[1]), p: mm[2], raw: l });
}
check('Q4-① 解析到 §4 表格登记行（含反引号路径）', rowPaths.length >= 1 && rowPaths.length === rowLines.length,
  `${rowPaths.length}/${rowLines.length} 行`);
const setDoc = new Set(rowPaths.map((r) => r.p));
const setApp = new Set(appPages);
const onlyApp = appPages.filter((p) => !setDoc.has(p));
const onlyDoc = rowPaths.filter((r) => !setApp.has(r.p)).map((r) => r.p);
check('Q4-② app.json 每条页面都在 §4 登记（漏登记 = 审核材料缺页）', onlyApp.length === 0,
  onlyApp.length ? onlyApp.join(' | ') : `${appPages.length} 条全覆盖`);
check('Q4-③ §4 每条登记都在 app.json 里（材料写了不存在的页 = 死条目）', onlyDoc.length === 0,
  onlyDoc.length ? onlyDoc.join(' | ') : `${rowPaths.length} 条全部有效`);
check('Q4-④ 登记行无重复路径', setDoc.size === rowPaths.length, `${rowPaths.length} 行 / ${setDoc.size} 唯一`);

// —— Q5 行内字段非空 + 序号连续
const badRows = rowPaths.filter((r) => {
  const cells = r.raw.split('|').slice(1, -1).map((s) => s.trim());
  return cells.length < 4 || cells.slice(1, 4).some((c) => c === '');
});
check('Q5-① §4 每行四字段（#/路径/用途/审核是否必看）非空', badRows.length === 0,
  badRows.length ? badRows.map((r) => r.p).join(' | ') : `${rowPaths.length} 行齐全`);
const seqBad = rowPaths.filter((r, i) => r.no !== i + 1);
check('Q5-② §4 序号列连续 1..N', seqBad.length === 0, seqBad.length ? seqBad.map((r) => r.no).join(',') : `1..${rowPaths.length}`);

// —— Q6 全仓当前态陈述 ≡ N
const claims = [];
const weak = [];
let skippedHist = 0;
for (const f of mdFiles) {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  t.split(/\r?\n/).forEach((line, i) => {
    const hits = [];
    for (const RE of [CLAIM_A_RE, CLAIM_B_RE]) {
      RE.lastIndex = 0;
      let mm;
      while ((mm = RE.exec(line)) !== null) hits.push({ v: Number(mm[2]), at: mm.index });
    }
    if (!hits.length) return;
    if (HIST_RE.test(line)) { skippedHist++; return; }
    // 锚点须在数字附近：`7 页内联色` 那一行虽含 `app.json`，但离数字 45 字符远 ⇒ 判为子集 ⇒ 弱面
    ANCHOR_SRC.lastIndex = 0;
    const anchorAts = [];
    let am;
    while ((am = ANCHOR_SRC.exec(line)) !== null) anchorAts.push(am.index);
    const near = (at) => anchorAts.some((a) => Math.abs(a - at) <= ANCHOR_WIN);
    for (const h of hits) {
      (near(h.at) ? claims : weak).push({ f: path.relative(ROOT, f).replace(/\\/g, '/'), line: i + 1, v: h.v, txt: line.trim().slice(0, 80) });
    }
  });
}
const badClaims = claims.filter((c) => c.v !== N);
check(`Q6 当前态全集陈述全部 ≡ ${N}（强锚点面共 ${claims.length} 处）`, badClaims.length === 0,
  badClaims.length ? badClaims.map((c) => `${c.f}:${c.line} 写 ${c.v}`).join(' | ') : `${claims.length} 处一致`);
if (weak.length) {
  console.log(`  ⚠️ 弱面（无全集锚点，` + '`N 页`' + ` 只明示不判红，避免误杀分页页数/子集页数）${weak.length} 处：`);
  weak.forEach((c) => console.log(`     ${c.f}:${c.line} 写 ${c.v} —— ${c.txt}`));
}

// —— Q7 排除面前提
check('Q7 排除面前提：确有子集/历史类陈述被放行（证明排除面没打错）', skippedHist >= 1, `${skippedHist} 行`);
// —— Q8 命中数 fail-closed
check(`Q8 当前态陈述命中数 ≥ ${CLAIM_MIN}（正则/扫描面失效即零命中假绿）`, claims.length >= CLAIM_MIN, `${claims.length} 处`);
// —— Q9 口径单源不扩散
const otherUnique = mdFiles.filter((f) => {
  if (path.relative(ROOT, f).replace(/\\/g, '/') === LIST_REL) return false;
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch (_) { return false; }
  return UNIQUE_RE.test(t) && /页面全集口径/.test(t);
});
check('Q9 唯一声明处不扩散（其它 .md 不得再自称单源）', otherUnique.length === 0,
  otherUnique.length ? otherUnique.map((f) => path.relative(ROOT, f).replace(/\\/g, '/')).join(' | ') : '仅提审材料一处');

console.log(`\n===== 功能页面清单口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
