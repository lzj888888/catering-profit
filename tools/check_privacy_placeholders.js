// tools/check_privacy_placeholders.js —— 【R99】隐私政策占位符口径守卫（文档声明 ≡ 实扫，双向）
// 运行：node tools/check_privacy_placeholders.js
//
// 为什么需要它（**同族病第 7 例**：与 R59「套件数」/ round61「重启键套件数」/ R98「云函数清单」同一病）：
//   隐私政策占位符是**上线唯一硬阻塞里唯一要李老师动手的一项**，而它的处数在仓里先后被记成
//   4 处（round47/48）→ 7 处（round50）→ 6 处（round51 实扫核准）。round51 修了 4 处陈述，
//   但 2026-09-20 round63 回源实扫发现：**重启键「阻塞抽查更正」行仍写「7 处未填」**
//   （round51 当时漏跟的那一条），且**全仓零守卫** —— 与 round61「重启键套件数写 68、实算 69」完全同构。
//   后果不是文字瑕疵：这个数字直接决定李老师填空时被漏掉几项，漏一项就卡提审。
//
// 判据（双向，缺一不可）：
//   P1 扫描面 fail-closed：三个文件均存在且非空（路径写错 = 扫了个寂寞 ⇒ 红）。
//   P2 实扫占位符 ≥ 1（剥反引号后的裸 `【…】`；为 0 说明扫描面/规则打错 ⇒ 红）。
//   P3 元描述命中 ≥ 1（**被反引号包裹**的 `【…】`，如「文档内 `【…】` 标记」）
//      —— 这是「剥反引号」这层规则的**前提守卫**（与 round56⑦ 同族：每写一条排除，就要守它的前提）；
//      为 0 ⇒ 要么文件结构变了、要么规则失效，而 P2 会假绿 ⇒ 红。
//   P4 语义标记「占位符全集口径」命中 ≥ MARK_MIN（fail-closed：删声明 = 口径消失 ⇒ 红）。
//   P5 所有带标记处的数字 ≡ 实扫 N（**换措辞仍绿、改数字即红**）。
//   P6 「唯一声明处」恰 1 处且在隐私政策文件内（**口径单源**，其它处只能是引用）。
//   P7 排除面前提：`review/` 下确实存在历史计数陈述（4 处 / 7 处）⇒ 证明「历史件按只增不改放行、
//      靠扫描面排除 review/」这个排除面没打错（打错 ⇒ 守卫静默失明）。
//   P8 扫描面固定 3 个文件且不含 `tools/`（本守卫不在扫描面内 ⇒ 无 round61⑫ 自指污染）。
//
// 🔴 **为什么用「语义标记 + 口径编码进文本」，而不是裸扫「N 处」**（round62 坑⑭ 第三次复现）：
//    裸扫 `(\d+)\s*处` 当场**误杀 4 处**：
//      · 提审材料包 §4 后静态自检段的「N 处页面跳转」写法（round62 当时写作「19 处」）= 与占位符无关的走查计数；
//      · 提审材料包:126 与 隐私政策:86 里的「4 处」= **否定式引用**（「此前"4 处"为漏计」「非 4 处」）；
//      · 隐私政策:86 自身还有 `【…】` 元描述。
//    ⇒ 机器无法从字面区分「当前口径 / 历史快照 / 否定式引用 / 无关计数」，
//      正确做法 = 把口径**编码进文本**（与 check_stale_claims、check_fn_inventory 同一手法）：
//      带 `占位符全集口径` 标记的行才是口径，历史件与否定式天然没有该标记。
// ⚠️ 明写边界：本守卫**不保证 review/ 下历史 NOTE 里的旧数字正确**（按「只增不改」放行）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY_REL = 'specs/dev-specs/上线材料_隐私政策_v1.md';
const PACK_REL = 'specs/dev-specs/上线材料_提审材料包_v1.md';
const RESTART_REL = 'specs/dev-specs/★知识存储点_2026-09-10.md';
const SCAN_RELS = [POLICY_REL, PACK_REL, RESTART_REL];
const REVIEW_DIR = path.join(ROOT, 'review');
const MIN_BYTES = 800;
const MARK_MIN = 3; // 唯一声明处 1 + 引用 2

// 语义标记：锚「占位符全集口径」+ 其后 60 字内的数字（换措辞仍命中，改数字即红）
const MARK_RE = /占位符全集口径[^。\n]{0,60}?\*{0,2}(\d+)\*{0,2}\s*处/g;
const UNIQUE_RE = /唯一声明处/;

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}

function read(rel) {
  const p = path.join(ROOT, rel);
  return { p, ok: fs.existsSync(p), size: fs.existsSync(p) ? fs.statSync(p).size : 0,
           text: fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '') : '' };
}

console.log('===== 隐私政策占位符口径守卫（R99）=====');

// —— P1 扫描面 fail-closed
const docs = SCAN_RELS.map(read);
const missing = SCAN_RELS.filter((r, i) => !docs[i].ok);
const small = SCAN_RELS.filter((r, i) => docs[i].ok && docs[i].size < MIN_BYTES);
check('P1 扫描面三个文件均存在', missing.length === 0, missing.length ? `缺失：${missing.join(' | ')}` : SCAN_RELS.length + ' 个');
check('P1 扫描面文件均非空（> ' + MIN_BYTES + 'B）', small.length === 0,
  small.length ? `过小：${small.join(' | ')}` : '通过');
check('P8 扫描面固定且不含 tools/（本守卫不在扫描面内，无自指污染）',
  SCAN_RELS.length === 3 && SCAN_RELS.every((r) => r.startsWith('specs/')),
  SCAN_RELS.join(' | '));

// —— 实扫：剥反引号后的裸 【…】（正文填空）；反引号内的 【…】 是元描述
function scanDoc(text) {
  const real = [], meta = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const stripped = line.replace(/`[^`]*`/g, '');
    const rs = stripped.match(/【[^】]{1,60}】/g);
    if (rs) real.push({ line: i + 1, items: rs });
    const ticks = line.match(/`[^`]*`/g) || [];
    ticks.forEach((t) => { const ms = t.match(/【[^】]{0,60}】/g); if (ms) meta.push({ line: i + 1, items: ms }); });
  });
  return { real, meta };
}

const policy = docs[0];
const sc = scanDoc(policy.text);
const N = sc.real.reduce((a, r) => a + r.items.length, 0);
const metaN = sc.meta.reduce((a, r) => a + r.items.length, 0);

check('P2 实扫占位符 ≥ 1（扫描面/规则非空）', N >= 1,
  `实扫 ${N} 处：${sc.real.map((r) => `L${r.line}${r.items.join('')}`).join(' ')}`);
check('P3 元描述（反引号内）≥ 1（「剥反引号」规则的前提守卫）', metaN >= 1,
  `命中 ${metaN} 处：${sc.meta.map((r) => `L${r.line}${r.items.join('')}`).join(' ')}`);

// —— P4/P5/P6 口径声明
const marks = [];
docs.forEach((d, idx) => {
  d.text.split(/\r?\n/).forEach((line, i) => {
    MARK_RE.lastIndex = 0;
    let m;
    while ((m = MARK_RE.exec(line))) {
      marks.push({ rel: SCAN_RELS[idx], line: i + 1, n: Number(m[1]), unique: UNIQUE_RE.test(line) });
    }
  });
});
check(`P4 语义标记「占位符全集口径」命中 ≥ ${MARK_MIN}（fail-closed）`, marks.length >= MARK_MIN,
  `命中 ${marks.length} 处：${marks.map((c) => `${c.rel}:${c.line}=${c.n}`).join(' | ')}`);
const bad = marks.filter((c) => c.n !== N);
check(`P5 全部口径声明 ≡ 实扫 ${N} 处`, bad.length === 0,
  bad.length ? `不符：${bad.map((c) => `${c.rel}:${c.line} 写 ${c.n}`).join(' | ')}` : '一致');
const uniq = marks.filter((c) => c.unique);
check('P6 「唯一声明处」恰 1 处且在隐私政策内（口径单源）',
  uniq.length === 1 && uniq[0].rel === POLICY_REL,
  uniq.length ? uniq.map((c) => `${c.rel}:${c.line}`).join(' | ') : '零命中');

// —— P7 排除面前提：review/ 里确有历史计数陈述（证明排除面打对）
let hist = 0;
(function walk(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.md$/i.test(e.name)) {
      let t = '';
      try { t = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
      if (/隐私[^。\n]{0,40}?\*{0,2}(4|7)\*{0,2}\s*处|[0-9]+\s*处[^。\n]{0,10}占位符/.test(t)) hist++;
    }
  }
})(REVIEW_DIR);
check('P7 排除面前提：review/ 下确有历史计数陈述（证明排除面没打错）', hist > 0, `${hist} 个文件`);

console.log(`\n===== 隐私政策占位符口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
