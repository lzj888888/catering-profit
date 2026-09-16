// cloudfunctions/detectCycle/validate.js —— 入参校验（纯函数）。
// 契约（core/10 §3）：detectCycle 入参 { edges:[{from,to}] }。
const { ERROR_CODES } = require('./common');

function validateInput(event) {
  const err = (m) => ({ error: ERROR_CODES.INVALID_PARAM, msg: m });
  if (!event || typeof event !== 'object') return err('event 必须是对象');
  const src = event.input || event;
  if (typeof src.shop_id !== 'string' || !src.shop_id) return err('shop_id 必须是非空字符串');

  const edges = src.edges || [];
  if (!Array.isArray(edges)) return err('edges 必须是数组');
  const cEdges = [];
  for (const e of edges) {
    if (!e || typeof e.from !== 'string' || !e.from || typeof e.to !== 'string' || !e.to) {
      return err('edges 每项必须含非空字符串 from / to');
    }
    cEdges.push({ from: e.from, to: e.to });
  }
  return {
    error: null,
    shop_id: src.shop_id,
    edges: cEdges,
    input: { client_request_id: src.client_request_id || '' },
  };
}

module.exports = { validateInput, ERROR_CODES };