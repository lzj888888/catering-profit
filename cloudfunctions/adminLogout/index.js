// cloudfunctions/adminLogout/index.js —— 批次 6 · 主动吊销当前 token（core/16 §8）
// token 取自 Authorization 头；从会话集合删除该 token，使其立即 ADMIN_AUTH_FAILED。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { parseBearer, requireAuth } = require('./adminAuth');

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  const sess = await requireAuth(db.collection('admin_login_log'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  const now = nowUtc();
  await db.collection('admin_login_log').where({ token }).remove();

  await db.collection('audit_log').add({
    data: {
      action: 'ADMIN_TOKEN_REVOKE',
      operator_type: 'admin',
      operator_id: sess.adminId,
      shop_id: '',
      before_data: null,
      after_data: { revoked: 'self' },
      remark: '主动退出，token 已吊销',
      idempotency_key: '',
      created_at: now,
    },
  }).catch(() => {});

  return ok({ ok: true });
};