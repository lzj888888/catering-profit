#!/usr/bin/env node
// tools/check_suite_count_claims.js —— 套件数口径守卫（「重启键写 68、实算 69」这类漂移的机械兜底）
//
// 为什么需要这一层（2026-09-20 round61 实锤）：
//   `verify_all.js` 的头部注释数量由 R59（guardSuiteCount）自动校验，但**重启键
//   `specs/dev-specs/★知识存储点_2026-09-10.md` 里的两处「套件数」是人工维护面** ——
//   该文件自己就写着：「改 `verify_all.js` 的 SUITES 后两处都要跟，否则重启键自相矛盾而
//   A–L 无一组能发现」。round60 新增第 69 个套件后确实漏跟了 ⇒ **本轮实扫：重启键两处仍写 68、
//   实算 69**（漂移已发生且无人报警）。
//   与 R86「索引已建 ≠ 生效」、round53「判据存在 ≠ 被执行」同族：**权威入口写的数 ≠ 机器实算的数**。
//   ⇒ 只把 68 改回 69 是止血；本文件把「口径 ≡ 实算」变成门禁里的常驻断言。
//
// 设计要点：
//   1) 实算单源 = `verify_all.js` 的 `const SUITES = [ ... ];` 块（只解析这一段，不整文件扫；
//      与 check_suite_coverage.js 同源，避免两套解析规则）。
//   2) 面 A = **当前态声明**（必须 ≡ 实算 N，fail-closed 解析不到即红）：
//        ① `verify_all.js` 头注「串联：N 个套件」（R59 同源，本守卫作交叉校验）
//        ② 重启键 §1.1「一键校验入口」行里的套件数
//        ③ 重启键「套件数会漂」行的当前值
//        ④ 全仓「第 N 套件」型序号声明（须同行点名脚本，且 SUITES[N-1] 真的是它）
//   3) 面 B = **历史陈述**（round40 的「64/64」、NOTE 里的旧计数…）一律放行 —— 本仓对历史件
//      的纪律是「只增不改」。放行靠**扫描面排除** `review/`（不是靠句式猜），并用 C5 断言守住
//      这条排除的前提（§0.3⑦：排除项必须连它的前提一起守）：review/ 里确实存在历史计数陈述
//      ⇒ 证明排除路径没打错，也证明「放行规则是必需的」而不是"根本没扫到"。
//   4) **不绑句式、绑语义位置**：② 的判据是「该行内第一个后面紧跟『套件』的数字」，
//      不是「串 X 个套件」这个字面 ⇒ 「共 **70** 个校验套件」这类换措辞的正确实现不会误杀。
//   5) **fail-closed**：任何一处锚点解析不出数字 ⇒ 判红（缺证据 = 不过，不许静默跳过）。
//
// 运行：node tools/check_suite_count_claims.js   （由 verify_all.js 的 [suite-count-claims] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = 'verify_all.js';
const RESTART = 'specs/dev-specs/★知识存储点_2026-09-10.md';
const SELF = 'tools/check_suite_count_claims.js';

// 面 A④：序号声明的扫描面（当前态权威件；review/ 是历史演进记录，排除，见设计要点 3）
const SEQ_FACES = ['specs/', 'miniprogram/', 'tools/'];
const SEQ_ROOT_MD = /^[^/]+\.md$/;

function readLines(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
}

// 只取 `const SUITES = [ ... ];` 段；行首 `[` 计一项
function suiteList() {
  const src = fs.readFileSync(path.join(ROOT, RUNNER), 'utf8');
  const start = src.indexOf('const SUITES = [');
  if (start < 0) return null;
  const end = src.indexOf('\n];', start);
  if (end < 0) return null;
  const block = src.slice(start, end);
  const rows = block.split(/\r?\n/).filter((l) => /^\s*\[/.test(l));
  const re = /'([A-Za-z0-9_./-]+\.(?:js|py))'/;
  const out = [];
  for (const r of rows) {
    const m = re.exec(r);
    if (m) out.push(m[1]);
  }
  return out.length ? out : null;
}

// 归一化：去路径、去 .js、横杠转下划线、小写（⇒ `env-ready` 与 `check_env_ready` 可比）
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\.js$/, '')
    .replace(/^.*\//, '')
    .replace(/-/g, '_');

// 在一行里找「其后 12 字符内出现『套件』」的第一个 2~3 位数 = 当前态套件数声明
function claimNearSuiteWord(line) {
  const re = /\*{0,2}(\d{2,3})\*{0,2}/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const after = line.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (after.includes('套件')) return Number(m[1]);
  }
  return null;
}

function gitTracked() {
  const { execFileSync } = require('child_process');
  // 🔴 必须 `-c core.quotepath=false`：git 默认把 CJK 路径输出成八进制转义
  //    （`specs/dev-specs/★知识存储点_2026-09-10.md` → `...\345\255\230...`），
  //    于是 readFileSync 找不到文件、被 catch 静默 continue ⇒ **整个 CJK 文件族不进扫描面**
  //    （round61 由变异 M3 当场抓出：把「第 66 套件」改错，守卫却仍判绿）。
  //    与 round56「判据扫错了层」、round53「判据存在≠被执行」同族：扫错/扫空 = 零覆盖而变异照样通过。
  return execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

(function main() {
  const pass = [];
  const bad = [];
  // ⚠️ check() 必须当场打印 ✅/❌：verify_all.js 的 R66 审计要求「每个段标题下至少一个 ✅」。
  const check = (name, ok, detail) => {
    (ok ? pass : bad).push(name + (detail ? ' · ' + detail : ''));
    console.log((ok ? '✅ ' : '❌ ') + name + (detail ? ' · ' + detail : ''));
  };

  console.log('===== C1 前置：实算单源 SUITES 可解析（fail-closed）=====');
  let suites = null;
  try {
    suites = suiteList();
  } catch (e) {
    check('C1 ' + RUNNER + ' 可读且 SUITES 块可解析', false, String(e.message || e));
    console.log('\n===== 套件数口径守卫结果：0 通过 / 1 失败 =====');
    process.exit(1);
  }
  check('C1 ' + RUNNER + ' 可读且 SUITES 块可解析', !!suites && suites.length > 0,
    suites ? '实算 N = ' + suites.length : '未找到 const SUITES = [ ... ];');
  if (!suites) {
    console.log('\n===== 套件数口径守卫结果：' + pass.length + ' 通过 / ' + bad.length + ' 失败 =====');
    process.exit(1);
  }
  const N = suites.length;

  console.log('\n===== C2 当前态声明 ≡ 实算 N（重启键是人工面，R59 只守 verify_all 头注）=====');
  // ① verify_all.js 头注（与 R59 同源，交叉校验）
  const runnerSrc = fs.readFileSync(path.join(ROOT, RUNNER), 'utf8');
  const mHead = /串联：\s*\*{0,2}(\d{2,3})/.exec(runnerSrc);
  check('C2-① ' + RUNNER + ' 头注「串联：N 个套件」 ≡ N', !!mHead && Number(mHead[1]) === N,
    mHead ? '文档 ' + mHead[1] + ' / 实算 ' + N : '未解析到头注数量 ⇒ fail-closed');

  let rkLines = [];
  try {
    rkLines = readLines(RESTART);
  } catch (e) {
    check('C2-② 重启键可读', false, String(e.message || e));
    console.log('\n===== 套件数口径守卫结果：' + pass.length + ' 通过 / ' + bad.length + ' 失败 =====');
    process.exit(1);
  }
  // ② 重启键 §1.1 一键校验入口行
  // ⚠️ 必须锚定「标题格式」（**…**），不能只 includes：第 159 行是**引用**「套件数会漂」行的历史陈述，
  //    按 includes 取到的是它 ⇒ 定义行（第 558 行）永远扫不到，守卫当场失明（round61 实测）。
  const iEntry = rkLines.findIndex((l) => /\*\*一键校验入口/.test(l));
  const entryClaim = iEntry >= 0 ? claimNearSuiteWord(rkLines[iEntry]) : null;
  check('C2-② 重启键 §1.1 一键校验入口行的套件数 ≡ N', entryClaim !== null && entryClaim === N,
    iEntry < 0 ? '未找到「一键校验入口」行 ⇒ fail-closed'
      : entryClaim === null ? '该行未解析到套件数 ⇒ fail-closed'
      : '文档 ' + entryClaim + ' / 实算 ' + N);

  // ③ 重启键「套件数会漂」行的当前值（锚点 = 「（现/当前」标签，不绑「现」单一写法）
  const iDrift = rkLines.findIndex((l) => /\*\*套件数会漂\*\*/.test(l));
  const mDrift = iDrift >= 0 ? /（(?:现|当前)[^0-9]{0,6}\*{0,2}(\d{2,3})/.exec(rkLines[iDrift]) : null;
  check('C2-③ 重启键「套件数会漂」行当前值 ≡ N', !!mDrift && Number(mDrift[1]) === N,
    iDrift < 0 ? '未找到「套件数会漂」行 ⇒ fail-closed'
      : !mDrift ? '未解析到当前值 ⇒ fail-closed'
      : '文档 ' + mDrift[1] + ' / 实算 ' + N);

  console.log('\n===== C3 「第 N 套件」序号声明 ≡ SUITES 实际位置 =====');
  let files = [];
  try {
    files = gitTracked();
  } catch (e) {
    check('C3 git ls-files 可用', false, String(e.message || e));
    console.log('\n===== 套件数口径守卫结果：' + pass.length + ' 通过 / ' + bad.length + ' 失败 =====');
    process.exit(1);
  }
  // fail-closed：git 路径一旦被转义（quotepath 没关）就说明"CJK 文件根本没进扫描面" ⇒ 直接判红，
  // 不许靠 catch 静默跳过（静默跳过 = 把缺口换个地方继续藏着）。
  const escaped = files.filter((f) => /\\[0-7]{3}/.test(f));
  check('C3-前置 git 路径未被转义（CJK 文件真进扫描面）', escaped.length === 0,
    escaped.length ? '转义路径 ' + escaped.length + ' 条：' + escaped.slice(0, 3).join(', ') : '零转义');

  // 🔴 坑⑱（round68 实证，round86 先在元守卫上修、round87 补齐本份）：`git ls-files` **只扫 index**
  //    ⇒ 一份**尚未 `git add`** 的新文档根本不在扫描面，于是「新文档写了错的第 N 套件序号」「新文档自称当前套件数」
  //    这类回归被整族静默跳过（与 round56「判据扫错了层」、round61「CJK 被静默跳过」同族：扫空 = 零覆盖而单向变异照样通过）。
  //    补面严格对齐 SEQ_FACES + 仓根 md —— **不补 `review/`**（上千取证件会被序号面全判违规）。
  const WT_FACES = [
    { key: 'specs', dir: 'specs' },
    { key: 'tools', dir: 'tools' },
    { key: 'miniprogram', dir: 'miniprogram' }
  ];
  const WT_FLOOR = { specs: 30, tools: 30, miniprogram: 1, rootMd: 4 };   // 实测 56/48/2/8 ⇒ 取保守下界
  function worktreeFace(idxFiles) {
    const seen = new Set(idxFiles.map((f) => f.replace(/\\/g, '/')));
    const add = [];
    const all = [];
    const counts = {};
    const walk = (rel, key) => {
      let ents = [];
      try { ents = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'miniprogram_npm') continue;
        const r = rel + '/' + e.name;
        if (e.isDirectory()) { walk(r, key); continue; }
        if (!e.isFile()) continue;
        counts[key] = (counts[key] || 0) + 1;
        all.push(r);
        if (!seen.has(r)) add.push(r);
      }
    };
    for (const d of WT_FACES) { counts[d.key] = 0; walk(d.dir, d.key); }
    let rootN = 0;
    let rootEnts = [];
    try { rootEnts = fs.readdirSync(ROOT, { withFileTypes: true }); } catch (_) { rootEnts = []; }
    for (const e of rootEnts) {
      if (!e.isFile() || !SEQ_ROOT_MD.test(e.name)) continue;
      counts.rootMd = (counts.rootMd || 0) + 1;
      all.push(e.name);
      if (!seen.has(e.name)) add.push(e.name);
    }
    if (counts.rootMd === undefined) counts.rootMd = rootN;
    return { add: add, all: all, counts: counts };
  }
  const idxFiles = files.slice();
  const wt = worktreeFace(idxFiles);
  files = files.concat(wt.add);
  // 两条前提守卫（§0.3⑦）：① 逐根下界 —— 补面被扫成空就转红；② 回环 —— index 面须能被工作树扫描复现，根路径写错即转红。
  const wtKeys = WT_FACES.map((d) => d.key).concat(['rootMd']);
  const wtUnder = wtKeys.filter((k) => (wt.counts[k] || 0) < WT_FLOOR[k])
    .map((k) => k + '(' + (wt.counts[k] || 0) + '<' + WT_FLOOR[k] + ')');
  check('C3-补面① 工作树补面逐根达下界（补面被扫空即转红）',
    wtKeys.every((k) => k in WT_FLOOR) && wtUnder.length === 0,
    wtKeys.map((k) => k + '=' + (wt.counts[k] || 0)).join(' / ') +
    (wtUnder.length ? ' 未达下界: ' + wtUnder.join(',') : ' ＋未入库 ' + wt.add.length + ' 个'));
  const wtAll = new Set(wt.all);
  const idxFace = idxFiles.filter(
    (f) => f !== SELF && !f.startsWith('review/') &&
      (SEQ_FACES.some((p) => f.startsWith(p)) || SEQ_ROOT_MD.test(f))
  );
  const loopMiss = idxFace.filter((f) => !wtAll.has(f));
  check('C3-补面② 回环：index 面内文件均能由工作树扫描复现（根路径写错即转红）', loopMiss.length === 0,
    loopMiss.length ? '工作树扫不到 ' + loopMiss.length + ' 个：' + loopMiss.slice(0, 3).join(', ')
      : 'index ' + idxFace.length + ' 个全部复现');

  // 自指排除：本守卫自己的注释里会**举例**「第 66 套件」这类字样（说明变异怎么抓的），
  // 那是说明性文字、不是序号声明 ⇒ 与 round59「正确实现本身也会引用被禁对象」同族，
  // 「不得出现 X」这类粗判据必误杀。故走「白名单外禁用 + 前提守卫」：
  //   前提 = 自身文件里的「第 N 套件」**只能出现在注释行**（去掉空白后以 // 开头）；
  //   一旦出现在非注释行 ⇒ 判红（那说明它成了真声明，或扫描面被人改坏）。
  const seqFiles = files.filter(
    (f) => f !== SELF && !f.startsWith('review/') &&
      (SEQ_FACES.some((p) => f.startsWith(p)) || SEQ_ROOT_MD.test(f))
  );
  const seqBad = [];
  let seqHits = 0;
  for (const f of seqFiles) {
    let lines = [];
    try {
      lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
    } catch (_) {
      continue;
    }
    lines.forEach((line, i) => {
      const m = /第\s*\*{0,2}(\d{1,3})\*{0,2}\s*套件/.exec(line);
      if (!m) return;
      seqHits++;
      const idx = Number(m[1]) - 1;
      const target = idx >= 0 && idx < suites.length ? suites[idx] : null;
      if (!target) {
        seqBad.push(f + ':' + (i + 1) + ' 第 ' + m[1] + ' 套件（超出 SUITES 范围 ' + N + '）');
        return;
      }
      // 同行须点名脚本：`tools/xxx.js` 或反引号里的名字；归一化后双向子串匹配
      const toks = (line.match(/[\w./-]+\.js/g) || []).concat(
        (line.match(/`([^`]+)`/g) || []).map((s) => s.replace(/`/g, ''))
      );
      const tStem = norm(target);
      const hit = toks.some((t) => {
        const s = norm(t);
        return s.length >= 4 && (tStem.includes(s) || s.includes(tStem));
      });
      if (!hit) {
        seqBad.push(f + ':' + (i + 1) + ' 第 ' + m[1] + ' 套件 ≠ 实为 ' + target +
          '（同行未点名该脚本，或序号已错）');
      }
    });
  }
  check('C3 面内 ' + seqHits + ' 处「第 N 套件」序号声明全部对得上', seqBad.length === 0,
    seqBad.length ? seqBad.join('；') : '全部 ≡ SUITES 实际位置');

  console.log('\n===== C4 扫描面非空（判据存在 ≠ 判据被执行）=====');
  check('C4 面 A 三处声明 + 序号面全部有命中', seqHits > 0 && !!mHead && entryClaim !== null && !!mDrift,
    '头注/§1.1/会漂行/序号声明 = ' + [!!mHead, entryClaim !== null, !!mDrift, seqHits].join('/'));

  console.log('\n===== C5 前提守卫：被排除的 review/ 确实是历史陈述面 =====');
  // §0.3⑦：每写一条排除，同时守它成立的前提。这里的前提 = review/ 里真的有历史计数陈述
  // ⇒ 排除路径没打错，且「放行历史陈述」这条规则是必需的、不是把扫描面扫成了空。
  const revFiles = files.filter((f) => f.startsWith('review/') && /\.(md|txt)$/.test(f));
  let histHits = 0;
  for (const f of revFiles) {
    let txt = '';
    try {
      txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    } catch (_) {
      continue;
    }
    if (/第\s*\*{0,2}\d{1,3}\*{0,2}\s*套件/.test(txt) || /\*{0,2}\d{2,3}\*{0,2}\s*\/\s*\*{0,2}\d{2,3}\*{0,2}\s*套件/.test(txt)) histHits++;
  }
  check('C5 review/ 历史计数陈述存在（排除面没打错、放行规则确有必要）', histHits > 0,
    '历史陈述文件 ' + histHits + ' 个' + (histHits ? '' : ' ⇒ 若确已清理，须同步改本守卫的排除面'));

  console.log('\n===== C6 前提守卫：自指排除只放行注释行（§0.3⑦）=====');
  let selfHits = 0;
  let selfCode = [];
  try {
    fs.readFileSync(path.join(ROOT, SELF), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (!/第\s*\*{0,2}\d{1,3}\*{0,2}\s*套件/.test(line)) return;
        selfHits++;
        if (!/^\s*(\/\/|\*|#)/.test(line)) selfCode.push(SELF + ':' + (i + 1));
      });
  } catch (e) {
    check('C6 自身文件可读', false, String(e.message || e));
  }
  check('C6 自身文件「第 N 套件」仅出现在注释行', selfCode.length === 0,
    selfCode.length ? '非注释行命中：' + selfCode.join(', ') : '注释行命中 ' + selfHits + ' 处，全部属说明性举例');

  const failN = bad.length;
  console.log('\n===== 套件数口径守卫结果：' + pass.length + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) {
    bad.forEach((b) => console.log('   ❌ ' + b));
    console.log('\n修复指引：');
    console.log('  1) C2 红：把重启键 §1.1 一键校验入口行与「套件数会漂」行的数字改成实算 N；');
    console.log('     若刚增删 SUITES，两处**都必须跟**（这正是本守卫存在的原因）。');
    console.log('  2) C3 红：「第 N 套件」写错位置，或同行没点名脚本 ⇒ 按 SUITES 实际顺序改正；');
    console.log('     序号声明必须同行给出脚本名（`tools/xxx.js` 或反引号名），否则按 fail-closed 判红。');
    console.log('  3) C4/C5 红：扫描规则或目录结构已变 ⇒ 修规则，不许放宽到静默通过。');
  }
  process.exit(failN === 0 ? 0 : 1);
})();
