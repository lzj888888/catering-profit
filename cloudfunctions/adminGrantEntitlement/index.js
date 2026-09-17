// cloudfunctions/adminGrantEntitlement/index.js —— 批次 6 · 手动调权（adminAuth + super）
//
// ⚠️ 核心规则见 service.js（批次 6 §2.3：未到期累加 / 过期从当日）。
// ⚠️ 幂等：client_request_id 校验（audit_log 的 idempotency_key 全局查重），重复提交不重复处理/留痕。
// ⚠️ 留痕：action=ADMIN_GRANT_ENTITLEMENT，记录前值/后值/原因/操作人；source=manual，必填原因。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;
const { parseBearer, requireAuth, requireRole } = require('./adminAuth');
const { grantEntitlement } = require('./service');

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  // ===== 1. adminAuth 中间件 =====
  const sess = await requireAuth(db.collection('admin_login_log'), db.collection('admin_user'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  // ===== 2. 角色拦截：仅 super 可调权（运营不可）=====
  const roleErr = requireRole(sess.role, ['super']);
  if (roleErr) return fail(roleErr, '运营账号不可手动调权');

  const v = (event && event.input) || event || {};
  if (typeof v.user_id !== 'string' || !v.user_id) return fail(ERROR_CODES.INVALID_PARAM, 'user_id 必填');
  if (!Number.isInteger(v.days) || v.days < 1 || v.days > 3650) return fail(ERROR_CODES.INVALID_PARAM, 'days 必须为 1~3650 整数');
  if (typeof v.reason !== 'string' || !v.reason.trim()) return fail(ERROR_CODES.INVALID_PARAM, 'reason 必填（操作留痕）');
  const clientRequestId = v.client_request_id || '';

  const now = nowUtc();
  try {
    const result = await grantEntitlement({
      nowMs: now,
      clientRequestId,
      readEntitlement: async (userId) => {
        const r = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
        return (r && r.data && r.data[0]) || null;
      },
      upsertEntitlement: async (doc) => {
        if (doc._id) {
          await db.collection('shop_entitlement').doc(doc._id).update({
            data: { expire_at: doc.expire_at, source: doc.source, updated_at: doc.updated_at },
          });
        } else {
          await db.collection('shop_entitlement').add({
            data: { user_id: doc.user_id, expire_at: doc.expire_at, source: doc.source, updated_at: doc.updated_at },
          });
        }
      },
      // 🔒 R72：引用单源 common/idempotency.js，不再内联重写（此前 3 处逐字重复同一段查询）
      checkIdempotent: (key) => common.idempotency.checkIdempotent(db, key),
      writeAudit,
    }, {
      userId: v.user_id,
      days: v.days,
      reason: v.reason,
      operatorId: sess.adminId,
    });

    return ok(result);
  } catch (e) {
    if (e && e.code === 'ADMIN_OP_IDEMPOTENT') return fail(ERROR_CODES.ADMIN_OP_IDEMPOTENT, '重复提交');
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '调权失败');
  }
};