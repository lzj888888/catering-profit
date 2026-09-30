// utils/takeawayDerive.js —— M3.17 外卖单均 + M3.32 外卖补丁（纯计算单源）
//
// 依据：`specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.17；
//       `specs/dev-specs/core/开发规范v1.2_ModuleM3增量_三块测算口径统一与外部补丁.md` §M3.32。
//
// 🔴 红线（违反即退回）：
//   ① 本文件**纯计算、不落库、不进云函数** —— 试算结果不落库，只做展示。
//   ② 佣金基数**恒为「商品总价」，不含打包费**（误用含打包费的支付额 = 系统性偏差）。
//   ③ 两套口径（到手 / 总额法）数字**不混进同一个总数**。
//   ④ 补贴承担方未选 ⇒ 该行不计入计算（fail-closed，不是"默认算商家"）。
//   ⑤ 打包费（收入）与包材成本（成本）两条腿都走、不得相抵。
//   ⑥ 外卖单均利润**不得进 M1**（输出对象不含任何 monthly/ledger 类字段，守卫 R135）。
//   ⑦ `commission_mode === 'fixed'` 时保底 min **不生效**（避免两条规则打架）。

// ===================== 佣金（rate / fixed 两模式） =====================
/**
 * 佣金计算。基数恒为「商品总价」（不含打包费）。
 * @param {object} params 平台参数
 *   - commission_mode: 'rate'（默认）| 'fixed'
 *   - commission_rate: %（rate 模式；0~100）
 *   - commission_min_fen: 保底（rate 模式可选；fixed 模式下**不生效**）
 *   - commission_fixed_fen: 固定金额（fixed 模式）
 * @param {number} goodsTotalFen 商品总价（分）
 * @returns {number} 佣金（分）
 */
function resolveCommission(params, goodsTotalFen) {
  const p = params || {};
  if (p.commission_mode === 'fixed') {
    // fixed：直接取固定金额；🔴 保底 min 不生效
    return Math.round(Number(p.commission_fixed_fen) || 0);
  }
  // rate（默认）
  const rate = Number(p.commission_rate) || 0;
  const base = Math.round((Number(goodsTotalFen) || 0) * rate / 100);
  const min = Number(p.commission_min_fen) || 0;
  return min > 0 ? Math.max(base, min) : base;
}

// ===================== 商家承担补贴合计（fail-closed） =====================
// 拆两行：s_user（用户券，承担方待定 K1）/ s_merchant（商家满减，商家承担）。
// 🔴 承担方未选（payer !== 'merchant'）⇒ 该行不计入（fail-closed，不默认算商家）。
function subsidyMerchant(params) {
  const p = params || {};
  let total = 0;
  if (p.s_user && p.s_user.payer === 'merchant') total += Number(p.s_user.amount_fen) || 0;
  if (p.s_merchant && p.s_merchant.payer === 'merchant') total += Number(p.s_merchant.amount_fen) || 0;
  return total;
}

// 包材成本 Cp = Σ(包材单价 × 数量)。临时包材行无 material_id，直接填 unit_price_fen。
function packCostOf(packs, lookup) {
  let total = 0;
  for (const pk of (Array.isArray(packs) ? packs : [])) {
    const qty = Number(pk && pk.qty) || 0;
    let upf = Number(pk && pk.unit_price_fen) || 0;
    if (!upf && pk && pk.material_id && lookup) {
      const m = lookup(pk.material_id) || {};
      upf = Number(m.unit_cost_fen) || 0;
    }
    total += upf * qty;
  }
  return total;
}

// ===================== 一单双口径计算 =====================
/**
 * 一单 = [卡或套餐 × 份数] + 包材 + 平台参数 ⇒ 两套口径结果（到手 / 总额法）。
 * @param {object} order
 *   - items: [{ card_id | combo_id, qty }]
 *   - packs: [{ material_id?, qty, unit_price_fen? }]
 *   - params: { commission_mode, commission_rate, commission_min_fen, commission_fixed_fen,
 *               delivery_fee_fen, delivery_subsidy_fen, promo_fen,
 *               pack_fee_fen, delivery_customer_fen,
 *               s_user: { amount_fen, payer }, s_merchant: { amount_fen, payer } }
 * @param {function} lookup (id) => { unit_cost_fen, price_fen }  卡/套餐解析器
 * @returns {{cash:{...}, accrual:{...}}} 两套口径（绝不混进同一个总数）
 */
function calcTakeawayOrder(order, lookup) {
  const items = (order && Array.isArray(order.items)) ? order.items : [];
  const packs = (order && Array.isArray(order.packs)) ? order.packs : [];
  const params = (order && order.params) || {};

  // 商品总价 + 菜品成本
  let goodsTotal = 0;
  let dishCost = 0;
  for (const it of items) {
    const id = (it && (it.card_id || it.combo_id)) || '';
    const qty = Number(it && it.qty) || 0;
    const card = (lookup && lookup(id)) || {};
    goodsTotal += (Number(card.price_fen) || 0) * qty;
    dishCost += (Number(card.unit_cost_fen) || 0) * qty;
  }

  // 包材成本
  const packCost = packCostOf(packs, lookup);

  // 平台参数
  const packFee = Number(params.pack_fee_fen) || 0;              // 打包费（收入）
  const deliveryCustomer = Number(params.delivery_customer_fen) || 0; // 配送费(顾客承担)
  const d = Number(params.delivery_fee_fen) || 0;                // 配送服务费
  const deliverySubsidy = Number(params.delivery_subsidy_fen) || 0; // 配送补贴
  const promo = Number(params.promo_fen) || 0;                   // 推广费
  const commission = resolveCommission(params, goodsTotal);
  const sMerchant = subsidyMerchant(params);                     // 商家承担补贴合计

  // ===== 口径一：到手（现金视角）=====
  const payment = goodsTotal + packFee + deliveryCustomer;       // 顾客支付 P
  const receipt = payment - sMerchant - commission - d - deliverySubsidy; // 商家实收 R
  const profit = receipt - dishCost - packCost;                  // 单均理论利润
  const receiptRate = payment > 0 ? Math.round((receipt / payment) * 10000) / 100 : 0;

  // ===== 口径二：总额法（会计视角 · 与 M1 对得上）=====
  const revenue = goodsTotal + packFee + sMerchant;              // 收入 = 商品总价 + 打包费 + 商家活动补贴
  const expense = commission + d + deliverySubsidy + sMerchant + promo; // 费用 = 佣金 + 配送服务费 + 补贴 + 推广
  const accrualProfit = revenue - expense - dishCost - packCost;

  return {
    cash: {
      goods_total_fen: Math.round(goodsTotal),
      pack_fee_fen: Math.round(packFee),
      delivery_customer_fen: Math.round(deliveryCustomer),
      payment_fen: Math.round(payment),
      commission_fen: Math.round(commission),
      delivery_fee_fen: Math.round(d),
      delivery_subsidy_fen: Math.round(deliverySubsidy),
      subsidy_merchant_fen: Math.round(sMerchant),
      promo_fen: Math.round(promo),
      receipt_fen: Math.round(receipt),
      dish_cost_fen: Math.round(dishCost),
      pack_cost_fen: Math.round(packCost),
      profit_fen: Math.round(profit),
      receipt_rate: receiptRate,
    },
    accrual: {
      revenue_fen: Math.round(revenue),
      expense_fen: Math.round(expense),
      dish_cost_fen: Math.round(dishCost),
      pack_cost_fen: Math.round(packCost),
      profit_fen: Math.round(accrualProfit),
    },
  };
}

// ===================== 挂牌价反算 =====================
/**
 * 挂牌价反算：给定目标到手利润 M，反推商品挂牌总价 P*（不含打包费）。
 * 公式：P* = (Cf + Cp + M + s + d + 配送费(顾客承担) − 打包费收入) ÷ (1 − c)
 *   分母 (1 − c) 体现佣金按商品总价计；配送费顾客承担须同侧一致（分子补该项）。
 * @param {object} input
 *   - dish_cost_fen / pack_cost_fen / target_profit_fen
 *   - subsidy_merchant_fen（商家承担补贴合计）
 *   - delivery_fee_fen（配送服务费 d）/ delivery_customer_fen（配送费顾客承担）
 *   - pack_fee_fen（打包费收入）/ commission_rate（%）
 * @returns {number} P*（商品挂牌总价，分；round 到分）
 */
function reverseListedPrice(input) {
  const p = input || {};
  const cf = Number(p.dish_cost_fen) || 0;
  const cp = Number(p.pack_cost_fen) || 0;
  const m = Number(p.target_profit_fen) || 0;
  const s = Number(p.subsidy_merchant_fen) || 0;
  const d = Number(p.delivery_fee_fen) || 0;
  const deliveryCustomer = Number(p.delivery_customer_fen) || 0;
  const packFee = Number(p.pack_fee_fen) || 0;
  const c = Number(p.commission_rate) || 0;
  if (c >= 100) return 0;
  const numerator = cf + cp + m + s + d + deliveryCustomer - packFee;
  return Math.round(numerator / (1 - c / 100));
}

module.exports = {
  calcTakeawayOrder,
  resolveCommission,
  reverseListedPrice,
};
