// tools/check_handoff_paths.js —— 交接面「引用位置」守卫（R77）
//
// 为什么需要（R77 的根因，不是"谁写错了"）：
//   `review/README.md §1` 把 WorkBuddy 的报告位置写成**仓库相对路径** `.workbuddy/memory/<日期>.md`，
//   而该路径在仓库里根本不存在（`<repo>\.workbuddy` = False）。round32 复审方据此查了三个候选路径，
//   在 `~\.workbuddy\memory\`（**云端画像缓存**，自动注入的 `<uuid>_memory.md`）与
//   `~\.workbuddy\MEMORY.md`（**跨项目用户级画像**）两处看到文件后，判定"**报告链事实中断**"——
//   而真正的报告目录一直在正常更新（2026-09-08 ~ 09-17 每日一份）。
//   ⇒ 缺陷在**引用位置不可解析 + 同名诱饵没有标注**：引用方只能猜，猜错就把"我核不了"升级成"你断链了"。
//
// 同族教训（R74/R75/R76）：**同一事实写错位置 = 漂移源**；
//   而"改一次文本"防不住下一个人再写一次 —— R74 只做到"改注释提醒"、一轮就被实测打脸
//   ⇒ **提醒 ≠ 机械**，必须落成判据。
//
// 🔑 一个该被记住的性质（复审方 round33 前建议写进本文件头，我方采纳）：
//   本守卫**上线当天、在基线态就抓到 3 处真问题**（含落地时新写的两处）。
//   ⇒ 这说明它的价值**不在"防将来"，而在"当下就证明了过去没人验过"**。
//   P4 之所以是核心，正因它把「这个路径真的存在吗」第一次变成**机器必答**的问题；
//   在此之前，写错也一路全绿 —— 一个**从来没被验证过的事实**，与"假绿"是同一种东西。
//
// 判据（P1~P6，全部 fail-closed；解析不到即判红，不许静默放行）：
//   P1 协议必须给**可解析绝对路径**：`review/README.md` 里含「WorkBuddy 报告」的表行必须含盘符路径
//   P2 协议必须**显式点名两个同名诱饵**并各自标注（否则下一个复核方会重犯 round32 的误判）
//   P3 活文档里凡出现**报告路径的相对写法**（`.workbuddy\memory` / `.workbuddy/memory`）的行，
//      必须**同行**给出可解析绝对路径、或显式标注为诱饵（含「诱饵」二字）
//   P4 被点名的报告目录**必须真实存在** —— 这才是真正的根因断言：
//      **此前从没有人验证过这个路径**，所以写错了也一路全绿。分两层：
//      ① 「解析到的都真实存在」；② 「**凡提到报告路径的活文档，都必须给出可解析的绝对路径**」
//      —— 否则把路径尾巴写坏（`…\memory_nope`）时，①会被前缀匹配蒙过去（M14 实测：加固前判绿）。
//      配套：ABS 正则带尾部 lookahead `(?![A-Za-z0-9_])`，坏后缀**解析不出来**，由 ② 点红。
//   P5 报告目录里至少 1 份 `YYYY-MM-DD.md`（并打印最新一份的 mtime，供人眼判断链条是否还活着）
//   P6 诱饵标注**不许腐**：两个诱饵路径的存在性必须被核实并打印（"警告一个不存在的东西"只会误导人）
//
// 扫描面（**只含活文档**；历史流水不改、也不在扫描面内）：
//   `review/README.md` · `SMOKETEST_RUNBOOK.md` · `新手上云操作手册.md` · `下一步工序清单.md` ·
//   `specs/dev-specs/★知识存储点_2026-09-10.md`
//   —— `review/REVIEW_*.md` 与 `review/evidence/**` 是 audit log（只增不改），
//      它们里面的相对写法按协议 §1 那一行的解释读，不算缺陷。
//
// 约定（沿用 R76/R77）：**新增或改写"位置引用"时，请沿用既有措辞**（"绝对路径 + 诱饵标注"），
//   或在本文件的常量表里补一条。P1/P2 都要求"命中 ≥1"，措辞改了会让它响亮转红；
//   但**同一事实若写成第二种写法，新模式不会被自动覆盖** ⇒ 新写法必须显式登记。
//
// 运行：
//   node tools/check_handoff_paths.js          # 校验（exit 0/1）

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL = path.join(ROOT, 'review/README.md');
const LIVE_DOCS = [
  PROTOCOL,
  path.join(ROOT, 'SMOKETEST_RUNBOOK.md'),
  path.join(ROOT, '新手上云操作手册.md'),
  path.join(ROOT, '下一步工序清单.md'),
  path.join(ROOT, 'specs/dev-specs/★知识存储点_2026-09-10.md'),
];

// 报告目录的「可解析绝对路径」形态（Windows 盘符；两种斜杠都认）
// ⚠️ 两个实例，故意分开：`/g` 正则**有状态**（`.test()` 会推进 `lastIndex`）——
//    若同一实例既 `.test()` 又 `matchAll()`，就会**串状态**；实测已造成一次假阴性（RUNBOOK 那行被漏判、
//    且 P1 断言"通过"却打印失败详情）。⇒ test 用无 /g 实例、matchAll 用带 /g 实例，**别退回一个**。
// 尾部 lookahead `(?![A-Za-z0-9_])` 是**边界断言**：`…\.workbuddy\memory_nope` 这类**写错后缀**的路径
// 不得被前缀匹配蒙过去 —— 不加它时，守卫自己的「存在性」断言会被绕过（M14 实测：改坏后缀仍判绿）。
const ABS_RE = /([A-Za-z]:[\\/]Users[\\/][^\s`|"'，,）;)]*?[\\/]\.workbuddy[\\/]memory(?![A-Za-z0-9_]))/;    // .test() 用（无 /g ⇒ 无状态）
const ABS_ALL = /([A-Za-z]:[\\/]Users[\\/][^\s`|"'，,）;)]*?[\\/]\.workbuddy[\\/]memory(?![A-Za-z0-9_]))/g;   // matchAll 用
// Git-Bash（MSYS）形态的**同一目录**：`/c/Users/…/.workbuddy/memory` —— 本仓文档惯用它写 shell 命令。
// 它同样是"绝对路径"，只是没有盘符 ⇒ P3 的豁免要认它（但不参与 P4 的存在性解析：fs 只认 Windows 形态，
// 且这种写法常带 `*` 通配）。⚠️ 不加这条会把**正确的定位命令**误判成裸相对写法（基线实测）。
const MSYS_ALL = /[\/][a-z][\/]Users[\/][^\s`|"'，,）;)]*?[\/]\.workbuddy[\/]memory(?![A-Za-z0-9_])/g;
// 报告路径的「相对写法」（只写 .workbuddy\memory、不带盘符）—— P3 的触发条件
const REL_RE = /\.workbuddy[\\/]memory/;     // .test() 用（无 /g ⇒ 无状态）
const REL_ALL = /\.workbuddy[\\/]memory/g;    // matchAll 用
// 两个同名诱饵（round32 实际误认的那两处）+ 标注词
const DECOYS = [
  { key: '~\\.workbuddy\\memory', label: '云端画像缓存' },
  { key: '~\\.workbuddy\\MEMORY.md', label: '跨项目用户级记忆' },
];
// 标注词 = **封闭词表**（P2/P3 共用）：凡引用诱饵，其后紧邻处必须出现其中之一。
// 词表外的新说法不会被自动识别 ⇒ 要加新词就改这一行（沿用 R76 的「约定」纪律）。
// 标注必须出现在诱饵的**紧邻处**：窗口 40 字符。⚠️ 别放大到 80 —— 两个诱饵写在同一行时，80 会把「隔壁诱饵的标注」算进来 ⇒ 删掉本诱饵的标注却仍然判绿（M15 实测的等价变异）。
const LABEL_WINDOW = 40;
const LABEL_WORDS = ['诱饵', '非本项目报告', '云端画像缓存', '跨项目用户级记忆'];
const DECOY_MARK = new RegExp(LABEL_WORDS.join('|'));
const ANCHOR = 'WorkBuddy 报告';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
function readOrDie(p) {
  if (!fs.existsSync(p)) {
    console.log(`❌ 缺少必需文件：${rel(p)}`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}
const norm = (s) => s.replace(/\//g, '\\');   // 统一成反斜杠再交给 fs（Windows）

// ===================== 读取活文档 =====================
const docs = LIVE_DOCS.map((p) => ({ file: p, text: readOrDie(p) }));
const proto = docs.find((d) => d.file === PROTOCOL).text;

// ===================== P1：协议必须给可解析绝对路径 =====================
const anchorLine = proto.split(/\r?\n/).find((l) => l.includes(ANCHOR)) || '';
check(`P1 协议含锚点行「${ANCHOR}」（fail-closed）`, anchorLine.length > 0,
  anchorLine ? `第 ${proto.split(/\r?\n/).indexOf(anchorLine) + 1} 行` : '**未找到** ⇒ 表结构变了，判据失效');
const p1Ok = ABS_RE.test(anchorLine);   // 只算一次：二次调用会拿到被推进的 lastIndex（假阴性源）
check('P1 锚点行含可解析绝对路径（盘符 + .workbuddy[/\]memory）', p1Ok,
  p1Ok ? '已给出盘符路径' : '只写了相对路径 ⇒ 引用方只能猜（R77 的根因）');

// ===================== P2：两个诱饵必须被显式点名 + 标注 =====================
// 判据要**紧**：光"这一行里有诱饵二字"太松（整行可能只有一处标注却管两个诱饵）
// ⇒ 要求标注**紧跟在该诱饵之后 80 字符内**（「A = 云端画像缓存」这种写法），否则不算。
for (const d of DECOYS) {
  const line = proto.split(/\r?\n/).find((l) => l.includes(d.key)) || '';
  const at = line.indexOf(d.key);
  const near = at >= 0 ? line.slice(at, at + LABEL_WINDOW) : '';
  const labeled = near.includes(d.label) || DECOY_MARK.test(near);
  check(`P2 协议点名诱饵「${d.key}」并在其后紧邻标注（${d.label}）`, at >= 0 && labeled,
    at < 0 ? '未点名 ⇒ 下一个复核方会重犯 round32 的误判'
           : (labeled ? '已标注' : `未在紧邻处标注（现状：${near.slice(0, 40)}…）`));
}

// ===================== P3：相对写法必须同行可解析或显式标注 =====================
const p3bad = [];
for (const d of docs) {
  d.text.split(/\r?\n/).forEach((line, i) => {
    if (!REL_RE.test(line)) return;
    const absSpans = [...line.matchAll(ABS_ALL), ...line.matchAll(MSYS_ALL)]
      .map((m) => [m.index, m.index + m[0].length]);
    for (const m of line.matchAll(REL_ALL)) {
      // ① 落在**绝对路径内部**的相对写法（`C:\...\.workbuddy\memory` 那段子串）不算独立引用
      if (absSpans.some(([a, b]) => m.index >= a && m.index + m[0].length <= b)) continue;
      // ② 独立的相对引用：其后 LABEL_WINDOW 字符内须有标注词（封闭词表）
      //    ⚠️ 必须**逐处**判定：早期版本「任一处有标注就 return 整行」，
      //       会把同一行里的**另一处裸相对写法**一起放过（M13 实测）。
      if (DECOY_MARK.test(line.slice(m.index, m.index + LABEL_WINDOW))) continue;
      p3bad.push(`${rel(d.file)}:${i + 1}`);
    }
  });
}
check('P3 活文档中报告路径的相对写法均可解析或已标注诱饵', p3bad.length === 0,
  p3bad.length ? `${p3bad.length} 处裸相对写法：${p3bad.join(', ')}` : `扫描 ${docs.length} 份活文档，0 处`);

// ===================== P4：被点名的报告目录必须真实存在 =====================
const absDirs = new Set();
for (const d of docs) {
  for (const m of d.text.matchAll(ABS_ALL)) absDirs.add(norm(m[1]));   // ABS_ALL 带 /g；matchAll 不写回原实例
}
check('P4 至少解析到 1 个报告目录绝对路径（fail-closed）', absDirs.size > 0,
  absDirs.size ? [...absDirs].join(' , ') : '**0 个** ⇒ P1/P3 形同虚设');
if (absDirs.size) {
  const missing = [...absDirs].filter((p) => !fs.existsSync(p));
  check('P4 每个报告目录均真实存在', missing.length === 0,
    missing.length ? `不存在：${missing.join(' , ')}（**这个路径从没被验证过**，正因如此才写错了也全绿）`
                   : `${absDirs.size} 个目录全部存在`);
}
// P4c（fail-closed，文档级）：「凡提到报告路径的活文档，都必须给出**可解析**的绝对路径」
//   —— 只查"解析到的都真实存在"是不够的：把路径写成 `…\.workbuddy\memory_nope`（尾部写坏）时，
//      旧版会被**前缀匹配**蒙过去而判绿（M14 实测）；有了尾部边界断言后它**解析不出来**，
//      于是必须由这一条把它点红 —— 即"说不出在哪"和"说错了在哪"都要响亮失败。
const mentionRel = docs.filter((d) => REL_RE.test(d.text));
const noAbs = mentionRel.filter((d) => { ABS_ALL.lastIndex = 0; return !ABS_ALL.test(d.text); });
check('P4 每个提到报告路径的活文档都给出了可解析的绝对路径',
  noAbs.length === 0 && mentionRel.length > 0,
  noAbs.length ? `缺可解析路径：${noAbs.map((d) => rel(d.file)).join(', ')}`
               : (mentionRel.length ? `${mentionRel.length} 份：${mentionRel.map((d) => rel(d.file)).join(', ')}`
                                    : '**0 份提到报告路径** ⇒ 判据失效（fail-closed）'));
ABS_ALL.lastIndex = 0;

// ===================== P5：报告目录里至少有 1 份日报 =====================
const reportDir = [...absDirs][0];
if (reportDir && fs.existsSync(reportDir)) {
  const dates = fs.readdirSync(reportDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  check('P5 报告目录含 ≥1 份 `YYYY-MM-DD.md`', dates.length > 0, `${dates.length} 份`);
  if (dates.length) {
    const latest = dates.sort().pop();
    const st = fs.statSync(path.join(reportDir, latest));
    console.log(`   ℹ️ 最新报告：${latest}（${st.size} B，mtime ${st.mtime.toISOString().slice(0, 16).replace('T', ' ')}）`);
  }
}

// ===================== P6：诱饵标注不许腐 =====================
for (const d of DECOYS) {
  const p = path.join(os.homedir(), norm(d.key.slice(2)));   // 去掉 `~\`
  const ok = fs.existsSync(p);
  check(`P6 诱饵「${d.key}」确实存在（标注不腐）`, ok,
    ok ? `${rel2home(p)} · ${d.label}` : `**不存在**：${d.label} 已不在这台机器上 ⇒ 标注会误导人，请更新协议`);
}
function rel2home(p) { return p.replace(os.homedir(), '~'); }

console.log(`\n===== 交接面引用位置守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
