// tools/check_collection_perms.js —— 集合权限矩阵口径守卫（R103）
//
// 为什么需要（同族病第 11 例，2026-09-20 round67 自驱动巡检抓出）：
//   集合权限是**安全边界**口径：AD-9「客户端不直连 DB」，店算全部业务集合默认安全态 =
//   `仅管理端可读写`（微信云开发默认却是「仅创建者可读写」⇒ 客户端可绕过云函数越权读写）。
//   单源 = `cloudfunctions/initDb/collections.js::COLLECTIONS`（25 张），
//   人工面 = `specs/dev-specs/core/15_集合权限矩阵.md` §2 表格（李老师**上线前逐条设权限**照着它做）。
//   实扫：`tools/` 与 `prototype/` grep `集合权限矩阵|core/15` **零命中** ⇒ 该表与单源**零守卫**；
//   `check_schema_sync.js` 的 S1~S5 只守 `collections.js ↔ init_db.js` 镜像与三份文档的索引计数，
//   **不看 core/15 一个字**。
//   后果比前 10 例都硬：加/删一个集合时，R74 会要求同步镜像与文档计数（绿），
//   但 **core/15 静默过期** ⇒ 新集合留在默认「仅创建者可读写」⇒ **客户端可直连越权**（AD-9 一票否决）。
//   与前 10 例同病：**人工陈述面 ≡ 实然，零守卫**；本例的"实然"换成安全边界。
//
// 判据（P1~P9，全部 fail-closed；解析不到即判红，不许静默放行）：
//   P1 扫描面 fail-closed      git ls-files 须 `core.quotepath=false`（CJK 路径八进制转义会让整族文件
//                              被 catch 静默跳过 ⇒ 零覆盖）；路径含 `\NNN` 转义即判红（第 5 例坑⑪）。
//   P2 单源解析                COLLECTIONS 非空、元素唯一、命名合法
//   P3 唯一声明处 ≡ 实算        core/15 的「🔢 集合权限口径（唯一声明处）」恰 1 处，数字 ≡ 单源长度
//   P4 三方计数一致             声明数 ≡ §2 表格实算行数 ≡ 单源长度
//   P5 集合逐条双向             表格集合集合 ≡ 单源（缺 / 多 / 改名都红）
//   P6 权限模式 ∈ 白名单        `仅管理端可读写`；例外须显式登记进 EXEMPT（双向防腐：僵尸条目也红）
//   P7 序号连续                 1..N 无重号、无跳号（表格被手工插行/删行即红）
//   P8 前提守卫                 表格行解析 ≥1、白名单命中 ≥ LEAST、无空字段
//                              （列错位 / 正则失效 ⇒ 零命中假绿，同族第 3 例「扫错层」）
//   P9 单源不扩散               其它 .md 不得再自称「集合权限口径（唯一声明处）」
//   ⚠️ 弱面：specs/**/*.md 里「N 张集合」与单源不符者只打印 ⚠️ **明示不判红**
//      （坑⑭/⑯：裸扫必误杀 ——「dev 只有 7 个集合」是显示截断、「15 集合」是子集）
//
// 运行：node tools/check_collection_perms.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_REL = 'cloudfunctions/initDb/collections.js';
const DOC_REL = 'specs/dev-specs/core/15_集合权限矩阵.md';
const DECL_MARK = '集合权限口径（唯一声明处）';
const SAFE_MODE = '仅管理端可读写';
const LEAST = 20; // 白名单命中下限（防列错位零命中假绿）

// 显式登记的白名单外权限模式（须带 by/date/reason）
const EXEMPT = [
  // 例：{ col: 'subscription_plan', mode: '所有用户可读，仅管理端可写', by: '李老师', date: '2026-09-20', reason: '...' },
];

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  ✅ ${name}${detail ? ` —— ${detail}` : ''}`); }
  else { fails.push(name); console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

// —— P1 扫描面（CJK 安全）
let files = [];
let octal = 0;
try {
  files = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch (_) { files = []; }
octal = files.filter((f) => /\\[0-7]{3}/.test(f)).length;
check('P1-① 扫描面非空且无八进制转义（CJK 路径不得被静默跳过）', files.length > 0 && octal === 0,
  `${files.length} 个文件 / 转义 ${octal}`);

// —— P2 单源解析（fail-closed）
let SRC = [];
let srcOk = false;
try {
  const m = require(path.join(ROOT, SRC_REL));
  const c = m.COLLECTIONS || (m.default && m.default.COLLECTIONS);
  if (Array.isArray(c)) { SRC = c.slice(); srcOk = true; }
} catch (_) { srcOk = false; }
check('P2-① 单源 COLLECTIONS 可解析', srcOk, srcOk ? `${SRC_REL}` : `${SRC_REL} require 失败`);
check('P2-② 单源非空且元素唯一', SRC.length > 0 && new Set(SRC).size === SRC.length,
  `${SRC.length} 张 / 去重 ${new Set(SRC).size}`);
check('P2-③ 单源命名合法（小写下划线）', SRC.every((c) => /^[a-z][a-z0-9_]*$/.test(c)),
  SRC.filter((c) => !/^[a-z][a-z0-9_]*$/.test(c)).join(', ') || '全部合法');

// —— 文档解析
const docAbs = path.join(ROOT, DOC_REL);
let doc = '';
try { doc = fs.readFileSync(docAbs, 'utf8'); } catch (_) { doc = ''; }
check('P1-② 权限矩阵文档可读', doc.length > 0, DOC_REL);
const lines = doc.split(/\r?\n/);

// —— P3 唯一声明处
const declIdx = lines.findIndex((l) => l.includes(DECL_MARK));
const declCount = lines.filter((l) => l.includes(DECL_MARK)).length;
check('P3-① 唯一声明处恰 1 处', declCount === 1 && declIdx >= 0, `命中 ${declCount} 处`);
let declNum = -1;
if (declIdx >= 0) {
  const m = /共[^0-9]{0,6}?\*{0,2}(\d+)\*{0,2}\s*张集合/.exec(lines[declIdx]);
  if (m) declNum = Number(m[1]);
}
check('P3-② 声明可解析出集合数（fail-closed）', declNum >= 0, declNum >= 0 ? `声明 ${declNum}` : '解析失败');
check('P3-③ 声明数 ≡ 单源长度', declNum === SRC.length, `声明 ${declNum} / 单源 ${SRC.length}`);

// —— 表格解析（§2 起，表头之后）
const secStart = lines.findIndex((l) => /^##\s+2\./.test(l));
const tbl = [];
if (secStart >= 0) {
  for (let i = secStart; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^##\s+3\./.test(l)) break;
    const m = /^\|\s*(\d+)\s*\|\s*`([A-Za-z0-9_]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/.exec(l);
    if (m) tbl.push({ line: i + 1, no: Number(m[1]), col: m[2], mode: m[3], note: m[4] });
  }
}
check('P8-① 表格行解析成功（fail-closed）', tbl.length > 0, `${tbl.length} 行`);
check('P8-② 表格字段无空（序号/集合/权限模式）', tbl.length > 0
  && tbl.every((r) => r.no > 0 && r.col && r.mode), tbl.filter((r) => !(r.no > 0 && r.col && r.mode)).map((r) => `L${r.line}`).join(', ') || '无空字段');

// —— P4 三方计数
check('P4 声明数 ≡ 表格行数 ≡ 单源长度（三方）', declNum === tbl.length && tbl.length === SRC.length,
  `声明 ${declNum} / 表格 ${tbl.length} / 单源 ${SRC.length}`);

// —— P5 逐条双向
const docSet = new Set(tbl.map((r) => r.col));
const srcSet = new Set(SRC);
const missing = SRC.filter((c) => !docSet.has(c));   // 单源有、文档没有
const extra = tbl.filter((r) => !srcSet.has(r.col)); // 文档有、单源没有
check('P5-① 单源每张集合都在权限矩阵里登记', missing.length === 0, missing.join(', ') || '无缺失');
check('P5-② 权限矩阵无单源之外的集合', extra.length === 0,
  extra.map((r) => `L${r.line} ${r.col}`).join(', ') || '无多余');
const dupCol = tbl.map((r) => r.col).filter((c, i, a) => a.indexOf(c) !== i);
check('P5-③ 表格内集合无重复行', dupCol.length === 0, [...new Set(dupCol)].join(', ') || '无重复');

// —— P6 权限模式白名单
const exemptCols = new Set(EXEMPT.map((e) => e.col));
const badMode = tbl.filter((r) => r.mode !== SAFE_MODE && !exemptCols.has(r.col));
check('P6 权限模式 ∈ 白名单（默认安全态 `仅管理端可读写`，例外须显式登记）', badMode.length === 0,
  badMode.map((r) => `L${r.line} ${r.col}=${r.mode}`).join(' | ') || `全部 ${SAFE_MODE}`);
const zombie = EXEMPT.filter((e) => !tbl.some((r) => r.col === e.col && r.mode === e.mode));
check('P6-b 豁免双向防腐（无僵尸条目）', zombie.length === 0,
  zombie.map((e) => e.col).join(', ') || (EXEMPT.length ? `${EXEMPT.length} 条豁免均生效` : '无豁免'));

// —— P7 序号连续
const nos = tbl.map((r) => r.no);
const seqOk = nos.length > 0 && nos.every((n, i) => n === i + 1);
check('P7 序号连续 1..N 且无重号', seqOk, seqOk ? `1..${nos.length}` : `实际 ${nos.join(',')}`);

// —— P8 前提守卫
const safeHits = tbl.filter((r) => r.mode === SAFE_MODE).length;
check(`P8-③ 白名单命中 ≥ ${LEAST}（列错位即零命中假绿）`, safeHits >= LEAST, `${safeHits} 行`);

// —— P9 单源不扩散
const others = files.filter((f) => /\.md$/.test(f) && f.startsWith('specs/'))
  .filter((f) => f.replace(/\\/g, '/') !== DOC_REL)
  .filter((f) => {
    try { return fs.readFileSync(path.join(ROOT, f), 'utf8').includes(DECL_MARK); } catch (_) { return false; }
  });
check('P9 唯一声明处不扩散（其它 .md 不得再自称本口径单源）', others.length === 0,
  others.join(' | ') || `仅 ${DOC_REL} 一处`);

// —— 弱面：只明示，不判红（坑⑭/⑯）
const weak = [];
let weakScan = 0;
files.filter((f) => /\.md$/.test(f) && f.startsWith('specs/') && !/OBSOLETE_/.test(f))
  .filter((f) => f.replace(/\\/g, '/') !== DOC_REL)
  .forEach((f) => {
    let txt = '';
    try { txt = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { return; }
    txt.split(/\r?\n/).forEach((l, i) => {
      const m = /(\d{1,3})\s*\*{0,2}\s*张集合/.exec(l);
      if (!m) return;
      weakScan += 1;
      const v = Number(m[1]);
      if (v !== SRC.length) weak.push(`${f}:${i + 1} 写 ${v}（单源 ${SRC.length}） —— ${l.trim().slice(0, 90)}`);
    });
  });
check('P8-④ 弱面扫描面有效（确有「N 张集合」陈述被扫到）', weakScan >= 3, `${weakScan} 处`);
if (weak.length) {
  console.log(`  ⚠️ 弱面（与单源不符，只明示不判红，可能是历史/子集/截断）${weak.length} 处：`);
  weak.slice(0, 10).forEach((w) => console.log(`     ${w}`));
}

console.log(`\n===== 集合权限矩阵口径守卫结果：${pass} 通过 / ${fails.length} 失败 =====`);
process.exit(fails.length === 0 ? 0 : 1);
