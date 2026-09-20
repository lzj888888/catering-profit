// tools/check_privacy_collection.js —— 隐私收集项清单口径守卫（R104）
//
// 为什么需要（同族病第 12 例，2026-09-21 round68 自驱动巡检抓出）：
//   `specs/dev-specs/上线材料_隐私政策_v1.md` §二 的「信息项 / 收集时机 / 用途 / **代码出处**」表
//   是**递交给微信审核 + mp 后台《用户隐私保护指引》录入的依据**（李老师照抄进后台表单）。
//   它的「实然」侧 = 代码：表里每个 `代码出处` 必须真存在；代码新增隐私能力必须回写这张表。
//   实扫：`tools/` + `prototype/` grep `信息项|收集项|代码出处` **零命中** ⇒ 该表**零守卫**；
//   `check_privacy_placeholders.js`（R99）只守**占位符处数**（6 处），**不看收集项一个字**。
//   后果（与第 9 例页面清单同族，但更硬）：
//     · 云函数改名/删除 ⇒ 表里仍声称收集该项数据 ⇒ 指引与实现不符（微信审核常见拒审理由）；
//     · 代码新增隐私 API（如 `getPhoneNumber`）⇒ 表与「不收集」段静默过期 ⇒ **谎报隐私合规**。
//   与前 11 例同病：**人工陈述面 ≡ 实然，零守卫**；本例的"实然"换成**隐私合规边界**。
//
// 判据（C1~C9，全部 fail-closed；解析不到即判红，不许静默放行）：
//   C1 扫描面 fail-closed      git ls-files 须 `core.quotepath=false`（CJK 路径八进制转义会让整族文件
//                              被 catch 静默跳过 ⇒ 零覆盖）；路径含 `\NNN` 转义即判红（坑⑪）。
//   C2 单源可解析              云函数目录集 ≥40 / 小程序端源码文件集 ≥40（解析不到即红）
//   C3 唯一声明处               「隐私收集项口径（唯一声明处）」恰 1 处，数字可解析（fail-closed）
//   C4 计数三方一致             声明 ≡ §二 表格行数 ≡ 引用行数字
//   C5 文档→代码（逐条）        表内每个 `代码出处` token，凡形如标识符者必须 ≡ 云函数目录 或 ∈ 白名单
//                              （改名 / 删除 / 拼错都红）
//   C6 代码→文档（反向）        小程序端（pages/ utils/ app.js miniprogram/，剥注释后）出现的隐私 API，
//                              必须**已被登记**：要么在表内（收集），要么在「不收集」段被显式点名为零命中
//                              ⇒ 防「代码加了收集能力而材料没更新」。扫描面**排除 tools/ specs/ review/**
//                              （守卫自身与文档会命中 ⇒ 自指误报，坑⑫/⑮）
//   C7 「不收集」≡ 代码零命中    「无 `X` 调用」/「…均未出现」点名的 API 必须在小程序端 **零命中**
//                              （fail-closed；这是本守卫最硬的一条：指引说"不收集"而代码真调了 = 谎报）
//   C8 序号连续 + 前提守卫       1..N 无重号；表格解析 ≥1 行、云函数 token 命中 ≥4、
//                              零命中声明 ≥2 条（列错位 / 正则失效 ⇒ 零命中假绿，同族「扫错层」）
//   C9 单源不扩散               其它 .md 不得再自称「隐私收集项口径（唯一声明处）」
//   ⚠️ 弱面：specs/**/*.md 里「N 项收集 / N 个文件」类陈述只打印 ⚠️ **明示不判红**
//      （坑⑭/⑯：裸扫必误杀 —— 附 的「52 个文件」= pages 的 js/wxml/json 42 + utils/*.js 9 + app.js 1，
//       是另一个合法口径；「6 项」也可能是子集）
//
// 运行：node tools/check_privacy_collection.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DOC_REL = 'specs/dev-specs/上线材料_隐私政策_v1.md';
const DECL_MARK = '隐私收集项口径（唯一声明处）';
const REF_MARK = '隐私收集项口径引用';

// 微信《用户隐私保护指引》里需要声明的隐私能力（小程序端）
const PRIV_APIS = [
  'chooseAvatar', 'getUserProfile', 'getUserInfo', 'getUserNickName',
  'getPhoneNumber', 'getLocation', 'chooseLocation', 'choosePoi',
  'chooseAddress', 'chooseMedia', 'chooseImage', 'chooseMessageFile',
  'chooseContact', 'chooseWeChatContact', 'startRecord', 'saveImageToPhotosAlbum',
  'saveVideoToPhotosAlbum', 'addPhoneContact', 'authorize',
];

// 表内「代码出处」列允许出现的非云函数标识符（云函数之外的合法出处）
const TOKEN_WHITELIST = new Set([
  'shop_entitlement', 'name', 'remark', 'chooseAvatar',
  'onNetworkStatusChange', 'getUpdateManager', 'recordScene',
  'OPENID', 'openid',
]);

const LEAST_FN = 4;  // 云函数 token 命中下限（防列错位零命中假绿）
const LEAST_ZERO = 2; // 「不收集」零命中声明下限

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  ✅ ${name}${detail ? ` —— ${detail}` : ''}`); }
  else { fails.push(name); console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

// —— C1 扫描面（CJK 安全 + index ∪ 工作树）
// ⚠️ 只用 `git ls-files` 会**只扫 index**：工作树里新增但尚未 `git add` 的源码文件**零覆盖**
//    （本轮变异 M3 首轮假绿实证 —— 新增 `pages/__mut_probe_r68.js` 调 `getPhoneNumber`，守卫判绿）。
//    ⇒ 扫描面 = index ∪ 工作树（小程序端四个入口），两者并集才等于"门禁当下应守的全部文件"。
let files = [];
let octal = 0;
try {
  files = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch (_) { files = []; }
octal = files.filter((f) => /\\[0-7]{3}/.test(f)).length;

// 工作树补面（仅小程序端入口，避免把 review/evidence 的过程文件扫进来）
function walkDir(rel) {
  const abs = path.join(ROOT, rel);
  let st = null;
  try { st = fs.statSync(abs); } catch (_) { return []; }
  if (st.isFile()) return [rel];
  if (!st.isDirectory()) return [];
  const out = [];
  try {
    fs.readdirSync(abs, { withFileTypes: true }).forEach((d) => {
      out.push(...walkDir(`${rel}/${d.name}`));
    });
  } catch (_) { /* 不可读目录跳过 */ }
  return out;
}
const WT_ROOTS = ['pages', 'utils', 'miniprogram', 'app.js', 'cloudfunctions'];
const wtFiles = [];
WT_ROOTS.forEach((r) => walkDir(r).forEach((f) => wtFiles.push(f.replace(/\\/g, '/'))));
const idxSet = new Set(files);
const wtOnly = wtFiles.filter((f) => !idxSet.has(f));
const before = files.length;
files = [...new Set(files.concat(wtFiles))];
const wtAdded = files.length - before;
check('C1-① 扫描面非空且无八进制转义（CJK 路径不得被静默跳过）', files.length > 0 && octal === 0,
  `${files.length} 个文件 / 转义 ${octal}`);
check('C1-③ 工作树补面非空（路径写错即零覆盖，非恒真）', wtFiles.length >= 40,
  `工作树 ${wtFiles.length} 个 / 其中 index 外 ${wtOnly.length} 个`);

// —— C2 单源解析：云函数目录 / 小程序端源码
const cfDirs = new Set();
files.forEach((f) => {
  if (f.startsWith('cloudfunctions/') && f.split('/').length >= 3) cfDirs.add(f.split('/')[1]);
});
const MINI = files.filter((f) => f.startsWith('pages/') || f.startsWith('utils/')
  || f === 'app.js' || f.startsWith('miniprogram/'))
  .filter((f) => /\.(js|wxml|wxss|json|html)$/.test(f));
check('C2-① 云函数目录集可解析（fail-closed）', cfDirs.size >= 40, `${cfDirs.size} 个目录`);
check('C2-② 小程序端源码扫描面可解析（fail-closed）', MINI.length >= 40, `${MINI.length} 个文件`);

// —— 文档解析
const docAbs = path.join(ROOT, DOC_REL);
let doc = '';
try { doc = fs.readFileSync(docAbs, 'utf8').replace(/^\uFEFF/, ''); } catch (_) { doc = ''; }
check('C1-② 隐私政策文档可读', doc.length > 0, DOC_REL);
const lines = doc.split(/\r?\n/);

// —— C3 唯一声明处
const declHits = lines.map((l, i) => ({ l, i })).filter((o) => o.l.includes(DECL_MARK));
check('C3-① 唯一声明处恰 1 处', declHits.length === 1, `命中 ${declHits.length} 处`);
let declNum = -1;
if (declHits.length === 1) {
  const m = /共[^0-9]{0,8}\*{0,2}(\d+)\*{0,2}\s*项/.exec(declHits[0].l);
  if (m) declNum = Number(m[1]);
}
check('C3-② 声明可解析出收集项数（fail-closed）', declNum >= 0, declNum >= 0 ? `声明 ${declNum} 项` : '解析失败');

// —— §二 表格解析（5 列：# / 信息项 / 收集时机 / 用途 / 代码出处）
const secStart = lines.findIndex((l) => /^##\s+二、/.test(l));
const rows = [];
if (secStart >= 0) {
  for (let i = secStart; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^##\s+三、/.test(l)) break;
    const m = /^\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/.exec(l);
    if (m) {
      const src = m[5];
      const toks = (src.match(/`([^`]+)`/g) || []).map((s) => s.replace(/`/g, '').trim());
      rows.push({ line: i + 1, no: Number(m[1]), item: m[2].trim(), src, toks });
    }
  }
}
check('C8-① 表格行解析成功（fail-closed）', rows.length > 0, `${rows.length} 行`);

// —— C4 计数三方一致
check('C4-① 声明数 ≡ 表格行数', declNum === rows.length, `声明 ${declNum} / 表格 ${rows.length}`);
const refLines = [];
files.filter((f) => /\.md$/.test(f) && f.startsWith('specs/')).forEach((f) => {
  let t = '';
  try { t = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { return; }
  t.split(/\r?\n/).forEach((l, i) => {
    if (!l.includes(REF_MARK)) return;
    const m = /\*\*(\d+)\s*项\*\*/.exec(l);
    refLines.push({ f, line: i + 1, num: m ? Number(m[1]) : -1 });
  });
});
check('C8-② 引用行扫描面有效（确有引用行被扫到）', refLines.length >= 1, `${refLines.length} 处`);
const badRef = refLines.filter((r) => r.num !== declNum);
check('C4-② 引用行数字 ≡ 声明数', refLines.length > 0 && badRef.length === 0,
  badRef.map((r) => `${r.f}:${r.line} 写 ${r.num}`).join(' | ') || `${refLines.length} 处引用均为 ${declNum} 项`);

// —— C5 文档→代码：代码出处逐条
const badTok = [];
let fnTok = 0;
rows.forEach((r) => {
  r.toks.forEach((tk) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(tk)) return; // `cloud.getWXContext().OPENID` / `pages/mine` 等非标识符
    if (cfDirs.has(tk) || TOKEN_WHITELIST.has(tk)) { if (cfDirs.has(tk)) fnTok += 1; return; }
    badTok.push(`L${r.line} \`${tk}\``);
  });
});
check('C5 表内每个标识符型「代码出处」≡ 云函数目录 或 ∈ 白名单', badTok.length === 0,
  badTok.join(' | ') || `${fnTok} 个云函数 token + 白名单全部合法`);

// —— 剥注释
function stripComments(t, ext) {
  let s = t;
  if (ext === '.wxml' || ext === '.html') s = s.replace(/<!--[\s\S]*?-->/g, '');
  else if (ext === '.js') {
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    s = s.replace(/(^|\s)\/\/[^\n]*/g, '$1');
  }
  return s;
}

// —— 小程序端隐私 API 命中（排除 tools/ specs/ review/ ⇒ 不自指）
const apiHits = new Map();
MINI.forEach((f) => {
  let t = '';
  try { t = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { return; }
  const ext = path.extname(f);
  const s = stripComments(t, ext);
  PRIV_APIS.forEach((a) => {
    if (new RegExp(`\\b${a}\\b`).test(s)) {
      if (!apiHits.has(a)) apiHits.set(a, []);
      apiHits.get(a).push(f);
    }
  });
});

// —— 「不收集」零命中声明解析（两种显式句式）
const zeroDecl = new Set();
const zeroLines = [];
lines.forEach((l, i) => {
  let m = /无\s*`([A-Za-z]\w*)`\s*调用/g;
  let r;
  while ((r = m.exec(l)) !== null) { zeroDecl.add(r[1]); zeroLines.push(`L${i + 1} ${r[1]}`); }
  if (/均未出现|零命中/.test(l)) {
    (l.match(/`([^`]+)`/g) || []).map((s) => s.replace(/`/g, '').trim()).forEach((tk) => {
      if (PRIV_APIS.includes(tk)) { zeroDecl.add(tk); zeroLines.push(`L${i + 1} ${tk}`); }
    });
  }
});
check(`C8-③ 「不收集」零命中声明 ≥ ${LEAST_ZERO} 条（列错位即零命中假绿）`, zeroDecl.size >= LEAST_ZERO,
  `[${[...zeroDecl].join(', ')}]`);

// —— C7 「不收集」≡ 代码零命中
const zeroViol = [...zeroDecl].filter((a) => apiHits.has(a));
check('C7 「不收集」点名的 API 在小程序端零命中（说"不收集"却真调了 = 谎报）', zeroViol.length === 0,
  zeroViol.map((a) => `${a} 命中于 ${apiHits.get(a).slice(0, 3).join(', ')}`).join(' | ')
  || `${zeroDecl.size} 条零命中声明全部成立`);

// —— C6 代码→文档：命中的隐私 API 必须已登记（表内 或 零命中声明）
const regTok = new Set();
rows.forEach((r) => r.toks.forEach((tk) => regTok.add(tk)));
const unreg = [...apiHits.keys()].filter((a) => !regTok.has(a) && !zeroDecl.has(a));
check('C6 小程序端出现的隐私 API 必须已登记（表内收集 或 显式零命中）', unreg.length === 0,
  unreg.map((a) => `${a} @ ${apiHits.get(a).slice(0, 3).join(', ')}`).join(' | ')
  || `命中 ${apiHits.size} 个（${[...apiHits.keys()].join(', ') || '无'}）均已登记`);

// —— C8 序号连续 + 前提守卫
const nos = rows.map((r) => r.no);
const seqOk = nos.length > 0 && nos.every((n, i) => n === i + 1);
check('C8-④ 序号连续 1..N 且无重号', seqOk, seqOk ? `1..${nos.length}` : `实际 ${nos.join(',')}`);
check(`C8-⑤ 云函数 token 命中 ≥ ${LEAST_FN}（列错位即零命中假绿）`, fnTok >= LEAST_FN, `${fnTok} 个`);
check('C8-⑥ 表格字段无空（信息项 / 代码出处）', rows.length > 0
  && rows.every((r) => r.item && r.src.trim()), rows.filter((r) => !(r.item && r.src.trim())).map((r) => `L${r.line}`).join(', ') || '无空字段');

// —— C9 单源不扩散
const dupDecl = files.filter((f) => /\.md$/.test(f) && f.startsWith('specs/'))
  .filter((f) => f.replace(/\\/g, '/') !== DOC_REL)
  .filter((f) => {
    try { return fs.readFileSync(path.join(ROOT, f), 'utf8').includes(DECL_MARK); } catch (_) { return false; }
  });
check('C9 唯一声明处不扩散（其它 .md 不得再自称本口径单源）', dupDecl.length === 0,
  dupDecl.join(' | ') || `仅 ${DOC_REL} 一处`);

// —— 弱面：只明示，不判红（坑⑭/⑯）
const weak = [];
let weakScan = 0;
files.filter((f) => /\.md$/.test(f) && f.startsWith('specs/') && !/OBSOLETE_/.test(f)).forEach((f) => {
  let txt = '';
  try { txt = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { return; }
  txt.split(/\r?\n/).forEach((l, i) => {
    const m = /(\d{1,3})\s*\*{0,2}\s*(项(?:个人信息|收集|信息)?收集?|个文件)/.exec(l);
    if (!m) return;
    weakScan += 1;
    const v = Number(m[1]);
    if (v !== declNum) weak.push(`${f}:${i + 1} 写 ${v}（声明 ${declNum}） —— ${l.trim().slice(0, 90)}`);
  });
});
check('C8-⑦ 弱面扫描面有效（确有「N 项 / N 个文件」陈述被扫到）', weakScan >= 1, `${weakScan} 处`);
if (weak.length) {
  console.log(`  ⚠️ 弱面（与声明不符，只明示不判红，可能是子集/另一口径/历史快照）${weak.length} 处：`);
  weak.slice(0, 10).forEach((w) => console.log(`     ${w}`));
}

console.log(`\n===== 隐私收集项清单口径守卫结果：${pass} 通过 / ${fails.length} 失败 =====`);
process.exit(fails.length === 0 ? 0 : 1);
