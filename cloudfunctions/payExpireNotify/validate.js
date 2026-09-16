// cloudfunctions/payExpireNotify/validate.js —— 定时任务无入参校验（保留入口形态，防误调）
const { ERROR_CODES } = require('./common');

function validateInput() {
  return { error: null, input: { client_request_id: '' } };
}

module.exports = { validateInput, ERROR_CODES };