// tools/check_list_ux.js —— R156：列表排序/置顶 · 原料选择 · 连续录入 守卫
//
// 事故模型（本轮要防的**形态缺陷**，每条都有真实的"静默失效"路径）：
//
// ① 「看着乱」：列表返回序 = 数据库自然序。改完一道菜回到列表，它仍停在原位 ——
//    老板找不到刚改的东西。修法 = 排序（置顶优先 + 最近编辑在前）。
//    ⚠️ 排序键 `updated_at` 必须**由云函数出参带出来**（原料列表此前一个时间字段都没有）
//      ⇒ 只改前端排序＝排序键恒为 undefined ⇒ 静默退化成自然序（看着像"改了没用"）。
//
// ② 🔴 **连续录入最危险的一条**：保存成功后留在本页时，若**不清 `id` / `card_code`**，
//    第二道菜/第二个原料会被当成「编辑第一道」⇒ **第一道的内容被静默覆盖**。
//    这是**数据正确性**缺陷，不是手感问题 ⇒ 单独成组守。
//
// ③ 原料选择回退：原生 `<picker mode="selector" range="{{materials}}">` 在 100 个原料时
//    只能靠手指滚、无搜索无分组。一旦有人"顺手简化"回 picker，用户的痛点原样复发。
//
// ④ WXML 表达式**不支持方法调用**：`{{pinned.indexOf(item.card_code) >= 0}}` 恒为 false
//    ⇒ 置顶标记永不显示（且不报错）⇒ 只能"预先在 JS 里打标记"。
//
// 判据（纯函数化 + 正负互证 + 反查真实单源）：
//   L1 排序在位：两个列表页都有 sortList，且同时用置顶与 updated_at；applyFilter 真的调用它
//   L2 排序键出参：getCostCard / getCardVersions / getMaterial 三处出参带 updated_at 且 fail-soft 退回 created_at
//   L3 置顶落点：saveShopSetting 校验+写库、getShopContext 下发；且**不得新建集合**（复用 shop 文档）
//   L4 原料选择：模板不再走原生 picker；改走独立页且该页四件套齐全、已注册、有搜索与分组
//   L5 连续录入：保存后按 isEdit 分支；afterSaved 必须清 id / card_code；有显式返回出口
//   L6 WXML 安全：三个列表相关模板的 {{}} 内不得出现方法调用
//   S1~S3 自失效护栏（扫描面文件数 / 空输入 fail-closed / 命中数下界）
//   C1~C6 反恒真：喂坏样本必红、喂等价改写必绿
//
// ⚠️ 输出纪律（R145 教训）：中间行不得出现「N 通过 / M 失败」字样，
//   否则 check_suite_assert_counts 会把第一条中间文案当成套件总口径。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass++; };
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; }
}

// 🔴 取「某个**具名函数**的函数体」—— 必须按**定义形态**匹配（`name(...) {`）。
//   ⚠️ 绝不能用 `src.indexOf(name)` ！那会命中**调用处**（如 `this.afterSaved(x)`、
//   `this.applyFilter()`），再从调用处往后找 `{` 会拿到毫不相干的块 ⇒ 判据读到错的体。
//   本守卫首跑实测：L1-③ / L5-③ / L5-④ 三条**全部因此假红**（行为完全正确却被判红）
//   —— 这是"按字面定位"的老毛病（R155 记的守卫反向伤害第二型），不是被测代码的缺陷。
//   排除前缀 `.` / `$` / 标识符字符 ⇒ `this.sortList(` 这类调用不会误命中定义。
function fnBodyOf(src, name) {
  if (!src) return null;
  const re = new RegExp('(^|[^A-Za-z0-9_$.])' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  const at = m.index + m[0].length - 1;      // 指向定义体的 '{'
  let depth = 0;
  for (let j = at; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  return null;
}

const EMPTY_Q = String.fromCharCode(39) + String.fromCharCode(39);   // 空字符串字面量（单引号形态）

// ===================== 判据（纯函数，可被反恒真样本直接调用） =====================

// 判据 L1：列表页是否真的按「置顶 + 最近编辑」排序。
//   ⚠️ 只认**行为**（体里同时出现置顶标识与 updated_at），不认排版、不认变量取名
//     —— 实现里用 `pins` 还是 `this.data.pinned` 都算数（R155 教训：判行为不判字面）。
function judgeSortList(src, rankKey) {
  if (!src) return { ok: false, why: '取不到页面源码（fail-closed）' };
  const body = fnBodyOf(src, 'sortList');
  if (!body) return { ok: false, why: '没有 sortList ⇒ 列表按数据库自然序展示（改完的菜仍停在原位，看着就是乱的）' };
  if (!/\bpins\b|\bpinned\b/.test(body)) return { ok: false, why: 'sortList 没考虑置顶 ⇒ 置顶点了也排不到最前' };
  if (!/updated_at/.test(body)) return { ok: false, why: 'sortList 没用 updated_at ⇒ 没有「最近编辑在前」' };
  if (!body.includes(rankKey)) return { ok: false, why: 'sortList 的排序键不是 ' + rankKey + '（键写错 = 所有项同 rank，置顶失效）' };
  return { ok: true, why: 'sortList 同时按置顶与 updated_at 排序（键=' + rankKey + '）' };
}

// 判据 L1b：applyFilter 是否真的把结果喂给 sortList（写了不用 = 白写）。
function judgeFilterCallsSort(src) {
  if (!src) return { ok: false, why: '取不到页面源码（fail-closed）' };
  const body = fnBodyOf(src, 'applyFilter');
  if (!body) return { ok: false, why: '没有 applyFilter（页面结构变了？）' };
  if (!/sortList\s*\(/.test(body)) return { ok: false, why: 'applyFilter 没用 sortList ⇒ 排序写了不生效' };
  return { ok: true, why: 'applyFilter 把结果交给 sortList' };
}

// 判据 L2：云函数出参是否带排序键，且**存量数据**（无 updated_at）能退回。
//   ⚠️ fail-soft 是必须的：存量卡/原料没有 updated_at ⇒ 不退回就会全为 0，
//     排序退化成"全相等"，看起来就像没排。
function judgeOutUpdatedAt(src) {
  if (!src) return { ok: false, why: '取不到 service.js（fail-closed）' };
  const m = /updated_at\s*:\s*doc\.updated_at/.exec(src);
  if (!m) return { ok: false, why: '出参没有 updated_at ⇒ 前端排序键恒为 undefined，静默退化成自然序' };
  const nl = src.indexOf('\n', m.index);
  const line = src.slice(m.index, nl < 0 ? src.length : nl);
  if (!/created_at/.test(line)) return { ok: false, why: 'updated_at 没退回 created_at ⇒ 存量数据（无该字段）排序全为 0' };
  if (!/:\s*0/.test(line)) return { ok: false, why: 'updated_at 最终兜底值缺失（两字段都没有时须给确定值）' };
  return { ok: true, why: '出参带 updated_at，且 fail-soft 退回 created_at → 0' };
}

// 判据 L3：置顶必须落在**既有** shop 文档上（M3 v1.1 红线：零新建集合）。
function judgePinPersist(validateSrc, indexSrc, ctxSrc) {
  const probs = [];
  // ⚠️ 判「**真的在校验**」而不是「字符串出现过」：裸 includes 会被改名/残留字符串绕过
  //   （技能 §10.5：`plan_free` 被 `plan_freeX` 含住即假绿）⇒ 这里锚的是校验器调用形态。
  if (!validateSrc || !/normPinList\(src\.pinned_cards/.test(validateSrc) || !/normPinList\(src\.pinned_materials/.test(validateSrc)) {
    probs.push('saveShopSetting/validate.js 未真正校验两个置顶键（须走 normPinList）');
  }
  if (!indexSrc || !/patch\.pinned_cards\s*=/.test(indexSrc) || !/patch\.pinned_materials\s*=/.test(indexSrc)) {
    probs.push('saveShopSetting/index.js 未把置顶写入 patch');
  }
  if (!ctxSrc || !/pinned_cards/.test(ctxSrc) || !/pinned_materials/.test(ctxSrc)) {
    probs.push('getShopContext/index.js 未下发置顶（列表页读不到）');
  }
  if (probs.length) return { ok: false, why: probs.join('；') };
  return { ok: true, why: '置顶校验/写库/下发三处齐备（落在既有 shop 文档）' };
}

// 判据 L3b：置顶不得靠新建集合实现（集合单源里不得冒出 pin 系列集合）。
function judgeNoPinCollection(collectionsSrc) {
  if (!collectionsSrc) return { ok: false, why: '取不到 initDb/collections.js（fail-closed）' };
  const hit = collectionsSrc.match(/['"][a-z_]*pin[a-z_]*['"]/i);
  if (hit) return { ok: false, why: '集合单源里出现置顶相关集合 ' + hit[0] + ' ⇒ 违反 M3 v1.1「零新建集合」红线' };
  return { ok: true, why: '集合单源里无置顶新集合（复用 shop 文档）' };
}

// 判据 L4：原料选择不得回退到原生 picker。
function judgeMaterialPicker(wxml) {
  if (!wxml) return { ok: false, why: '取不到 card/edit.wxml（fail-closed）' };
  if (/range="\{\{materials\}\}"/.test(wxml) || /range-key="name"/.test(wxml)) {
    return { ok: false, why: '原料仍走原生 picker（range=materials）⇒ 100 项只能滚，搜索/分组全失效' };
  }
  if (!/goPickMaterial/.test(wxml)) {
    return { ok: false, why: '模板里没有 goPickMaterial 入口 ⇒ 原料根本选不了' };
  }
  return { ok: true, why: '原料走独立选择页（模板已无原生 materials picker）' };
}

// 判据 L6：WXML 表达式不支持方法调用 ⇒ 标记必须在 JS 里预先打好。
function judgeWxmlNoMethodCall(wxml) {
  if (!wxml) return { ok: false, why: '取不到模板（fail-closed）' };
  const m = /\{\{[^}]*\.\s*(indexOf|includes|split|trim|filter|map|find|toFixed)\s*\(/.exec(wxml);
  if (m) return { ok: false, why: 'WXML 表达式里调用了方法（模板不支持，恒为 undefined ⇒ 静默失效）' };
  return { ok: true, why: '模板 {{}} 内无方法调用（标记由 JS 预先打好）' };
}

// 判据 L5a：保存后必须按 isEdit 分支 —— 编辑=回列表 / 新增=连续录入。
//   不分支的后果：编辑一道菜也被当成"新建下一道"，界面把 card_code 清掉，
//   老板以为还在改这道菜，再点保存就生成了一张新卡（原卡没改）。
function judgeIsEditBranch(src) {
  if (!src) return { ok: false, why: '取不到页面源码（fail-closed）' };
  if (!/const wasEdit\s*=\s*this\.data\.isEdit\s*;/.test(src)) {
    return { ok: false, why: '保存路径没先取 isEdit ⇒ 编辑态与新增态走同一条收尾（必有一边是错的）' };
  }
  if (!/if\s*\(\s*wasEdit\s*\)/.test(src)) {
    return { ok: false, why: '没有按 wasEdit 分支' };
  }
  if (!fnBodyOf(src, 'afterSaved')) {
    return { ok: false, why: '没有 afterSaved（连续录入没落地）' };
  }
  return { ok: true, why: '保存后按 isEdit 分支（编辑=回列表 / 新增=连续录入）' };
}

// 判据 L5b：afterSaved 必须清主键 —— 这是**防第二道覆盖第一道**的唯一屏障。
function judgeAfterSavedResets(src, key) {
  if (!src) return { ok: false, why: '取不到页面源码（fail-closed）' };
  const body = fnBodyOf(src, 'afterSaved');
  if (!body) return { ok: false, why: '没有 afterSaved' };
  const re = new RegExp('\\b' + key + '\\s*:\\s*(' + EMPTY_Q + '|"")');
  if (!re.test(body)) {
    return { ok: false, why: 'afterSaved 没清 ' + key + ' ⇒ 第二道会被当成「编辑第一道」，**第一道的内容被静默覆盖**' };
  }
  return { ok: true, why: 'afterSaved 清空了 ' + key + '（不会覆盖上一条）' };
}

// ===================== L1 列表排序在位 =====================
console.log('===== L1 · 两个列表「置顶 + 最近编辑在前」=====');
{
  const cardIdx = read('pages/card/index.js');
  const matIdx = read('pages/material/index.js');
  const r1 = judgeSortList(cardIdx, 'card_code');
  r1.ok ? ok('L1-① 菜品卡列表排序：' + r1.why) : bad('L1-① 菜品卡列表排序 —— ' + r1.why);
  const r2 = judgeSortList(matIdx, 'id');
  r2.ok ? ok('L1-② 原料列表排序：' + r2.why) : bad('L1-② 原料列表排序 —— ' + r2.why);
  const r3 = judgeFilterCallsSort(cardIdx);
  r3.ok ? ok('L1-③ ' + r3.why + '（菜品卡）') : bad('L1-③ ' + r3.why);
  const r4 = judgeFilterCallsSort(matIdx);
  r4.ok ? ok('L1-④ ' + r4.why + '（原料）') : bad('L1-④ ' + r4.why);
}

// ===================== L2 排序键出参 =====================
console.log('');
console.log('===== L2 · 排序键必须由云函数出参带出来 =====');
{
  const files = [
    ['getCostCard', 'cloudfunctions/getCostCard/service.js'],
    ['getCardVersions', 'cloudfunctions/getCardVersions/service.js'],
    ['getMaterial', 'cloudfunctions/getMaterial/service.js'],
  ];
  files.forEach(([fn, rel], i) => {
    const r = judgeOutUpdatedAt(read(rel));
    r.ok ? ok('L2-' + (i + 1) + ' ' + fn + '：' + r.why) : bad('L2-' + (i + 1) + ' ' + fn + ' —— ' + r.why);
  });
}

// ===================== L3 置顶落点 =====================
console.log('');
console.log('===== L3 · 置顶落在既有 shop 文档（零新建集合）=====');
{
  const r = judgePinPersist(
    read('cloudfunctions/saveShopSetting/validate.js'),
    read('cloudfunctions/saveShopSetting/index.js'),
    read('cloudfunctions/getShopContext/index.js')
  );
  r.ok ? ok('L3-① ' + r.why) : bad('L3-① ' + r.why);
  const r2 = judgeNoPinCollection(read('cloudfunctions/initDb/collections.js'));
  r2.ok ? ok('L3-② ' + r2.why) : bad('L3-② ' + r2.why);
  const iSrc = read('cloudfunctions/saveShopSetting/index.js') || '';
  const tri = /v\.pinned_cards\s*!==\s*undefined/.test(iSrc) && /v\.pinned_materials\s*!==\s*undefined/.test(iSrc);
  tri ? ok('L3-③ 置顶写入沿用三态语义（undefined = 不动库）—— 只改置顶不会顺手清掉别的店铺字段')
      : bad('L3-③ 置顶写入没有三态判定 ⇒ 未传字段会被归一成空值写库');
}

// ===================== L4 原料选择 =====================
console.log('');
console.log('===== L4 · 原料选择走独立页（搜索 + 分组）=====');
{
  const wxml = read('pages/card/edit.wxml');
  const r = judgeMaterialPicker(wxml);
  r.ok ? ok('L4-① ' + r.why) : bad('L4-① ' + r.why);
  const js = read('pages/card/edit.js') || '';
  const jumps = /\/pages\/material\/pick\?idx=/.test(js);
  jumps ? ok('L4-② 跳转带 idx（选择页知道自己该填哪一行）') : bad('L4-② 跳转未带 idx ⇒ 选完不知道该填哪一行');
  const quartet = ['js', 'wxml', 'json', 'wxss'].filter((e) => read('pages/material/pick.' + e));
  const registered = (read('app.json') || '').indexOf('"pages/material/pick"') >= 0;
  (quartet.length === 4 && registered)
    ? ok('L4-③ 选择页四件套齐全（4/4）且已在 app.json 注册')
    : bad('L4-③ 选择页不完整：四件套 ' + quartet.length + '/4，注册=' + registered);
  const pickJs = read('pages/material/pick.js') || '';
  const pickWxml = read('pages/material/pick.wxml') || '';
  const hasSearch = /onKeyword/.test(pickJs) && /bindinput="onKeyword"/.test(pickWxml);
  const hasGroup = fnBodyOf(pickJs, 'buildGroups') !== null && /wx:for="\{\{groups\}\}"/.test(pickWxml);
  (hasSearch && hasGroup)
    ? ok('L4-④ 选择页有搜索（onKeyword）与分组（buildGroups → groups）')
    : bad('L4-④ 选择页缺搜索或分组（搜索=' + hasSearch + '，分组=' + hasGroup + '）—— 100 项还是只能滚');
}

// ===================== L5 连续录入 =====================
console.log('');
console.log('===== L5 · 连续录入（防第二道覆盖第一道）=====');
{
  const cardEdit = read('pages/card/edit.js');
  const matEdit = read('pages/material/edit.js');
  const r1 = judgeIsEditBranch(cardEdit);
  r1.ok ? ok('L5-① 菜品卡编辑页：' + r1.why) : bad('L5-① 菜品卡编辑页 —— ' + r1.why);
  const r2 = judgeIsEditBranch(matEdit);
  r2.ok ? ok('L5-② 原料编辑页：' + r2.why) : bad('L5-② 原料编辑页 —— ' + r2.why);
  const r3 = judgeAfterSavedResets(cardEdit, 'card_code');
  r3.ok ? ok('L5-③ ' + r3.why) : bad('L5-③ 菜品卡 —— ' + r3.why);
  const r4 = judgeAfterSavedResets(matEdit, 'id');
  r4.ok ? ok('L5-④ ' + r4.why) : bad('L5-④ 原料 —— ' + r4.why);
  const backC = /backToList\s*\(\s*\)\s*\{/.test(cardEdit || '') && /bindtap="backToList"/.test(read('pages/card/edit.wxml') || '');
  const backM = /backToList\s*\(\s*\)\s*\{/.test(matEdit || '') && /bindtap="backToList"/.test(read('pages/material/edit.wxml') || '');
  (backC && backM)
    ? ok('L5-⑤ 两页都有显式「返回列表」出口（不打断，也不把人困住）')
    : bad('L5-⑤ 返回出口缺失（菜品卡=' + backC + '，原料=' + backM + '）—— 连续录入会把人困在本页');
}

// ===================== L6 WXML 表达式安全 =====================
console.log('');
console.log('===== L6 · WXML 表达式不得调方法 =====');
{
  [['L6-①', 'pages/card/index.wxml'], ['L6-②', 'pages/material/index.wxml'], ['L6-③', 'pages/material/pick.wxml']].forEach(([id, rel]) => {
    const r = judgeWxmlNoMethodCall(read(rel));
    r.ok ? ok(id + ' ' + rel + '：' + r.why) : bad(id + ' ' + rel + ' —— ' + r.why);
  });
}

// ===================== S 自失效护栏 =====================
console.log('');
console.log('===== S · 自失效护栏 =====');
{
  const faces = [
    'pages/card/index.js', 'pages/material/index.js', 'pages/card/index.wxml', 'pages/material/index.wxml',
    'pages/material/pick.wxml', 'pages/card/edit.js', 'pages/card/edit.wxml', 'pages/material/edit.js',
    'pages/material/edit.wxml', 'app.json',
    'cloudfunctions/getCostCard/service.js', 'cloudfunctions/getCardVersions/service.js',
    'cloudfunctions/getMaterial/service.js', 'cloudfunctions/saveShopSetting/validate.js',
    'cloudfunctions/saveShopSetting/index.js', 'cloudfunctions/getShopContext/index.js',
    'cloudfunctions/initDb/collections.js',
  ];
  const missing = faces.filter((f) => read(f) === null);
  missing.length === 0
    ? ok('S1 扫描面完整：' + faces.length + ' 个目标文件全部可读')
    : bad('S1 扫描面残缺，读不到 ' + missing.length + ' 个：' + missing.slice(0, 4).join(', '));

  // S2 空输入必须 fail-closed（不能"读不到就当通过"）
  const empties = [
    judgeSortList(null, 'id'), judgeOutUpdatedAt(null), judgeMaterialPicker(null),
    judgeWxmlNoMethodCall(null), judgeIsEditBranch(null), judgeAfterSavedResets(null, 'id'),
  ];
  empties.every((r) => r.ok === false)
    ? ok('S2 全部 6 条判据在空输入时 fail-closed（读不到文件绝不假绿）')
    : bad('S2 有条判据在空输入时返回通过 ⇒ 文件被删/改名会静默变成假绿');

  // S3 命中数下界：sortList 至少 2 处（两个列表），映射出 updated_at 的 service 至少 3 处
  const all = faces.map(read).join('\n');
  const nSort = (all.match(/sortList\s*\(/g) || []).length;
  const nOut = (all.match(/updated_at:\s*doc\.updated_at/g) || []).length;
  (nSort >= 2 && nOut >= 3)
    ? ok('S3 命中数下界：sortList ≥ 2（实 ' + nSort + '）· 出参 updated_at ≥ 3（实 ' + nOut + '）')
    : bad('S3 命中数过低（sortList=' + nSort + ' / 出参=' + nOut + '）⇒ 判据或扫描面失效');
}

// ===================== C 反恒真（影子样本） =====================
console.log('');
console.log('===== C · 反恒真影子样本 =====');
{
  // C1 坏样本：sortList 只排 updated_at，没有置顶 ⇒ 必须判红
  const c1 = judgeSortList('function f(){ sortList(list) { return list.slice().sort((a,b)=>b.updated_at-a.updated_at); } }', 'card_code');
  c1.ok === false ? ok('C1 影子样本「sortList 漏置顶」判红') : bad('C1 判据放过漏置顶的 sortList（假绿）');

  // C2 好样本：等价改写的 sortList（变量叫 pins、比较器另取变量）⇒ 必须判绿（防按字面判）
  const c2 = judgeSortList(
    'sortList(rows) {\n const rank = (it) => { const i = pins.indexOf(it.card_code); return i < 0 ? 99 : i; };\n' +
    ' return rows.slice().sort((x, y) => rank(x) - rank(y) || (Number(y.updated_at) || 0) - (Number(x.updated_at) || 0));\n}',
    'card_code');
  c2.ok === true ? ok('C2 影子样本「等价改写的 sortList」判绿（判行为不判字面）') : bad('C2 等价改写被判红 —— ' + c2.why);

  // C2b 好样本：定义在调用之后（本轮真实踩点）—— 定位必须锚「定义」而非「首次出现」
  const c2b = judgeAfterSavedResets('save() { this.afterSaved(n); }\nafterSaved(n) { this.setData({ id: EMPTYQ, name: empty }); }'.replace('EMPTYQ', EMPTY_Q), 'id');
  c2b.ok === true ? ok('C2b 影子样本「定义在调用之后」仍能定位到定义体（防 indexOf 命中调用处）') : bad('C2b 定义在调用之后时定位失败 —— ' + c2b.why);

  // C3 坏样本：出参有 updated_at 但不退回 created_at ⇒ 必须判红
  const c3 = judgeOutUpdatedAt('return { updated_at: doc.updated_at != null ? doc.updated_at : 0 };');
  c3.ok === false ? ok('C3 影子样本「updated_at 不退回 created_at」判红') : bad('C3 判据放过缺兜底的出参（假绿）');

  // C4 坏样本：模板里在 {{}} 内调方法 ⇒ 必须判红
  const c4 = judgeWxmlNoMethodCall('{{pinned.indexOf(item.card_code) >= 0}}');
  c4.ok === false ? ok('C4 影子样本「WXML 内调 indexOf」判红') : bad('C4 判据放过模板方法调用（假绿）');

  // C5 坏样本：afterSaved 不清主键 ⇒ 必须判红，且失败原因必须点名该键
  const c5 = judgeAfterSavedResets('afterSaved(name) { this.setData({ name: empty, lines: [] }); }', 'card_code');
  (c5.ok === false && c5.why.indexOf('card_code') >= 0)
    ? ok('C5 影子样本「afterSaved 不清 card_code」判红且点名到该键')
    : bad('C5 判据放过不明主键的 afterSaved（数据覆盖风险）');

  // C6 坏样本：原料仍走原生 picker ⇒ 必须判红
  const c6 = judgeMaterialPicker('<picker mode="selector" range="{{materials}}" range-key="name" bindchange="onMaterialChange"></picker>');
  c6.ok === false ? ok('C6 影子样本「原料回退原生 picker」判红') : bad('C6 判据放过原生 picker 回退（假绿）');
}

console.log('');
console.log('===== R156 列表排序/置顶·原料选择·连续录入 守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
