// tools/check_quota_limits.js —— 商业化额度口径守卫（R102）
//
// 【为什么需要】（round66 立项 / round120 改造）
//   免费/硬上限额度是**收钱口径**。round66 时单源 = `checkQuota/service.js` 里的
//   `FREE_LIMIT` / `HARD_LIMIT` 常量；但 M3.7 基线明写「上限数值禁硬编码，必须读配置集合」
//   —— 即"常量单源"本身就是违规（同族病第 10 例的**根因**，不是解）。
//   round120（M3 v1.1 批次 A1）把额度**真正迁到配置集合**：
//     唯一真相源 = `cloudfunctions/initDb/collections.js` 的 `SEED_FEATURES` 中
//     `plan_id='plan_free'` 行的 `limits: { shop, cost_card, hard_shop, hard_card }`。
//   ⇒ 本守卫的单源随之迁移，并**新增反向断言**：Service 层一旦再现额度字面量即判红
//     （防"改回硬编码"复发 —— 这正是 round119 发现的"改对反而转红"病灶反解）。
//
//   同时同一事实被抄进多份 .md（`core/04_核对清单` / `core/01_架构总览` / `core/03_写码提示词` /
//   `delivery/inscode喂投包_8批` / `★知识存储点` / `商业化方案_v1.4`）；round66 实扫发现
//   `core/04:70` 写「M3 成本卡免费上限 **8**」而同文件 :55/:64/:117 三处写 3
//   ⇒ **同一份上线前核对清单自相矛盾**。那一族判据（L4~L9）保留不变。
//
// 判据（全部 fail-closed；解析不到即判红，不许静默放行、不许 crash）：
//   L1 扫描面 fail-closed      git ls-files 须 `core.quotepath=false`；含 `\NNN` 转义即判红。
//                             L1-② 工作树补面逐根达下界（坑⑱：git ls-files 只扫 index）。
//                             L1-③ 回环：index 内 specs/*.md 均能由工作树扫描复现。
//   L2 单源解析（配置种子）    plan_free.limits 四个数必须都解析出来（fail-closed，解析失败也**不崩**）
//   L2r 反向断言（round120 新）`checkQuota/service.js` 剥注释后**不得**再出现额度字面量：
//                             `const FREE_LIMIT =` / `const HARD_LIMIT =` / `cost_card: <数字>` /
//                             `hard_card: <数字>` ⇒ 再现即判红（防硬编码复发）
//   L3 单源不变量              free < hard（同 scope）；四个数为正整数
//   L4 唯一声明处 ≡ 实算        `商业化方案_v1.4_融合版.md` 的「🔢 商业化额度口径（唯一声明处）」恰 1 处，四个数 ≡ 单源
//   L5 当前态陈述 ≡ 实算        specs/**/*.md 里「类别锚点 + 就近 ≤40 字符 + 额度语义 + 数字」的强面陈述 ≡ 单源
//                              （裸扫「N 张」必误杀：OBSOLETE 历史版、演进链「v1.3 改 8→3」都是合法旧值 —— 坑⑭）
//   L6 硬上限面                 `硬上限` ≤12/40 字符内数字 ∈ {200, 2000}
//   L7 排除面前提              确有历史/演进类陈述被放行（HIST 命中 ≥1），证明排除面没打错
//   L8 命中数 fail-closed      强面命中 < LEAST 即判红（正则/扫描面失效 ⇒ 零命中假绿）
//   L9 单源不扩散               其它 .md 不得再自称「唯一声明处」
//   L10 配置唯一性（round120 新）`plan_free` 在种子清单里**恰 1 处**（两行 plan_free ⇒ 读哪行不确定）
//   L11 弱面补口（round121 新）声明处文件内的「M3 张数」陈述必须 ≡ 单源。
//                              根因：L5 的就近窗 ≤8 字符，而表格行锚点到数字间距 >8 ⇒ 落弱面 ⇒
//                              改配置不转红会漏改（round118 实扫：L44/L148/L199/L218 四处旧值 3 张全在弱面）。
//                              豁免硬上限行 / 声明行本身 / HIST 历史行；另配命中数下界防"补口失效"。
//
// 运行：node tools/check_quota_limits.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// 🔴 round120：单源由「Service 常量」迁到「配置集合种子」（M3 v1.1 批次 A1）
const SRC_REL = 'cloudfunctions/initDb/collections.js';
const SVC_REL = 'cloudfunctions/checkQuota/service.js';   // 反向断言对象（不得再含额度字面量）
const DECL_REL = 'specs/dev-specs/商业化方案_v1.4_融合版.md';
const DECL_MARK = '商业化额度口径（唯一声明处）';
const LEAST = 4; // 强面陈述命中下限

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  ✅ ${name}${detail ? ` —— ${detail}` : ''}`); }
  else { fails.push(name); console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

// —— L1 扫描面（CJK 安全）
let files = [];
let octal = 0;
try {
  files = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch (_) { files = []; }
octal = files.filter((f) => /\\[0-7]{3}/.test(f)).length;
check('L1-① 扫描面非空且无八进制转义（CJK 路径不得被静默跳过）', files.length > 0 && octal === 0,
  `${files.length} 个文件 / 转义 ${octal}`);

// 🔴 坑⑱：`git ls-files` **只扫 index** ⇒ 尚未 git add 的新 specs/*.md 不在扫描面。
const WT_DIRS = [{ key: 'specs', dir: 'specs' }];
const WT_FLOOR = { specs: 20 };              // 实测 30 ⇒ 取保守下界（坑㉚：下界键固定）
const WT_EXT = /\.md$/;
function worktreeFace(idxFiles) {
  const seen = new Set(idxFiles.map((f) => f.replace(/\\/g, '/')));
  const add = [];
  const all = [];
  const counts = {};
  const walk = (rel, key) => {
    let ents = [];
    try { ents = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const r = rel + '/' + e.name;
      if (e.isDirectory()) { walk(r, key); continue; }
      if (!e.isFile() || !WT_EXT.test(e.name)) continue;
      counts[key] = (counts[key] || 0) + 1;
      all.push(r);
      if (!seen.has(r)) add.push(r);
    }
  };
  for (const d of WT_DIRS) { counts[d.key] = 0; walk(d.dir, d.key); }
  return { add: add, all: all, counts: counts };
}
const idxFiles = files.slice();
const wt = worktreeFace(idxFiles);
files = files.concat(wt.add);
const wtUnder = WT_DIRS.filter((d) => (wt.counts[d.key] || 0) < WT_FLOOR[d.key])
  .map((d) => `${d.key}(${wt.counts[d.key] || 0}<${WT_FLOOR[d.key]})`);
check('L1-② 工作树补面逐根达下界（补面被扫空即转红）',
  WT_DIRS.every((d) => d.key in WT_FLOOR) && wtUnder.length === 0,
  WT_DIRS.map((d) => `${d.key}=${wt.counts[d.key] || 0}`).join(' / ') +
  (wtUnder.length ? ` 未达下界: ${wtUnder.join(',')}` : ` ＋未入库 ${wt.add.length} 个`));
const wtAll = new Set(wt.all);
const idxSpecs = idxFiles.filter((f) => /\.md$/.test(f) && f.startsWith('specs/')).map((f) => f.replace(/\\/g, '/'));
const loopMiss = idxSpecs.filter((f) => !wtAll.has(f));
check('L1-③ 回环：index 内 specs/*.md 均能由工作树扫描复现（根路径写错即转红）', loopMiss.length === 0,
  loopMiss.length ? `工作树扫不到 ${loopMiss.length} 个：${loopMiss.slice(0, 3).join(', ')}` : `index ${idxSpecs.length} 个全部复现`);

const mdFiles = files.filter((f) => /\.md$/.test(f) && f.startsWith('specs/'))
  .map((f) => path.join(ROOT, f));

// —— L2 单源解析（配置种子；解析失败 → 记 null，**不抛异常**）
const srcRaw = fs.existsSync(path.join(ROOT, SRC_REL)) ? fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8') : '';
function parseLimits(text) {
  // 锚 `plan_id: 'plan_free'`（或双引号）→ 其后 ≤400 字符内出现 limits: { … }
  const m = text.match(/plan_id:\s*['"]plan_free['"][\s\S]{0,400}?limits:\s*\{([^}]*)\}/);
  if (!m) return null;
  const pick = (k) => (m[1].match(new RegExp(`(?:^|[^A-Za-z0-9_])${k}\\s*:\\s*(\\d+)`)) || [])[1];
  const shop = pick('shop');
  const cost = pick('cost_card');
  const hs = pick('hard_shop');
  const hc = pick('hard_card');
  if (!shop || !cost || !hs || !hc) return null;
  return { shop: Number(shop), cost_card: Number(cost), hard_shop: Number(hs), hard_card: Number(hc) };
}
const LIM = parseLimits(srcRaw);
check('L2-① 单源 plan_free.limits 可解析（fail-closed，配置种子）', !!LIM,
  LIM ? `shop=${LIM.shop} / cost_card=${LIM.cost_card} / hard_shop=${LIM.hard_shop} / hard_card=${LIM.hard_card}`
      : `解析失败（${SRC_REL} 内未见 plan_id:'plan_free' + limits）`);

// —— L2r 反向断言：Service 不得再出现额度字面量（防硬编码复发）
function stripComment(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const svcRaw = fs.existsSync(path.join(ROOT, SVC_REL)) ? fs.readFileSync(path.join(ROOT, SVC_REL), 'utf8') : '';
const svcCode = stripComment(svcRaw);
const LIT_PATTERNS = [
  { re: /const\s+FREE_LIMIT\s*=/, tag: '`const FREE_LIMIT =` 常量' },
  { re: /const\s+HARD_LIMIT\s*=/, tag: '`const HARD_LIMIT =` 常量' },
  { re: /(?:^|[^A-Za-z0-9_$])cost_card\s*:\s*\d/, tag: '`cost_card: <数字>` 字面量' },
  { re: /(?:^|[^A-Za-z0-9_$])hard_card\s*:\s*\d/, tag: '`hard_card: <数字>` 字面量' },
];
const litHits = LIT_PATTERNS.filter((p) => p.re.test(svcCode)).map((p) => p.tag);
check('L2r 反向断言：checkQuota/service.js 剥注释后零额度字面量（防硬编码复发）', litHits.length === 0,
  litHits.length ? `命中 ${litHits.join(' / ')}` : '零命中（额度只由 limits 入参注入）');
// 前提守卫：反向断言的对象文件必须存在且非空（否则"零命中"是因为文件读空 —— 假绿）
check('L2r-② 前提：反向断言对象存在且非空（防读空导致零命中假绿）', svcCode.length > 200,
  `${svcCode.length} 字符`);

// —— L3 单源不变量
if (LIM) {
  check('L3-① 免费额 < 硬上限（同 scope）', LIM.shop < LIM.hard_shop && LIM.cost_card < LIM.hard_card,
    `M1 ${LIM.shop}<${LIM.hard_shop} / M3 ${LIM.cost_card}<${LIM.hard_card}`);
  check('L3-② 四个额度均为正整数', [LIM.shop, LIM.cost_card, LIM.hard_shop, LIM.hard_card]
    .every((n) => Number.isInteger(n) && n > 0), 'OK');
} else {
  check('L3-① 免费额 < 硬上限（同 scope）', false, '单源解析失败');
  check('L3-② 四个额度均为正整数', false, '单源解析失败');
}

// —— L10 配置唯一性：plan_free 恰 1 处
const planFreeN = (srcRaw.match(/plan_id:\s*['"]plan_free['"]/g) || []).length;
check('L10 plan_free 在种子清单中恰 1 处（两行则"读哪行"不确定）', planFreeN === 1, `${planFreeN} 处`);

// —— L4 唯一声明处
const declAbs = path.join(ROOT, DECL_REL);
const declRaw = fs.existsSync(declAbs) ? fs.readFileSync(declAbs, 'utf8') : '';
const declLines = declRaw.split(/\r?\n/).filter((l) => l.includes(DECL_MARK));
check('L4-① 语义标记「商业化额度口径（唯一声明处）」恰 1 处', declLines.length === 1, `${declLines.length} 处`);
if (declLines.length === 1 && LIM) {
  const seg = declLines[0];
  const want = [`**${LIM.shop}**`, `**${LIM.cost_card}**`, `**${LIM.hard_shop}**`, `**${LIM.hard_card}**`];
  const miss = want.filter((w) => !seg.includes(w));
  check('L4-② 声明处四个数 ≡ 单源实算', miss.length === 0,
    miss.length ? `缺 ${miss.join(' / ')}` : `M1 ${LIM.shop} / M3 ${LIM.cost_card} / 硬上限 ${LIM.hard_shop}·${LIM.hard_card}`);
} else {
  check('L4-② 声明处四个数 ≡ 单源实算', false, '声明处缺失或单源解析失败');
}

// —— L5/L6 当前态陈述 ≡ 实算
const HIST = /(OBSOLETE|已作废|已过时|演进|改回|原为|调整为|此前|历史快照|v1\.1|v1\.3|8→3|→3|曾|回退|3\s*→\s*5|5\s*←\s*3)/;
const EXCL_DIR = /^specs\/dev-specs\/review\//;
const EXCL_FILE = /(^|\/)OBSOLETE_/;
const HARDLINE = /(硬上限|防护上限|隐藏[^。；\n]{0,10}上限)/;
const ORDINAL = /第\s*\d+\s*(?:张|个|套|家|月)/g;

const P_M1_FREE = /(?:M1|账套|店铺数)[^。；\n]{0,40}?(?:免费上限|配额|限额|免费|额度|上限)[^。；\n]{0,6}?\*{0,2}(?<![\w.])(\d+)/g;
const P_M1_UNIT = /(?:M1|账套)[^。；\n]{0,40}?(?:账套|店铺|免费|配额|额度)[^。；\n]{0,8}?\*{0,2}(?<![\w])(\d+)\*{0,2}\s*(?:个|套|账套)(?!月)/g;
const P_M3_FREE = /(?:M3|成本卡)[^。；\n]{0,40}?(?:免费上限|配额|限额|免费|额度|上限)[^。；\n]{0,6}?\*{0,2}(?<![\w.])(\d+)/g;
const P_M3_UNIT = /(?:M3|成本卡)[^。；\n]{0,40}?(?:成本卡|免费|配额|额度)[^。；\n]{0,8}?\*{0,2}(?<![\w])(\d+)\*{0,2}\s*张(?!纸)/g;
const P_HARD_M1 = /硬上限[^。；\n]{0,24}?M1[^。；\n]{0,10}?\*{0,2}(?<![\w.])(\d{2,4})(?![\d.])/g;
const P_HARD_M3 = /硬上限[^。；\n]{0,40}?M3[^。；\n]{0,10}?\*{0,2}(?<![\w.])(\d{2,4})(?![\d.])/g;

const claims = [];
const hardClaims = [];
const weak = [];
let skippedHist = 0;

let exclFileN = 0;
for (const abs of mdFiles) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (EXCL_DIR.test(rel)) continue;
  if (EXCL_FILE.test(rel)) { exclFileN += 1; continue; }
  let txt = '';
  try { txt = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
  txt.split(/\r?\n/).forEach((line, i) => {
    if (!/\d/.test(line)) return;
    const isDecl = line.includes(DECL_MARK);
    if (HIST.test(line)) { skippedHist += 1; return; }
    const grab = (re, kind) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const v = Number(m[1]);
        if (kind === 'hard') hardClaims.push({ f: rel, line: i + 1, v, txt: line.trim().slice(0, 90) });
        else claims.push({ f: rel, line: i + 1, v, kind, txt: line.trim().slice(0, 90) });
      }
    };
    if (HARDLINE.test(line)) { grab(P_HARD_M1, 'hard'); grab(P_HARD_M3, 'hard'); }
    if (HARDLINE.test(line)) return;
    if (isDecl) return;
    const free = line.replace(ORDINAL, '第▓');
    const grabF = (re, kind) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(free)) !== null) {
        claims.push({ f: rel, line: i + 1, v: Number(m[1]), kind, txt: line.trim().slice(0, 90) });
      }
    };
    grabF(P_M1_FREE, 'm1'); grabF(P_M1_UNIT, 'm1');
    grabF(P_M3_FREE, 'm3'); grabF(P_M3_UNIT, 'm3');
    if (/(免费|上限|限额|配额)[^。；\n]{0,6}\*{0,2}\d/.test(line.replace(/\bM\s*\d+(?:\.\d+)*/g, 'M').replace(/\bv?\d+\.\d+(?:\.\d+)*/g, 'V'))
      && !claims.some((c) => c.f === rel && c.line === i + 1)) {
      // ⚠️ 弱面只提示不判红，但**取值必须避开模块名与版本号** —— 裸取「行内首个数字」会把
      //    `M3` 的 3、`v1.6` 的 1 当成额度旧值（round121 实扫：29 处里绝大多数是这类噪声，
      //    噪声淹没真命中 ⇒ 弱面形同虚设）。此处先把 `M\d(.\d)*` 与 `v?\d+.\d+` 替换掉再取数。
      const mm = line.replace(/\bM\s*\d+(?:\.\d+)*/g, 'M').replace(/\bv?\d+\.\d+(?:\.\d+)*/g, 'V')
        .match(/\*{0,2}(\d+)\*{0,2}/);
      if (mm) weak.push({ f: rel, line: i + 1, v: mm[1], txt: line.trim().slice(0, 90) });
    }
  });
}
check('L1-② 文件级排除面前提：确有 OBSOLETE 历史版被排除（证明排除没打错）', exclFileN >= 1, `${exclFileN} 个文件`);

const expectOf = (k) => (!LIM ? null : (k === 'm1' ? LIM.shop : LIM.cost_card));
const badClaims = LIM ? claims.filter((c) => c.v !== expectOf(c.kind)) : claims;
check('L5 当前态免费额陈述全部 ≡ 单源实算（M1/M3 强面）', LIM && badClaims.length === 0,
  !LIM ? '单源解析失败'
    : badClaims.length
      ? badClaims.map((c) => `${c.f}:${c.line} ${c.kind} 写 ${c.v} ≠ ${expectOf(c.kind)}`).join(' | ')
      : `${claims.length} 处一致（M1=${LIM.shop} / M3=${LIM.cost_card}）`);

const badHard = LIM ? hardClaims.filter((c) => c.v !== LIM.hard_shop && c.v !== LIM.hard_card) : hardClaims;
check('L6 硬上限陈述 ∈ {200, 2000}（≡ 单源）', LIM && badHard.length === 0,
  badHard.length ? badHard.map((c) => `${c.f}:${c.line} 写 ${c.v}`).join(' | ')
    : `${hardClaims.length} 处一致（${LIM ? `${LIM.hard_shop}/${LIM.hard_card}` : '?'}）`);

check('L7 排除面前提：确有历史/演进类陈述被放行（证明排除面没打错）', skippedHist >= 1, `${skippedHist} 行`);
check(`L8 强面命中数 ≥ ${LEAST}（正则/扫描面失效即零命中假绿）`, claims.length >= LEAST, `${claims.length} 处`);

const otherUnique = mdFiles.filter((abs) => {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (rel === DECL_REL) return false;
  let t = '';
  try { t = fs.readFileSync(abs, 'utf8'); } catch (_) { return false; }
  return t.includes(DECL_MARK);
});
check('L9 唯一声明处不扩散（其它 .md 不得再自称本口径单源）', otherUnique.length === 0,
  otherUnique.length ? otherUnique.map((abs) => path.relative(ROOT, abs).replace(/\\/g, '/')).join(' | ')
    : `仅 ${DECL_REL} 一处`);

// —— L11 声明处文件内「免费档 M3 张数」陈述 ≡ 单源（round121 补弱面缺口）
// 背景（round118 实扫登记、与 round66 栽的 core/04:70 同族）：
//   L5 的强面判据要求「类别锚点 + 就近 ≤40 字符 + 锚点到数字 ≤8 字符」，而声明处里的表格行
//   `| **M3 菜品成本卡** | ⚠️ 限 **5 张**（…）|` 锚点与数字间距 >8 字符 ⇒ 落进**弱面**
//   （只明示、不判红）⇒ **改了配置这里不转红 ⇒ 会漏改**（2026-09-24 实测：L44/L148/L199/L218 四处旧值 3 张全在弱面）。
//   声明处是**人审维护的单一文件**，对它单独放宽「就近窗口」风险可控 ⇒ 单列一条。
//   豁免：硬上限行（`2000 张`）、声明行本身（由 L4 精确守）、历史/演进行（HIST）。
const DECL_M3_RE = /(?:M3|成本卡)[^。；\n]{0,40}?\*{0,2}(\d+)\*{0,2}\s*张(?!纸)/g;
const declScan = [];
const declBad = [];
declRaw.split(/\r?\n/).forEach((line, i) => {
  if (HARDLINE.test(line)) return;                 // 硬上限行（2000 张）
  if (line.includes(DECL_MARK)) return;            // 声明行本身由 L4 守
  if (HIST.test(line)) return;                     // 历史/演进行豁免
  const free = line.replace(ORDINAL, '第▓');
  DECL_M3_RE.lastIndex = 0;
  let m;
  while ((m = DECL_M3_RE.exec(free)) !== null) {
    const v = Number(m[1]);
    declScan.push({ line: i + 1, v });
    if (!LIM || v !== LIM.cost_card) declBad.push({ line: i + 1, v, txt: line.trim().slice(0, 100) });
  }
});
check(`L11-① 弱面补口·命中数 ≥ 3（正则/文件改动导致零命中即判红，防"补口本身失效"）`,
  declScan.length >= 3, `${declScan.length} 处（声明处文件内）`);
check('L11-② 声明处文件内「免费档 M3 张数」陈述全部 ≡ 单源实算（round118 登记的弱面缺口）',
  !!LIM && declBad.length === 0,
  !LIM ? '单源解析失败'
    : declBad.length
      ? `旧值 ${declBad.map((c) => `L${c.line} 写 ${c.v} ≠ ${LIM.cost_card}`).join(' | ')}`
      : `${declScan.length} 处全部 ≡ ${LIM.cost_card}`);

if (weak.length) {
  console.log(`  ⚠️ 弱面（无类别锚点，` + '`N 张/个/套`' + ` 只明示不判红，避免误杀无关计数）${weak.length} 处：`);
  weak.slice(0, 8).forEach((c) => console.log(`     ${c.f}:${c.line} 写 ${c.v} —— ${c.txt}`));
}

console.log(`\n===== 商业化额度口径守卫结果：${pass} 通过 / ${fails.length} 失败 =====`);
process.exit(fails.length === 0 ? 0 : 1);
