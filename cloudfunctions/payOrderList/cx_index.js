// cloudfunctions/common/index.js
// 公共层单源（批次 0 地基）。后续 1~7 批云函数的复用方式（见 tools/sync_common.js）：
//   本目录是「单源」，由 tools/sync_common.js 复制进每个 cloudfunctions/<func>/common/；
//   云函数内统一 require('./common')（指向自身目录内的副本，而非 ../common —— 后者云端 MODULE_NOT_FOUND）。
module.exports = {
  errors: require('./cx_errors'),
  ERROR_CODES: require('./cx_errors').ERROR_CODES,
  ok: require('./cx_errors').ok,
  fail: require('./cx_errors').fail,

  utilTime: require('./cx_utilTime'),

  money: require('./cx_money'),

  dataAdapter: require('./cx_dataAdapter'),

  auth: require('./cx_auth'),
  resolveAuth: require('./cx_auth').resolveAuth,
  assertShopOwner: require('./cx_auth').assertShopOwner,

  idempotency: require('./cx_idempotency'),
  rateLimit: require('./cx_rateLimit'),
  audit: require('./cx_audit'),
};
