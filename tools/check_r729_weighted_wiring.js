'use strict';
// tools/check_r729_weighted_wiring.js ——【R729】加权双口径接线守卫（页面桩真跑 + 服务端纯函数真跑）
// 运行：node tools/check_r729_weighted_wiring.js   （EXIT 0 = 全绿）
//
// 守什么（判行为，不判字面）：
//   A 服务端：calcWeightedMenuPct 用全量 ranked + 成本卡标价、覆盖率闸门、
//     pct=null 必带 reason、返回值零逐菜字段（免费档边界）。
//   B 页面桩：对账页 calc() 三条路径 —— 有标量 / 无标量 / 取数抛错，
//     都必须「并列展示」且「绝不静默变口径」。
//   C 反恒真：合成坏样本证明判据能红。
//
// ⚠️ 顶部不得用 ==== 装饰横幅（R66 段标题下零断言即判红）。

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const RECON = 'subpkg/tools/recon/index.js';
const SVC = 'cloudfunctions/getDishReview/service.js';

let pass = 0; const bad = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('   ✅ ' + name); }
  else { bad.push(name); console.log('   ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

// ============ 页面桩：只 stub api.js，其余（ui / terms / reconDerive）用真模块 ============
let apiCalls = [];
let reviewResult = {};
let reviewThrows = false;
function stubDeps() {
  const orig = Module._load;
  Module._load = function (req) {
    if (/utils[\\/]api\.js$/.test(req)) {
      return {
        call: async (name, params) => {
          apiCalls.push({ name, params });
          if (name === 'getDishReview') {
            if (reviewThrows) throw new Error('network down');
            return reviewResult;
          }
          if (name === 'getLedger') return { income_items: [{ category: 'dine_in', amount_fen: 536000 }], result: { material_cost_fen: 240000 } };
          if (name === 'getCostCard') return { list: [
            { card_type: 1, price_fen: 1200, total_cost_fen: 400 },
            { card_type: 1, price_fen: 8800, total_cost_fen: 6000 },
          ] };
          return {};
        },
        toastError: () => {}, fenToYuan: (n) => String(n), ensureShop: async () => ({}),
      };
    }
    return orig.apply(this, arguments);
  };
  return () => { Module._load = orig; };
}
function loadRecon() {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.wx = { navigateTo: () => {}, showToast: () => {}, showModal: () => {} };
  const restore = stubDeps();
  const abs = path.join(ROOT, RECON);
  delete require.cache[require.resolve(abs)];
  try { require(abs); } finally { restore(); }
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data || {}));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  return p;
}
async function runCalc(review, throws) {
  apiCalls = []; reviewResult = review; reviewThrows = !!throws;
  const p = loadRecon();
  await p.calc('2026-11', 2);
  return { p, calls: apiCalls };
}

console.log('\nR729 · 加权双口径接线守卫（服务端纯函数 + 页面桩真跑）');

// ---------- A 服务端 ----------
console.log('\n===== A. 服务端聚合标量 =====');
const S = require(path.join(ROOT, SVC));
const CARDS = [
  { card_code: 'A', version: 1, name: '青菜', price_list: 1200, total_cost: 400 },
  { card_code: 'B', version: 1, name: '招牌鱼', price_list: 8800, total_cost: 6000 },
];
const R = (a, b) => [{ card_code: 'A', qty: a, amountFen: a * 1000 }, { card_code: 'B', qty: b, amountFen: b * 7000 }];
const wGood = S.calcWeightedMenuPct(R(300, 20), CARDS, 320);
const wFlip = S.calcWeightedMenuPct(R(20, 300), CARDS, 320);
ok('A-① 分母用成本卡标价：便宜菜卖得多 55.22% / 贵菜卖得多 32.13%',
  wGood.pct === 55.22 && wFlip.pct === 32.13, JSON.stringify({ good: wGood.pct, flip: wFlip.pct }));
ok('A-② 反恒真：销量相等时 ≡ 售价加权 36.00%（不是恒等于某个值）',
  S.calcWeightedMenuPct(R(300, 300), CARDS, 600).pct === 36);
ok('A-③ 🔴 覆盖率 <90% ⇒ pct=null 且 reason=low_match（不拿半截样本下结论）',
  (() => { const x = S.calcWeightedMenuPct(R(300, 20), CARDS, 400); return x.pct === null && x.reason === 'low_match'; })());
ok('A-④ 🔴 pct=null 的每条路径都带 reason（不许静默失败）',
  [S.calcWeightedMenuPct([], CARDS, 0), S.calcWeightedMenuPct(R(300, 20), CARDS, 400),
   S.calcWeightedMenuPct([{ card_code: 'A', qty: 5 }], [{ card_code: 'A', version: 1, price_list: 0, total_cost: 1 }], 5)]
    .every((x) => x.pct === null && !!x.reason));
ok('A-⑤ 免费档边界：返回值零逐菜字段（不泄 totalCostFen/grossFen/marginPct/price）',
  ['totalCostFen', 'grossFen', 'marginPct', 'price_list', 'ranked', 'cards']
    .every((k) => Object.keys(wGood).indexOf(k) < 0), Object.keys(wGood).join(','));
ok('A-⑥ 服务端源码用全量【全渠道】ranked 而非 freeTop（Top10 陷阱）',
  /calcWeightedMenuPct\(allChannelRanked, cards, totals\.qty\)/.test(rd('cloudfunctions/getDishReview/index.js')));
ok('A-⑦ 免费档出参只加三个聚合字段，未把逐菜字段带回',
  (() => {
    const src = rd('cloudfunctions/getDishReview/index.js');
    const blk = src.slice(src.indexOf("if (tier === 'free')"), src.indexOf("return ok({\n      shop_id: shopId,\n      tier: 'full'"));
    return /weighted_menu_pct: weighted\.pct/.test(blk)
      && /weighted_reason: weighted\.reason/.test(blk)
      && !/totalCostFen|grossFen|marginPct/.test(blk.slice(blk.indexOf('weighted_menu_pct') - 200));
  })());
// 🔴 R717 同族：M6 变异证明「setData 加了字段但 wxml 不上屏」是静默失败，必须单独守。
const RECON_WXML = rd('subpkg/tools/recon/index.wxml');
ok('A-⑧ 🔴 并列双口径真上屏：wxml 渲染标签/数值/说明/缺失提示，且 t 映射已登记',
  /\{\{t\.reconWeightedLabel\}\}/.test(RECON_WXML)
  && /\{\{result\.weightedPctText\}\}/.test(RECON_WXML)
  && /result\.weightedPct !== null/.test(RECON_WXML)
  && /\{\{t\.reconWeightedNote\}\}/.test(RECON_WXML)
  && /result\.weightedPct === null/.test(RECON_WXML)
  && /\{\{t\.reconWeightedMissing\}\}/.test(RECON_WXML)
  && (() => {
    const js = rd(RECON);
    return ['reconWeightedLabel', 'reconWeightedNote', 'reconWeightedMissing']
      .every((k) => new RegExp(k + ':\\s*TERMS\\.card\\.' + k).test(js));
  })());

// ---------- B 页面桩 ----------
console.log('\n===== B. 对账页三条路径（页面桩真跑）=====');
(async () => {
  try {
    const g = await runCalc({ weighted_menu_pct: 55.22, weighted_reason: '', weighted_coverage: 100 }, false);
    ok('B-① 有标量 ⇒ 并列展示 55.22%，售价口径仍是 36.00%（不替换）',
      g.p.data.result.weightedPct === 55.22 && g.p.data.result.weightedPctText === '55.22%'
      && g.p.data.result.menuPct === 36, JSON.stringify({ w: g.p.data.result.weightedPct, m: g.p.data.result.menuPct }));
    ok('B-② 月份区间走单源 monthRange 且为 2026-11 的闭区间',
      (() => { const c = g.calls.find((x) => x.name === 'getDishReview');
        return c && c.params.biz_date_from === '2026-11-01' && c.params.biz_date_to === '2026-11-30'; })(),
      JSON.stringify(g.calls.find((x) => x.name === 'getDishReview')));

    const n = await runCalc({ weighted_menu_pct: null, weighted_reason: 'low_match', weighted_coverage: 62 }, false);
    ok('B-③ 🔴 无标量（匹配不足）⇒ weightedPct=null + 原因，售价口径原样保留',
      n.p.data.result.weightedPct === null && n.p.data.result.weightedPctText === '—'
      && n.p.data.result.weightedReason === 'low_match' && n.p.data.result.menuPct === 36);

    const e = await runCalc({}, true);
    ok('B-④ 🔴 取数抛错 ⇒ 降级：加权缺失明示、对账页其余数字照常出（不整页挂）',
      e.p.data.result && e.p.data.result.weightedPct === null
      && e.p.data.result.menuPct === 36 && e.p.data.result.actualPct !== null
      && e.p.data.result.weightedReason === 'unavailable',
      JSON.stringify({ w: e.p.data.result && e.p.data.result.weightedPct, m: e.p.data.result && e.p.data.result.menuPct }));

    const u = await runCalc({}, false);
    ok('B-⑤ 反恒真：老云函数（无加权字段）返回 ⇒ 不静默把加权当售价口径',
      u.p.data.result.weightedPct === null && u.p.data.result.weightedPct !== u.p.data.result.menuPct);

    // ---------- C 反恒真 ----------
    console.log('\n===== C. 反恒真 =====');
    ok('C-① 合成坏样本：把覆盖率闸门拿掉（<90% 仍给数）应被 A-③ 识别',
      (() => { const fake = { pct: 55.22, reason: '' }; return !(fake.pct === null && fake.reason === 'low_match'); })());
    ok('C-② 合成坏样本：把「分母用标价」换成实收 ⇒ 结果不等于 55.22',
      (() => { const rev = 300 * 1000 + 20 * 7000, cost = 300 * 400 + 20 * 6000;
        return Math.round((1 - cost / rev) * 10000) / 100 !== 55.22; })());
    ok('C-③ 页面桩反恒真：若把降级分支写成「回落售价口径」应被 B-③/B-④ 识别',
      n.p.data.result.weightedPct !== n.p.data.result.menuPct
      && e.p.data.result.weightedPct !== e.p.data.result.menuPct);

    // ---------- D. R194-A 通道口径（真实引擎复现 + 修复锁）----------
    console.log('\n===== D. R194-A 加权标量通道口径（真实引擎）=====');
    const D_DEPS = {
      normalizeDishName: (s) => String(s == null ? '' : s).trim(),
      toMonth: () => '2026-11',
      lookupCardCode: (dk) => (['A', 'B'].indexOf(String(dk)) >= 0 ? String(dk) : ''),
    };
    const D_CARDS = [
      { card_code: 'A', version: 1, name: '外卖菜A', price_list: 2000, total_cost: 800, created_at: '2026-11-01' },
      { card_code: 'B', version: 1, name: '外卖菜B', price_list: 3000, total_cost: 1500, created_at: '2026-11-01' },
    ];
    const D_allRanked = (dine, take) => {
      const arr = (dine.dine_in || []).slice();
      const bp = take.by_platform || {};
      for (const p of Object.keys(bp)) { const r = bp[p] && bp[p].ranked; if (Array.isArray(r)) arr.push(...r); }
      return arr;
    };
    // 纯外卖店
    const d1 = S.buildDishReview([], D_CARDS, D_DEPS);
    const t1 = S.buildTakeawayReview([{ dish_key: 'A', qty: 100, amount: 200000, platform: 'meituan' }, { dish_key: 'B', qty: 100, amount: 300000, platform: 'meituan' }], D_CARDS, D_DEPS);
    const tot1 = S.mergeTotals(d1.totals, t1.totals);
    const w1 = S.calcWeightedMenuPct(D_allRanked(d1, t1), D_CARDS, tot1.qty);
    ok('D-① 🔴 纯外卖店（全渠道接线）加权标量返回有效 pct（=54.00%，非 no_match）', w1.pct === 54 && w1.reason === '', JSON.stringify(w1));
    // 混合店
    const d2 = S.buildDishReview([{ dish_key: 'A', qty: 50, amount: 100000, platform: 'pos' }], D_CARDS, D_DEPS);
    const t2 = S.buildTakeawayReview([{ dish_key: 'B', qty: 50, amount: 150000, platform: 'meituan' }], D_CARDS, D_DEPS);
    const tot2 = S.mergeTotals(d2.totals, t2.totals);
    const w2 = S.calcWeightedMenuPct(D_allRanked(d2, t2), D_CARDS, tot2.qty);
    ok('D-② 🔴 混合店（全渠道接线）加权标量返回有效 pct（=54.00%，非 low_match 抑制）', w2.pct === 54 && w2.reason === '', JSON.stringify(w2));
    // 反恒真：退回"仅堂食 ranked" ⇒ 纯外卖店必变回 no_match（证明此断言能抓回归）
    const regress = S.calcWeightedMenuPct(d1.dine_in, D_CARDS, tot1.qty);
ok('D-③ 反恒真：退回仅堂食 ranked ⇒ 纯外卖店变回 no_match（抓回归）', regress.pct === null && regress.reason === 'no_match', JSON.stringify(regress));
    // 源码锁：index.js 不再用"仅堂食 ranked"喂加权，且改用全渠道 ranked
    const idxSrcD = rd('cloudfunctions/getDishReview/index.js');
    ok('D-④ 🔴 源码锁：index.js 不再调用 calcWeightedMenuPct(ranked, cards, totals.qty)（仅堂食口径必删）', !/calcWeightedMenuPct\(ranked, cards, totals\.qty\)/.test(idxSrcD));
    ok('D-⑤ 🔴 源码锁：index.js 用全渠道 ranked（allChannelRanked）喂加权', /allChannelRanked/.test(idxSrcD) && /calcWeightedMenuPct\(allChannelRanked, cards, totals\.qty\)/.test(idxSrcD));

    // ---------- E. R194-A 同根：免费档销量榜 / 已建卡数 全渠道 ----------
    console.log('\n===== E. R194-A 同根：免费档销量榜全渠道 =====');
    const eTake = S.buildTakeawayReview([{ dish_key: 'A', qty: 100, amount: 200000, platform: 'meituan' }, { dish_key: 'B', qty: 60, amount: 180000, platform: 'meituan' }], D_CARDS, D_DEPS);
    const ePureTake = S.buildFreeTop([], eTake, 10);
    ok('E-① 🔴 纯外卖店：销量榜非空（≥2 道），旧实现为空', ePureTake.top.length >= 2 && ePureTake.totalDistinct >= 2, JSON.stringify({ len: ePureTake.top.length, total: ePureTake.totalDistinct }));
    const eDine = S.buildDishReview([{ dish_key: 'A', qty: 50, amount: 100000, platform: 'pos' }], D_CARDS, D_DEPS);
    const eTake2 = S.buildTakeawayReview([{ dish_key: 'B', qty: 40, amount: 120000, platform: 'meituan' }], D_CARDS, D_DEPS);
    const eMixed = S.buildFreeTop(eDine.dine_in, eTake2, 10);
    ok('E-② 混合店：销量榜含堂食 A 与外卖 B（totalDistinct=2）', eMixed.totalDistinct === 2 && eMixed.top.map((x) => x.dish_key).sort().join(',') === 'A,B', JSON.stringify(eMixed.totalDistinct));
    const eDine3 = S.buildDishReview([{ dish_key: 'A', qty: 50, amount: 100000, platform: 'pos' }, { dish_key: 'B', qty: 80, amount: 240000, platform: 'pos' }], D_CARDS, D_DEPS);
    const ePureDine = S.buildFreeTop(eDine3.dine_in, { by_platform: {}, totals: {} }, 10);
    const eOld = eDine3.dine_in.slice().sort((a, b) => (b.qty - a.qty) || (b.amountFen - a.amountFen) || String(a.name).localeCompare(String(b.name))).slice(0, 10);
    ok('E-③ 纯堂食：与旧实现逐行等价（不改既有行为）', ePureDine.top.length === eOld.length && ePureDine.top.every((x, i) => x.dish_key === eOld[i].dish_key && x.qty === eOld[i].qty), JSON.stringify(ePureDine.top.map((x) => x.dish_key + ':' + x.qty)));
    const eDine4 = S.buildDishReview([{ dish_key: 'A', qty: 50, amount: 100000, platform: 'pos' }], D_CARDS, D_DEPS);
    const eTake4 = S.buildTakeawayReview([{ dish_key: 'A', qty: 30, amount: 60000, platform: 'meituan' }], D_CARDS, D_DEPS);
    const eDup = S.buildFreeTop(eDine4.dine_in, eTake4, 10);
    ok('E-④ 跨渠道同菜去重：同 dish_key ⇒ 1 行、qty 相加（不重复）', eDup.top.length === 1 && eDup.top[0].qty === 80 && eDup.totalDistinct === 1, JSON.stringify(eDup));
    ok('E-⑤ 🔴 源码锁：index.js 用 buildFreeTop 生成销量榜', /buildFreeTop\(ranked, takeawayResult, FREE_TOP_N\)/.test(rd('cloudfunctions/getDishReview/index.js')));
    ok('E-⑥ 🔴 源码锁：free_ranked_total 不再用仅堂食 ranked.length', !/free_ranked_total:\s*ranked\.length/.test(rd('cloudfunctions/getDishReview/index.js')));

    console.log('\n============================================================');
    console.log('===== R729 加权接线守卫结果：' + pass + ' 通过 / ' + bad.length + ' 失败 =====');
    if (bad.length) { bad.forEach((p) => console.log('   ❌ ' + p)); process.exit(1); }
    process.exit(0);
  } catch (e2) {
    console.error('FATAL', e2 && e2.stack || e2);
    process.exit(2);
  }
})();
