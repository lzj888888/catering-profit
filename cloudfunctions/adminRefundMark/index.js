// cloudfunctions/adminRefundMark/index.js —— 批次 6 · 退款标记（adminAuth）「权收数据留」
// 编排见 service.js：权益回退、order_refund 记录、ADMIN_REFUND 留痕；数据/订单/记录不删。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;
const { parseBearer, requireAuth } = require('./adminAuth');
const { refundMark } = require('./service');

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  // ===== 1. adminAuth 中间件 =====
  const sess = await requireAuth(db.collection('admin_login_log'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  const v = (event && event.input) || event || {};
  if (typeof v.order_id !== 'string' || !v.order_id) return fail(ERROR_CODES.INVALID_PARAM, 'order_id 必填');
  if (typeof v.reason !== 'string' || !v.reason.trim()) return fail(ERROR_CODES.INVALID_PARAM, 'reason 必填');

  const now = nowUtc();
  try {
    const result = await refundMark({
      nowMs: now,
      clientRequestId: v.client_request_id || '',
      readOrder: async (orderNo) => {
        const r = await db.collection('shop_payment_flow').where({ order_no: orderNo, is_deleted: false }).limit(1).get();
        return (r && r.data && r.data[0]) || null;
      },
      readAuditSnapshot: async (orderNo) => {
        const r = await db.collection('audit_log')
          .where({ action: 'ADMIN_MANUAL_ORDER', 'after_data.order_no': orderNo }).limit(1).get();
        return (r && r.data && r.data[0]) || null;
      },
      readPlan: async (planId) => {
        if (!planId) return null;
        const r = await db.collection('subscription_plan').where({ plan_id: planId }).limit(1).get();
        return (r && r.data && r.data[0]) || null;
      },
      readEntitlement: async (userId) => {
        const r = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
        return (r && r.data && r.data[0]) || null;
      },
      markOrderRefunded: async (docId) => {
        await db.collection('shop_payment_flow').doc(docId).update({ data: { status: 'refunded', updated_at: now } });
      },
      updateEntitlement: async (docId, expireAt, source) => {
        await db.collection('shop_entitlement').doc(docId).update({
          data: { expire_at: expireAt, source: source || 'manual', updated_at: now },
        });
      },
      insertRefund: async (doc) => {
        await db.collection('order_refund').add({ data: Object.assign({ created_at: now }, doc) });
      },
      checkIdempotent: async (key) => {
        const dup = await db.collection('audit_log').where({ idempotency_key: key }).limit(1).get();
        return !!(dup && dup.data && dup.data.length > 0);
      },
      writeAudit,
    }, {
      orderId: v.order_id,
      reason: v.reason,
      operatorId: sess.adminId,
    });

    return ok(result);
  } catch (e) {
    if (e && e.code === 'ADMIN_OP_IDEMPOTENT') return fail(ERROR_CODES.ADMIN_OP_IDEMPOTENT, '重复提交');
    if (e && e.code === 'ORDER_NOT_FOUND') return fail(ERROR_CODES.ORDER_NOT_FOUND, '订单不存在');
    if (e && e.code === 'REFUND_NOT_ALLOWED') return fail(ERROR_CODES.REFUND_NOT_ALLOWED, '订单已退款');
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '退款失败');
  }
};