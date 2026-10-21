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
    // 🔴 R301：ui 替身必须**从真实模块派生**，只覆盖测试要钉死的那两个函数。
    //   原写法是**手写白名单** `{ setTitle, nowMonth }` ⇒ 页面一用上 `ui` 的新函数
    //   （本轮 `ui.monthRange`）替身就缺符号 ⇒ `load()` 抛异常 ⇒ 6-① 误红。
    //   这是 R97「mock 没有真云的 `_id` 语义」的**同族**：**替身会漂**。
    //   ⇒ 改为 spread 真实模块 + 只覆盖 `setTitle`（会调 wx）/ `nowMonth`（要**确定性**月份）。
    if (/utils[\\/]ui\.js$/.test(request)) {
      return Object.assign({}, origLoadM.apply(this, arguments), {
        setTitle: () => {},
        nowMonth: () => '2026-10',
      });
    }
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

// ===== ⑪ 段（R262）：「卡不够挂」的显式引导 =====
// 真机实证（李老师 2026-10-10）：店里有 3 张成本卡（鱼香肉丝/炸鸡腿/肥炸鸡腿），外卖 51 道菜
//   ⇒ 未匹配清单每行 picker 只有这 3 张可选；而旧代码**只在 `cardOptions.length === 0`** 时
//   显示「本店还没有成本卡」⇒ 有卡但不够时**零提示**，用户只能盲目关联。
//   🔴 最坏的不是"关联不上"，是"关联错了"：把黄喉挂到鱼香肉丝 ⇒ 食材成本按错的算，
//      且**用户会信那个数**（毛利榜照常出数）⇒ 比"暂时不算"更坏。
function section11() {
  const pageSrc = rd('pages/m3/dishreview/index.js');
  const wxmlSrc = rd('pages/m3/dishreview/index.wxml');
  const termsSrc = rd('miniprogram/i18n/terms.js');
  check('11-① 文案单源：terms.js 有 reviewMapShortCard 且带 {n} 占位（缺口数字走占位，页面不拼中文）',
    /reviewMapShortCard:\s*'[^']*\{n\}[^']*'/.test(termsSrc));
  check('11-② 前端真的替换了占位（否则用户看到字面 {n}）',
    /reviewMapShortCard\)\.replace\('\{n\}'/.test(pageSrc));
  // 🔴 判「需求」而非「我改过什么」：缺口 = 未匹配数 − 卡数，**不是**"卡数是否为 0"。
  //   旧行为正是只看 cardOptions.length ⇒ 3 张卡 vs 51 道菜时零提示（本轮真机卡点的根因）。
  check('11-③ 🔴 缺口按「未匹配数 − 卡数」算（不是只看卡数是否为 0）—— 只看卡数 ⇒ 3 卡 51 菜时零提示',
    /unmatched\.length - \(cardOptions \|\| \[\]\)\.length/.test(pageSrc));
  check('11-④ 引导只在缺口 > 0 时出现（卡够用时不打扰）',
    /shortCardGap > 0/.test(pageSrc) && /shortCardGap > 0/.test(wxmlSrc));
  check('11-⑤ 自失效护栏：三份源码非空且关键锚点在场',
    pageSrc.length > 1000 && wxmlSrc.length > 200 && termsSrc.length > 1000
    && /shortCardText/.test(pageSrc) && /reviewGoCard/.test(wxmlSrc));
}
section11();

// ===== ⑫ 段（R264）：覆盖率明示 + 行内「去建卡」带菜名预填 + 卡不够不给批量按钮 =====
// 真机实证（李老师 2026-10-10）：外卖 51 道菜、店里 3 张成本卡 ⇒ 界面只说「未匹配 51 道」，
//   用户看不到"已经算出几道"、也无从判断"先建哪道最划算"，面对长清单无从下手（当场卡住）。
// 三件事：
//   A 覆盖率按**金额**算（不按行数 —— 真表有 43 份 0 元的口味询问类 SKU，按行数会稀释分母）；
//   B 行内「去建卡」带菜名预填（免手打 —— 菜名打错一个字 = 建了另一道菜的卡，回来照样匹配不上）；
//   C 卡不够时**不给**批量关联按钮（猜错的预选被一次性写进库 ⇒ 成本算错且毛利照常出数）。
function section12() {
  const pageSrc = rd('pages/m3/dishreview/index.js');
  const wxmlSrc = rd('pages/m3/dishreview/index.wxml');
  const editSrc = rd('subpkg/biz/card/edit.js');
  const termsSrc = rd('miniprogram/i18n/terms.js');

  check('12-① 文案单源：terms.js 有 reviewCoverage 且带 {n}/{m}/{p} 三个占位（页面不拼中文）',
    /reviewCoverage:\s*'[^']*\{n\}[^']*\{m\}[^']*\{p\}[^']*'/.test(termsSrc));
  check('12-② 前端真的替换了三个占位（否则用户看到字面 {n} / {m} / {p}）',
    /reviewCoverage\)\s*\.replace\('\{n\}'/.test(pageSrc)
    && /\.replace\('\{m\}'/.test(pageSrc)
    && /\.replace\('\{p\}'/.test(pageSrc));
  // 🔴 判「需求」：覆盖率的分母必须是**金额**，不是行数。
  //   真表 355 行里有 43 份 0 元的口味询问类 SKU ⇒ 按行数算会把它们计入分母，覆盖率被稀释。
  // ⚠️ 判「语义」不判「排版」：只看 pct 那一行用不用金额（rankedFen/allFen），
  //   不钉死乘除顺序（`(a*100)/b` 与 `a/b*100` 等价 ⇒ 钉死顺序会造成反向伤害第二型）。
  const pctLine = (pageSrc.match(/const coveragePct = [^\n]*/) || [''])[0];
  check('12-③ 🔴 覆盖率按金额算（pct 的分母是营收 allFen，不是道数 coverageCount）'
    + ' —— 按行数算 ⇒ 0 元的口味询问类 SKU 稀释分母',
    /rankedFen/.test(pctLine) && /allFen/.test(pctLine) && !/coverageCount/.test(pctLine)
    && /const allFen = rankedFen \+ unmatchedFen/.test(pageSrc)
    && /Number\(x\.amountFen\)/.test(pageSrc)
    && /amountFen: x\.amountFen \|\| 0/.test(pageSrc));
  // 🔴 R299 升级（原判据的盲区）：旧判据只问「用没用 Set 去重」（`/dishNames\.add/ && /dishNames\.size/`），
  //   **不问「去重用的那个字段在两侧是不是同一个命名空间」** —— 属"守了形状、没守语义"（R298Y 同族）。
  //   实况（修复前）：两侧都取 `.name`，而 `.name` 语义不同 ——
  //     · 已匹配行 `service.js:95` ⇒ `card.name || dishKey`（**成本卡名**）
  //     · 未匹配行 `service.js:86` ⇒ `dishKey`（**菜名**）
  //   ⇒ 多张菜挂到同一张卡时「共 N 道」少算；卡名与某未匹配菜名碰巧同名时两个数一起错（用户可见的错数）。
  //   新判据 = 「菜品身份 `dishKey` 被带出 + 三侧(堂食/外卖/未匹配)都按它去重 + 旧命名空间不得复活」。
  //   ⚠️ 必须**钉住去重参数的实参**（`dishKeys.add(x.dishKey)`）而不只是"调了 add"：
  //      只数 `dishKeys.add(` 的次数时，把实参换成 `x.name` 照样是 3 次 ⇒ 判据恒真（本判据首版即此病）。
  //   ⚠️ `dishKey:` 那条腿必须**锚定在 `fmtRanked` 函数体内**：同文件 `pushUnmatched` 里另有一处
  //      `dishKey: x.dish_key || nm`，若只做全文匹配，把 `fmtRanked` 的那行删掉判据**照样绿**
  //      （变异 M3 实测抓到 —— "探测器坏了与命中 0 长得一样"）。
  const coverageAddKey = (pageSrc.match(/dishKeys\.add\(x\.dishKey\)/g) || []).length;
  const coverageAddName = (pageSrc.match(/dishKeys\.add\(x\.name\)/g) || []).length;
  check('12-④ 🔴 覆盖率「道数」三侧一律按 `dishKey`（菜品身份）去重，不得用 `.name`'
    + ' —— `.name` 在已匹配行是**成本卡名**、在未匹配行是**菜名**，混算 ⇒「共 N 道 / 已算 M 道」一起错',
    /fmtRanked\(x\)\s*\{[\s\S]{0,700}?dishKey:\s*x\.dish_key/.test(pageSrc)
    && coverageAddKey >= 3
    && coverageAddName === 0
    && /const coverageCount = dishKeys\.size/.test(pageSrc)
    && /new Set\(unmatched\.map\(\(x\) => x\.dishKey\)\)/.test(pageSrc)
    && !/dishNames/.test(pageSrc));
  check('12-⑤ 覆盖率条真的渲染出来（wxml 引用 coverageText，且只在有菜时显示）',
    /coverageCount/.test(wxmlSrc) && /coverageText/.test(wxmlSrc));
  check('12-⑥ 除零保护：营收为 0 时覆盖率取 0，不得产出 NaN/Infinity',
    /allFen > 0 \?/.test(pageSrc) && /: 0;/.test(pageSrc));

  // P0-B：行内「去建卡」带菜名预填
  check('12-⑦ 复盘页「去建卡」跳转带 dish_name，且菜名经 encodeURIComponent 编码'
    + ' —— 菜名含空格/括号/加号时会截断或被解成空格（静默错名）',
    /dish_name=' \+ encodeURIComponent\(/.test(pageSrc));
  check('12-⑧ 建卡页 onLoad 接住 dish_name 并 decodeURIComponent 回填到 name',
    /decodeURIComponent\(q\.dish_name\)/.test(editSrc) && /setData\(\{ name: prefillName \}\)/.test(editSrc));
  // 🔴 只在**新建**时生效：编辑态下 load() 会用卡里的名字回填，预填覆盖它就是"改了名还以为没改"。
  check('12-⑨ 🔴 预填只在新建态生效（编辑态不得覆盖卡里的菜名）',
    /prefillName\s*&&\s*!\(\(q && q\.card_code\)/.test(editSrc));
  check('12-⑩ 行内按钮把菜名带出去（wxml 绑定 data-name + goNewCard）',
    /data-name="\{\{item\.name\}\}" bindtap="goNewCard"/.test(wxmlSrc));

  // P1-B：卡不够时不给批量关联按钮
  check('12-⑪ 🔴 批量关联入口受 shortCardGap 约束（卡数 < 未匹配数 ⇒ 不渲染该按钮）'
    + ' —— 猜错的预选会被一次性写进库，成本算错且毛利照常出数',
    /cardOptions\.length && shortCardGap <= 0/.test(wxmlSrc));
  check('12-⑫ 自失效护栏：四份源码非空且关键锚点在场',
    pageSrc.length > 1000 && wxmlSrc.length > 200 && editSrc.length > 1000 && termsSrc.length > 1000
    && /coverageText/.test(pageSrc) && /goNewCard/.test(pageSrc) && /shortCardGap/.test(pageSrc));

  // 🔴 R299 新增（缺陷 D3）：**只读页「返回本页必须刷新」**。
  //   「去建卡 / 去映射」在本页是 `navigateTo` 跳走再回来（R264 专门设计的闭环），而本页
  //   `enablePullDownRefresh: false`（无下拉刷新）、旧 `onShow` 又**只在 locked 时**重载
  //   ⇒ 返回后页面全然不刷新：刚建的卡不进关联 picker、刚挂的菜不进榜、`unmatched` 也不减少
  //   ⇒ 用户以为「卡没建上 / 关联失败」并重复操作。
  //   本页是**只读页**（零未保存输入）⇒ 返回时重载是安全且期待的；对照 `subpkg/biz/card/index.js:122`
  //   同类只读页即 `onShow(){this.load()}` ⇒ 说明这是遗漏，不是设计选择。
  //   判据 = `onShow` 的非 locked 路径必须重载 + 用 `_shown` 哨兵避免首次进入重复拉。
  const ON_SHOW_RELOAD = /onShow\(\)\s*\{[\s\S]{0,400}?if\s*\(this\._shown\)\s*this\.load\(\)/;
  check('12-⑬ 🔴 只读页返回时必须刷新（`onShow` 非 locked 路径重载 + `_shown` 哨兵防首次重复拉）'
    + ' —— 旧写法只在 locked 时重载 ⇒「去建卡」回来卡列表还是旧的，用户以为没建上',
    ON_SHOW_RELOAD.test(pageSrc) && /onLoad\(\)\s*\{\s*this\._shown\s*=\s*false;/.test(pageSrc)
    && /enablePullDownRefresh"\s*:\s*false/.test(rd('pages/m3/dishreview/index.json')));
  // 反恒真：把**旧写法**（只在 locked 时重载）喂给上面那条判据 ⇒ 必须判不通过。
  const OLD_ONSHOW = "onShow() { if (this.data.locked) this.init(); },";
  check('12-⑭ 反恒真：旧 onShow（只在 locked 时重载）必须判不通过（证明 ⑬ 有分辨力，不是恒真）',
    !ON_SHOW_RELOAD.test(OLD_ONSHOW));

  // 🔴 R299-Q（豆包评审采纳）：**汇总卡必须带标题**，且标题要写明口径「堂食+外卖」。
  //   为什么：那张「份数/营收/成本/毛利」卡的数据源是 `mergeTotals(堂食, 外卖)`＝**全渠道合计**，
  //   却无标题地夹在「堂食榜」与「外卖榜」之间 ⇒ 极易被读成"堂食小计"（读错一次就误判堂食盈利）。
  //   术语 `reviewTotals` 自引入（bcd3326）起**从未被渲染**（死键）⇒ 本轮借它补标题（零新增键），
  //   并把口径写进键值「汇总（堂食+外卖）」（键值也必须带口径 —— 只写"汇总"仍会被读成小计）。
  check('12-⑮ 🔴 汇总卡必须渲染标题，且标题键值写明口径「堂食+外卖」'
    + ' —— 无标题会被读成堂食小计（该卡实为全渠道合计）',
    /t\.reviewTotals/.test(wxmlSrc)
    && /section-title[^>]*>\s*\{\{t\.reviewTotals\}\}/.test(wxmlSrc)
    && /reviewTotals:\s*'[^']*堂食\s*\+\s*外卖[^']*'/.test(termsSrc));
  check('12-⑯ 反恒真：把"无标题"版本（只有 totals 卡、无 reviewTotals 引用）喂给 ⑮ ⇒ 必须判不通过',
    !(/section-title[^>]*>\s*\{\{t\.reviewTotals\}\}/.test('<view class="card2" wx:if="{{totals}}"></view>')));
}
section12();

// ===== ⑭ 段（R301）：**统计期间**（契约入参 `biz_date_from/to` 的补实现）=====
// 为什么（真缺陷，实锤"契约与实现分歧"）：
//   契约 `specs/dev-specs/core/10_云函数清单与接口契约.md` 的 `getDishReview` 一行**一直**声明
//   入参 `biz_date_from` / `biz_date_to`、出参 `range{from,to}`，而实现**从未读取** ⇒
//   复盘榜把该店**历次导入的多个月份全部累加**当成一份榜、页面却按"当前月"呈现
//   ⇒「这道菜这个月卖过」是错的（**静默错数**）。真样本就是 **7 天表**，"一段"冒充"整月"。
// 本段是**行为级**判据（真调 `filterByRange` 算），不是读源码字面 —— 防"改了字面量但函数没变"。
function section14() {
  const pageSrc = rd('pages/m3/dishreview/index.js');
  const wxmlSrc = rd('pages/m3/dishreview/index.wxml');
  const idxSrc = rd('cloudfunctions/getDishReview/index.js');
  const svcSrc = rd('cloudfunctions/getDishReview/service.js');
  const uiSrc = rd('utils/ui.js');

  // ① 实现**真的读**了契约入参（不是只写在注释里 —— 剥注释后再判，本仓「被注释喂成恒真」同族）
  const idxStripped = idxSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  check('14-① 🔴 实现真的读契约入参 `biz_date_from` / `biz_date_to`（剥注释后判）',
    /event\.biz_date_from/.test(idxStripped) && /event\.biz_date_to/.test(idxStripped)
    && /filterByRange\(/.test(idxStripped));

  // ② 出参如实回 `range`（前端不许猜期间）
  check('14-② 出参含 `range: { from, to, days }`（期间口径由云端给，前端不猜）',
    /range:\s*\{\s*from:\s*rangeFrom,\s*to:\s*rangeTo,\s*days:\s*rangeDays\s*\}/.test(idxSrc));

  // ③ ④ **行为级**：真调 filterByRange 验四条语义（区间内 / 任一端缺⇒不过滤 / 区间反⇒空 / 非法日期行剔除）
  const SVC_P = path.join(ROOT, 'cloudfunctions/getDishReview/service.js');
  let SVC = null;
  try { SVC = require(SVC_P); } catch (e) { SVC = null; }
  const ROWS = [
    { biz_date: '2026-09-30', qty: 1 }, { biz_date: '2026-10-01', qty: 1 },
    { biz_date: '2026-10-07', qty: 1 }, { biz_date: '2026-10-31', qty: 1 },
    { biz_date: '2026-11-01', qty: 1 },
  ];
  const r1 = SVC ? SVC.filterByRange(ROWS, '2026-10-01', '2026-10-31') : null;
  check('14-③ 🔴 行为：按区间过滤（跨月数据只留区间内 3 行 / days=3；9-30 与 11-01 必须被剔除）',
    !!r1 && r1.rows.length === 3 && r1.days === 3 && r1.from === '2026-10-01' && r1.to === '2026-10-31'
    && r1.rows.every((x) => x.biz_date >= '2026-10-01' && x.biz_date <= '2026-10-31'));
  const r2 = SVC ? SVC.filterByRange(ROWS, '2026-10-01', '') : null;
  const r3 = SVC ? SVC.filterByRange(ROWS, '2026-11-01', '2026-10-01') : null;
  check('14-④ 行为：**任一端缺 ⇒ 不过滤**（`range.from` 回空串，前端据此明说"不是单月"）'
    + ' + **区间反了 ⇒ 空集**（不静默当全量）',
    !!r2 && r2.rows.length === 5 && r2.from === '' && r2.days === 5
    && !!r3 && r3.rows.length === 0 && r3.days === 0);

  // ⑤ 前端**必须传**区间（这是"不许退回跨月累计"的前端侧钉子）+ 月→区间走单源
  check('14-⑤ 🔴 复盘页 load() 必须传 `biz_date_from/to`，且月→区间走单源 `utils/ui.js::monthRange`'
    + ' —— 不传 ⇒ 云端不过滤 ⇒ 跨月累计这个缺陷会**悄悄回来**',
    /api\.call\('getDishReview',\s*\{\s*biz_date_from:\s*rng\.from,\s*biz_date_to:\s*rng\.to\s*\}\)/.test(pageSrc)
    && /ui\.monthRange\(month\)/.test(pageSrc)
    && /monthRange\(ym\)\s*\{/.test(uiSrc));

  // ⑥ 期间**可见**：月份选择器 + 期间文案渲染；且"没有区间"时必须**明说不是单月**（不许假装本月）
  check('14-⑥ 期间可见：页面有月份选择器 + 渲染期间文案；且未过滤时必须**明说"不是单月"**',
    /fields="month"/.test(wxmlSrc) && /bindchange="onMonth"/.test(wxmlSrc)
    && /\{\{rangeText\}\}/.test(wxmlSrc) && /reviewRangeAll/.test(pageSrc)
    && /reviewRangeAll:/.test(rd('miniprogram/i18n/terms.js')));
  const lf = (a) => a.replace(/\r?\n/g, ' ');
  check('14-⑦ 反恒真：把「不传区间」的旧前端形态喂给 14-⑤ 的判据 ⇒ 必须判不通过',
    !/api\.call\('getDishReview',\s*\{\s*biz_date_from:\s*rng\.from,\s*biz_date_to:\s*rng\.to\s*\}\)/
      .test(lf("const d = await api.call('getDishReview', {});")));
  check('14-⑧ 自失效护栏：五份源码非空且关键锚点在场（防读空文件 ⇒ 恒真）',
    pageSrc.length > 1000 && wxmlSrc.length > 200 && idxSrc.length > 500
    && svcSrc.length > 1000 && uiSrc.length > 500
    && /filterByRange/.test(svcSrc) && /countDataDays/.test(svcSrc));
}
section14();
// 为什么（R297 第七轮 A1 复核实测的真缺陷）：
//   旧形态是 `service.js` 回中文字符串 `'偏高'/'偏低'/'合理'`，前端 `index.js` 再拿中文字符串
//   `bm.actualFlag === '偏高'` 取警示色 ⇒ **前后端靠中文字面量做接口契约**，两端还可能不同人改。
//   任一端改文案 ⇒ `buffet_flagClass` 静默变空 ⇒ 「成本偏高」的红色告警**消失**，零报错。
//   ⇒ 契约改为机器码（`'' | high | low | ok`），文案由 `TERMS.card.buffetFlag` 单源映射。
// 本段是**行为级**判据（真调 `computeCoverage` 算三档），不是读源码字面 —— 防"改了字面量但函数没变"。
function section13() {
  const TERMS_P = path.join(ROOT, 'miniprogram/i18n/terms.js');
  const SVC_P = path.join(ROOT, 'cloudfunctions/getDishReview/service.js');
  let FLAG_MAP = null, computeCoverage = null;
  try { FLAG_MAP = require(TERMS_P).TERMS.card.buffetFlag || null; } catch (e) { FLAG_MAP = null; }
  try { computeCoverage = require(SVC_P).computeCoverage || null; } catch (e) { computeCoverage = null; }

  if (!FLAG_MAP || typeof computeCoverage !== 'function') {
    check('13-① 前置：术语表 buffetFlag 与 computeCoverage 均可解析（fail-closed）', false,
      'flagMap=' + (FLAG_MAP ? 'ok' : 'null') + ' / fn=' + typeof computeCoverage);
    return;
  }
  const KEYS = Object.keys(FLAG_MAP);
  const SALES = [{ dish_key: '自助餐', category: 'buffet', amount: 10000, qty: 1 }];
  const codeOf = (costFen) => computeCoverage(SALES, new Set(), costFen).buffet.benchmark.actualFlagCode;
  const cHigh = codeOf(6000);     // 成本率 60% > 55% ⇒ 高
  const cOk = codeOf(4000);       // 40% ⇒ 合理
  const cLow = codeOf(2000);      // 20% < 25% ⇒ 低
  const cNone = codeOf(null);     // 本月自助食材消耗未填

  check('13-① 云端三档产出的码均 ∈ 术语表 buffetFlag 的键集（跨端契约 = 机器码）',
    cHigh !== '' && cOk !== '' && cLow !== '' &&
    KEYS.indexOf(cHigh) >= 0 && KEYS.indexOf(cOk) >= 0 && KEYS.indexOf(cLow) >= 0,
    'keys=' + KEYS.join('/') + ' 实测=' + [cHigh, cOk, cLow].join('/'));
  // ⚠️ 只判"三档互不相同"，**不钉死 'high'/'ok'/'low' 这三个字面量**（钉字面量会把改名判红、属反向伤害第二型）
  check('13-② 三档码互不相同（阈值方向没反、也没被压成同一档）',
    cHigh !== cOk && cOk !== cLow && cHigh !== cLow, [cHigh, cOk, cLow].join('/'));
  check('13-③ 未填成本 ⇒ 空码（不得把「没数据」当成「合理」）', cNone === '', JSON.stringify(cNone));
  check('13-④ 码里不含中文（一旦云端回中文，前端取色就会静默丢失）',
    !/[一-龥]/.test(String(cHigh) + cOk + cLow), cHigh + cOk + cLow);
  check('13-⑤ 契约里不再有中文字段 actualFlag（旧形态已移除，防回退）',
    computeCoverage(SALES, new Set(), 6000).buffet.benchmark.actualFlag === undefined);

  // 前端侧：色号表的键必须 ⊆ 云端码集 —— 否则云端新增/改名档位时，该档在前端**静默无色**
  const pageSrc13 = rd('pages/m3/dishreview/index.js');
  const clsBlock = (pageSrc13.match(/BUFFET_FLAG_CLS\s*=\s*\{([^}]*)\}/) || ['', ''])[1];
  const clsKeys = clsBlock.split(',').map((s) => (s.split(':')[0] || '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  check('13-⑥ 前端色号表键集 ⊆ 术语表键集（云端档位改名/新增不会静默无色）',
    clsKeys.length > 0 && clsKeys.every((k) => KEYS.indexOf(k) >= 0),
    'cls=[' + clsKeys.join('/') + '] keys=[' + KEYS.join('/') + ']');
  check('13-⑦ 判据自证：掺一个不存在的键进色号表 ⇒ 上面的包含判据必须不通过（证明 ⑥ 有分辨力，不是恒真）',
    !['high', '__round298_不存在的档__'].every((k) => KEYS.indexOf(k) >= 0));
  // 防回退：前端不得再拿中文字段取色（strip 掉 Code 后缀再查，避免 actualFlagCode 误命中）
  // 🔴 必须先剥注释：本判据的**说明注释里就举了旧写法 `bm.actualFlag === '偏高'` 这个例子**
  //   —— 直接扫源码会把注释判红（本仓已第三次踩「守卫被自己的说明注释绊红」，见 round107 A9-②）。
  const pageNoCmt13 = pageSrc13
    .replace(/^[ \t]*\/\/[^\n]*/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  check('13-⑧ 前端不再按中文字段 actualFlag 取色（旧形态已移除，防回退）',
    !/actualFlag\b/.test(pageNoCmt13.replace(/actualFlagCode/g, '')));
}
section13();

console.log('\n===== getDishReview 算法层守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
})().catch(function (e) {
  console.log('  ❌ ⑥ 段未捕获异常（按 fail-closed 判红）：' + ((e && e.message) || e));
  console.log('\n===== getDishReview 算法层守卫结果：' + pass + ' 通过 / ' + (failN + 1) + ' 失败 =====');
  process.exit(1);
});
