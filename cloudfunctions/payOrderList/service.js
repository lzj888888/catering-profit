// cloudfunctions/payOrderList/service.js —— 批次 5 · 订单流水出参映射（纯函数）
const { ERROR_CODES } = require('./common');

// shop_payment_flow doc → 订单出参（金额分整数；paid_at/状态原样）
function flowToOut(doc) {
  return {
    order_no: doc.order_no || '',
    plan_name: doc.plan_name || '',
    amount_fen: doc.amount != null ? doc.amount : 0,
    channel: doc.channel || '',
    status: doc.status || 'pending',
    paid_at: doc.paid_at || 0,
    created_at: doc.created_at || 0,
  };
}

module.exports = { flowToOut, ERROR_CODES };