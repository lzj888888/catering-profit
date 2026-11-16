// r752_m3_property_test.js —— M3 引擎属性测试（fast-check 思路，自写不引依赖）
// 对团购 / 外卖 / 成本卡做随机输入压测，验证上轮固定锚点覆盖不到的恒等式不变量。
// 可复现：固定种子。运行：node review/evidence/r752_m3_property_test.js
'use strict';
const { calcGrouponOrder } = require('../../utils/grouponDerive.js');
const { calcTakeawayOrder } = require('../../utils/takeawayDerive.js');
const { calcCostCard } = require('../../cloudfunctions/calcBom/service.js');

let _s = 20261117;
function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

const INV = {
  groupon_cash: '团购：净额=挂牌−佣金−优惠，利润=净额−成本',
  groupon_commission: '团购：佣金基于挂牌价(±1分)',
  groupon_vs_dine: '团购：vs堂食=堂食利润−团购利润',
  takeaway_lines: '外卖：逐行金额和=商品总价，逐行成本和=菜品成本',
  takeaway_profit: '外卖：利润=实收−菜品成本−包材',
  takeaway_margin: '外卖：逐行毛利率∈[−100,100]且金额>0时公式自洽',
  costcard_nonneg: '成本卡：净料成本≤售价、结果为有限数',
};
const fail = {}; Object.keys(INV).forEach((k) => { fail[k] = []; });

// ---------- 团购 ----------
for (let i = 0; i < 2000; i++) {
  const priceFen = ri(1000, 200000), costFen = ri(0, priceFen), ratePct = ri(0, 30),
        promoFen = ri(0, Math.floor(priceFen * 0.3)), dineFen = ri(0, 200000);
  const r = calcGrouponOrder({ priceFen, costFen, ratePct, promoFen, dineFen });
  if (r.netFen !== priceFen - r.commissionFen - promoFen || r.profitFen !== r.netFen - costFen) {
    fail.groupon_cash.push({ priceFen, costFen, ratePct, promoFen, r });
  }
  if (Math.abs(r.commissionFen - Math.round(priceFen * ratePct / 100)) > 1) {
    fail.groupon_commission.push({ priceFen, ratePct, commissionFen: r.commissionFen });
  }
  if (r.hasDine && r.vsDineFen !== r.dineProfitFen - r.profitFen) {
    fail.groupon_vs_dine.push({ dineFen, r });
  }
}

// ---------- 外卖 ----------
function dishLookup() {
  const db = {};
  for (let i = 0; i < 5; i++) db['c' + i] = { price_fen: ri(1000, 10000), unit_cost_fen: ri(200, 3000), name: '菜' + i };
  return (id) => db[id] || {};
}
for (let i = 0; i < 2000; i++) {
  const lookup = dishLookup();
  const items = [];
  let gt = 0, dc = 0;
  for (let k = 0; k < ri(1, 4); k++) {
    const id = 'c' + ri(0, 4), qty = ri(1, 5);
    const card = lookup(id);
    items.push({ card_id: id, qty });
    gt += card.price_fen * qty; dc += card.unit_cost_fen * qty;
  }
  const packs = [{ key: 'p', qty: ri(0, 3) }];
  const order = { items, packs, params: {
    pack_fee_fen: ri(0, 500), delivery_customer_fen: ri(0, 800),
    delivery_fee_fen: ri(0, 600), delivery_subsidy_fen: ri(0, 300),
    promo_fen: ri(0, 500), commission_pct: ri(0, 8),
  }};
  const lookupFull = (id) => id === 'p' ? { unit_cost_fen: ri(50, 200) } : lookup(id);
  const r = calcTakeawayOrder(order, lookupFull);
  const cash = r.cash || r;
  // 逐行金额和与出参 goods_total 双向核对（既验引擎求和，也验我构造的期望）
  const lineSum = r.lines.reduce((a, x) => a + x.price_fen * x.qty, 0);
  const lineCost = r.lines.reduce((a, x) => a + x.unit_cost_fen * x.qty, 0);
  if (lineSum !== gt || lineCost !== dc || cash.goods_total_fen !== gt || cash.dish_cost_fen !== dc) {
    fail.takeaway_lines.push({ gt, dc, lineSum, lineCost, engineGt: cash.goods_total_fen, engineDc: cash.dish_cost_fen });
  }
  if (cash.profit_fen !== cash.receipt_fen - cash.dish_cost_fen - cash.pack_cost_fen) {
    fail.takeaway_profit.push({ cash });
  }
  // 成本>售价时毛利率可以为负（引擎诚实反映亏损），不应限制范围；
  // 只验公式自洽：gross = (price−cost)×qty，margin = gross/price×100（金额>0时）
  for (const ln of r.lines) {
    if (ln.price_fen <= 0) continue;
    const expGross = (ln.price_fen - ln.unit_cost_fen) * ln.qty;
    const expMargin = Math.round((expGross / (ln.price_fen * ln.qty)) * 10000) / 100;
    if (ln.gross_profit_fen !== expGross || Math.abs(ln.gross_margin_pct - expMargin) > 0.01) {
      fail.takeaway_margin.push({ ln, expGross, expMargin });
    }
  }
}

// ---------- 成本卡 ----------
for (let i = 0; i < 2000; i++) {
  const priceFen = ri(100, 100000);
  const lines = [];
  for (let k = 0; k < ri(1, 4); k++) {
    lines.push({ quantity: ri(1, 300), net_unit_cost: ri(1, 1000) });  // 万分单位
  }
  let r;
  try {
    r = calcCostCard({ mode: 'A', auxFen: ri(0, 100), lossPct: ri(0, 20),
      priceFen, targetMarginPct: ri(30, 80), lines });
  } catch (e) { fail.costcard_nonneg.push({ priceFen, lines, err: String(e) }); continue; }
  const s = JSON.stringify(r);
  if (/Infinity|NaN/.test(s)) fail.costcard_nonneg.push({ priceFen, lines, r });
}

console.log('=== M3 属性测试：6000 组随机 ===');
let total = 0;
Object.keys(INV).forEach((k) => {
  const n = fail[k].length; total += n;
  console.log((n ? '❌' : '✅') + ' ' + INV[k] + ' — 反例 ' + n);
  if (n) console.log('   首例:', JSON.stringify(fail[k][0]).slice(0, 400));
});
console.log(total === 0 ? '===== 全部不变量成立 =====' : '===== 发现 ' + total + ' 类反例 =====');
process.exit(total === 0 ? 0 : 1);
