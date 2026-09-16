// cloudfunctions/adminRefreshToken/index.js —— 批次 6 · 刷新 token（core/16 §8）
//
// ⚠️ token 取自 Authorization 头；仅当 expires_at 剩 <24h 且会话活跃时签发新 token，
//   并**立即使旧 token 失效**（删除旧会话行），写入新会话。前端静默刷新，不强制重登。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { parseBearer, requireAuth, genToken, TOKEN_TTL_MS } = require('./adminAuth');

const REFRESH_WINDOW_MS = 24 * 3600 * 1000;          // 剩 <24h 才刷新

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  // ===== 1. adminAuth 中间件（校验当前 token）=====
  const sess = await requireAuth(db.collection('admin_login_log'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  const now = nowUtc();
  const curRow = await db.collection('admin_login_log').where({ token }).limit(1).get();
  const row = curRow && curRow.data && curRow.data[0];

  // ===== 2. 剩余有效期 <24h 才签发新 token =====
  if (!row || (row.expires_at - now) >= REFRESH_WINDOW_MS) {
    // 剩余仍充足：返回当前 token 信息（不签发）
    return ok({ token, role: sess.role, expires_at: row ? row.expires_at : 0, refreshed: false });
  }

  // ===== 3. 签发新 token，旧 token 立即失效 =====
  const newToken = genToken();
  const newExpiresAt = now + TOKEN_TTL_MS;
  if (row._id) {
    await db.collection('admin_login_log').doc(row._id).remove();
  }
  await db.collection('admin_login_log').add({
    data: {
      admin_id: sess.adminId,
      ip: (cloud.getWXContext && cloud.getWXContext().CLIENTIP) || '',
      result: 'refresh',
      token: newToken,
      role: sess.role,
      expires_at: newExpiresAt,
      created_at: now,
    },
  });

  // 留痕
  await db.collection('audit_log').add({
    data: {
      action: 'ADMIN_TOKEN_REFRESH',
      operator_type: 'admin',
      operator_id: sess.adminId,
      shop_id: '',
      before_data: { token_len: token.length },
      after_data: { token_len: newToken.length, expires_at: newExpiresAt },
      remark: 'token 刷新（旧 token 已失效）',
      idempotency_key: '',
      created_at: now,
    },
  }).catch(() => {});

  return ok({ token: newToken, role: sess.role, expires_at: newExpiresAt, refreshed: true });
};