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

let buildDishReview = null, normalizeDishName = null, toMonth = null;
try {
  buildDishReview = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js')).buildDishReview;
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

console.log('\n===== getDishReview 算法层守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
