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
//    🔴 R298 扩面（本轮真实事故×2）：原判据是「8 个方法名白名单 + 只扫 3 个列表页」，
//      而实际踩到的两处**分别落在别的页**、且其中一个方法名还不在白名单里：
//        · `subpkg/biz/month/input.wxml`  `{{g.expanded ? g.rows : g.rows.slice(0, 1)}}`（**slice 不在白名单**）
//          ⇒ 费用/其他收入组的**细项行整段不渲染**（收入、费用两个月录入页各一处）
//        · `pages/sandbox/compare.wxml` `{{selected.indexOf(...)}}`（indexOf 在册，但**该页不在原扫描面**）
//          ⇒ 方案勾选框永不点亮（老板看不出选了哪几个）
//      ⇒ 判据改成「**通用** `.{ident}(`」+「扫描面 = **全仓** pages/**/*.wxml」，并加扫描面下界
//        （防止 walk 失效 ⇒ 0 个文件 ⇒ 恒真假绿）。
//
// 判据（纯函数化 + 正负互证 + 反查真实单源）：
//   L1 排序在位：两个列表页都有 sortList，且同时用置顶与 updated_at；applyFilter 真的调用它
//   L2 排序键出参：getCostCard / getCardVersions / getMaterial 三处出参带 updated_at 且 fail-soft 退回 created_at
//   L3 置顶落点：saveShopSetting 校验+写库、getShopContext 下发；且**不得新建集合**（复用 shop 文档）
//   L4 原料选择：模板不再走原生 picker；改走独立页且该页四件套齐全、已注册、有搜索与分组
//   L5 连续录入：保存后按 isEdit 分支；afterSaved 必须清 id / card_code；有显式返回出口
//   L6 WXML 安全：**全仓** pages/**/*.wxml 的 {{}} 内不得出现任何方法调用（通用 .ident( ，非白名单）
//   L6b 渲染源：月录入页细项行必须渲染**已装饰的 g.rows**（fixed/tag 都在其上），不得改读未装饰/易过期的 showRows
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
// ⚠️ R181 修假阳性：旧实现用裸子串 `/['"][a-z_]*pin[a-z_]*['"]/i`，
//    而 `shop_dish_mapping`（R174 入站接入缝，v1.4 §6.2 定名）的 `mapping` 里就含 "pin"（ma-pin-g）
//    ⇒ 被误判成「置顶相关集合」⇒ 假红。**判据改为「按下划线分段后存在独立的 `pin` 段」**：
//    `shop_pin_card` / `pin_cards` / `shop_cards_pin` ⇒ 命中；`shop_dish_mapping` / `shopping` ⇒ 不命中。
function judgeNoPinCollection(collectionsSrc) {
  if (!collectionsSrc) return { ok: false, why: '取不到 initDb/collections.js（fail-closed）' };
  const ids = [...collectionsSrc.matchAll(/['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)].map(m => m[1]);
  const hit = ids.find(id => id.toLowerCase().split('_').includes('pin'));
  if (hit) return { ok: false, why: '集合单源里出现置顶相关集合 ' + hit + ' ⇒ 违反 M3 v1.1「零新建集合」红线' };
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

// WXML 注释剥离（**等长空格替换、保留 \n**）：判据只看**会被求值**的部分。
//   🔴 为什么必须剥（本轮实测假红）：守卫扩到全仓后，`subpkg/biz/month/input.wxml` 里那句
//     「原式 `{{g.expanded ? g.rows : g.rows.slice(0, 1)}}` 已修」的**说明注释**被判红 ——
//     注释不会被 WXML 求值，写"曾经的错法"是**文档、不是缺陷**。
//   ⚠️ 反向不放松：真·方法调用只可能出现在 {{}} 求值段；藏在注释里的调用**本来就不生效**，
//     故剥离不削弱判据（与 `check_wxml_structure.js::skeleton` 同一手法）。
const stripWxmlComments = (s) => String(s || '').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

// 判据 L6：WXML 表达式不支持方法调用 ⇒ 任何 `{{ ... .ident( ... }}` 都是静默失效
//   （求值成 undefined，不报错、不渲染）。
//   ⚠️ R298 教训：**别用方法名白名单**（slice 就漏了）；也别只扫"相关页"（在别的页照样发生）。
//     ⇒ 判据 = 通用正则；调用方负责把**全仓**模板喂进来（见 L6 段）。
//   ✅ 不误伤：`{{a.b}}`（无括号）、`{{ok ? 1 : 2}}`（无点）、`{{price | fmt}}`（管道过滤器）、
//     `{{ 0.5 }}`（点后接数字）、注释里的示例 —— 已用正负样本互证（C4 / C4b / C4c）。
//   ⚠️ 前提：本仓 wxml **不使用 <wxs>**（已机器核对：0 处）⇒ 不存在"合法的方法调用"。
//     将来若引入 WXS，须回看本判据（WXS 里的函数调用在模板中是合法的）。
function judgeWxmlNoMethodCall(wxml) {
  if (!wxml) return { ok: false, why: '取不到模板（fail-closed）' };
  const src = stripWxmlComments(wxml);
  // `[^}\n]*` 刻意不跨行、不跨 mustache，避免把相邻两段 {{}} 之间的内容误算进同一次求值。
  const m = /\{\{[^}\n]*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(src);
  if (m) return { ok: false, why: 'WXML 表达式里调用了 .' + m[1] + '()（模板不支持 ⇒ 恒为 undefined，静默失效）' };
  return { ok: true, why: '模板 {{}} 内无方法调用（标记由 JS 预先打好）' };
}

// 判据 L6b：细项行的**渲染源必须是已装饰行** `g.rows`。
//   为什么单列一条（与 L6 "有没有方法调用" 是**两个不同的失效面**）：
//     这不是"写法"问题，而是"取哪一份数据"问题 —— `g.rows` 是**唯一装配口** decorateRows 的产物
//     （`fixed` 预设名只读 / `tag` 沿用·要核对 / `note` 行内说明 都挂在其上）；而 `g.showRows` 槽
//     对非堂食组是**未装饰** raw，且多处赋值在 markRecurringTags / updateRow 之后是**过期引用**
//     ⇒ 一旦模板改读它，预设细项名会退化成**可编辑输入框**、「沿用/要核对」标记消失 —— 全是**无报错的静默降级**。
//   （🔴 这正是本轮我自己先踩的坑：M1-B1 初版改成读 `showRows`，门禁全绿而语义已错，靠"按老板常识走查"才现形。）
//   判据 = 渲染源里不得出现 `g.showRows`，且 `wx:for="{{g.rows}}"` 出现 ≥2 处（收入侧 + 费用侧都走它）。
function judgeRowRenderSource(wxml) {
  if (!wxml) return { ok: false, why: '取不到模板（fail-closed）' };
  const src = stripWxmlComments(wxml);   // 同上：说明性注释不算渲染源
  if (/\{\{\s*g\.showRows\b/.test(src)) {
    return { ok: false, why: '细项渲染源用了 g.showRows（未装饰 / 易过期槽）⇒ 预设名只读与「沿用」标记会静默丢失' };
  }
  const n = (src.match(/wx:for="\{\{g\.rows\}\}"/g) || []).length;
  if (n < 2) return { ok: false, why: '细项渲染源 g.rows 只出现 ' + n + ' 处（应 ≥2：收入侧 + 费用侧）' };
  return { ok: true, why: '细项渲染源为**已装饰**的 g.rows（' + n + ' 处；折叠由 wx:if 数据表达式决策，不产生派生槽）' };
}

// L6 扫描面收集器：**全仓** .wxml（递归）。返回 [relPath, text] 列表。
//   ⚠️ 扫描面/排除面刻意与 `tools/check_wxml_structure.js` 的约定**保持一致**
//     （SCAN_DIRS = pages/miniprogram/components + 仓根 *.wxml；排除 node_modules/.git/.workbuddy/review）
//     —— 两处判据不同（那边管结构与裸属性行、这边管表达式方法调用），但**扫描面必须同源**，
//     否则将来新增一个 `components/` 目录时，一边扫得到、一边扫不到 ⇒ 覆盖出现无声的洞。
//   ⚠️ walk 失败时返回空数组 ⇒ 由调用方的**扫描面下界**转红（不许"扫不到就当通过"）。
function collectAllPageWxml() {
  const out = [];
  const EXCLUDED = new Set(['node_modules', '.git', '.workbuddy', 'review']);
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (EXCLUDED.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.wxml')) {
        const r = path.relative(ROOT, full).split(path.sep).join('/');
        out.push([r, read(r) || '']);
      }
    }
  };
  for (const d of ['pages', 'subpkg', 'miniprogram', 'components']) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.wxml')) out.push([e.name, read(e.name) || '']);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
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
  const cardIdx = read('subpkg/biz/card/index.js');
  const matIdx = read('subpkg/biz/material/index.js');
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
  const wxml = read('subpkg/biz/card/edit.wxml');
  const r = judgeMaterialPicker(wxml);
  r.ok ? ok('L4-① ' + r.why) : bad('L4-① ' + r.why);
  const js = read('subpkg/biz/card/edit.js') || '';
  // R423 分包化：跳转目标与 app.json 注册形式都变了（分包路径 = root + "material/pick"）
  const jumps = /\/(?:pages\/material|subpkg\/biz\/material)\/pick\?idx=/.test(js);
  jumps ? ok('L4-② 跳转带 idx（选择页知道自己该填哪一行）') : bad('L4-② 跳转未带 idx ⇒ 选完不知道该填哪一行');
  const quartet = ['js', 'wxml', 'json', 'wxss'].filter((e) => read('subpkg/biz/material/pick.' + e));
  // 分包页在 app.json 里是 root + "material/pick" 两段，完整路径不再出现
  const registered = (read('app.json') || '').indexOf('"material/pick"') >= 0;
  (quartet.length === 4 && registered)
    ? ok('L4-③ 选择页四件套齐全（4/4）且已在 app.json 注册')
    : bad('L4-③ 选择页不完整：四件套 ' + quartet.length + '/4，注册=' + registered);
  const pickJs = read('subpkg/biz/material/pick.js') || '';
  const pickWxml = read('subpkg/biz/material/pick.wxml') || '';
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
  const cardEdit = read('subpkg/biz/card/edit.js');
  const matEdit = read('subpkg/biz/material/edit.js');
  const r1 = judgeIsEditBranch(cardEdit);
  r1.ok ? ok('L5-① 菜品卡编辑页：' + r1.why) : bad('L5-① 菜品卡编辑页 —— ' + r1.why);
  const r2 = judgeIsEditBranch(matEdit);
  r2.ok ? ok('L5-② 原料编辑页：' + r2.why) : bad('L5-② 原料编辑页 —— ' + r2.why);
  const r3 = judgeAfterSavedResets(cardEdit, 'card_code');
  r3.ok ? ok('L5-③ ' + r3.why) : bad('L5-③ 菜品卡 —— ' + r3.why);
  const r4 = judgeAfterSavedResets(matEdit, 'id');
  r4.ok ? ok('L5-④ ' + r4.why) : bad('L5-④ 原料 —— ' + r4.why);
  const backC = /backToList\s*\(\s*\)\s*\{/.test(cardEdit || '') && /bindtap="backToList"/.test(read('subpkg/biz/card/edit.wxml') || '');
  const backM = /backToList\s*\(\s*\)\s*\{/.test(matEdit || '') && /bindtap="backToList"/.test(read('subpkg/biz/material/edit.wxml') || '');
  (backC && backM)
    ? ok('L5-⑤ 两页都有显式「返回列表」出口（不打断，也不把人困住）')
    : bad('L5-⑤ 返回出口缺失（菜品卡=' + backC + '，原料=' + backM + '）—— 连续录入会把人困在本页');
}

// ===================== L6 WXML 表达式安全（全仓扫描） =====================
console.log('');
console.log('===== L6 · 全仓 WXML {{}} 不得调方法 =====');
{
  const all = collectAllPageWxml();
  // 扫描面下界：当前实有 27 页。取 25 —— 新增页不必改判据，但**掉到 25 以下必然是真出事**
  //   （walk 坏了 / pages 被搬走 / 守卫被改成扫单页），不许"扫不到就当通过"。
  const SURFACE_MIN = 25;
  (all.length >= SURFACE_MIN)
    ? ok('L6-① 扫描面下界：全仓 ' + all.length + ' 个 .wxml（≥' + SURFACE_MIN + '）')
    : bad('L6-① 扫描面塌陷：只扫到 ' + all.length + ' 个 .wxml（<' + SURFACE_MIN + '）⇒ 判据失效');
  const hits = [];
  all.forEach(([rel, text]) => {
    const r = judgeWxmlNoMethodCall(text);
    if (!r.ok) hits.push(rel + ' —— ' + r.why);
  });
  if (hits.length === 0) {
    ok('L6-② 全仓 ' + all.length + ' 个模板的 {{}} 内 0 处方法调用（标记均已在 JS 里预先打好）');
  } else {
    bad('L6-② 全仓发现 ' + hits.length + ' 处模板方法调用（模板不支持 ⇒ 该处永不渲染，且不报错）');
    hits.slice(0, 8).forEach((h) => console.log('       ↳ ' + h));
  }
  // L6-③ 取哪一份数据（与"有没有方法调用"是两个面）
  const r6b = judgeRowRenderSource(read('subpkg/biz/month/input.wxml'));
  r6b.ok ? ok('L6-③ 月录入页细项渲染源：' + r6b.why) : bad('L6-③ 月录入页细项渲染源 —— ' + r6b.why);
}

// ===================== S 自失效护栏 =====================
console.log('');
console.log('===== S · 自失效护栏 =====');
{
  const faces = [
    'subpkg/biz/card/index.js', 'subpkg/biz/material/index.js', 'subpkg/biz/card/index.wxml', 'subpkg/biz/material/index.wxml',
    'subpkg/biz/material/pick.wxml', 'subpkg/biz/card/edit.js', 'subpkg/biz/card/edit.wxml', 'subpkg/biz/material/edit.js',
    'subpkg/biz/material/edit.wxml', 'app.json',
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
    judgeRowRenderSource(null),
  ];
  empties.every((r) => r.ok === false)
    ? ok('S2 全部 ' + empties.length + ' 条判据在空输入时 fail-closed（读不到文件绝不假绿）')
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

  // C4b 好样本（**不误伤**）：无括号的属性访问 / 三元 / 管道过滤器 / 小数 —— 必须判绿。
  //   这条是 R298 拆掉白名单后的**必要配套**：正则放宽到通用 `.ident(` 后，最容易变成"见点就红"。
  const c4b = judgeWxmlNoMethodCall('{{a.b}}{{ok ? 1 : 2}}{{item.price | fixed}}{{form.amount > 0.5}}{{x}}');
  c4b.ok === true ? ok('C4b 影子样本「属性访问/三元/管道/小数」判绿（通用正则不误伤）') : bad('C4b 通用正则误伤合法写法 —— ' + c4b.why);

  // C4c 坏样本：**本轮 M1 真事故原文**（`slice` 不在旧白名单内）⇒ 证明"白名单已拆"。
  const c4c = judgeWxmlNoMethodCall('wx:for="{{g.expanded ? g.rows : g.rows.slice(0, 1)}}"');
  c4c.ok === false ? ok('C4c 影子样本「M1 原文 g.rows.slice(0,1)」判红 ⇒ 白名单已拆') : bad('C4c 判据仍按白名单 ⇒ slice 这类静默失效抓不到');

  // C4d 坏样本：细项渲染源改读未装饰/易过期的 `g.showRows` ⇒ 必须判红（**本轮我自己踩的坑**）
  const c4d = judgeRowRenderSource('wx:for="{{g.showRows}}" wx:for="{{g.rows}}"');
  c4d.ok === false ? ok('C4d 影子样本「细项改读 g.showRows（未装饰槽）」判红 ⇒ 静默降级锁死') : bad('C4d 判据放过未装饰渲染源（固定的预设名会变成可编辑框）');

  // C4e 好样本：本轮的真实修法形态（g.rows + wx:if 折叠，两个面各一处）⇒ 必须判绿
  const c4e = judgeRowRenderSource('wx:for="{{g.rows}}" wx:key="index" wx:if="{{g.expanded || ri === 0}}"\nwx:for="{{g.rows}}"');
  c4e.ok === true ? ok('C4e 影子样本「g.rows + wx:if 折叠」判绿（等价改正不误杀）') : bad('C4e 真实修法形态被判红 —— ' + c4e.why);

  // C4f 好样本：**注释里**举例写法（写"曾经的错法"是文档不是缺陷）⇒ 必须判绿（证明剥注释生效）
  const c4f = judgeWxmlNoMethodCall('<!-- 原式 {{g.rows.slice(0, 1)}} 已修 -->\n<view wx:for="{{g.rows}}"></view>');
  c4f.ok === true ? ok('C4f 影子样本「注释里的举例写法」判绿（剥注释生效，不误杀文档）') : bad('C4f 把说明性注释判红了 —— ' + c4f.why);

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
