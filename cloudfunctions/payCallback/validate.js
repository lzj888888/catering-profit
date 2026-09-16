// cloudfunctions/payCallback/validate.js —— 入参校验（纯函数）。
// ⚠️ 本函数**不鉴权 OPENID**（微信回调无登录态），签名校验在 Controller 内进行。
// 入参即微信回调原始报文（透传给 Service 验签），本层只做基础结构检查。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象（微信回调报文）');
  // 回调报文：headers + body；body 应含 out_trade_no / transaction_id / result_code 等
  const body = event.body || event;
  if (!body || typeof body !== 'object') return err('回调 body 必须是对象');
  return { error: null, raw: event, input: { client_request_id: '' } };
}

module.exports = { validateInput, ERROR_CODES };