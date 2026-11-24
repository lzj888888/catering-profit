// utils/materialUsage.js —— 原料级用量核对（理论用量 vs 实际用量）
//
// 🔴 定位（李老师 2026-11-24「第二期」）：
//   第一期只能算出「料钱总共多花了多少」，但说不出「哪个料超了」。
//   本期把粒度下到**单个原料**：米用超 30%、油多 40% —— 这才是老板能去查的话。
//
// 数据来源（全部为现有云函数出参，**不新增接口**）：
//   · 逐菜销量：`getDishReview` 的 `dine_in[].{card_code, qty}`
//   · 每菜原料明细：`getCostCard` 的 `list[].lines[].{material_id, quantity}`（quantity 单位 = **克**）
//   · 原料档案：`getMaterial`/`getCostCard` 的原料表 —— `convert_factor`（1 采购单位 = N 克）、
//     `yield_rate`（出成率 %）、`purchase_unit`（"斤"/"公斤"/"个"）
//   · 盘点数量：老板在库存页填的 `{material_id, opening_qty, purchase_qty, closing_qty}`（采购单位）
//
// 🔴🔴 核心口径（最容易算错的一处，必须先看明白）：
//   成本卡里 `quantity` 是**净料克数**（可食部分），而单价已经按出成率放大过：
//     `netUnitCostWan = 采购单价 ÷ convert_factor ÷ (出成率/100)`
//   ⇒ 老板**买的是毛料**。所以「理论该采购多少」必须把净料还原成毛料：
//     `理论采购量(采购单位) = Σ(该原料净料克数) ÷ (出成率/100) ÷ convert_factor`
//   例：某菜用 200 克鸡胸肉净料，出成率 90%，1 斤 = 500 克
//     ⇒ 理论采购 = 200 ÷ 0.9 ÷ 500 = 0.444 斤
//   ⚠️ 若把净料当毛料直接用（不除出成率），理论值会偏小 ⇒ 显示「买多了」= 冤枉采购。
//     这一条必须与 `cloudfunctions/calcBom/service.js::netUnitCostWan` 保持同源。
//
// 边界（fail-closed，绝不输出编出来的数）：
//   · 没有成本卡明细 / 该原料没出现在任何成本卡里 ⇒ 无理论值（hasTheory=false），只显示实际用量
//   · 理论量为 0 ⇒ 不给差率（除零）
//   · 差率只在理论量 > 0 时输出
//
// 🔴 诚实边界（要写进页面）：
//   本模块只回答「这个原料的用量对不上」，**不回答原因**。差量可能来自浪费、内盗、
//   员工餐、配方过时、出成率填错、盘点误差。产品文案一律「异常，建议核查」，不做定性。

const num0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100 + 1e-9) / 100;

// 🔴 G3（2026-11-25 M3 变动面审计发现）：理论量极小时**差率会爆表**。
//   实测：理论 0.001 斤 / 实际 10 斤 ⇒ 差率 1000000%，页面上没法看（数学上不算错，但不可读、会误导）。
//   处理：**差量照给**（10 − 0.001 = 9.999 斤这个事实有意义），但**差率不给**（分母太小，比率无意义）。
//   阈值取 0.01 个采购单位（斤/公斤）—— 约 5 克，正常原料不可能只该用这么点，
//   一旦出现说明"成本卡用量填错了"或"这个原料只在一道很冷门的菜里用了一点点"。
const MIN_THEORY_QTY_FOR_PCT = 0.01;

/**
 * 把某原料在成本卡里的净料克数，汇总成「按采购单位的理论采购量」。
 * @param {Array} cards getCostCard.list（含 lines）
 * @param {object} qtyByCardCode { [card_code]: 月售份数 }
 * @param {object} material 原料档案（含 convert_factor / yield_rate / purchase_unit）
 * @returns {{theoryQty:number, netGram:number, yieldRate:number, convertFactor:number, dishCount:number}}
 */
function theoryQtyOf(cards, qtyByCardCode, material) {
  const list = Array.isArray(cards) ? cards : [];
  const qmap = qtyByCardCode || {};
  const matId = String((material && material.material_id) || (material && material.id) || '').trim();
  if (!matId) return { theoryQty: 0, netGram: 0, yieldRate: 100, convertFactor: 1, dishCount: 0 };

  let netGram = 0;
  let dishCount = 0;
  for (const c of list) {
    if (!c || !Array.isArray(c.lines)) continue;
    const code = String(c.card_code || '').trim();
    const qty = num0(qmap[code]);
    if (!(qty > 0)) continue;
    for (const ln of c.lines) {
      if (!ln) continue;
      // 只认原料行（line_type=1 / input_type=1）；子卡行（line_type=2）的成本已含在子卡里，不重复取
      if (num0(ln.line_type) === 2) continue;
      if (String(ln.material_id || '').trim() !== matId) continue;
      const per = num0(ln.quantity);          // 单份净料克数
      if (!(per > 0)) continue;
      netGram += per * qty;
      dishCount++;
    }
  }

  // 出成率与换算系数：口径与 calcBom/netUnitCostWan 一致（未填/非法 ⇒ 100% / 1）
  const y = num0(material && material.yield_rate);
  const yieldRate = (y > 0 && y <= 100) ? y : 100;
  const cfRaw = num0(material && material.convert_factor);
  const convertFactor = cfRaw > 0 ? cfRaw : 1;

  const theoryQty = netGram / (yieldRate / 100) / convertFactor;
  return { theoryQty, netGram, yieldRate, convertFactor, dishCount };
}

/**
 * 原料用量核对主函数。
 * @param {object} input
 * @param {Array} input.cards            getCostCard.list（含 lines）
 * @param {Array} input.dineIn           getDishReview.dine_in（含 card_code / qty）
 * @param {Array} input.materials        原料档案数组（含 material_id/id、name、purchase_unit、convert_factor、yield_rate）
 * @param {Array} input.inventoryItems   老板填的盘点：[{ material_id, opening_qty, purchase_qty, closing_qty }]
 * @returns {{ok:boolean, reason?:string, items:Array, comparableCount:number}}
 *   items 每项：{ material_id, name, unit, theoryQty, actualQty, diffQty, diffPct, hasTheory, yieldRate, convertFactor }
 */
function materialUsage(input) {
  const p = input || {};
  const cards = Array.isArray(p.cards) ? p.cards : [];
  const dineIn = Array.isArray(p.dineIn) ? p.dineIn : [];
  const materials = Array.isArray(p.materials) ? p.materials : [];
  const invItems = Array.isArray(p.inventoryItems) ? p.inventoryItems : [];

  // 🔴 先把逐菜销量整理成 { card_code → qty }：dine_in 是逐菜的，这里只关心份数
  const qtyByCardCode = {};
  for (const d of dineIn) {
    if (!d) continue;
    const code = String(d.card_code || '').trim();
    if (!code) continue;
    qtyByCardCode[code] = num0(qtyByCardCode[code]) + num0(d.qty);
  }

  if (!invItems.length) return { ok: false, reason: 'no_items', items: [], comparableCount: 0 };

  // 原料档案索引（material_id 与 id 都可能出现，两个键都建）
  const matById = {};
  for (const m of materials) {
    if (!m) continue;
    const a = String(m.material_id || '').trim();
    const b = String(m.id || '').trim();
    if (a) matById[a] = m;
    if (b) matById[b] = m;
  }

  const items = [];
  let comparableCount = 0;
  let actualHasValue = 0;

  for (const it of invItems) {
    if (!it) continue;
    const mid = String(it.material_id || '').trim();
    if (!mid) continue;
    const mat = matById[mid] || {};
    const openQ = num0(it.opening_qty);
    const purQ = num0(it.purchase_qty);
    const closeQ = num0(it.closing_qty);

    // 三栏全空 ⇒ 这行老板没填，跳过（不产生一行 0，避免"这个料一滴没用"的假结论）
    const blank = (openQ === 0 && purQ === 0 && closeQ === 0);
    if (blank) continue;
    actualHasValue++;

    const th = theoryQtyOf(cards, qtyByCardCode, mat);
    const actualQty = openQ + purQ - closeQ;
    const hasTheory = th.theoryQty > 0;

    let diffQty = null;
    let diffPct = null;
    // G3：理论量太小时只给差量、不给差率（见 MIN_THEORY_QTY_FOR_PCT 注释）
    const pctSuppressed = hasTheory && th.theoryQty < MIN_THEORY_QTY_FOR_PCT;
    if (hasTheory) {
      diffQty = round2(actualQty - th.theoryQty);
      diffPct = pctSuppressed ? null : round2((diffQty / th.theoryQty) * 100);
      comparableCount++;
    }

    items.push({
      material_id: mid,
      name: String(mat.name || it.name || mid),
      unit: String(mat.purchase_unit || ''),
      // ⚠️ 小值不能走 round2：round2(0.001)=0 ⇒ 页面会显示「该买 0.00 斤」，荒谬。
      //   pctSuppressed 时保留原值，页面显示成「<0.01」。
      theoryQty: hasTheory ? (pctSuppressed ? th.theoryQty : round2(th.theoryQty)) : null,
      actualQty: round2(actualQty),
      diffQty,
      diffPct,
      hasTheory,
      pctSuppressed,
      yieldRate: th.yieldRate,
      convertFactor: th.convertFactor,
      netGram: round2(th.netGram),
    });
  }

  if (!actualHasValue) return { ok: false, reason: 'no_items', items: [], comparableCount: 0 };
  // 全部原料都没理论值 ⇒ 有计划但算不了（成本卡里没有这些原料）
  if (!comparableCount) return { ok: false, reason: 'no_theory', items, comparableCount: 0 };
  return { ok: true, items, comparableCount };
}

/**
 * 「算不了」的原因 → 文案键（页面据此显示缺什么）。
 * 🔴 与 consumeDerive::missingOf 同族：只给键，取值由调用方查 TERMS。
 */
function missingKeyOf(reason) {
  if (reason === 'no_items') return 'reconMaterialNeedItems';
  if (reason === 'no_theory') return 'reconMaterialNeedCards';
  return 'reconMaterialNeedItems';
}

module.exports = { materialUsage, theoryQtyOf, missingKeyOf };
