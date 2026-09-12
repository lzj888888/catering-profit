// cloudfunctions/common/index.js
// 公共层统一出口（批次 0 地基）。后续 1~7 批云函数统一 require('../common') 复用。
module.exports = {
  errors: require('./errors'),
  ERROR_CODES: require('./errors').ERROR_CODES,
  ok: require('./errors').ok,
  fail: require('./errors').fail,

  utilTime: require('./utilTime'),

  money: require('./money'),

  dataAdapter: require('./dataAdapter'),

  auth: require('./auth'),
  resolveAuth: require('./auth').resolveAuth,
  assertShopOwner: require('./auth').assertShopOwner,

  idempotency: require('./idempotency'),
  rateLimit: require('./rateLimit'),
  audit: require('./audit'),
};
