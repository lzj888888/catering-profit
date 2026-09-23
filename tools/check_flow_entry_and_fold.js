#!/usr/bin/env node
// tools/check_flow_entry_and_fold.js —— round109 四项真机反馈的机器判据（R125）
//
// 背景（李老师真机一次性报的四件事，都是「代码里明明有路、用户却走不通」）：
//   ① 「一次算清的输入投入有『删掉这一笔』，分期摊销的如果输入错误怎么解决？它没有删除这一笔」
//      —— 后端 saveAsset 早就支持删任意资产（软删 is_deleted），**纯前端把入口写死了**：
//         assetEdit.wxml 的删除键条件是 `kind === 'lump' && mode === 'edit' && !readOnly`
//         ⇒ 摊销资产**永远看不到**这个键，只能走「提前报废」（保留痕迹语义，与"填错了想抹掉"不是一回事）。
//   ② 「整个流程填到摊销属于最后流程，填完理论上需要返回或者可以看整体的经营结果，对吗？
//      现在的情况是填完了不知道做什么了，需要点手机最上面的退回」
//      —— amortize 页是全流程最后一步（月度首页 → 月度录入 → 库存盘点 → 一次性投入 → 看经营结果），
//         底部却只有「+ 新增摊销资产」，**一个出口都没有**。
//   ③ 「外卖那个一直是全部显示全部的状态，可以把外卖也做成折叠吗？」
//      —— 外卖标题行一直有 ▾/▸，但内容块**压根不读 g.expanded**（wx:elif 条件里没这个变量）
//         ⇒ 点了只有符号翻转、内容纹丝不动，是个**假开关**。
//   ④ 「整体流程其实很明朗了，可以从头到尾，把主关键词放大，比如收入一个板块、费用一个板块，
//      或者用什么方式把每一个板块稍微区隔一下，这样看起来清爽明了」
//      —— 一级板块标题（.sec）原本 30rpx/700，与二级标题（.g-label 30rpx/600、.cm-sub 30rpx/600）
//         **同字号、只差 100 字重** ⇒ 扫一屏分不出层级。
//
// 缺口（为什么必须新立守卫，而不是"改完就算"）：97 个套件里**没有任何一条读这四处**——
//   · R122 只验 .js 能否编译；R123 只验 WXML 属性有没有错成文本；R124 只验术语键引用得出来。
//   · 全是「能不能跑起来」级别的判据，**没有一条守「用户能不能走通这条路」**。
//   ⇒ 把这四项的判据固化成常驻断言；任何一条被改回旧写法，门禁当场转红。
//
// 判据分四组（A 删除入口 / B 出口 / C 真折叠 / D 层级区隔）+ 自失效护栏 S。
// ⚠️ 判定一律走**语义/结构解析**（取属性值、取函数体、解析字号数值），不做裸字面 grep ——
//    裸扫「lump」会误杀注释（本仓注释里大量引用旧写法说明根因），那是坑⑭/⑯ 的同族误杀。
// ⚠️ 每个判据都有对应的**变异形态**写在段内注释里，S3 段用**正负样本互证**证明判据本身不是恒真/恒假。
//
// 运行：node tools/check_flow_entry_and_fold.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const F = {
  inputWxml: 'pages/month/input.wxml',
  inputJs: 'pages/month/input.js',
  inputWxss: 'pages/month/input.wxss',
  appWxss: 'app.wxss',
  appJson: 'app.json',
  amortizeWxml: 'pages/month/amortize.wxml',
  amortizeJs: 'pages/month/amortize.js',
  assetEditWxml: 'pages/month/assetEdit.wxml',
  assetEditJs: 'pages/month/assetEdit.js',
  saveAsset: 'cloudfunctions/saveAsset/index.js',
  terms: 'miniprogram/i18n/terms.js',
};

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}

// ===================== 纯解析工具（供判据与正负样本共用）=====================
// 说明：把这些写成**纯函数**（输入字符串 → 输出事实），S3 段才能拿同一份判据去跑
//   「旧写法（应判红）」与「新写法（应判绿）」两个样本 —— 否则证明不了判据不是恒真。

/** 取 `marker` 所在的那个标签整段（从它前面最近的 `<` 到其后第一个 `>`）。 */
function tagAround(src, marker) {
  const at = String(src).indexOf(marker);
  if (at < 0) return null;
  const lt = String(src).lastIndexOf('<', at);
  const gt = String(src).indexOf('>', at);
  if (lt < 0 || gt < 0 || gt < lt) return null;
  return String(src).slice(lt, gt + 1);
}

/** 从一段标签文本里取属性值（支持单/双引号）。 */
function attrOf(tagText, attr) {
  if (!tagText) return null;
  const re = new RegExp(attr.replace(/[-:]/g, (c) => '\\' + c) + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1');
  const m = re.exec(tagText);
  return m ? m[2] : null;
}

/** 取 `name(` 起的方法体（大括号配平；扫描时跳过字符串与注释，避免被模板串里的括号带偏）。
 *  ⚠️ 必须锚在**定义**上（行首缩进 + 可选 async），不能只找 `name(`：
 *     `onLoad` 里有一句 `this.load();`，而它的**定义** `async load() {` 在几百行之后 ——
 *     旧写法（不锚行首）会先命中共用名的**调用**，再往后找第一个 `{`（那是下一个方法 onShow 的）
 *     ⇒ 取到别人的方法体、判据在错的字符串上判定。本轮 C6-② 就是这么误报的（实测）。 */
function bodyOf(src, name) {
  const s = String(src);
  const re = new RegExp('(?:^|\\n)[ \\t]*(?:async\\s+)?' + name.replace(/[^\w$]/g, '') + '\\s*\\(', 'm');
  const m = re.exec(s);
  if (!m) return null;
  const start = s.indexOf('{', m.index + m[0].length - 1);
  if (start < 0) return null;
  let depth = 0, i = start, mode = null;
  for (; i < s.length; i++) {
    const c = s[i], c2 = s[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && c2 === '/') { mode = null; i++; } continue; }
    if (mode) {                                   // 字符串 / 模板串
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
    if (c === '/' && c2 === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && c2 === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/** 取某条 CSS 选择器的声明块（**剥掉注释**后再扫，注释里的示例不算声明）。 */
function cssBlock(src, selector) {
  const live = String(src).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const re = new RegExp('(^|[\\s,}])' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{', 'm');
  const m = re.exec(live);
  if (!m) return null;
  const start = live.indexOf('{', m.index + m[1].length);
  const end = live.indexOf('}', start);
  return end < 0 ? null : live.slice(start + 1, end);
}

/** 从声明块里取字号（rpx 数值）。 */
function fontSizeRpx(decl) {
  if (!decl) return null;
  const m = /font-size\s*:\s*(\d+(?:\.\d+)?)rpx/.exec(decl);
  return m ? Number(m[1]) : null;
}

/** 取某个对象字面量字段的字符串值（如 terms.js 的 `amortDelete: '…'`）。 */
function strField(src, key) {
  const live = String(src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const m = new RegExp('(^|[\\s,{])' + key + '\\s*:\\s*(["\'])([\\s\\S]*?)\\2', 'm').exec(live);
  return m ? m[3] : null;
}

/** 收集 wxml 里全部 `wx:elif="{{…}}"`（按出现顺序），返回 [{idx, cond, tag}]。 */
function elifConds(src) {
  const out = [];
  const s = String(src);
  const re = /<block\b[^>]*wx:elif\s*=\s*"\{\{([\s\S]*?)\}\}"[^>]*>/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ idx: m.index, cond: m[1], tag: m[0] });
  return out;
}

/**
 * 外卖折叠的结构事实（C 组核心判据，纯函数）。
 * 返回：{ hasExpandedBranch, hasSummaryBranch, expandedFirst, summaryRendersFoldRows, summaryUsesAnyFilled }
 * 旧写法（假折叠）的特征：只有「takeaway」无条件分支、没有带 expanded 的分支 ⇒ hasExpandedBranch=false。
 */
function foldFacts(wxml) {
  const els = elifConds(wxml).filter((e) => /takeaway/.test(e.cond));
  const expIdx = els.findIndex((e) => /expanded/.test(e.cond));
  const sumIdx = els.findIndex((e) => !/expanded/.test(e.cond));
  let summarySlice = '';
  if (sumIdx >= 0) {
    const from = els[sumIdx].idx;
    const next = els.slice(sumIdx + 1).find((e) => e.idx > from);
    summarySlice = String(wxml).slice(from, next ? next.idx : from + 3000);
  }
  return {
    branchCount: els.length,
    hasExpandedBranch: expIdx >= 0,
    hasSummaryBranch: sumIdx >= 0,
    expandedFirst: expIdx >= 0 && sumIdx >= 0 && expIdx < sumIdx,
    summaryRendersFoldRows: /takeoutFoldRows/.test(summarySlice),
    summaryUsesAnyFilled: /takeoutAnyFilled/.test(summarySlice),
  };
}

/** 删除键事实（A 组核心判据，纯函数）：条件里是否还写死 kind === 'lump'。 */
function deleteKeyFacts(wxml) {
  const tag = tagAround(wxml, 'bindtap="onDelete"');
  const cond = attrOf(tag, 'wx:if');
  return { found: !!tag, cond, hardCodesLump: !!cond && /lump/.test(cond) };
}

/** 层级事实（D 组核心判据，纯函数）：一级标题字号 vs 二级标题字号。 */
function tierFacts(inputWxss, appWxss) {
  const sec = fontSizeRpx(cssBlock(inputWxss, '.sec'));
  const gLabel = fontSizeRpx(cssBlock(inputWxss, '.g-label'));
  const cmSub = fontSizeRpx(cssBlock(appWxss, '.cm-sub'));
  return { sec, gLabel, cmSub };
}

// ===================== A 摊销资产的删除入口 =====================
section('A 摊销资产必须有删除入口（前端放开 + 文案分流 + 后端归档锁）');
const assetWxml = read(F.assetEditWxml);
const assetJs = read(F.assetEditJs);
const termsSrc = read(F.terms);
const saveAssetSrc = read(F.saveAsset);

// A1 前端：删除键条件不得再写死 kind === 'lump'
//   变异形态：把 `wx:if="{{mode === 'edit' && !readOnly}}"` 改回 `{{kind === 'lump' && …}}` ⇒ 转红。
if (!assetWxml) no('A1-①', '读取 ' + F.assetEditWxml + ' 失败');
else {
  const dk = deleteKeyFacts(assetWxml);
  if (!dk.found) no('A1-①', '找不到 bindtap="onDelete" 的按钮 ⇒ 删除入口整体缺失');
  else if (!dk.cond) no('A1-①', '删除按钮没有 wx:if 条件（无法判它是否对两类资产都开）');
  else if (dk.hardCodesLump) no('A1-①', '删除键条件仍写死 lump（摊销资产永远看不到删除入口）：wx:if="' + dk.cond + '"');
  else ok('A1-①', '删除键对两类资产都开（条件不含 lump）：wx:if="' + dk.cond + '"');
}

// A2 删除确认文案按 kind 分流（摊销删掉影响「从起摊月起的各月」，与一次算清的当月不同）
//   变异形态：删掉 onLoad 里任一条 `'t.fDelete': …` 路径赋值 ⇒ 转红（按钮会退回旧文案/空白）。
if (!assetJs) no('A2-①', '读取 ' + F.assetEditJs + ' 失败');
else {
  const onLoad = bodyOf(assetJs, 'onLoad');
  const hasF = !!onLoad && /['"]t\.fDelete['"]\s*:/.test(onLoad);
  const hasC = !!onLoad && /['"]t\.confirmDelete['"]\s*:/.test(onLoad);
  if (hasF && hasC) ok('A2-①', 'onLoad 按 kind 分流 t.fDelete / t.confirmDelete');
  else no('A2-①', 'onLoad 缺文案分流（t.fDelete=' + hasF + ' / t.confirmDelete=' + hasC +
    '）⇒ 摊销进编辑页会显示一次算清的旧文案或用 undefined');
}

// A3 onDelete 真的用上了分流后的文案，且不再有「仅 lump」早退
//   变异形态：把 `if (this.data.mode !== 'edit') return;` 改回 `… || this.data.kind !== 'lump'` ⇒ 转红。
if (assetJs) {
  const del = bodyOf(assetJs, 'onDelete');
  if (!del) no('A3-①', '解析不到 onDelete 方法体');
  else if (/kind\s*!==\s*['"]lump['"]/.test(del)) no('A3-①', 'onDelete 仍有「非 lump 直接 return」的早退 ⇒ 摊销删不掉');
  else if (!/this\.data\.t\.(fDelete|confirmDelete)/.test(del)) no('A3-①', 'onDelete 未使用分流文案（this.data.t.fDelete / confirmDelete）');
  else ok('A3-①', 'onDelete 无 lump 早退，且使用分流文案');
}

// A4 术语单源里两套文案都存在且**确实不同**（共用文案会让人以为摊销删掉也只影响一个月）
//   变异形态：把 amortDelete 改成与 lumpDelete 同值 ⇒ 转红。
if (!termsSrc) no('A4-①', '读取 terms.js 失败');
else {
  const al = strField(termsSrc, 'amortDelete');
  const ll = strField(termsSrc, 'lumpDelete');
  const ac = strField(termsSrc, 'confirmDeleteAmort');
  const lc = strField(termsSrc, 'confirmDeleteLump');
  if (!al || !ac) no('A4-①', '术语单源缺 amortDelete / confirmDeleteAmort');
  else if (!ll || !lc) no('A4-①', '术语单源缺 lumpDelete / confirmDeleteLump（对照项不见了）');
  else if (al === ll || ac === lc) no('A4-①', '两类资产的删除文案相同 ⇒ 后果不同却用同一句话（分摊影响各月、一次算清只影响当月）');
  else ok('A4-①', '两套删除文案都在且互不相同（amort≠lump）');
}

// A5 后端：摊销资产的删除必须过**跨月**归档锁（否则「账已封」仍能从台账把钱挪走）
//   变异形态：删掉 index.js 里的 else 分支调用（只留 lump 那把锁）⇒ 出现次数 2→1 ⇒ 转红。
if (!saveAssetSrc) no('A5-①', '读取 ' + F.saveAsset + ' 失败');
else {
  const defs = (saveAssetSrc.match(/async\s+function\s+amortArchiveLocked/g) || []).length;
  const calls = (saveAssetSrc.match(/amortArchiveLocked\s*\(/g) || []).length;
  if (defs !== 1) no('A5-①', 'amortArchiveLocked 定义数 = ' + defs + '（须恰为 1）');
  else if (calls < 2) no('A5-①', 'amortArchiveLocked 只出现 ' + calls + ' 次（定义+调用须 ≥2）⇒ 摊销删除未过归档锁');
  else ok('A5-①', '摊销删除有跨月归档锁（定义 1 处 + 调用 ≥1 处）');
}

// ===================== B 摊销页的收尾出口 =====================
section('B 摊销页必须有明确出口（看结果 / 回首页），且跳转目标真实存在');
const amorWxml = read(F.amortizeWxml);
const amorJs = read(F.amortizeJs);
const appJson = read(F.appJson);

// B1 wxml 侧两个入口都在
if (!amorWxml) no('B1-①', '读取 ' + F.amortizeWxml + ' 失败');
else {
  const r = /bindtap="goResult"/.test(amorWxml);
  const h = /bindtap="goHome"/.test(amorWxml);
  if (r && h) ok('B1-①', 'wxml 含 goResult（看结果）与 goHome（回首页）两个出口');
  else no('B1-①', 'wxml 缺出口按钮（goResult=' + r + ' / goHome=' + h + '）⇒ 填完仍只能按手机顶部返回键一层层退');
}

// B2 js 侧两个处理函数都在，且 goResult 指向结果页
//   变异形态：把 goResult 的目标改成不存在的页 ⇒ B3 转红；把 goResult 整个删掉 ⇒ B2 转红。
if (!amorJs) no('B2-①', '读取 ' + F.amortizeJs + ' 失败');
else {
  const gr = bodyOf(amorJs, 'goResult');
  const gh = bodyOf(amorJs, 'goHome');
  if (!gr) no('B2-①', 'amortize.js 未定义 goResult');
  else if (!/\/pages\/month\/result/.test(gr)) no('B2-①', 'goResult 未跳向 /pages/month/result');
  else if (!gh) no('B2-②', 'amortize.js 未定义 goHome');
  else if (!/navigateBack/.test(gh) || !/redirectTo/.test(gh)) no('B2-②', 'goHome 缺兜底（须 navigateBack + redirectTo 双路，防本页是栈底时返回失败）');
  else ok('B2-①', 'goResult → /pages/month/result；goHome 有 navigateBack + redirectTo 兜底');
}

// B3 跳转目标必须是 app.json 里真实存在的页面（防"点了没反应" —— 真机上跳不存在的页只报错不提示）
//   ⚠️ 判据是「**从出口函数体里解析出的 URL**」而不是"写死一份该在的清单"：
//      初版写死 `need = ['/pages/month/result', …]`，做变异 M7（把 goResult 改成 /pages/month/results）
//      时**照样判绿** —— 因为清单跟函数体没关系，等于断言了一个常量。改成"解析 URL ⇒ 反查 app.json"
//      之后，改目标页立刻转红（本轮变异 M7 实证）。
if (!appJson) no('B3-①', '读取 ' + F.appJson + ' 失败');
else {
  let pages = [];
  try { pages = (JSON.parse(appJson).pages || []).map((p) => '/' + String(p).replace(/^\//, '')); }
  catch (e) { pages = []; }
  const bodies = [bodyOf(amorJs || '', 'goResult'), bodyOf(amorJs || '', 'goHome')]
    .filter(Boolean).join('\n');
  const urls = Array.from(new Set(bodies.match(/\/pages\/[A-Za-z0-9_\-/]+/g) || []));
  if (!pages.length) no('B3-①', 'app.json::pages 解析为空 ⇒ fail-closed');
  else if (!urls.length) no('B3-①', '两个出口的函数体里解析不到 /pages/… 目标 ⇒ 本判据会在空集上判定');
  else {
    const miss = urls.filter((u) => !pages.includes(u));
    if (miss.length === 0) ok('B3-①', '出口解析出的 ' + urls.length + ' 个跳转目标均已在 app.json::pages 注册（' + urls.join(' , ') + '）');
    else no('B3-①', '出口指向未注册页面：' + miss.join(', ') + ' ⇒ 真机点击无效');
  }
}

// ===================== C 外卖分组必须是「真折叠」 =====================
section('C 外卖分组真折叠（内容块读 expanded + 折叠态有摘要 + 摘要与合计同源同模式）');
const inputWxml = read(F.inputWxml);
const inputJs = read(F.inputJs);

// C1 内容块必须读 g.expanded（假折叠的根因就是这里没读）
if (!inputWxml) no('C1-①', '读取 ' + F.inputWxml + ' 失败');
else {
  const ff = foldFacts(inputWxml);
  if (!ff.hasExpandedBranch) no('C1-①', '外卖内容块不读 g.expanded ⇒ 假折叠（点标题只翻符号、内容不动）');
  else ok('C1-①', '外卖内容块的 wx:elif 条件含 takeaway && g.expanded（真折叠）');
}

// C2 折叠态要有只读摘要分支，且**排在展开分支之后**（wx:elif 按顺序匹配，顺序反了就永远走摘要）
//   变异形态：两个分支调换顺序 ⇒ expandedFirst=false ⇒ 转红。
if (inputWxml) {
  const ff = foldFacts(inputWxml);
  if (!ff.hasSummaryBranch) no('C2-①', '没有折叠态摘要分支 ⇒ 折叠后成一片空白，人不知道填没填');
  else if (!ff.expandedFirst) no('C2-①', '折叠态分支排在展开分支之前 ⇒ wx:elif 先匹配摘要，展开态永远打不开');
  else ok('C2-①', '两态分支都在且展开态在前（摘要分支共 ' + ff.branchCount + ' 个 takeaway 分支）');
}

// C3 摘要渲染的必须是 js 预计算的 takeoutFoldRows（**不能**直接渲染 g.rows）
//   为什么：两种模式的金额不在同一处（快速=groups.rows；分项=takeoutDetailRows），
//   g.rows 在分项模式下是切模式时的旧值 ⇒ 折叠起来显示过期数字（口径串味）。
if (inputWxml) {
  const ff = foldFacts(inputWxml);
  if (ff.summaryRendersFoldRows && ff.summaryUsesAnyFilled) ok('C3-①', '折叠态摘要取 takeoutFoldRows + takeoutAnyFilled（空态占位判据在场）');
  else no('C3-①', '折叠态摘要未取预计算字段（takeoutFoldRows=' + ff.summaryRendersFoldRows +
    ' / takeoutAnyFilled=' + ff.summaryUsesAnyFilled + '）⇒ 分项模式下会显示过期数字');
}

// C4 js：syncTakeoutFold 必须定义、且被 syncTakeoutSum 调用（金额一变摘要就要跟着变）
//   变异形态：把 syncTakeoutFold() 调用从 syncTakeoutSum 体里删掉 ⇒ 转红。
if (!inputJs) no('C4-①', '读取 ' + F.inputJs + ' 失败');
else {
  const foldDef = bodyOf(inputJs, 'syncTakeoutFold');
  const sumBody = bodyOf(inputJs, 'syncTakeoutSum');
  if (!foldDef) no('C4-①', 'input.js 未定义 syncTakeoutFold');
  else if (!sumBody || !/syncTakeoutFold\s*\(\s*\)/.test(sumBody)) no('C4-①', 'syncTakeoutSum 未调用 syncTakeoutFold ⇒ 填完金额摘要不更新');
  else ok('C4-①', 'syncTakeoutFold 已定义且在 syncTakeoutSum 内被调用');
}

// C5 摘要的取数必须**按模式分流**（含分项模式的 takeoutDetailRows 分支）
//   变异形态：把 src 里分项那一支删掉（只留 groups.rows）⇒ 转红。
if (inputJs) {
  const foldDef = bodyOf(inputJs, 'syncTakeoutFold');
  if (!foldDef) no('C5-①', 'syncTakeoutFold 方法体解析失败');
  else if (!/takeoutDetailRows/.test(foldDef)) no('C5-①', 'syncTakeoutFold 只读 groups.rows，未按分项模式取 takeoutDetailRows');
  else ok('C5-①', 'syncTakeoutFold 按两种模式分流取数（快速 groups.rows / 分项 takeoutDetailRows）');
}

// C6 折叠状态要记住，且**默认必须是折叠**（李老师诉求就是"别老是全摊开"）
//   变异形态①：删掉 onToggleGroup 里的 saveTakeoutFold 调用 ⇒ 转红；
//   变异形态②：把 loadTakeoutFold 的兜底改成 `return true` ⇒ 转红（回到"每次都全摊开"）。
if (inputJs) {
  const hasKey = /const\s+TAKEOUT_FOLD_KEY\s*=/.test(inputJs);
  const saveDef = bodyOf(inputJs, 'saveTakeoutFold');
  const loadDef = bodyOf(inputJs, 'loadTakeoutFold');
  const applyDef = bodyOf(inputJs, 'applyTakeoutFold');
  const toggleBody = bodyOf(inputJs, 'onToggleGroup');
  const loadBody = bodyOf(inputJs, 'load');
  const miss = [];
  if (!hasKey) miss.push('TAKEOUT_FOLD_KEY 常量');
  if (!saveDef) miss.push('saveTakeoutFold');
  if (!loadDef) miss.push('loadTakeoutFold');
  if (!applyDef) miss.push('applyTakeoutFold');
  if (miss.length) no('C6-①', '折叠记忆缺件：' + miss.join(', '));
  else if (!toggleBody || !/saveTakeoutFold\s*\(/.test(toggleBody)) no('C6-①', 'onToggleGroup 未持久化外卖折叠状态 ⇒ 下次进来又变');
  else if (!loadBody || !/applyTakeoutFold\s*\(/.test(loadBody)) no('C6-②', 'load() 未应用折叠记忆（applyTakeoutFold 未被调用）');
  else if (!/return\s+false/.test(loadDef)) no('C6-③', 'loadTakeoutFold 的兜底不是 false ⇒ 首次进入/清缓存后又全摊开（与诉求相反）');
  else ok('C6-①', '折叠状态有记忆键、onToggleGroup 会存、load 会应用，且读不到时默认**折叠**');
}

// ===================== D 板块一级区隔 =====================
section('D 板块一级区隔（一级标题字号必须与二级标题拉开量级，且有竖条断点）');
const inputWxss = read(F.inputWxss);
const appWxss = read(F.appWxss);

// D1 一级 > 二级（**语义级判据**：不是断言某个具体数字，而是断言"层级真的分开了"）
//   变异形态：把 .sec 改回 30rpx ⇒ 与 .g-label/.cm-sub 相等 ⇒ 转红。
if (!inputWxss || !appWxss) no('D1-①', '读取 wxss 失败');
else {
  const tf = tierFacts(inputWxss, appWxss);
  const missing = [];
  if (tf.sec === null) missing.push('.sec');
  if (tf.gLabel === null) missing.push('.g-label');
  if (tf.cmSub === null) missing.push('.cm-sub');
  if (missing.length) no('D1-①', '字号解析失败：' + missing.join(', ') + '（选择器被改名 ⇒ fail-closed）');
  else if (tf.sec >= 40 && tf.sec > tf.gLabel && tf.sec > tf.cmSub) {
    ok('D1-①', '一级 .sec ' + tf.sec + 'rpx > 二级 .g-label ' + tf.gLabel + 'rpx / .cm-sub ' + tf.cmSub + 'rpx，且 ≥40rpx');
  } else {
    no('D1-①', '层级没拉开：.sec ' + tf.sec + 'rpx vs .g-label ' + tf.gLabel + 'rpx / .cm-sub ' + tf.cmSub +
      'rpx（须 .sec ≥40 且严格大于二者）');
  }
}

// D2 左侧渐变竖条在场（区隔的第二条腿：不靠颜色单打独斗）
//   变异形态：删掉 .sec::before 块 ⇒ 转红。
if (inputWxss) {
  const before = cssBlock(inputWxss, '.sec::before');
  if (!before) no('D2-①', '.sec::before 不存在 ⇒ 板块没有竖向断点');
  else if (!/linear-gradient/.test(before)) no('D2-①', '.sec::before 不是渐变（须用渐变竖条做区隔）');
  else ok('D2-①', '.sec::before 渐变竖条在场');
}

// D3 区隔不得靠"引入编号"实现 —— 本页「核算方式」段内已用 ① 食材消耗 / ② 一次性投入，
//    两处编号会打架（这是拍板时明确排除的方案）。判据：.sec 的声明块内不得出现圈码字符。
//    变异形态：把 .sec 文案改成「① 收入」这类 ⇒ 转红（防日后有人图省事加编号）。
if (inputWxml && inputWxss) {
  const secDecl = cssBlock(inputWxss, '.sec');
  const circled = /[\u2460-\u2473\u3251-\u32BF]/;
  const inSecDecl = !!secDecl && circled.test(secDecl);
  if (inSecDecl) no('D3-①', '.sec 声明块里出现圈码字符 ⇒ 与段内已有的 ①② 编号打架');
  else ok('D3-①', '未用圈码编号做区隔（避开与「核算机制」段内 ①② 的冲突）');
}

// ===================== S 自失效护栏 =====================
section('S 自失效护栏（证明上面这些判据不是恒真/恒假）');

// S1 前提：11 个锚点文件全部可读（少一个 ⇒ 该组判据整组静默失明）
const anchors = Object.keys(F).map((k) => F[k]);
const unreadable = anchors.filter((rel) => read(rel) === null);
if (unreadable.length === 0) ok('S1-①', '锚点文件 ' + anchors.length + ' 个全部可读（扫描面非空）');
else no('S1-①', '锚点文件不可读 ' + unreadable.length + ' 个：' + unreadable.join(', '));

// S2 正负样本互证 —— 用**同一份判据函数**跑「旧写法」与「新写法」两个合成样本：
//    旧写法必须判红、新写法必须判绿，否则说明判据恒真/恒假（R115 A4 同款做法）。
const OLD_DELETE = '<button class="btn ghost" wx:if="{{kind === \'lump\' && mode === \'edit\' && !readOnly}}" bindtap="onDelete">{{t.fDelete}}</button>';
const NEW_DELETE = '<button class="btn ghost" wx:if="{{mode === \'edit\' && !readOnly}}" bindtap="onDelete">{{t.fDelete}}</button>';
const dOld = deleteKeyFacts(OLD_DELETE);
const dNew = deleteKeyFacts(NEW_DELETE);
if (dOld.hardCodesLump === true && dNew.hardCodesLump === false) ok('S2-①', '删除键判据：旧写法（写死 lump）判红、新写法判绿');
else no('S2-①', '删除键判据恒真/恒假：旧=' + JSON.stringify(dOld) + ' 新=' + JSON.stringify(dNew));

const OLD_FOLD = '<block wx:elif="{{g.category === \'takeaway\'}}"><view class="dm-wrap">x</view></block>';
const NEW_FOLD = '<block wx:elif="{{g.category === \'takeaway\' && g.expanded}}"><view class="dm-wrap">x</view></block>'
  + '<block wx:elif="{{g.category === \'takeaway\'}}"><view class="tw-fold" wx:for="{{takeoutFoldRows}}">{{item.name}}</view>'
  + '<view wx:if="{{!takeoutAnyFilled}}">还没填</view></block>';
const fOld = foldFacts(OLD_FOLD);
const fNew = foldFacts(NEW_FOLD);
if (fOld.hasExpandedBranch === false && fNew.hasExpandedBranch === true
  && fNew.expandedFirst === true && fNew.summaryRendersFoldRows === true) {
  ok('S2-②', '折叠判据：旧写法（内容块不读 expanded）判红、新写法（两态分支 + 摘要）判绿');
} else {
  no('S2-②', '折叠判据恒真/恒假：旧=' + JSON.stringify(fOld) + ' 新=' + JSON.stringify(fNew));
}

// 顺序反了必须判红（wx:elif 按顺序匹配）—— 这是 C2 的负样本
const REV_FOLD = '<block wx:elif="{{g.category === \'takeaway\'}}"><view class="tw-fold"></view></block>'
  + '<block wx:elif="{{g.category === \'takeaway\' && g.expanded}}"><view class="dm-wrap"></view></block>';
if (foldFacts(REV_FOLD).expandedFirst === false) ok('S2-③', '折叠判据：两分支顺序反了判红（摘要分支抢在展开分支前）');
else no('S2-③', '顺序判据恒真 ⇒ 顺序反了仍判绿');

// 层级判据的负样本：一级与二级同字号必须判红
const SAME_TIER = '.sec { font-size: 30rpx; }\n.g-label { font-size: 30rpx; }';
const BIG_TIER = '.sec { font-size: 40rpx; }\n.g-label { font-size: 30rpx; }';
const tSame = tierFacts(SAME_TIER, '.cm-sub { font-size: 30rpx; }');
const tBig = tierFacts(BIG_TIER, '.cm-sub { font-size: 30rpx; }');
const sameBad = !(tSame.sec >= 40 && tSame.sec > tSame.gLabel && tSame.sec > tSame.cmSub);
const bigGood = tBig.sec >= 40 && tBig.sec > tBig.gLabel && tBig.sec > tBig.cmSub;
if (sameBad && bigGood) ok('S2-④', '层级判据：同字号（30/30）判红、拉开（40/30）判绿');
else no('S2-④', '层级判据恒真/恒假：同=' + JSON.stringify(tSame) + ' 大=' + JSON.stringify(tBig));

// S3 前提：正负样本解析出的选择器真的命中（防 cssBlock 被人改坏后 A4/S2 全部空转）
if (tSame.sec !== null && tSame.gLabel !== null && tSame.cmSub !== null) ok('S3-①', 'cssBlock 解析有效（合成样本三处字号均解析得出）');
else no('S3-①', 'cssBlock 解析失效 ⇒ 层级判据与正负样本一起空转');

// S2-⑤ bodyOf 必须锚「定义」而不是「调用」——本轮 C6-② 的真实误报就是栽在这里：
//   合成样本刻意把**调用**（this.load()）放在**定义**（async load() {…}）之前；
//   若 bodyOf 不锚行首，它会取到调用后面那个 `{`（= 下一个方法）的方法体 ⇒ 取不到 MARK。
const CALL_BEFORE_DEF = 'function x() { this.load(); }\n\n  async load() { const MARK = 1; }';
const cbd = bodyOf(CALL_BEFORE_DEF, 'load');
if (cbd && /MARK/.test(cbd)) ok('S2-⑤', 'bodyOf 锚定义不锚调用（调用在前、定义在后时仍取到定义体）');
else no('S2-⑤', 'bodyOf 取错了方法体（调用与定义同名时取到调用后的那块）⇒ 判据会在错的字符串上判定');

// S4 前提：elifConds 真的在扫 —— 真实 wxml 里必须扫出多个 takeaway 分支
if (inputWxml && foldFacts(inputWxml).branchCount >= 2) ok('S4-①', '真实 input.wxml 扫出 ' + foldFacts(inputWxml).branchCount + ' 个 takeaway 分支（elifConds 有效）');
else no('S4-①', '真实 input.wxml 未扫到 2 个 takeaway 分支 ⇒ 折叠判据在空集上判定');

// S5 断言条数下界（本守卫自带 21 条；被改小即转红）
const TOTAL = pass + fail;
if (TOTAL >= 20) ok('S5-①', '本轮断言 ' + TOTAL + ' 条 ≥ 20（判据集合被改小即转红）');
else no('S5-①', '断言仅 ' + TOTAL + ' 条 < 20 ⇒ 判据集合疑似被削');

console.log(`\n===== 流程出口与折叠守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
