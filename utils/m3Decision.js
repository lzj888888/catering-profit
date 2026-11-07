// utils/m3Decision.js —— M3 利润决策台（纯函数，零 IO、零云函数改动）
//
// 为什么有这个文件（2026-11-07 重新规划，见 review/PLAN_M3_决策台_20261107.md）：
//   M3 的数据与能力其实都在（复盘出参、comboInsight、takeawayDerive 的四项费用），
//   但都停在各页自己的表里，没有一处把它们组织成老板能用的答案。
//   本文件只做一件事：把已有出参组织成**三个问题的答案** + 一个涨价试算。
//     Q1 该动哪道菜   —— 用本店当月中位数分界，输出动作清单（不是给老板看象限图）
//     Q2 套餐划算吗   —— 直接读 comboInsight 的「我少赚」
//     Q3 外卖还赚不赚 —— 把 calcTakeawayOrder 的四项费用拆成瀑布
//     S  涨价试算     —— 纯内存重算，不落库、不改快照
//
// 🔴 三条铁律（与全仓一致）：
//   1. 不编行业阈值：分界线一律用**本店当月**中位数，并把分界值返回给页面显示。
//   2. 样本不足 fail-closed：菜数 <10 或营收覆盖率 <60% ⇒ 不给动作，只给原因。
//   3. 免费档不带毛利结论：free 档后端本就不下发 grossFen/marginPct，
//      这里也**绝不**用「营收 − 0 成本」凑一个毛利出来（那不是少给，是给错）。
'use strict';

const MIN_DISHES = 10;          // 少于此数不给结构（中位数没有统计意义）
const MIN_COVERAGE_PCT = 60;    // 与 D17「对账覆盖率闸门」同一口径
const DEFAULT_RISE_PCT = 10;    // 涨价试算默认 +10%

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

/** 中位数（偶数取中间两数平均；空数组 ⇒ null） */
function median(list) {
  const a = (list || []).filter((x) => x != null && Number.isFinite(Number(x))).map(Number).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 占比（一位小数）。whole <= 0 ⇒ null（不编 0%） */
function sharePct(part, whole) {
  const w = Number(whole);
  if (!(w > 0)) return null;
  return Math.round((Number(part) || 0) / w * 1000) / 10;
}

/**
 * Q1：该动哪道菜。
 * @param {object} o
 *   - rows: [{name, qty, amountFen, totalCostFen, grossFen, marginPct}] 已匹配菜品
 *   - unmatchedAmountFen: 未匹配行的营收合计（算覆盖率；缺省按 0）
 *   - tier: 'free' | 'full'
 * @returns {{
 *   ok:boolean, insufficient:boolean, reason:string,
 *   coveragePct:number|null, dishCount:number,
 *   medianQty:number|null, medianMarginPct:number|null,
 *   actions:Array<{kind,name,qty,gainFen?,lossFen?,grossFen?,sharePct?,marginPct}>,
 *   quadrant:Array<{name,qty,marginPct,grossFen,cell}>
 * }}
 */
function buildDishDecision(o) {
  const c = o || {};
  const rows = Array.isArray(c.rows) ? c.rows.filter((r) => r && num(r.qty) > 0) : [];
  const tier = c.tier === 'free' ? 'free' : 'full';
  const matchedAmount = rows.reduce((s, r) => s + (num(r.amountFen) || 0), 0);
  const unmatchedAmount = num(c.unmatchedAmountFen) || 0;
  const coveragePct = sharePct(matchedAmount, matchedAmount + unmatchedAmount);
  const dishCount = rows.length;

  const base = {
    ok: false, insufficient: true, reason: '', coveragePct, dishCount,
    medianQty: null, medianMarginPct: null, actions: [], quadrant: [], free: tier === 'free',
  };

  // ---- fail-closed：先判能不能给结论 ----
  if (!dishCount) return Object.assign(base, { reason: 'no_dishes' });
  if (dishCount < MIN_DISHES) return Object.assign(base, { reason: 'few_dishes' });
  if (coveragePct != null && coveragePct < MIN_COVERAGE_PCT) return Object.assign(base, { reason: 'low_coverage' });

  // ---- 免费档：只给销量结构，绝不碰毛利 ----
  const medianQty = median(rows.map((r) => num(r.qty)));
  if (tier === 'free') {
    const sorted = rows.slice().sort((a, b) => (num(b.qty) || 0) - (num(a.qty) || 0));
    const top = sorted.slice(0, 5).map((r) => ({
      kind: 'top_sales', name: r.name || '', qty: num(r.qty) || 0,
      sharePct: sharePct(num(r.qty) || 0, medianQty == null ? 0 : rows.reduce((s, x) => s + (num(x.qty) || 0), 0)),
    }));
    return Object.assign(base, {
      ok: true, insufficient: false, reason: '', medianQty, actions: top,
      quadrant: rows.map((r) => ({ name: r.name || '', qty: num(r.qty) || 0, marginPct: null, grossFen: null,
        cell: (num(r.qty) || 0) >= medianQty ? 'many' : 'few' })),
    });
  }

  // ---- 付费档：毛利三列必须齐（缺一列就整题不出，不拿营收减 0 成本凑）----
  const withGross = rows.filter((r) => num(r.grossFen) != null && num(r.qty) > 0);
  if (withGross.length < MIN_DISHES) return Object.assign(base, { reason: 'no_margin', medianQty });

  // 🔴 纵轴必须用**毛利率**，不能用「单份毛利额」：
  //   毛利额跟菜价强相关（一碗面赚 3 元 vs 一杯豆浆赚 2.8 元，额几乎一样、毛利率天差地别），
  //   首版真跑就把「单份赚 3 元、毛利率 16.7%」的炸酱面判成「高毛利、该主推」——不可比。
  //   毛利率是「卖 100 元赚多少」，跨菜品可比；同时**亏损（grossFen<0）一律判低**，不靠阈值。
  const marginOf = (r) => {
    const amt = num(r.amountFen);
    const g = num(r.grossFen);
    if (!(amt > 0) || g == null) return null;
    return Math.round(g / amt * 1000) / 10;
  };
  const margins = withGross.map(marginOf).filter((x) => x != null);
  if (margins.length < MIN_DISHES) return Object.assign(base, { reason: 'no_margin', medianQty });
  const medianMarginPct = Math.round(median(margins) * 10) / 10;
  const totalQty = rows.reduce((s, r) => s + (num(r.qty) || 0), 0);
  const totalGross = withGross.reduce((s, r) => s + (num(r.grossFen) || 0), 0);

  const quadrant = [];
  const actions = [];
  for (const r of withGross) {
    const qty = num(r.qty) || 0;
    const marginPct = marginOf(r);
    const gross = num(r.grossFen) || 0;
    const amt = num(r.amountFen) || 0;
    const highSales = qty >= medianQty;
    // 亏损必判低：这是硬事实，不依赖中位数是否被长尾拉偏
    const highMargin = gross >= 0 && marginPct >= medianMarginPct;
    const cell = highSales ? (highMargin ? 'many_high' : 'many_low') : (highMargin ? 'few_high' : 'few_low');
    quadrant.push({ name: r.name || '', qty, marginPct, grossFen: Math.round(gross), cell });

    if (cell === 'many_low') {
      // 提价/换供应商：把毛利率补到本店中位，整月能多赚多少（整月金额差，不乘份数）
      const targetGross = Math.round(amt * medianMarginPct / 100);
      const gain = Math.max(0, targetGross - gross);
      actions.push({ kind: 'raise', name: r.name || '', qty, marginPct,
        gainFen: gain, grossFen: Math.round(gross), sharePct: sharePct(gross, totalGross) });
    } else if (cell === 'few_low') {
      // 只有真在亏（毛利为负）才建议砍；只是「赚得少」不砍，避免把长尾菜误杀
      if (gross < 0) {
        actions.push({ kind: 'cut', name: r.name || '', qty, marginPct,
          lossFen: Math.round(-gross), costFen: Math.round(num(r.totalCostFen) || 0),
          sharePct: sharePct(gross, totalGross) });
      }
    } else if (cell === 'many_high') {
      actions.push({ kind: 'push', name: r.name || '', qty, marginPct,
        grossFen: Math.round(gross), sharePct: sharePct(gross, totalGross) });
    } else {
      actions.push({ kind: 'bundle', name: r.name || '', qty, marginPct,
        grossFen: Math.round(gross), sharePct: sharePct(gross, totalGross) });
    }
  }

  // 排序：**先按动作紧迫度，再按钱**。
  //   首版按金额降序 ⇒ 「主推」占了前三条（贡献毛利天然最大），但主推不是「要动」的动作，
  //   老板打开清单看到全是「保持现状」等于没给建议。正确顺序：在亏要砍 > 能多赚要提价 > 搭售 > 主推。
  const RANK = { cut: 0, raise: 1, bundle: 2, push: 3 };
  const moneyOf = (a) => (a.kind === 'cut' ? (a.lossFen || 0)
    : a.kind === 'raise' ? (a.gainFen || 0) : (a.grossFen || 0));
  actions.sort((a, b) => (RANK[a.kind] - RANK[b.kind]) || (moneyOf(b) - moneyOf(a)));

  return Object.assign(base, {
    ok: true, insufficient: false, reason: '',
    medianQty, medianMarginPct, totalQty, totalGrossFen: Math.round(totalGross),
    actions: actions.slice(0, 5), quadrant,
  });
}

/**
 * Q2：套餐比单点划算吗。
 * @param {Array} combos [{name, priceFen, costFen, customerSaveFen, merchantLoseFen, costSharePct?}]
 * @returns {Array<{name, customerSaveFen, merchantLoseFen, costSharePct, kind}>}
 *   kind: 'raise'（在拉低毛利，建议调价/换子菜）| 'push'（没少赚，可主推）
 */
function buildComboDecision(combos) {
  const list = (Array.isArray(combos) ? combos : []).filter((x) => x && num(x.merchantLoseFen) != null);
  return list.map((x) => ({
    name: x.name || '',
    customerSaveFen: num(x.customerSaveFen),
    merchantLoseFen: num(x.merchantLoseFen),
    costSharePct: num(x.costSharePct),
    kind: (num(x.merchantLoseFen) || 0) > 0 ? 'raise' : 'push',
  })).sort((a, b) => (b.merchantLoseFen || 0) - (a.merchantLoseFen || 0));
}

/**
 * Q3：外卖还赚不赚 —— 把一单拆成瀑布。
 * 分母统一用「顾客实付 payment_fen」（= 商品 + 打包 + 顾客配送费），
 * 各项之和 + 到手 = payment（takeawayDerive 的恒等式），所以占比 + 到手率 ≡ 100%。
 * @param {object} cash calcTakeawayOrder 出参的 cash 块
 * @returns {{ok, paymentFen, receiptRatePct, items:[{key,fen,pct}], breakEvenDropPct, profitFen}}
 */
function buildTakeawayWaterfall(cash) {
  const c = cash || {};
  const payment = num(c.payment_fen) || 0;
  if (!(payment > 0)) return { ok: false, paymentFen: 0, receiptRatePct: null, items: [], breakEvenDropPct: null, profitFen: null };
  const items = [
    { key: 'commission', fen: num(c.commission_fen) || 0 },
    { key: 'delivery', fen: num(c.delivery_fee_fen) || 0 },
    { key: 'deliverySubsidy', fen: num(c.delivery_subsidy_fen) || 0 },
    { key: 'subsidyMerchant', fen: num(c.subsidy_merchant_fen) || 0 },
    { key: 'promo', fen: num(c.promo_fen) || 0 },
  ].map((x) => Object.assign(x, { pct: sharePct(x.fen, payment) }));
  const receiptFen = num(c.receipt_fen) || 0;
  const profitFen = num(c.profit_fen);
  return {
    ok: true,
    paymentFen: payment,
    receiptRatePct: sharePct(receiptFen, payment),
    items,
    // 到手利润归零前，还能被平台/配送多拿几个点 —— 老板真正需要的「临界点」
    breakEvenDropPct: profitFen == null ? null : sharePct(profitFen, payment),
    profitFen,
  };
}

/**
 * S：原料涨价试算（纯内存）。
 * @param {Array} rows 复盘行（含 totalCostFen / grossFen / qty）
 * @param {number} risePct 涨幅（默认 10）
 * @returns {{risePct, rows:[{name, costDeltaFen, newGrossFen, deltaFen, wasCell, nowCell}], totalDeltaFen}}
 *   注意：这里只按「成本 × 涨幅」估，**不重算配方**（真实重算要走 syncCostCard 生成新版本）。
 */
function projectCostRise(rows, risePct) {
  const p = num(risePct) == null ? DEFAULT_RISE_PCT : num(risePct);
  const list = (Array.isArray(rows) ? rows : []).filter((r) => num(r.totalCostFen) != null && num(r.grossFen) != null);
  let totalDelta = 0;
  const out = list.map((r) => {
    const cost = num(r.totalCostFen) || 0;
    const gross = num(r.grossFen) || 0;
    const costDelta = Math.round(cost * p / 100);
    totalDelta += costDelta;
    return {
      name: r.name || '',
      costDeltaFen: costDelta,
      newGrossFen: Math.round(gross - costDelta),
      deltaFen: -costDelta,
    };
  });
  return { risePct: p, rows: out, totalDeltaFen: totalDelta };
}

module.exports = {
  buildDishDecision, buildComboDecision, buildTakeawayWaterfall, projectCostRise,
  median, sharePct, MIN_DISHES, MIN_COVERAGE_PCT, DEFAULT_RISE_PCT,
};
