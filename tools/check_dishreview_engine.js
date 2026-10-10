#!/usr/bin/env node
// tools/check_dishreview_engine.js —— R232f · getDishReview 算法层守卫
// 运行：node tools/check_dishreview_engine.js   （由 verify_all.js 的 [dishreview-engine] 套件调用）
//
// ===== 为什么需要它（真缺口，非纸面演练）=====
//   M3.33 阶段②的**读侧** getDishReview 是「付费钩子 + 用户最终看到的东西」，
//   但它的算法原先把「聚合 / 最新版本 / 匹配 / 毛利 / 毛利率 / 排名 / totals / 未匹配」全部内联在
//   `exports.main` 里 ⇒ **环上零判据**（R232 的 C-10 就出在这个函数里，靠人工审查才发现）。
//   R232f 把算法外提为 `service.js::buildDishReview`（纯函数 · 零 db）⇒ 本守卫直接 require 它复算。
//
//   被拦住的失效形态（每条都对应一次真实误算）：
//     ① 版本选取错（取旧版成本）⇒ 毛利系统性偏移，且**无报错**；
//     ② 未匹配被静默归零 / 被丢弃 ⇒ 用户看到「所有菜都有成本」（红线 17 明令禁止）；
//     ③ 毛利率不防零除 ⇒ 营收 0 的赠品产出 NaN/Infinity ⇒ 前端渲染异常；
//     ④ totals.qty 漏掉未匹配 ⇒ 合计销量小于实际；
//     ⑤ snapshot_month 走本地时区（C-10）⇒ 每月 1 日 00-08 点创建的卡差一月。
//
// 判据全部 fail-closed：读不到 service.js / 依赖即判红，不静默放行。
// 期望值**手推**（推导过程写在各段注释里），**不从被测模块读回来**。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVC_REL = 'cloudfunctions/getDishReview/service.js';
const IDX_REL = 'cloudfunctions/getDishReview/index.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
function sec(t) { console.log('\n【' + t + '】'); }
function rd(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } }
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const idxSrc = rd(IDX_REL);
const svcSrc = rd(SVC_REL);

// ============ ⓪ 存在性（fail-closed）============
sec('⓪ 模块在场（读不到即红，不静默放行）');
check('0-① service.js 在场', svcSrc.length > 0, SVC_REL);
check('0-② index.js 在场', idxSrc.length > 0, IDX_REL);

let buildDishReview = null, rankReview = null, normalizeDishName = null, toMonth = null;
try {
  buildDishReview = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js')).buildDishReview;
  rankReview = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js')).rankReview;
} catch (e) { /* 下面判据判红 */ }
try {
  normalizeDishName = require(path.join(ROOT, 'cloudfunctions/common/dishKey.js')).normalizeDishName;
  toMonth = require(path.join(ROOT, 'cloudfunctions/common/utilTime.js')).toMonth;
} catch (e) { /* 下面判据判红 */ }

check('0-③ service.js 导出 buildDishReview', typeof buildDishReview === 'function',
  typeof buildDishReview);
check('0-④ 单源依赖可 require（dishKey / utilTime）',
  typeof normalizeDishName === 'function' && typeof toMonth === 'function');

// ============ ① 真调生产函数（偏执行为判据）============
sec('① 真的调生产 buildDishReview（不是读源码字面）');
const hasSvc = typeof buildDishReview === 'function'
  && typeof normalizeDishName === 'function' && typeof toMonth === 'function';

if (!hasSvc) {
  check('1-① 因模块缺失，行为判据整组无法执行 ⇒ 判红（fail-closed）', false);
} else {
  const D = { normalizeDishName, toMonth };

  // ---- 1-A 最新版本（推导线：v2 cost=900 ⇒ 3×(900)=2700，若取 v1(800) 则为 2400）----
  const cardsA = [
    { card_code: 'C001', version: 1, name: '红烧肉', total_cost: 800, created_at: 1789430400000 },
    { card_code: 'C001', version: 2, name: '红烧肉', total_cost: 900, created_at: 1789862400000 },
  ];
  const rA = buildDishReview([{ dish_key: '红烧肉', qty: 3, amount: 6000 }], cardsA, D);
  check('1-① 取最新版本成本（3×900=2700，非 3×800=2400）',
    rA.dine_in[0].totalCostFen === 2700, 'totalCostFen=' + rA.dine_in[0].totalCostFen);
  check('1-② 毛利 = 营收 − 成本（6000−2700=3300）', rA.dine_in[0].grossFen === 3300);
  check('1-③ 毛利率 = round(毛利/营收×10000)/100（55）', rA.dine_in[0].marginPct === 55);

  // ---- 1-B 未匹配不归零（红线 17）----
  const rB = buildDishReview(
    [{ dish_key: '红烧肉', qty: 1, amount: 2000 }, { dish_key: '土豆丝', qty: 4, amount: 3200 }],
    [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1789862400000 }], D);
  check('1-④ 未匹配单列、不混入明细',
    rB.unmatched.length === 1 && rB.dine_in.length === 1,
    'unmatched=' + rB.unmatched.length + ' ranked=' + rB.dine_in.length);
  check('1-⑤ 未匹配**不带**成本/毛利字段（无成本可算，不得造 0）',
    rB.unmatched[0].totalCostFen === undefined && rB.unmatched[0].grossFen === undefined);
  check('1-⑥ totals.qty 含未匹配（1+4=5）', rB.totals.qty === 5, 'qty=' + rB.totals.qty);
  check('1-⑦ totals.costFen/grossFen 只算已匹配（900/1100）',
    rB.totals.costFen === 900 && rB.totals.grossFen === 1100);

  // ---- 1-C 同名多行聚合（2+3=5 份 / 1000+1500=2500 ⇒ 成本 4500 ⇒ 毛利 −2000 ⇒ 率 −80）----
  const rC = buildDishReview(
    [{ dish_key: '红烧肉', qty: 2, amount: 1000 }, { dish_key: '红烧肉', qty: 3, amount: 1500 }],
    [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1789862400000 }], D);
  check('1-⑧ 同 dish_key 聚合为一行（不重复列菜）', rC.dine_in.length === 1);
  check('1-⑨ 聚合后 qty=5 / amountFen=2500',
    rC.dine_in[0].qty === 5 && rC.dine_in[0].amountFen === 2500);
  check('1-⑩ 负毛利可表达（−2000）且负率（−80）',
    rC.dine_in[0].grossFen === -2000 && rC.dine_in[0].marginPct === -80);

  // ---- 1-D 零营收防零除（赠品）----
  const rD = buildDishReview([{ dish_key: '赠品', qty: 2, amount: 0 }],
    [{ card_code: 'C001', version: 1, name: '赠品', total_cost: 100, created_at: 1789862400000 }], D);
  check('1-⑪ 营收 0 ⇒ marginPct = 0（不得 NaN/Infinity）',
    rD.dine_in[0].marginPct === 0 && Number.isFinite(rD.dine_in[0].marginPct),
    'marginPct=' + rD.dine_in[0].marginPct);
  check('1-⑫ 营收 0 但成本照算（毛利 −200）', rD.dine_in[0].grossFen === -200);

  // ---- 1-E 排名按毛利降序 ----
  const rE = buildDishReview(
    [{ dish_key: '红烧肉', qty: 3, amount: 6000 }, { dish_key: '米饭', qty: 2, amount: 1000 }],
    [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1789862400000 },
     { card_code: 'C002', version: 1, name: '米饭', total_cost: 100, created_at: 1789862400000 }], D);
  check('1-⑬ 排名按毛利降序（红烧肉 3300 > 米饭 800）',
    rE.dine_in[0].dish_key === '红烧肉' && rE.dine_in[1].dish_key === '米饭');

  // ---- 1-F 空 dish_key 跳过 ----
  const rF = buildDishReview(
    [{ dish_key: '', qty: 9, amount: 9000 }, { dish_key: '   ', qty: 9, amount: 9000 },
     { dish_key: '红烧肉', qty: 1, amount: 2000 }],
    [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1789862400000 }], D);
  check('1-⑭ 空/空白 dish_key 跳过（不计入 totals、不进未匹配）',
    rF.totals.qty === 1 && rF.unmatched.length === 0, 'qty=' + rF.totals.qty);

  // ---- 1-G C-10 回归：snapshot_month 走 UTC ----
  // created_at = 1790789400000 = 2026-09-30T17:30Z ⇒ UTC 是 9 月
  // （本地时区 UTC+8 ⇒ 10-01 ⇒ 本地实现会误给 '2026-10'）
  const rG = buildDishReview([{ dish_key: '红烧肉', qty: 1, amount: 2000 }],
    [{ card_code: 'C001', version: 1, name: '红烧肉', total_cost: 900, created_at: 1790789400000 }], D);
  check('1-⑮ snapshot_month 走 UTC 单源（1790789400000 ⇒ 2026-09）',
    rG.dine_in[0].snapshot_month === '2026-09', 'snapshot_month=' + rG.dine_in[0].snapshot_month);

  // ---- 1-H 反恒真：证明上面判据有鉴别力（把错口径也算出来，差异真实存在）----
  const rH = buildDishReview([], [], D);
  check('1-⑯ 空输入不崩且三字段齐（反恒真：证明函数真被调到）',
    Array.isArray(rH.dine_in) && Array.isArray(rH.unmatched)
    && rH.totals && rH.totals.qty === 0 && rH.totals.dishCount === 0);
}

// ============ ② 架构判据（防退化回内联）============
sec('② 架构：算法必须在 service.js、index.js 只做编排（防退化回内联）');
const idxNoCmt = stripComments(idxSrc);
check('2-① index.js require 了 ./service',
  /require\(['"]\.\/service['"]\)/.test(idxNoCmt),
  'require("./service")');
check('2-② index.js 调用了 buildDishReview',
  /buildDishReview\s*\(/.test(idxNoCmt));
// 🔴 判据锚「聚合/毛利计算是否又被写回 index」——用**行为特征**而非函数名（换名即绕过）
check('2-③ index.js 不再内联聚合逻辑（无 `new Map()` 聚合块 / 无手写毛利率公式）',
  idxNoCmt.indexOf('const agg = new Map()') < 0
  && idxNoCmt.indexOf('grossFen = a.amountFen - totalCostFen') < 0,
  '内联算法已清除');
check('2-④ service.js **零外部依赖**（不得 require wx-server-sdk / 不得碰 db）',
  stripComments(svcSrc).indexOf('wx-server-sdk') < 0
  && stripComments(svcSrc).indexOf('cloud.database') < 0,
  '纯函数保持可测');
check('2-⑤ service.js 导出 buildDishReview（module.exports）',
  /module\.exports\s*=\s*\{[^}]*buildDishReview/.test(svcSrc));

// ============ ③ 单源不扩散（C-9 / C-10 回归）============
sec('③ 单源：归一与月份必须来自 common（C-9/C-10 防复发）');
const svcNoCmt = stripComments(svcSrc);
check('3-① service.js 不从云依赖取归一（归一由入参注入）',
  /normalizeDishName\s*=\s*deps\.normalizeDishName/.test(svcNoCmt),
  'deps 注入');
check('3-② index.js 的归一/月份来自 common 单源',
  /require\(['"]\.\/common['"]\)/.test(idxNoCmt)
  && /common\.dishKey/.test(idxNoCmt) && /common\.utilTime/.test(idxNoCmt));
// 🔴 字面扫描本地 YYYY-MM 拼装：本地实现会写 getFullYear()/getMonth()（非 UTC）
check('3-③ index.js/service.js 内不得出现本地时区的月份拼装（防 C-10 复发）',
  !/getFullYear\s*\(\s*\)/.test(idxNoCmt) && !/getFullYear\s*\(\s*\)/.test(svcNoCmt)
  && !/getMonth\s*\(\s*\)/.test(idxNoCmt) && !/getMonth\s*\(\s*\)/.test(svcNoCmt));

// ============ ④ 自失效护栏（R182 纪律：扫描面非退化 + 关键锚点在场）============
sec('④ 自失效护栏（扫描面一旦扫空，上面判据会恒绿）');
check('4-① index.js 非空且规模合理（> 40 行）', idxSrc.split('\n').length > 40,
  idxSrc.split('\n').length + ' 行');
check('4-② service.js 非空且规模合理（> 60 行）', svcSrc.split('\n').length > 60,
  svcSrc.split('\n').length + ' 行');
check('4-③ 关键锚点在场：index.js 有鉴权 + 付费墙',
  /resolveAuth/.test(idxNoCmt) && /hasFeature/.test(idxNoCmt)
  && /m3_dishreview/.test(idxNoCmt));
check('4-④ 关键锚点在场：service.js 有 5 个口径段标记',
  ['最新版本', '归一名称', '聚合销量', '匹配 + 计算', '合计'].every(function (k) {
    return svcSrc.indexOf(k) >= 0;
  }));

// ============ ⑤ 页面消费契约：外卖「未匹配」不得被静默丢弃（R249-B）============
// 真实缺陷（R249 真云实证）：getDishReview 回的是 **两层** 未匹配 ——
//   顶层 `unmatched`（= buildDishInReview 产物，**仅堂食**）与 `takeaway.by_platform[p].unmatched`（各外卖平台）。
//   而页面只读顶层那份 ⇒ 外卖路径下「红线 17：不静默归零」**未落地**：
//   51 个外卖商品在界面上完全不可见，且外卖榜区块因 `ranked` 为空连表头都不渲染、只剩一个空标题。
// 判据（**判行为不判字面**）：在注释剥离后的页面源码里，**每个 `by_platform` 出现点之后的窗口内**
//   至少有一处存在「按平台读 unmatched」的形态；三种合法写法都算（`.unmatched` / `['unmatched']` / 解构）。
//   ⚠️ 不能只判「源码里有没有 `unmatched` 这个词」—— 旧代码 `setData({ …, unmatched, … })` 那处
//   **不是**按平台读，会把缺陷判绿（自证假绿）。
function judgeTakeawayUnmatched(src) {
  const W = 1200;
  const reads = /(\.\s*unmatched\b|\[\s*['"]unmatched['"]\s*\]|\{\s*unmatched\s*[,}])/;
  let i = -1, windows = 0, hit = 0;
  while ((i = src.indexOf('by_platform', i + 1)) >= 0) {
    windows++;
    if (reads.test(src.slice(i, i + W))) hit++;
  }
  return windows > 0 && hit > 0;
}
console.log('\n============ ⑤ 页面消费契约（R249-B）============');
const PAGE_REL = 'pages/m3/dishreview/index.js';
const pageSrc = stripComments(rd(PAGE_REL));
check('5-① 页面源码可读且非空（自失效护栏，防扫空恒绿）', pageSrc.length > 500, pageSrc.length + ' 字符');
check('5-② 页面确实按 by_platform 分平台渲染（判据锚点在位）', pageSrc.indexOf('by_platform') >= 0);
check('5-③ 🔴 每个 by_platform 之后的窗口内必须能读到 unmatched（否则外卖未匹配静默不可见）',
  judgeTakeawayUnmatched(pageSrc) === true);
check('5-④ 自检：合成的「只渲染 ranked、不读 unmatched」样本必须判红（带 setData 同名干扰）',
  judgeTakeawayUnmatched('takeaway = Object.keys(d.takeaway.by_platform).map((p) => ({ ranked: b.ranked })); this.setData({ takeaway, unmatched, totals });') === false);

// ============ ⑥ 平台块「不得只留光标题」（R251）============
// 真实缺陷（李老师 2026-10-09 真机报障：「又有京东又有淘宝数据，正常吗？看看是不是混乱了」）：
//   「外卖·淘宝闪购」「外卖·京东（订单）」两个标题下面**什么都没有** ⇒ 看着像混进了脏数据。
//   真云实测（`review/evidence/r251_dishreview/probe_r251.txt`）两条成因**完全不同**：
//     · jd_order 块 `unmatchedCount=0`、`ranked=[]` ⇒ 该平台只进了**账单级**行
//       （`importSalesBill` 账单分支写 `dish_key: ''`，被 `rankReview` 的 `if (!k) continue` 跳过
//        ⇒ 既不上榜、也不进未匹配、连合计都是 0 —— 「填了没用」的死输入）
//     · taobao 块 `unmatchedCount=51`、`ranked=[]` ⇒ 有菜品行，但一张成本卡都没匹配上
//   而 `by_platform[p].totals` 后端**一直算着**，页面却**一次都没渲染**（用户看不到「导进来多少」）。
// 判据（**判行为不判字面**）：**真调页面 `load()`**（require hook 换桩 + 注入 setData），
//   断两条成因各自落在正确措辞上、且**互不相同**（防判据退化成常量）。
//   ⚠️ 不许只 grep 源码：注释里出现 `item.totals` 会把「wxml 其实没渲染」判绿（R249-B 同型假绿）。
function judgePlatformSummary(wxmlNoCmt) {
  return wxmlNoCmt.indexOf('item.emptyReason') >= 0 && wxmlNoCmt.indexOf('item.totals.qty') >= 0;
}
// ⚠️ 本段**必须异步**：页面 `load()` 内有 `await api.call(...)` ⇒ 同步读 data 会读到「还没跑完」的
//   中间态（`takeaway` 仍是 null）= **假绿**。故整段包进 async IIFE，末尾统一出结果并 exit。
(async function sectionR251() {
console.log('\n============ ⑥ 平台块不得只留光标题（R251）============');

// 真云回包**忠实样本**（字段名/量级照抄 probe_r251.txt，只把菜名缩短）
const FIX_R251 = {
  dine_in: [],
  totals: { qty: 0, amountFen: 0, costFen: 0, grossFen: 0, dishCount: 0, unmatchedCount: 0 },
  unmatched: [],
  takeaway: {
    by_platform: {
      taobao: {
        ranked: [],
        unmatched: [
          { dish_key: '样本菜甲', name: '样本菜甲', qty: 2, amountFen: 1520 },
          { dish_key: '样本菜乙', name: '样本菜乙', qty: 43, amountFen: 0 },
        ],
        totals: { qty: 45, amountFen: 1520, costFen: 0, grossFen: 0, dishCount: 0, unmatchedCount: 2 },
      },
      jd_order: {
        ranked: [], unmatched: [],
        totals: { qty: 0, amountFen: 0, costFen: 0, grossFen: 0, dishCount: 0, unmatchedCount: 0 },
      },
    },
  },
};

let pageData = null;
try {
  const Module = require('module');
  const origLoadM = Module._load;
  Module._load = function (request, parent, isMain) {
    if (/utils[\\/]api\.js$/.test(request)) {
      return { ensureShop: async () => true, call: async () => FIX_R251, toastError: () => {} };
    }
    if (/utils[\\/]ui\.js$/.test(request)) return { setTitle: () => {}, nowMonth: () => '2026-10' };
    if (/utils[\\/]paywall\.js$/.test(request)) return { openPaywall: () => {} };
    return origLoadM.apply(this, arguments);
  };
  let captured = null;
  global.Page = (o) => { captured = o; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_probe' } });
  global.wx = { navigateTo: () => {} };
  delete require.cache[require.resolve(path.join(ROOT, PAGE_REL))];
  require(path.join(ROOT, PAGE_REL));
  Module._load = origLoadM;
  if (captured) {
    const inst = Object.assign({}, captured);
    inst.data = JSON.parse(JSON.stringify(captured.data));
    inst.setData = function (o) { Object.assign(this.data, o); };
    await inst.load();
    pageData = inst.data;
  }
} catch (e) { /* 下面判红 */ }

check('6-① 页面 load() 可被真调（fail-closed：拿不到 data 即红）', !!(pageData && pageData.takeaway),
  pageData ? 'by_platform 解析成功' : '未取得页面 data');
if (pageData && pageData.takeaway) {
  const tb = pageData.takeaway.find((b) => b.platform === 'taobao');
  const jd = pageData.takeaway.find((b) => b.platform === 'jd_order');
  check('6-② 账单级平台（jd_order）必须给出「只有账单合计」的说明',
    jd && typeof jd.emptyReason === 'string' && jd.emptyReason.indexOf('账单合计') >= 0,
    jd && JSON.stringify(jd.emptyReason));
  check('6-③ 全未匹配平台（taobao）必须给出「未匹配到成本卡」的说明',
    tb && typeof tb.emptyReason === 'string' && tb.emptyReason.indexOf('未匹配到成本卡') >= 0,
    tb && JSON.stringify(tb.emptyReason));
  check('6-④ 自失效护栏：两条成因**互不相同**（否则判据已退化成常量）',
    jd && tb && jd.emptyReason !== tb.emptyReason);
  check('6-⑤ 平台合计必须带出来（此前算好了却不渲染）',
    tb && tb.totals && tb.totals.qty === 45 && tb.unmatchedCount === 2,
    tb && JSON.stringify({ qty: tb.totals.qty, un: tb.unmatchedCount }));
  check('6-⑥ 未匹配行必须标来源平台（跨平台合并后否则看不出出处）',
    (pageData.unmatched[0] || {}).platformText === '淘宝闪购',
    JSON.stringify((pageData.unmatched[0] || {}).platformText));
  check('6-⑦ 0 元高份数行标「口味询问类」，非 0 元行**不得**误标（掉进 unmatched 后标记不能丢）',
    (pageData.unmatched.find((x) => x.name === '样本菜乙') || {}).zeroAmount === true
    && (pageData.unmatched.find((x) => x.name === '样本菜甲') || {}).zeroAmount === false);
  check('6-⑧ 自失效护栏：样本里含 0 元行与正常行各一（判据面非退化）',
    pageData.unmatched.length === 2);
}
// 页面算出来的东西**必须真被 wxml 渲染**（本仓反复踩过的「算了不渲染」族）
const WXML_REL = 'pages/m3/dishreview/index.wxml';
const wxmlNoCmt = rd(WXML_REL).replace(/<!--[\s\S]*?-->/g, ' ');
check('6-⑨ wxml 真渲染成因说明与平台合计（剥注释后判，防注释骗过）', judgePlatformSummary(wxmlNoCmt));
check('6-⑩ 自检：合成的「只渲染标题、不渲染合计」样本必须判红',
  judgePlatformSummary('<view class="section-title">{{t.reviewTakeaway}} · {{item.platformName}}</view>') === false);
check('6-⑪ 自失效护栏：wxml 扫描面非空', wxmlNoCmt.length > 300, wxmlNoCmt.length + ' 字符');

// ============ ⑦ 菜名映射表接线（R253 决策 2）============
// 缺口：菜品匹配只走 `normalizeDishName`（trim + NFKC，**保留规格后缀与括号**）⇒
//   平台写「耙牛肉(小份)」而成本卡叫「耙牛肉」时两边归一后仍不等 ⇒ **静默落 unmatched**。
//   映射表（shop_dish_mapping）是人工一次性挂钩（平台菜品 → 本地卡），比字符串猜名可靠。
// 🔴 本节最重要的两条是 7-①/7-②（**回落等价**）：
//   映射表为空 / 未注入时，行为必须与接线前**逐字相同** —— 否则本次改动会让所有存量用户
//   "忽然全菜不匹配"，且**不报错**（比不接线更坏）。
// 🔴 期望值全部手推，不从被测模块读回。
console.log('\n============ ⑦ 菜名映射表接线（R253 决策 2）============');

// ⚠️ created_at 必须传 **Date**（toMonth 真口径是 getUTCFullYear ⇒ 传 ISO 串会抛）
const CARD_FIX = [
  { card_code: 'C001', version: 1, name: '耙牛肉', total_cost: 1200, created_at: new Date('2026-09-01T00:00:00Z') },
  { card_code: 'C001', version: 2, name: '耙牛肉', total_cost: 1350, created_at: new Date('2026-10-01T00:00:00Z') },
  { card_code: 'C002', version: 1, name: '小面', total_cost: 300, created_at: new Date('2026-09-05T00:00:00Z') },
];
const BASE_DEPS = { normalizeDishName, toMonth };

// ---- 7-①/7-② 回落等价（防存量用户受伤）----
{
  const sales = [
    { dish_key: '耙牛肉', qty: 10, amount: 12000, platform: 'pos' },
    { dish_key: '小面', qty: 5, amount: 3000, platform: 'pos' },
    { dish_key: '没成本卡的菜', qty: 2, amount: 2000, platform: 'pos' },
  ];
  const before = JSON.stringify(buildDishReview(sales, CARD_FIX, BASE_DEPS));   // 接线前形态
  const noMap = JSON.stringify(buildDishReview(sales, CARD_FIX,
    { normalizeDishName, toMonth, lookupCardCode: null }));                      // 接线后·无映射表
  check('7-① 不注入 lookupCardCode ⇒ 输出与接线前**逐字相同**（存量用户零影响）',
    before === noMap, before === noMap ? 'len=' + before.length : '前≠后');
  const emptyMap = JSON.stringify(buildDishReview(sales, CARD_FIX,
    { normalizeDishName, toMonth, lookupCardCode: () => '' }));                  // 接线后·空表
  check('7-② 映射表为空（恒返空串）⇒ 输出仍与接线前逐字相同',
    before === emptyMap);
  check('7-③ 自失效护栏：判据面非退化 —— 样本含已匹配 2 行 + 未匹配 1 行',
    JSON.parse(before).dine_in.length === 2 && JSON.parse(before).unmatched.length === 1,
    'ranked=' + JSON.parse(before).dine_in.length + ' unmatched=' + JSON.parse(before).unmatched.length);
}

// ---- 7-④/7-⑤ 映射真的能救回「名字对不上」的行（先证缺口真存在）----
{
  const sales = [{ dish_key: '耙牛肉(小份)', qty: 3, amount: 4500, platform: 'pos' }];
  const noMap = buildDishReview(sales, CARD_FIX, BASE_DEPS);
  check('7-④ 无映射时「耙牛肉(小份)」确实匹配不上（缺口真实存在，映射非多此一举）',
    noMap.unmatched.length === 1 && noMap.dine_in.length === 0,
    'unmatched=' + noMap.unmatched.length);
  const withMap = buildDishReview(sales, CARD_FIX,
    { normalizeDishName, toMonth, lookupCardCode: (k, p) => (p === 'pos' && k === '耙牛肉(小份)' ? 'C001' : '') });
  check('7-⑤ 挂上映射后同一行匹配成功，且用**最新版本**成本 1350（3×1350=4050）',
    withMap.dine_in.length === 1 && withMap.dine_in[0].card_code === 'C001'
    && withMap.dine_in[0].totalCostFen === 4050 && withMap.dine_in[0].grossFen === 450,
    JSON.stringify(withMap.dine_in[0] || withMap.unmatched));
}

// ---- 7-⑥ 脏映射（指向不存在的卡）不得把本来能匹配的行打掉 ----
{
  const sales = [{ dish_key: '小面', qty: 5, amount: 3000, platform: 'pos' }];
  const r = buildDishReview(sales, CARD_FIX,
    { normalizeDishName, toMonth, lookupCardCode: (k) => (k === '小面' ? 'NO_SUCH_CARD' : '') });
  check('7-⑥ 映射指向不存在的卡 ⇒ 回落名称匹配（5×300=1500，仍挂 C002）',
    r.dine_in.length === 1 && r.dine_in[0].card_code === 'C002' && r.dine_in[0].totalCostFen === 1500,
    JSON.stringify(r.dine_in[0] || r.unmatched));
}

// ---- 7-⑦ 平台隔离：同一 dish_key 在不同平台可挂不同卡，不得串卡 ----
{
  const lookup = (k, p) => ({ 'meituan|招牌面': 'C002', 'taobao|招牌面': 'C001' }[p + '|' + k] || '');
  const deps = { normalizeDishName, toMonth, lookupCardCode: lookup };
  const mt = rankReview([{ dish_key: '招牌面', qty: 2, amount: 2000, platform: 'meituan' }], CARD_FIX, deps);
  const tb = rankReview([{ dish_key: '招牌面', qty: 2, amount: 2000, platform: 'taobao' }], CARD_FIX, deps);
  check('7-⑦ 美团行挂 C002、淘宝行挂 C001（查表带平台键，跨平台不串卡）',
    mt.ranked[0] && tb.ranked[0] && mt.ranked[0].card_code === 'C002' && tb.ranked[0].card_code === 'C001',
    'mt=' + JSON.stringify((mt.ranked[0] || {}).card_code) + ' tb=' + JSON.stringify((tb.ranked[0] || {}).card_code));
  check('7-⑧ 自失效护栏：两平台样本的卡不同（否则该判据已退化成常量）',
    mt.ranked[0] && tb.ranked[0] && mt.ranked[0].card_code !== tb.ranked[0].card_code);
}

// ---- 7-⑨ 映射查找键必须用 dish_key，不得用销量行的 external_ref_id（含日期 ⇒ 天天失配）----
{
  const SERVICE_SRC = rd('cloudfunctions/getDishReview/service.js');
  const codeNoCmt = SERVICE_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  check('7-⑨a service.js 查映射表时传的是 dishKey（而非含日期的 external_ref_id）',
    /lookupCardCode\(\s*dishKey\s*,/.test(codeNoCmt));
  const IDX_SRC = rd('cloudfunctions/getDishReview/index.js');
  const idxNoCmt = IDX_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  check('7-⑨b index.js 读 shop_dish_mapping 集合（接线落地，不是只有注释）',
    /listAll\(\s*'shop_dish_mapping'/.test(idxNoCmt));
  check('7-⑨c index.js 读映射表失败不阻断主流程（try/catch 兜底，缺失即回落）',
    /catch\s*\([^)]*\)\s*\{\s*mapping\s*=\s*\[\]\s*;/.test(idxNoCmt));
}

// ---- 7-⑩ 红线 17 回归：仍未匹配的必须单列返回，绝不静默归零 ----
{
  const r = buildDishReview([{ dish_key: '完全没卡的菜', qty: 7, amount: 7000, platform: 'pos' }],
    CARD_FIX, { normalizeDishName, toMonth, lookupCardCode: () => '' });
  check('7-⑩ 未匹配仍单列返回且 qty/amount 原样带出（红线 17）',
    r.unmatched.length === 1 && r.unmatched[0].dish_key === '完全没卡的菜'
    && r.unmatched[0].qty === 7 && r.unmatched[0].amountFen === 7000,
    JSON.stringify(r.unmatched));
  check('7-⑪ 未匹配不进 ranked，但仍计入 totals.qty/amountFen（不得凭空消失）',
    r.dine_in.length === 0 && r.totals.qty === 7 && r.totals.amountFen === 7000 && r.totals.grossFen === 0,
    JSON.stringify(r.totals));
}

// ============ ⑧ 全渠道 totals（堂食 + 外卖）—— R254 ============
// 真云实证缺陷（2026-10-09 模拟器逻辑层探针，证据见 review/evidence/r254_cloud_probe/）：
//   顶层 totals 原只取 buildDishReview 的产物（**仅堂食**），外卖那份 takeawayResult.totals 被丢弃；
//   而前端主结论卡渲染的正是这个顶层 totals（pages/m3/dishreview/index.wxml 的 {{totals.qty}} 等）
//   ⇒ 纯外卖店铺（本仓真云现状：堂食 0 行、taobao 51 道菜）主结论卡恒显示
//     「份数 0 / 营收 ¥0.00 / 成本 ¥0.00 / 毛利 ¥0.00」，而同一屏平台块里明明白白有数据
//     ⇒ 用户视角＝「导进来了但合计是 0」。
//
// 🔴 判据仍走「真调生产纯函数」+「源码面反恒真」，不靠字面扫描（改名即绕过）。
// 🔴 期望值手推：外卖 2 行（qty 2+4=6，amount 1520+1200=2720；均无同名成本卡 ⇒ 全部未匹配）。
console.log('\n============ ⑧ 全渠道 totals（R254）============');

{
  const SVC8 = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js'));
  const mergeTotals8 = SVC8.mergeTotals;
  const buildTakeawayReview8 = SVC8.buildTakeawayReview;

  // ---- 8-① / 8-② mergeTotals 自身的逐字段相加（真调生产）----
  const a8 = { qty: 3, amountFen: 3000, costFen: 1200, grossFen: 1800, dishCount: 2, unmatchedCount: 1 };
  const b8 = { qty: 5, amountFen: 5000, costFen: 2000, grossFen: 3000, dishCount: 4, unmatchedCount: 3 };
  const m8 = (typeof mergeTotals8 === 'function') ? mergeTotals8(a8, b8) : null;
  check('8-① mergeTotals 已导出且六字段逐项相加（真调生产）',
    !!m8 && m8.qty === 8 && m8.amountFen === 8000 && m8.costFen === 3200
    && m8.grossFen === 4800 && m8.dishCount === 6 && m8.unmatchedCount === 4,
    JSON.stringify(m8));
  const z8 = (typeof mergeTotals8 === 'function') ? mergeTotals8(undefined, undefined) : null;
  check('8-② 缺省入参按 0 处理（不抛、不产出 NaN）',
    !!z8 && Object.keys(z8).length === 6
    && Object.keys(z8).every(function (k) { return z8[k] === 0; }),
    JSON.stringify(z8));

  // ---- 8-③ / 8-④ 核心场景：堂食 0 行 + 外卖有数据 ⇒ 合并后 totals 必须等于外卖那份 ----
  const TAKE8 = [
    { dish_key: '★发鱿鱼', qty: 2, amount: 1520, platform: 'taobao' },
    { dish_key: '加个油碟', qty: 4, amount: 1200, platform: 'taobao' },
  ];
  const dine8 = buildDishReview([], CARD_FIX, BASE_DEPS);
  const take8 = buildTakeawayReview8(TAKE8, CARD_FIX, BASE_DEPS);
  const merged8 = (typeof mergeTotals8 === 'function') ? mergeTotals8(dine8.totals, take8.totals) : null;
  check('8-③ 纯外卖店铺：堂食 totals 全 0，合并后 qty 必须 = 外卖 qty = 6（绝不为 0）',
    dine8.totals.qty === 0 && !!merged8 && merged8.qty === take8.totals.qty && merged8.qty === 6,
    'dine=' + JSON.stringify(dine8.totals) + ' take=' + JSON.stringify(take8.totals)
    + ' merged=' + JSON.stringify(merged8));
  check('8-④ 合并后 amountFen 必须 = 外卖 amountFen = 2720，且 unmatchedCount = 2',
    !!merged8 && merged8.amountFen === 2720 && take8.totals.amountFen === 2720
    && merged8.unmatchedCount === 2,
    JSON.stringify(merged8));

  // ---- 8-⑤ ~ 8-⑦ 源码面：index.js 必须真的走 mergeTotals，且旧写法绝迹 ----
  const idxNo8 = stripComments(idxSrc);
  const RE_MERGE = /totals\s*=\s*mergeTotals\s*\(/;
  // 🔴 闭括号绝不能被 [,}] 吃掉：首版写成 `[,}][^}]*\}` ⇒ 旧形态 `unmatched, totals }` 里
  //    的 `}` 被 [,}] 消耗掉，后面再找 `}` 找不到 ⇒ **旧写法反而匹配不上**（M1b 实证假绿）。
  //    改为 `\s*,?\s*\}`：逗号可选、闭括号单独匹配。
  const RE_OLD = /\{\s*[^}]*\btotals\s*,?\s*\}\s*=\s*buildDishReview\s*\(/;
  check('8-⑤ index.js 顶层 totals 走 mergeTotals（剥注释后真查调用点）',
    RE_MERGE.test(idxNo8),
    RE_MERGE.exec(idxNo8) ? RE_MERGE.exec(idxNo8)[0] : '未命中');
  // 🔴 反恒真：只认「把 totals 直接当绑定名取走」这一种旧形态（totals 后紧跟 , 或 }）。
  //    新写法是 `totals: dineTotals`（后跟冒号）⇒ 不被误伤；改回 `totals` ⇒ 当场转红。
  check('8-⑥ 旧写法「只从 buildDishReview 取 totals」已绝迹（反恒真）',
    !RE_OLD.test(idxNo8),
    '命中即说明顶层 totals 又退回仅堂食');
  check('8-⑦ mergeTotals 从 service 单源取，index.js 不得内联第二份',
    /require\(['"]\.\/service['"]\)/.test(idxNo8) && /mergeTotals/.test(idxNo8)
    && !/function\s+mergeTotals/.test(idxNo8));

  // ---- 8-⑧ 自失效护栏（R182 纪律：扫描面非退化 + 关键锚点在场）----
  check('8-⑧ 扫描面非退化：index.js / service.js 均在场且关键锚点在场',
    idxSrc.length > 1000 && svcSrc.length > 1000
    && /mergeTotals/.test(svcSrc) && /exports\.main/.test(idxSrc)
    && /buildTakeawayReview/.test(svcSrc));
}

// ============ ⑨ 外卖毛利率「口径说明」必须与指标同屏（R259）============
// 缺口（R258 核查发现）：复盘的毛利率 = `销量表金额 − 销量×卡内成本`，而
//   · 堂食侧「销量表金额」= 售价 ⇒ `售价 − 食材成本`，叫毛利率**没毛病**；
//   · **外卖侧那是平台侧金额（顾客实付/商品原价），不是商家到手** ⇒ 佣金、配送、
//     商家补贴**全被算进了毛利**（实测锚点：规范 v1.2 §1.1 外卖到手率仅 **66.67%**，
//     即 33% 里有大半是平台费用）。
// ⇒ 「其他费用不填只出毛利」本身可行，但**不加口径说明就会让老板拿虚高的数去定价**。
// 李老师 2026-10-10 裁定：**指标名保持「毛利率」**（不叫"食材毛利率"），
//   故本段守的是「**同屏口径说明**」，不是改名。
function section9() {
  const terms = rd('miniprogram/i18n/terms.js');
  const termsMirror = rd('specs/dev-specs/i18n/terms.js');
  const wxmlSrc = rd('pages/m3/dishreview/index.wxml');
  const pageSrc = rd('pages/m3/dishreview/index.js');

  const m = /reviewTakeawayMarginNote:\s*'([^']*)'/.exec(terms);
  check('9-① 口径说明文案存在（外卖毛利率必须与说明同屏，否则用户拿虚高数定价）',
    !!m && m[1].length > 0, m ? m[1] : 'n/a');
  // 判「说了什么」而不是判字面：必须点出**未扣平台费用**这件事
  check('9-② 说明必须点明「未扣平台佣金/配送」（只说"仅供参考"不够 —— 要给出差在哪）',
    !!m && /佣金/.test(m[1]) && /配送/.test(m[1]) && /(未扣|不含|没扣)/.test(m[1]),
    m ? m[1] : 'n/a');
  // 李老师裁定：**不得**改叫「食材毛利率」
  check('9-③ 🔴 指标名保持「毛利率」——说明里不得出现「食材毛利率」（李老师 2026-10-10 裁定）',
    !!m && m[1].indexOf('食材毛利率') < 0, m ? m[1] : 'n/a');
  check('9-④ 页面 t:{} 已登记该键（漏映射 ⇒ 渲染成**空白**且零报错，R124 同族）',
    /reviewTakeawayMarginNote:\s*TERMS\.\w+\.reviewTakeawayMarginNote/.test(pageSrc),
    String(/reviewTakeawayMarginNote:\s*TERMS\./.test(pageSrc)));
  check('9-⑤ 🔴 说明渲染在**外卖区块内**（放在堂食区块 = 把干净的堂食说脏）',
    /<block wx:if="\{\{takeaway\}\}">[\s\S]{0,400}reviewTakeawayMarginNote/.test(wxmlSrc),
    String(/<block wx:if="\{\{takeaway\}\}">[\s\S]{0,400}reviewTakeawayMarginNote/.test(wxmlSrc)));
  // ⚠️ 首版写成「堂食区块内不得出现」用的是 `wx:if="{{dineIn` 前缀 → 实际堂食块是
  //   `<view class="card2" wx:if="{{dineIn.length}}">` ⇒ 恒不匹配 ⇒ **恒真断言**（假绿）。
  //   ⇒ 改成两条有分辨力的：① 只渲染一处（防同页两句口径互相打架）② 必须走 `t.` 绑定（页面零硬编码红线）
  const noteHits = (wxmlSrc.match(/reviewTakeawayMarginNote/g) || []).length;
  check('9-⑥ 该说明在页面只渲染**一处**（同页两句口径会互相打架）',
    noteHits === 1, `命中 ${noteHits} 处`);
  check('9-⑦ 渲染走 `t.` 绑定、不得把中文硬写进 wxml（本仓「页面零硬编码」红线）',
    /\{\{t\.reviewTakeawayMarginNote\}\}/.test(wxmlSrc)
    && !/<\/text>[^<]*未扣[^<]*/.test(wxmlSrc));
  check('9-⑧ terms 两副本逐字节一致（改单副本 ⇒ 页面静默空白）',
    terms.length > 0 && terms === termsMirror);
  // 自失效护栏：扫描面非退化 + 关键锚点在场
  check('9-⑨ 自失效护栏：wxml / terms 非空且外卖区块锚点在场',
    wxmlSrc.length > 500 && terms.length > 1000
    && /<block wx:if="\{\{takeaway\}\}">/.test(wxmlSrc) && /reviewMargin:/.test(terms));
}
section9();

// ============ ⑩ 未匹配清单按营收降序（R261）============
// 缺口：后端返回的是**首见顺序**，而真实数据下未匹配有 51 行（外卖商品表）/ 270 行（堂食菜品表）
//   ⇒ 用户得逐行读才知道"哪道菜影响最大"。降序后大头在最上面，批量关联（R260）先处理值得处理的那批。
// 🔴 这类排序的失效方式是**静默**的：把 `.sort()` 挪到 `.map()` **之后**，
//    行里只剩 `amountText`（字符串）⇒ 减法得 NaN ⇒ 比较器恒返回 falsy ⇒ **顺序原地不动**，
//    页面照样渲染、零报错。⇒ 判据必须钉住「排序发生在 map 之前」这个**位置不变式**。
function section10() {
  const pageSrc = rd('pages/m3/dishreview/index.js');
  check('10-① 未匹配清单按营收降序（比较器真的用了 amountFen 的差）',
    /\(b\.amountFen - a\.amountFen\)/.test(pageSrc));
  check('10-② 有稳定化兜底（同额按份数、再按菜名）—— 否则两次 load 顺序抖动，用户以为数据变了',
    /\|\| \(b\.qty - a\.qty\)/.test(pageSrc) && /localeCompare/.test(pageSrc));
  // 🔴 位置不变式：先 sort 后 map（挪到 map 之后 ⇒ 排的是字符串，静默不动）
  const iSorted = pageSrc.indexOf('const unmatchedSorted = Array.from(unmatchedMap.values()).sort(');
  const iMapped = pageSrc.indexOf('const unmatched = unmatchedSorted.map(');
  check('10-③ 🔴 排序发生在 map **之前**（`unmatched` 由 `unmatchedSorted.map(` 而来）'
    + ' —— 挪到 map 之后 ⇒ 排的是 amountText 字符串、顺序原地不动且零报错',
    iSorted >= 0 && iMapped > iSorted, 'sort@' + iSorted + ' < map@' + iMapped);
  // 自失效护栏：扫描面非退化 + 关键锚点在场
  check('10-④ 自失效护栏：页面源码非空且未匹配清单的构造锚点在场',
    pageSrc.length > 1000 && /unmatchedMap/.test(pageSrc) && /const unmatchedSorted/.test(pageSrc));
  // 影子样本：把排序挪到 map 之后（拿字符串排）⇒ 上述判据必须判红
  const SHADOW = 'const unmatched = Array.from(unmatchedMap.values()).map((x) => ({ amountText: "1" }));\n'
    + 'const late = [].sort((a, b) => (b.amountFen - a.amountFen) || (b.qty - a.qty));';
  const shadowOk = SHADOW.indexOf('const unmatched = unmatchedSorted.map(') >= 0
    && SHADOW.indexOf('const unmatchedSorted = Array.from(unmatchedMap.values()).sort(') >= 0;
  check('10-⑤ 影子：把排序挪到 map 之后的写法 ⇒ 10-③ 判据失效（证明该判据有分辨力）',
    shadowOk === false, String(shadowOk));
}
section10();

console.log('\n===== getDishReview 算法层守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
})().catch(function (e) {
  console.log('  ❌ ⑥ 段未捕获异常（按 fail-closed 判红）：' + ((e && e.message) || e));
  console.log('\n===== getDishReview 算法层守卫结果：' + pass + ' 通过 / ' + (failN + 1) + ' 失败 =====');
  process.exit(1);
});
