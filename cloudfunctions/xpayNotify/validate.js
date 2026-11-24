// cloudfunctions/xpayNotify/validate.js —— 虚拟支付发货回调入参校验（纯函数）
// ⚠️ 本函数不鉴权 OPENID（微信回调无登录态）；验签在 Controller 内 fail-closed 处理。
// 虚拟支付回调报文（xpay_goods_deliver_notify）关键字段：
//   OutTradeNo（业务单号=我方 order_no）/ Env / WeChatPayInfo / GoodsInfo / TransactionId
// 本层只做基础结构检查，字段语义校验在 service.verifyDeliveryPreconditions（用订单快照）。
// 内联（同 service.js）：与 cloudfunctions/common/errors.js 单源逐字一致，
// 让本纯函数不依赖 sync_common 派生的 common 副本即可自测。
const ERROR_CODES = { INVALID_PARAM: 'INVALID_PARAM' };

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象（虚拟支付回调报文）');
  const body = event.body || event;
  if (!body || typeof body !== 'object') return err('回调 body 必须是对象');
  const outTradeNo = body.OutTradeNo || body.out_trade_no || body.outTradeNo;
  if (!outTradeNo || typeof outTradeNo !== 'string') return err('缺 OutTradeNo（业务单号）');
  return {
    error: null,
    raw: event,
    input: { outTradeNo },
  };
}

module.exports = { validateInput, ERROR_CODES };
