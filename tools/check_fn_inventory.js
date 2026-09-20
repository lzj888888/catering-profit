// tools/check_fn_inventory.js —— 【R98】云函数清单守卫（契约文档 ≡ 实际部署目录，双向）
// 运行：node tools/check_fn_inventory.js
//
// 为什么需要它（与 R59「套件数」/ R74「索引计数」/ round61「重启键套件数」**同族第 6 例**）：
//   `specs/dev-specs/core/10_云函数清单与接口契约.md` 头部自称「**单一文档列出全部云函数** →
//   入参/出参/归属批次/鉴权，防止前端与后端各自生成导致命名/字段错位」，而 2026-09-20 实测：
//     ① **8 个已部署函数在该文档零出现**（archiveMonth / checkQuota / deleteAccount /
//        getCardVersions / getShopContext / getShopList / saveShopSetting / smokeTest）；
//     ② 该文档表格里另有 4 个名字**从未落地为目录**（getPlan / savePlan / shopList / shopSwitch）。
//   后果不是文档瑕疵：这份文档是**写码 AI 的输入基线**，漏 8 个 ⇒ 后续生成会重复造轮子/命名撞车；
//   多 4 个 ⇒ 会照着不存在的名字生成调用代码。而两级门禁全绿（A–L 的 K 组只守投喂链派生件，
//   check_schema_sync 只守**集合/索引**计数，谁都不看「函数清单 ↔ 代码目录」这一层）。
//
// 判据（双向，缺一不可 —— 只查「代码里有文档没有」会放过「文档承诺了却没实现」）：
//   F1 扫描面非空（fail-closed）：函数目录数 ≥ MIN_FN；两个非函数目录确实存在；契约文档存在且够长。
//   F2 代码 → 文档：每个实际函数目录名，必须在契约文档里**至少出现一次**。
//   F3 文档 → 代码：契约文档表格首列登记的名字，必须是 ①实际函数 或 ②`cloudfunctions/common/` 公共模块
//      （**从目录实测派生**，不手写白名单 —— 手写白名单会腐，与 round56 的⑦同族）或 ③该行带「未实现」标记。
//   F4 全集计数（**只校验契约文档里那一行显式声明**）≡ 实测函数数；命中 0 ⇒ 判红（fail-closed）。
//   F5 selftest 覆盖面声明（`N 个云函数…selftest`）≡ 有 selftest.js 的函数数；命中 0 ⇒ 判红。
//
// 🔴 **F4/F5 为什么只判"显式声明"、不扫全仓「N 个函数」**：首版判据是裸扫 `(\d+)个(业务)?(云)?函数`，
//    实测**误杀 5 处**（与 round58 E1「裸扫关键词必误报」同族）：
//      · core/13:49 / 重启键:506「线上 dev **实际只部署了 2 个函数**」= 2026-09-18 的**历史快照**；
//      · core/13:52 / 重启键:482「44 个函数」= **目录数**（42 函数 + `_adminCore` + `common`）；
//      · 重启键:558「batch4 补 6 个函数自测」= **批次子集**。
//    三者都是**合法口径**，机器无法从字面区分 ⇒ 正确做法是**把全集口径做成单源声明**（契约文档头部那一行）
//    再只校验它，而不是放宽正则去猜。明写边界：**本守卫不保证其它文档里的「N 个函数」正确**。
//
// ⚠️ 本守卫**不扫自己**：扫描面固定为「一个契约文档 + cloudfunctions/ 目录」，自指污染不可能发生。
//    但若将来要扩面到全仓 md，必须照 round61⑫ 加「自身排除 + 前提守卫」。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const COMMON_DIR = path.join(CF, 'common');
const DOC_REL = 'specs/dev-specs/core/10_云函数清单与接口契约.md';
const DOC = path.join(ROOT, DOC_REL);
const SPECS = path.join(ROOT, 'specs');

// 非函数目录（云端不认子目录，common 是共享模块；_adminCore 是 admin 复用内核）
const NON_FN = ['_adminCore', 'common'];
const MIN_FN = 40;

// 全集口径声明：锚「**全集口径**」这个**语义标记** + 其后的数字，不锚具体措辞。
// ⚠️ 两次踩坑才定下来（都记在此，别再改回宽松版）：
//   ① 首版锚「本表共登记」字面 ⇒ 正确实现换个说法就判红（round59 同族病：绑字面 ⇒ 误报）；
//   ② 二版放宽成裸扫「N 个已部署(云)函数」⇒ 立刻吃到我自己写的**子集句**「8 个已部署函数零出现」
//      （core/10:163、重启键:558）⇒ 假红。
//   ⇒ 正确形态 = **把口径编码进文本**（与 check_stale_claims 同一手法）：全集声明那一行带「全集口径」标记，
//     子集/历史句天然没有该标记 ⇒ 既不会误杀，删掉声明又会 fail-closed 转红。
const TOTAL_RE = /全集口径[^。\n]{0,80}?\*{0,2}(\d+)\*{0,2}\s*个已部署(?:云)?函数/g;
// selftest 覆盖面声明：「N 个云函数…selftest.js」（24 字窗口内，天然阻断跨句匹配）
const SELFTEST_RE = /\*{0,2}(\d+)\*{0,2}\s*个云函数[^。\n]{0,24}selftest/g;

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
}

console.log('===== F · 云函数清单守卫（契约文档 ≡ 实际目录）=====');

// ---------------- F1 扫描面（fail-closed）----------------
if (!fs.existsSync(DOC)) { console.log(`❌ F1 缺少契约文档：${DOC_REL}`); process.exit(1); }
const docRaw = fs.readFileSync(DOC, 'utf8').replace(/^\uFEFF/, '');
const docLines = docRaw.split(/\r?\n/);

const actual = fs.readdirSync(CF, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !NON_FN.includes(d.name))
  .map((d) => d.name).sort();

check('F1 函数目录数 ≥ ' + MIN_FN, actual.length >= MIN_FN, `实测 ${actual.length} 个`);
for (const n of NON_FN) {
  check(`F1 非函数目录「${n}」确实存在（排除面没写错）`, fs.existsSync(path.join(CF, n)), '存在');
}
check('F1 契约文档行数 ≥ 100', docLines.length >= 100, `${docLines.length} 行`);

// common 公共模块（实测派生，不手写）
const commonMods = fs.existsSync(COMMON_DIR)
  ? fs.readdirSync(COMMON_DIR).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''))
  : [];
check('F1 common 模块清单非空（F3 派生白名单未空跑）', commonMods.length > 0, `${commonMods.length} 个`);

// 契约文档里的**表格登记行**（`| \`name\` | ...`）—— 这是"登记"的正确层
// 🔴 别退化成 `docRaw.includes(name)`：本轮变异 M1 实锤那样会**漏** ——
//    删掉 `getShopList` 的正式登记行后，§9 备注里那句「8 个已部署函数零出现（… getShopList …）」
//    仍含该名字 ⇒ 判绿（与 round56「判据扫错了层」同族：扫"任何提及" ≠ 扫"契约登记"）。
const docNames = new Set();
const rowOf = new Map();
for (let i = 0; i < docLines.length; i++) {
  const m = /^\|\s*`([A-Za-z][A-Za-z0-9_]*)`/.exec(docLines[i]);
  if (m) { docNames.add(m[1]); if (!rowOf.has(m[1])) rowOf.set(m[1], i + 1); }
}

// ---------------- F2 代码 → 文档 ----------------
console.log('\n----- F2 实际函数必须在契约文档登记 -----');
const missingInDoc = actual.filter((n) => !docNames.has(n));
check('F2 每个已部署函数都有契约表格登记行', missingInDoc.length === 0,
  missingInDoc.length ? `无登记行：${missingInDoc.join(' / ')}` : `${actual.length} 个全覆盖`);

// ---------------- F3 文档 → 代码 ----------------
console.log('\n----- F3 契约登记的名字必须落地（或显式标未实现）-----');
const actualSet = new Set(actual);
const commonSet = new Set(commonMods);
const notLanded = [];
for (const n of [...docNames].sort()) {
  if (actualSet.has(n) || commonSet.has(n)) continue;
  const ln = rowOf.get(n);
  if (docLines[ln - 1].includes('未实现')) continue;
  notLanded.push(`${n}(第${ln}行)`);
}
check('F3 契约登记名 = 已落地 / common 模块 / 带「未实现」标记', notLanded.length === 0,
  notLanded.length ? `未落地且未标注：${notLanded.join(' / ')}` : `登记 ${docNames.size} 个，全部有交代`);
// 反向防腐：标了「未实现」的名字如果其实已落地 ⇒ 标记过期（曾经的空头承诺兑现了却没人摘）
const staleMark = [...docNames].filter((n) => {
  const ln = rowOf.get(n);
  return docLines[ln - 1].includes('未实现') && (actualSet.has(n) || commonSet.has(n));
});
check('F3 反向：「未实现」标记未过期（标记了却已落地 ⇒ 判红）', staleMark.length === 0,
  staleMark.length ? `已落地仍标未实现：${staleMark.join(' / ')}` : '无过期标记');

// ---------------- F4 / F5 计数声明 ----------------
console.log('\n----- F4 「N 个函数」计数声明 ≡ 实测 -----');
const withSelftest = actual.filter((n) => fs.existsSync(path.join(CF, n, 'selftest.js'))).length;
console.log(`  实测：函数 ${actual.length} 个 / 带 selftest.js 的 ${withSelftest} 个`);

// 扫描面：specs/ 下全部 .md（排除 review/ 历史流水；CJK 路径用 dirent 遍历，不经 git ls-files ⇒ 无八进制转义坑⑪）
const mdFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'review' && e.name !== '.git') walk(p); continue; }
    if (e.name.endsWith('.md')) mdFiles.push(p);
  }
})(SPECS);

function collect(re) {
  const out = [];
  for (const p of mdFiles) {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, i) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) out.push({ file: rel, line: i + 1, n: Number(m[1]) });
    });
  }
  return out;
}

const totalClaims = collect(TOTAL_RE);
check('F4 全集口径声明存在（fail-closed：删了/改了措辞 ⇒ 红）', totalClaims.length > 0,
  `命中 ${totalClaims.length} 处`);
const badTotal = totalClaims.filter((c) => c.n !== actual.length);
check(`F4 全集声明「共登记 N 个已部署」≡ 实测 ${actual.length}`, badTotal.length === 0,
  badTotal.length ? `不符：${badTotal.map((c) => `${c.file}:${c.line} 写 ${c.n}`).join(' | ')}` : '一致');

const stClaims = collect(SELFTEST_RE);
check('F5 selftest 覆盖面声明存在（fail-closed）', stClaims.length > 0, `命中 ${stClaims.length} 处`);
const badSt = stClaims.filter((c) => c.n !== withSelftest);
check(`F5 selftest 覆盖面声明 ≡ 实测 ${withSelftest} 个`, badSt.length === 0,
  badSt.length ? `不符：${badSt.map((c) => `${c.file}:${c.line} 写 ${c.n}`).join(' | ')}` : '一致');

console.log(`\n===== 云函数清单守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
