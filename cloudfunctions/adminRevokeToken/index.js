// cloudfunctions/adminRevokeToken/index.js —— 批次 6 · 超管吊销指定管理员全部会话（core/16 §8）
// ⚠️ 仅 super 可调用（角色隔离）；吊销即删除该 admin 的全部活跃会话行，立即失效。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { parseBearer, requireAuth, requireRole } = require('./adminAuth');

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  // ===== 1. adminAuth 中间件 =====
  const sess = await requireAuth(db.collection('admin_login_log'), db.collection('admin_user'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  // ===== 2. 角色拦截：仅 super =====
  const roleErr = requireRole(sess.role, ['super']);
  if (roleErr) return fail(roleErr, '无权执行该操作');

  const v = (event && event.input) || event || {};
  const targetId = v.admin_id;
  if (typeof targetId !== 'string' || !targetId) return fail(ERROR_CODES.INVALID_PARAM, 'admin_id 必填');

  const now = nowUtc();
  // 删除该 admin 全部活跃会话
  await db.collection('admin_login_log').where({ admin_id: targetId }).remove();

  await db.collection('audit_log').add({
    data: {
      action: 'ADMIN_TOKEN_REVOKE',
      operator_type: 'admin',
      operator_id: sess.adminId,
      shop_id: '',
      before_data: { target_admin_id: targetId },
      after_data: { revoked: 'all_sessions' },
      remark: (v.reason || '') + '（超管吊销指定管理员会话）',
      idempotency_key: '',
      created_at: now,
    },
  }).catch(() => {});

  return ok({ ok: true, admin_id: targetId });
};