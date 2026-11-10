// cloudfunctions/common/audit.js
// 操作留痕（批次 0 §2.4 audit_log 字段）。铁律 8：只 INSERT，可追溯前后状态。
const { nowUtc } = require('./cx_utilTime');

/**
 * 写审计日志（只 INSERT）
 * @param {object} db
 * @param {object} p { action, operator_type, operator_id, shop_id, before_data, after_data, remark, idempotency_key }
 */
async function writeAudit(db, p) {
  const data = p || {};
  return db.collection('audit_log').add({
    data: {
      action: data.action,
      operator_type: data.operator_type || 'user',
      operator_id: data.operator_id || '',
      shop_id: data.shop_id || '',
      before_data: data.before_data === undefined ? null : data.before_data,
      after_data: data.after_data === undefined ? null : data.after_data,
      remark: data.remark || '',
      idempotency_key: data.idempotency_key || '',
      created_at: nowUtc(),
    },
  });
}

module.exports = { writeAudit };
