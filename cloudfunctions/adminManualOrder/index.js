// cloudfunctions/adminManualOrder/index.js —— 批次 6 · 私域订单手动录入（adminAuth）
// 编排见 service.js：标记已支付 → 自动按套餐天数发权益（source=manual，§2.7）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;
const { parseBearer, requireAuth } = require('./adminAuth');
const { manualOrder } = require('./service');

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  // ===== 1. adminAuth 中间件（运营/超管均可录单）=====
  const sess = await requireAuth(db.collection('admin_login_log'), db.collection('admin_user'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  const v = (event && event.input) || event || {};
  if (typeof v.user_id !== 'string' || !v.user_id) return fail(ERROR_CODES.INVALID_PARAM, 'user_id 必填');
  if (typeof v.plan_id !== 'string' || !v.plan_id) return fail(ERROR_CODES.INVALID_PARAM, 'plan_id 必填');
  if (typeof v.amount_fen !== 'number' || !Number.isInteger(v.amount_fen) || v.amount_fen < 0) {
    return fail(ERROR_CODES.INVALID_PARAM, 'amount_fen 必须是非负整数分');
  }

  const now = nowUtc();
  try {
    const result = await manualOrder({
      nowMs: now,
      clientRequestId: v.client_request_id || '',
      readPlan: async (planId) => {
        const r = await db.collection('subscription_plan').where({ plan_id: planId }).limit(1).get();
        return (r && r.data && r.data[0]) || null;
      },
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
      insertOrder: async (doc) => {
        await db.collection('shop_payment_flow').add({ data: Object.assign({ is_deleted: false }, doc) });
      },
      // 🔒 R72：引用单源 common/idempotency.js，不再内联重写（此前 3 处逐字重复同一段查询）
      checkIdempotent: (key) => common.idempotency.checkIdempotent(db, key),
      writeAudit,
    }, {
      userId: v.user_id,
      planId: v.plan_id,
      amountFen: v.amount_fen,
      paidAt: v.paid_at ? Number(v.paid_at) : now,
      remark: (typeof v.remark === 'string') ? v.remark : '',
      operatorId: sess.adminId,
      shopId: (typeof v.shop_id === 'string') ? v.shop_id : '',
    });

    return ok(result);
  } catch (e) {
    if (e && e.code === 'ADMIN_OP_IDEMPOTENT') return fail(ERROR_CODES.ADMIN_OP_IDEMPOTENT, '重复提交');
    if (e && e.code === 'INVALID_PARAM') return fail(ERROR_CODES.INVALID_PARAM, e.message);
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '录单失败');
  }
};