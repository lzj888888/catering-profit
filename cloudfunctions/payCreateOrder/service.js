// cloudfunctions/payCreateOrder/service.js —— 批次 5 · 订单创建（Service 层纯逻辑）
//
// ⚠️ 当前阶段（批次 5 §2.6 私域）：enable_real_payment=false，**不接真实支付**。
//   · 本函数仍生成订单写入 shop_payment_flow（status='pending'，channel 记入），供订单记录页可见；
//   · pay_params 为空（无真实拉起支付参数）→ 前端提示「联系客服开通」；
//   · 权益由后台 source=manual 发放（payCallback / 管理端），前端展示逻辑不变。
// ⚠️ 免费额度维度：配额判定在 checkQuota（user_id 维度）；本函数只负责下单，不重复判定。
const { ERROR_CODES } = require('./common');

// 支付开关：执照+商户号就绪后改 true 即可接真实支付（前端一行不改，见 §2.6）
const ENABLE_REAL_PAYMENT = false;

/**
 * 生成订单号（纯函数）：前缀 + 时间戳 base36 + 随机段。
 */
function genOrderNo(prefix) {
  return (prefix || 'PO') + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1e6).toString(36).toUpperCase();
}

/**
 * 创建订单（纯计算 + 出参组装）。
 * @param {object} p { userId, planId, planName, priceFen, channel }
 * @returns {object} { order_no, amount_fen, plan_id, plan_name, channel,
 *                     enable_real_payment, pay_params (null) }
 */
function createOrder(p) {
  const channel = (p && p.channel) || 'wechat';
  return {
    order_no: genOrderNo('PO'),
    user_id: (p && p.userId) || '',
    amount_fen: Number(p && p.priceFen) || 0,
    plan_id: (p && p.planId) || '',
    plan_name: (p && p.planName) || '',
    channel,
    enable_real_payment: ENABLE_REAL_PAYMENT,
    pay_params: null, // 未接真实支付：无可拉起参数
    status: 'pending',
  };
}

module.exports = { createOrder, genOrderNo, ENABLE_REAL_PAYMENT, ERROR_CODES };