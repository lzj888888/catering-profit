// utils/reconDerive.js —— M3.21 M1↔M3 率对率对账（纯计算单源）
//
// 依据：`specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.21。
//
// 🔴 红线：
//   ① 纯计算、不落库、不进云函数、不需要 specs 派生副本。
//   ② **只读** M1（getLedger 出参），绝不写 M1（不调 saveLedger/archiveMonth/saveAsset）。
//   ③ 细项名**不写死字面量**：从 `TERMS.ledger.takeawayMode.goodsField` 取（当前值 '商品总价'）。
//   ④ **套餐默认排除**（card_type===3），避免同一道菜被计两次；includeCombo 为 true 时含。
//   ⑤ **无分母不硬凑**：覆盖率缺失/不足 ⇒ 抑制；外卖快速录入（无 sub_items）⇒ 抑制；缺项不出键、不出 0。
//   ⑥ 金额一律「分」；比例一律「百分数」（65 表示 65%），展示保留 1 位小数。

const { TERMS } = require('../miniprogram/i18n/terms.js');
// 🔴 细项名单源（不写字面量；selftest 会断言它取自该单源）
const GOODS_FIELD = (TERMS.ledger && TERMS.ledger.takeawayMode && TERMS.ledger.takeawayMode.goodsField) || '商品总价';

// 比例保留 2 位小数（对齐规范锚点 64.84 / 9.84；展示层可再按需取 1 位）
const round2 = (n) => Math.round(n * 100 + 1e-9) / 100;

/**
 * M3 侧：标准菜单毛利率（权重 = 售价，隐含"各菜品销售额均匀"假设）。
 * 公式：1 − Σ(card.total_cost_fen) ÷ Σ(card.price_fen)，返回百分数（64.84 表示 64.84%）。
 * 🔴 默认排除套餐（card_type === 3）；includeCombo 为 true 时含。
 * @param {Array<{card_type?:number, price_fen:number, total_cost_fen:number}>} cards
 * @param {{includeCombo?:boolean}} [opts]
 * @returns {{pct:number|null, reason?:string}}
 */
function calcMenuMargin(cards, opts) {
  const includeCombo = !!(opts && opts.includeCombo);
  const list = (Array.isArray(cards) ? cards : []).filter((c) => {
    if (!c) return false;
    if (!includeCombo && c.card_type === 3) return false;   // 套餐默认排除
    return true;
  });
  let priceFen = 0;
  let costFen = 0;
  for (const c of list) {
    priceFen += Number(c.price_fen) || 0;
    costFen += Number(c.total_cost_fen) || 0;
  }
  if (priceFen === 0) return { pct: null, reason: 'no_price' };   // 🔴 不许除零、不许返回 0
  return { pct: round2((1 - costFen / priceFen) * 100) };
}

/**
 * M1 侧：实际菜品毛利率（只读 getLedger 出参）。
 * 菜品口径收入（分）= Σ(dine_in 行的 amount_fen) ＋ Σ(takeaway 行的 sub_items 中 goodsField 行的 amount_fen)。
 * 🔴 外卖走「快速录入」（takeaway 行无 sub_items）⇒ 取不到商品总价 ⇒ 返回 { pct:null, reason:'need_detail_income' }。
 * 食材成本（分）= ledger.result.material_cost_fen（M1 引擎出参，= 库存倒轧或直接消耗）。
 * @param {object} ledger getLedger 出参
 * @returns {{income_fen:number, food_cost_fen:number, pct:number|null, reason?:string}}
 */
function calcActualDishMargin(ledger) {
  const incomeItems = (ledger && Array.isArray(ledger.income_items)) ? ledger.income_items : [];
  let dineFen = 0;
  let takeawayGoodsFen = 0;
  let hasTakeawayWithoutDetail = false;
  for (const it of incomeItems) {
    const cat = (it && it.category) || '';
    const amt = Number(it && it.amount_fen) || 0;
    if (cat === 'dine_in') {
      dineFen += amt;
    } else if (cat === 'takeaway') {
      const subs = (it && Array.isArray(it.sub_items)) ? it.sub_items : [];
      if (subs.length === 0) {
        // 🔴 快速录入：无 sub_items ⇒ 取不到商品总价
        hasTakeawayWithoutDetail = true;
        continue;
      }
      for (const si of subs) {
        if ((si && si.sub_item) === GOODS_FIELD) takeawayGoodsFen += Number(si && si.amount_fen) || 0;
      }
    }
  }
  if (hasTakeawayWithoutDetail) {
    // 🔴 不许用整类外卖额硬凑商品总价
    return { income_fen: 0, food_cost_fen: 0, pct: null, reason: 'need_detail_income' };
  }
  const incomeFen = Math.round(dineFen + takeawayGoodsFen);
  const foodCostFen = Math.round(Number((ledger && ledger.result && ledger.result.material_cost_fen)) || 0);
  if (incomeFen === 0) return { income_fen: incomeFen, food_cost_fen: foodCostFen, pct: null, reason: 'no_income' };
  return { income_fen: incomeFen, food_cost_fen: foodCostFen, pct: round2(((incomeFen - foodCostFen) / incomeFen) * 100) };
}

/**
 * 率对率对账：M1 实际菜品毛利率 vs M3 标准菜单毛利率。
 * 🔴 覆盖率闸门（fail-closed）：coverage < 0.6 或 coverage 为 null（未填在售菜品数）或任一 pct === null
 *    ⇒ suppressed: true，只回两个 pct，diffPp / diffFen / 归因一律置 null。
 * @param {{menuPct:number|null, actualPct:number|null, coverage:number|null, incomeFen:number}} input
 * @returns {{suppressed:boolean, menuPct:number|null, actualPct:number|null, diffPp:number|null, diffFen:number|null, reason?:string}}
 */
function reconcile(input) {
  const p = input || {};
  const menuPct = p.menuPct;
  const actualPct = p.actualPct;
  const coverage = p.coverage;
  const incomeFen = Number(p.incomeFen) || 0;

  let reason = '';
  if (coverage == null) reason = 'coverage_missing';
  else if (Number(coverage) < 0.6) reason = 'coverage_low';
  else if (menuPct == null) reason = 'menu_no_price';
  else if (actualPct == null) reason = 'actual_no_data';

  if (reason) {
    // 抑制：只回两个 pct，差值/金额/归因一律 null（样本偏差会让差值失真）
    return { suppressed: true, menuPct: menuPct, actualPct: actualPct, diffPp: null, diffFen: null, reason };
  }

  const diffPp = round2(Number(actualPct) - Number(menuPct));
  const diffFen = Math.round((diffPp / 100) * incomeFen);
  return { suppressed: false, menuPct, actualPct, diffPp, diffFen, reason: '' };
}

module.exports = {
  calcMenuMargin,
  calcActualDishMargin,
  reconcile,
  GOODS_FIELD,
};
