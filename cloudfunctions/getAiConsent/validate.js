// cloudfunctions/getAiConsent/validate.js —— 入参校验（纯函数）
//
// 契约（core/10 §10）：`{ shop_id }`
// 🔴 读侧入参刻意**只有一个字段**：多一个可选参数（如 `scope:['pricing']` 只问某一项）
//   就等于把"权限判定"劈成两种调用形态，页面与 AI 链路各用一半 ⇒ 迟早出现两种答案。
//   要问某一项，前端对 `effective_scope` 做 `indexOf` 即可，不需要服务端再开一个口子。
const { ERROR_CODES } = require('./common');

const mkErr = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });

function validateInput(event) {
  if (!event || typeof event !== 'object') return mkErr('event 必须是对象');
  const src = event.input || event;

  if (typeof src.shop_id !== 'string' || !src.shop_id) {
    return mkErr('shop_id 必须是非空字符串');
  }

  // 🔴 **不做 trim** —— 与写侧 `grantAiConsent/validate.js` 逐字一致。
  //   读侧 trim、写侧不 trim ⇒ 写入 `' shop_x '` 后按 `'shop_x'` 查，读不到自己刚写的记录，
  //   而这种缺陷在自测里也看不出来（两边各测各的，都"通"）。
  //   归一化只能有**一处**：要么两边都 trim，要么都不做。当前全仓约定是不做，本函数跟随。
  return { error: null, shop_id: src.shop_id };
}

module.exports = { validateInput };
