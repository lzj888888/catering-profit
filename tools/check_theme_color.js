// tools/check_theme_color.js —— 主题色 / 主题决策单源守卫（R115 · round86；A5 深色模式退役段 = round86 续批）
//
// 根因（实扫为据，不是推测）：
//   · `app.wxss` 头部第 3~5 行是全仓**唯一的主题色口径声明**：
//       品牌色 墨蓝 #1e3a5f（渐变 #2a4e7c → #162c49）
//       旧橘黄 #ff6b35 **已全量下线**（含 app.json 导航栏与各页内联色）
//   · 但 `tools/` 与 `prototype/` 对该声明**零引用**（grep 实扫）⇒ 长期零守卫。
//   · 2026-09-22 R85 当场复发：`pages/month/input.wxss` 新引入 `background: #ff6b35`（旧橘黄），
//     而**门禁 88/88 全绿** ⇒ 「明令下线 + 零守卫」= 一定复发，只是时间问题。
//
// 判据（三条腿 + 前提护栏 + 正负样本互证）：
//   A1 声明在场：app.wxss 头部须含「旧橘黄」+「已全量下线」+ 主色 #1e3a5f（否则口径单源被删，本守卫失效 ⇒ fail-closed）
//   A2 生效样式零命中：扫全仓 .wxss / .wxml / .json / .js 的**生效部分**（去块注释与 HTML 注释），不得出现旧橘黄
//   A3 扫描面非空 + 下界：被扫文件数 ≥ 30、主色在 app.wxss 出现次数 ≥ 10、EXTS 须为 REQUIRED_EXTS 超集、四类扩展名计数达下界（证明 A2 不是"扫了个空集/被改小所以全绿"）
//   A4 正负样本互证：内置两条样本验证「去注释 + 命中」逻辑本身有效（防"判据恒真/恒假"）
//   A5 深色模式退役（app.wxss 头部第二处「已移除」声明，同款根因：明令退役却零守卫）：
//      声明在场(fail-closed) + page 浅底显式写死 + 全仓零命中 prefers-color-scheme + 正负样本互证。
//      ⚠️ 判据必须锁精确 token `prefers-color-scheme`，**不得**用 `dark` 一词 —— 实测 14 个页面 .json 的
//         `"backgroundTextStyle": "dark"` 是合法的下拉刷新指示器样式，粗判据必大规模误杀（见 PITFALLS §1）。
//
// ⚠️ 扫描面**排除 `tools/`**：本守卫自身必须写出旧橘黄色值才能判它，不排除即自命中（本仓既有惯例）。
// ⚠️ 判据只扫**生效代码**，不扫注释：在注释里说明「勿用旧橘黄」是正当做法，不该被判红。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_WXSS = path.join(ROOT, 'app.wxss');

const OLD_COLOR = ['#ff6', 'b35'].join('');   // 旧橘黄（拼接书写：不写整字面，降低自命中面）
const BRAND = ['#1e3', 'a5f'].join('');       // 品牌墨蓝

const EXTS = ['.wxss', '.wxml', '.json', '.js'];
// 必需扩展名（A3-③ 断言 EXTS 必须仍是本集合的超集 —— 变异 M3 实证：旧写法守不住缩水）
const REQUIRED_EXTS = ['.wxss', '.wxml', '.json', '.js'];
// 每类文件数下界（A3-④，防文件被删/搬走导致扫描面静默缩水；取实测值的保守下界）
const EXT_FLOOR = { '.wxss': 5, '.wxml': 5, '.json': 20, '.js': 20 };
const SKIP_DIRS = ['node_modules', 'miniprogram_npm', '.git', 'tools', 'review', 'prototype', 'specs'];

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

/** 去注释：块注释 / 行注释 / HTML 注释。只做"生效代码"判定用。 */
function stripComments(text, ext) {
  let s = String(text);
  if (ext === '.wxml') {
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  } else if (ext === '.wxss' || ext === '.js') {
    s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  }
  if (ext === '.js') {
    // 行注释（保守：不碰 :// 中的 //）
    s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  }
  return s;
}

/** 递归收集扫描面文件 */
function collect() {
  const out = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.includes(e.name)) continue;
        walk(abs);
      } else if (EXTS.includes(path.extname(e.name).toLowerCase())) {
        out.push(abs);
      }
    }
  };
  walk(ROOT);
  return out;
}

// ===================== A0 扫描面 =====================
section('A0 扫描面（工作树递归，不依赖 git index）');
const FILES = collect();
if (FILES.length > 0) ok('A0-①', '扫描面非空：' + FILES.length + ' 个文件待扫');
else no('A0-①', '扫描面为空 ⇒ 后续判定无意义');

// ===================== A1 声明在场（fail-closed） =====================
section('A1 口径声明在场（app.wxss 头部；不在即本守卫失效）');
if (!fs.existsSync(APP_WXSS)) {
  no('A1-①', 'app.wxss 不存在 ⇒ 主题色口径单源缺失');
} else {
  const app = fs.readFileSync(APP_WXSS, 'utf8');
  const head = app.split('\n').slice(0, 12).join('\n');
  if (head.includes('旧橘黄') && head.includes('已全量下线')) ok('A1-①', '头部声明「旧橘黄已全量下线」在场');
  else no('A1-①', '头部未见「旧橘黄 / 已全量下线」声明 ⇒ 口径单源被改，本守卫前提失效');
  if (head.includes(BRAND)) ok('A1-②', '头部声明品牌墨蓝在场');
  else no('A1-②', '头部未见品牌色 ⇒ 口径单源被改');
}

// ===================== A2 生效样式零命中 =====================
section('A2 生效样式不得出现旧橘黄（去注释后扫全仓）');
const hits = [];
let scanned = 0;
for (const abs of FILES) {
  const ext = path.extname(abs).toLowerCase();
  let raw = '';
  try { raw = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
  scanned++;
  const live = stripComments(raw, ext);
  const re = new RegExp(OLD_COLOR, 'ig');
  let m;
  while ((m = re.exec(live)) !== null) {
    const line = live.slice(0, m.index).split('\n').length;
    hits.push(path.relative(ROOT, abs).replace(/\\/g, '/') + ':' + line);
    if (hits.length > 40) break;
  }
}
if (hits.length === 0) ok('A2-①', '全仓生效样式零命中旧橘黄（' + scanned + ' 个文件）');
else no('A2-①', hits.length + ' 处命中旧橘黄（已下线色值回流）：' + hits.slice(0, 6).join(' , '));

// ===================== A3 前提下界 =====================
section('A3 前提护栏（证明 A2 不是"扫了空集所以全绿"）');
if (scanned >= 30) ok('A3-①', '实扫文件 ' + scanned + ' ≥ 30（扫描面被改小即转红）');
else no('A3-①', '实扫仅 ' + scanned + ' 个文件 < 30 ⇒ 扫描面异常');
if (fs.existsSync(APP_WXSS)) {
  const n = (fs.readFileSync(APP_WXSS, 'utf8').match(new RegExp(BRAND, 'ig')) || []).length;
  if (n >= 10) ok('A3-②', 'app.wxss 品牌色出现 ' + n + ' 次 ≥ 10（下界非空）');
  else no('A3-②', 'app.wxss 品牌色仅 ' + n + ' 次 < 10 ⇒ 扫描面可能失真');
}
const extCount = {};
for (const abs of FILES) {
  const e = path.extname(abs).toLowerCase();
  extCount[e] = (extCount[e] || 0) + 1;
}
// A3-③ EXTS 必须是 REQUIRED_EXTS 的**超集**
//   ⚠️ 根因（变异 M3 实证，本守卫初版即错）：旧写法 `EXTS.filter(e => !extCount[e])` 只检查
//   「EXTS 里每个扩展名都有文件」—— EXTS 一缩，过滤集同步缩 ⇒ **恒真**。
//   把 .wxss 从 EXTS 删掉后仍判绿（假绿），与注释声称的「防改小」完全不符。
const missReq = REQUIRED_EXTS.filter((e) => !EXTS.includes(e));
if (missReq.length === 0) {
  ok('A3-③', 'EXTS 覆盖全部必需扩展名（' + REQUIRED_EXTS.join(' ') + '）');
} else {
  no('A3-③', 'EXTS 缺失必需扩展名 ' + missReq.join(',') + ' ⇒ 该类文件的色值将扫不到（假绿）');
}
// A3-④ 每类扩展名文件数下界
const underFloor = Object.keys(EXT_FLOOR).filter((e) => (extCount[e] || 0) < EXT_FLOOR[e]);
if (underFloor.length === 0) {
  ok('A3-④', '四类扩展名计数均达下界（' + REQUIRED_EXTS.map((e) => e + ':' + (extCount[e] || 0) + '/' + EXT_FLOOR[e]).join(' ') + '）');
} else {
  no('A3-④', '以下扩展名计数低于下界：' + underFloor.map((e) => e + ' ' + (extCount[e] || 0) + '<' + EXT_FLOOR[e]).join(', '));
}

// ===================== A4 正负样本互证 =====================
section('A4 正负样本互证（证明判据本身有效，不是恒真/恒假）');
const posLive = stripComments('/* 勿用旧橘黄 ' + OLD_COLOR + ' */\n.x { color: ' + BRAND + '; }', '.wxss');
const negLive = stripComments('.x { background: ' + OLD_COLOR + '; }', '.wxss');
if (!new RegExp(OLD_COLOR, 'i').test(posLive)) ok('A4-①', '正样本：注释里的旧橘黄被正确忽略（不误报）');
else no('A4-①', '正样本失败：注释里的色值未被忽略 ⇒ 会误报');
if (new RegExp(OLD_COLOR, 'i').test(negLive)) ok('A4-②', '负样本：生效样式里的旧橘黄被抓到（不错漏）');
else no('A4-②', '负样本失败：生效样式里的色值未被抓到 ⇒ 判据恒假，守卫无效');
const wxmlLive = stripComments('<!-- ' + OLD_COLOR + ' -->\n<view class="a">x</view>', '.wxml');
if (!new RegExp(OLD_COLOR, 'i').test(wxmlLive)) ok('A4-③', 'wxml 注释里的色值被正确忽略');
else no('A4-③', 'wxml 注释去不掉 ⇒ 会误报');

// ============ A5 深色模式退役 ============
section('A5 深色模式已移除（明令退役却零守卫 ⇒ 同款根因）');
if (!fs.existsSync(APP_WXSS)) {
  no('A5-①', 'app.wxss 不存在 ⇒ 深色模式退役声明无从校验');
} else {
  const appTxt = fs.readFileSync(APP_WXSS, 'utf8');
  if (appTxt.includes('深色模式：已移除')) ok('A5-①', '头部退役声明「深色模式：已移除」在场');
  else no('A5-①', '头部未见「深色模式：已移除」⇒ 声明被删、本段判据失效（若确要恢复深色，须整份配色 token 化全量适配，并同步删除本段）');
  if (/page\s*\{[^}]*background:\s*#f5f6f8/.test(appTxt)) ok('A5-②', '声明前提成立：page 背景显式写死 #f5f6f8（不随系统切）');
  else no('A5-②', 'page 未显式写死浅底 ⇒ 深色手机可能回落到「黑底黑字」（真机走查缺陷② 复发）');
}
const darkHits = [];
for (const abs of FILES) {
  let raw = '';
  try { raw = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
  const live = stripComments(raw, path.extname(abs).toLowerCase());
  if (/prefers-color-scheme/.test(live)) darkHits.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
}
if (darkHits.length === 0) ok('A5-③', '全仓生效代码零命中 prefers-color-scheme（深色模式未回流）');
else no('A5-③', darkHits.length + ' 个文件的生效代码出现 prefers-color-scheme（深色模式回流）：' + darkHits.slice(0, 5).join(' , '));
const dPos = stripComments('/* 原 @media (prefers-color-scheme: dark) 已移除 */\n.x{color:' + BRAND + ';}', '.wxss');
const dNeg = stripComments('@media (prefers-color-scheme: dark) { .x{color:#000;} }', '.wxss');
if (!/prefers-color-scheme/.test(dPos)) ok('A5-④', '正样本：注释里的 prefers-color-scheme 被忽略（不误报）');
else no('A5-④', '正样本失败：注释里的标记未被忽略 ⇒ 会误报');
if (/prefers-color-scheme/.test(dNeg)) ok('A5-⑤', '负样本：生效的 @media 深色块被抓到（不错漏）');
else no('A5-⑤', '负样本失败：判据恒假，本段无效');

console.log('\n==== 主题色单源守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail === 0 ? 0 : 1);
