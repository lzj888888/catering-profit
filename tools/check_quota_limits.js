// tools/check_quota_limits.js —— 商业化额度口径守卫（R102）
//
// 为什么需要（同族病第 10 例，2026-09-20 round66 自驱动巡检抓出）：
//   免费/硬上限额度是**收钱口径**，单源 = `cloudfunctions/checkQuota/service.js` 的
//   `FREE_LIMIT { shop, cost_card }` 与 `HARD_LIMIT { shop, cost_card }`。
//   但同一事实被抄进多份 .md：`core/04_核对清单` / `core/01_架构总览` / `core/03_写码提示词` /
//   `delivery/inscode喂投包_8批` / `★知识存储点` / `商业化方案_v1.4`。
//   实扫发现 `core/04_核对清单.md:70` 写「M3 成本卡免费上限 **8**」，而**同文件** :55 / :64 / :117 三处
//   都写 3 张、代码单源也是 3 ⇒ **同一份上线前核对清单自相矛盾**。
//   后果不是排版问题：04 是李老师**上线前逐条勾的验收清单**，照 :70 勾会按「8 张」验收，
//   而代码第 4 张就弹付费墙 ⇒ 验收判据与实现不一致，且此前 A–L 与 verify_all 全绿（无一组织额度计数）。
//   8 是 v1.1 旧值（v1.3 用户改 8→3），与红线 12/11、隐私 6/7、套件数、云函数清单同一病：
//   **人工陈述面 ≡ 实然，零守卫**。
//
// 判据（L1~L9，全部 fail-closed；解析不到即判红，不许静默放行）：
//   L1 扫描面 fail-closed      git ls-files 须 `core.quotepath=false`（CJK 路径八进制转义会让整族文件
//                              被 catch 静默跳过 ⇒ 零覆盖）；路径含 `\NNN` 转义即判红（同族第 5 例坑⑪）。
//   L2 单源解析                FREE_LIMIT / HARD_LIMIT 四个数必须都解析出来
//   L3 单源不变量              free < hard（同 scope）；四个数为正整数
//   L4 唯一声明处 ≡ 实算        `商业化方案_v1.4_融合版.md` 的「🔢 商业化额度口径（唯一声明处）」恰 1 处，四个数 ≡ 单源
//   L5 当前态陈述 ≡ 实算        specs/**/*.md 里「类别锚点 + 就近 ≤40 字符 + 额度语义 + 数字」的强面陈述 ≡ 单源
//                              （裸扫「N 张」必误杀：OBSOLETE 历史版、演进链「v1.3 改 8→3」都是合法旧值 —— 坑⑭）
//   L6 硬上限面                 `硬上限` ≤12 字符内数字 ∈ {200, 2000}
//   L7 排除面前提              确有历史/演进类陈述被放行（HIST 命中 ≥1），证明排除面没打错
//   L8 命中数 fail-closed      强面命中 < LEAST 即判红（正则/扫描面失效 ⇒ 零命中假绿）
//   L9 单源不扩散              其它 .md 不得再自称「唯一声明处」
//
// 运行：node tools/check_quota_limits.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_REL = 'cloudfunctions/checkQuota/service.js';
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

// 🔴 坑⑱（round68 实证，round86 先在元守卫上修、round87 补齐本份）：`git ls-files` **只扫 index**
//    ⇒ 一份**尚未 `git add`** 的新 `specs/*.md` 根本不在扫描面，于是「新文档把 M3 免费额度写回 8」「新文档自称额度单源」
//    这类回归被整族静默跳过（与 round56「判据扫错了层」、round61「CJK 被静默跳过」同族：扫空 = 零覆盖而单向变异照样通过）。
//    补面只取 `specs/` 一个既有根 —— **不补 `review/evidence/`**（上千取证件会被 L 组全判违规）。
const WT_DIRS = [{ key: 'specs', dir: 'specs' }];
const WT_FLOOR = { specs: 20 };              // 实测 30 ⇒ 取保守下界（下界表键必须是固定 key，不能随被判对象变 ⇒ 坑㉚）
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
// 两条前提守卫（§0.3⑦）：① 逐根下界 —— 补面被扫成空就转红；② 回环 —— index 面须能被工作树扫描复现，根路径写错即转红。
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

// —— L2 单源解析
const srcRaw = fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8');
function parseObj(sym) {
  const m = srcRaw.match(new RegExp(`const\\s+${sym}\\s*=\\s*\\{([^}]*)\\}`));
  if (!m) return null;
  const shop = (m[1].match(/shop\s*:\s*(\d+)/) || [])[1];
  const card = (m[1].match(/cost_card\s*:\s*(\d+)/) || [])[1];
  if (!shop || !card) return null;
  return { shop: Number(shop), cost_card: Number(card) };
}
const FREE = parseObj('FREE_LIMIT');
const HARD = parseObj('HARD_LIMIT');
check('L2-① 单源 FREE_LIMIT 可解析（fail-closed）', !!FREE,
  FREE ? `shop=${FREE.shop} / cost_card=${FREE.cost_card}` : '解析失败');
check('L2-② 单源 HARD_LIMIT 可解析（fail-closed）', !!HARD,
  HARD ? `shop=${HARD.shop} / cost_card=${HARD.cost_card}` : '解析失败');

// —— L3 单源不变量
if (FREE && HARD) {
  check('L3-① 免费额 < 硬上限（同 scope）', FREE.shop < HARD.shop && FREE.cost_card < HARD.cost_card,
    `M1 ${FREE.shop}<${HARD.shop} / M3 ${FREE.cost_card}<${HARD.cost_card}`);
  check('L3-② 四个额度均为正整数', [FREE.shop, FREE.cost_card, HARD.shop, HARD.cost_card]
    .every((n) => Number.isInteger(n) && n > 0), 'OK');
} else {
  check('L3-① 免费额 < 硬上限（同 scope）', false, '单源解析失败');
  check('L3-② 四个额度均为正整数', false, '单源解析失败');
}

// —— L4 唯一声明处
const declAbs = path.join(ROOT, DECL_REL);
const declRaw = fs.existsSync(declAbs) ? fs.readFileSync(declAbs, 'utf8') : '';
const declLines = declRaw.split(/\r?\n/).filter((l) => l.includes(DECL_MARK));
check('L4-① 语义标记「商业化额度口径（唯一声明处）」恰 1 处', declLines.length === 1, `${declLines.length} 处`);
if (declLines.length === 1 && FREE && HARD) {
  const seg = declLines[0];
  const want = [`**${FREE.shop}**`, `**${FREE.cost_card}**`, `**${HARD.shop}**`, `**${HARD.cost_card}**`];
  const miss = want.filter((w) => !seg.includes(w));
  check('L4-② 声明处四个数 ≡ 单源实算', miss.length === 0,
    miss.length ? `缺 ${miss.join(' / ')}` : `M1 ${FREE.shop} / M3 ${FREE.cost_card} / 硬上限 ${HARD.shop}·${HARD.cost_card}`);
} else {
  check('L4-② 声明处四个数 ≡ 单源实算', false, '声明处缺失或单源解析失败');
}

// —— L5/L6 当前态陈述 ≡ 实算
// HIST：合法的历史/演进/作废类陈述（v1.1 旧值 8、演进链「8→3」、OBSOLETE 文件）⇒ 放行不判红。
// 与 round64 同律：排除面必须有前提守卫（L7）证明它没打错。
const HIST = /(OBSOLETE|已作废|已过时|演进|改回|原为|调整为|此前|历史快照|v1\.1|v1\.3|8→3|→3|曾|回退)/;
const EXCL_DIR = /^specs\/dev-specs\/review\//;
const EXCL_FILE = /(^|\/)OBSOLETE_/;      // 文件头已声明作废的历史版（v1.1 旧值 8 张）
const HARDLINE = /(硬上限|防护上限|隐藏[^。；\n]{0,10}上限)/; // 整行走硬上面，不进免费面（否则「账套 200 个」误判成免费额）
const ORDINAL = /第\s*\d+\s*(?:张|个|套|家|月)/g;             // 「第 4 张触发付费墙」= 触发序号，不是免费额

// 强面模式：类别锚点 → 就近 ≤40 字符 → 额度语义 → 数字（坑⑯：就近是防误杀的关键）
const P_M1_FREE = /(?:M1|账套|店铺数)[^。；\n]{0,40}?(?:免费上限|配额|限额|免费|额度|上限)[^。；\n]{0,6}?\*{0,2}(?<![\w.])(\d+)/g;
const P_M1_UNIT = /(?:M1|账套)[^。；\n]{0,40}?(?:账套|店铺|免费|配额|额度)[^。；\n]{0,8}?\*{0,2}(?<![\w])(\d+)\*{0,2}\s*(?:个|套|账套)(?!月)/g;
const P_M3_FREE = /(?:M3|成本卡)[^。；\n]{0,40}?(?:免费上限|配额|限额|免费|额度|上限)[^。；\n]{0,6}?\*{0,2}(?<![\w.])(\d+)/g;
const P_M3_UNIT = /(?:M3|成本卡)[^。；\n]{0,40}?(?:成本卡|免费|配额|额度)[^。；\n]{0,8}?\*{0,2}(?<![\w])(\d+)\*{0,2}\s*张(?!纸)/g;
// 硬上限：必须「硬上限 → ≤24/40 字符 → M1/M3 类别锚点 → ≤10 字符 → 2~4 位数字」。
// 三条约束都是防误杀：① 要类别锚点 —— `core/12_云开发配额与成本测算` 里的「硬上限」指云资源配额，
//   与商业化额度无关；② 要 2~4 位 —— 排掉版本号（v1.4 的 4）与免费额（1/3）；③ 就近 —— 排掉
//   「硬上限…（1/3/3）…另有硬上限（M1 账套 200）」一行两处时抓错前一个（坑⑯）。
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
    if (HARDLINE.test(line)) return;            // 硬上限行：不再进免费面
    if (isDecl) return;                          // 声明处已由 L4 单独校验
    const free = line.replace(ORDINAL, '第▓');   // 剥离「第 N 张」触发序号
    const grabF = (re, kind) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(free)) !== null) {
        claims.push({ f: rel, line: i + 1, v: Number(m[1]), kind, txt: line.trim().slice(0, 90) });
      }
    };
    grabF(P_M1_FREE, 'm1'); grabF(P_M1_UNIT, 'm1');
    grabF(P_M3_FREE, 'm3'); grabF(P_M3_UNIT, 'm3');
    // 弱面：有额度数字但无类别锚点 ⇒ 只明示不判红
    if (/(免费|上限|限额|配额)[^。；\n]{0,6}\*{0,2}\d/.test(line)
      && !claims.some((c) => c.f === rel && c.line === i + 1)) {
      const mm = line.match(/\*{0,2}(\d+)\*{0,2}/);
      if (mm) weak.push({ f: rel, line: i + 1, v: mm[1], txt: line.trim().slice(0, 90) });
    }
  });
}
check('L1-② 文件级排除面前提：确有 OBSOLETE 历史版被排除（证明排除没打错）', exclFileN >= 1, `${exclFileN} 个文件`);

const expectOf = (k) => (k === 'm1' ? FREE.shop : FREE.cost_card);
const badClaims = claims.filter((c) => c.v !== expectOf(c.kind));
check('L5 当前态免费额陈述全部 ≡ 单源实算（M1/M3 强面）', badClaims.length === 0,
  badClaims.length
    ? badClaims.map((c) => `${c.f}:${c.line} ${c.kind} 写 ${c.v} ≠ ${expectOf(c.kind)}`).join(' | ')
    : `${claims.length} 处一致（M1=${FREE.shop} / M3=${FREE.cost_card}）`);

const badHard = HARD ? hardClaims.filter((c) => c.v !== HARD.shop && c.v !== HARD.cost_card) : hardClaims;
check('L6 硬上限陈述 ∈ {200, 2000}（≡ 单源）', badHard.length === 0,
  badHard.length ? badHard.map((c) => `${c.f}:${c.line} 写 ${c.v}`).join(' | ')
    : `${hardClaims.length} 处一致（${HARD ? `${HARD.shop}/${HARD.cost_card}` : '?'}）`);

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

if (weak.length) {
  console.log(`  ⚠️ 弱面（无类别锚点，` + '`N 张/个/套`' + ` 只明示不判红，避免误杀无关计数）${weak.length} 处：`);
  weak.slice(0, 8).forEach((c) => console.log(`     ${c.f}:${c.line} 写 ${c.v} —— ${c.txt}`));
}

console.log(`\n===== 商业化额度口径守卫结果：${pass} 通过 / ${fails.length} 失败 =====`);
process.exit(fails.length === 0 ? 0 : 1);
