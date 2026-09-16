// cloudfunctions/payRenew/service.js —— 批次 5 · 续费订单生成（与 payCreateOrder 同款内联实现）
// 云函数包自包含：无法跨函数 require，此处内联同源 createOrder（生成 PR 前缀订单号）。
const { ERROR_CODES } = require('./common');

const ENABLE_REAL_PAYMENT = false;
function genOrderNo(prefix) {
  return (prefix || 'PR') + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1e6).toString(36).toUpperCase();
}
function createOrder(p) {
  const channel = (p && p.channel) || 'wechat';
  return {
    order_no: genOrderNo('PR'),
    user_id: (p && p.userId) || '',
    amount_fen: Number(p && p.priceFen) || 0,
    plan_id: (p && p.planId) || '',
    plan_name: (p && p.planName) || '',
    channel,
    enable_real_payment: ENABLE_REAL_PAYMENT,
    pay_params: null,
    status: 'pending',
  };
}

module.exports = { createOrder, genOrderNo, ENABLE_REAL_PAYMENT, ERROR_CODES };