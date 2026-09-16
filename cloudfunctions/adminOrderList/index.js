// cloudfunctions/adminOrderList/index.js —— 批次 6 · 订单管理列表（adminAuth）
// 按 user_id? / status? 过滤，分页；金额分整数仅格式化展示。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { parseBearer, requireAuth } = require('./adminAuth');

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  const sess = await requireAuth(db.collection('admin_login_log'), db.collection('admin_user'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  const v = (event && event.input) || event || {};
  const page = Math.max(1, Number(v.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(v.page_size) || 20));

  // 组装过滤条件
  const cond = { is_deleted: false };
  if (typeof v.user_id === 'string' && v.user_id) cond.user_id = v.user_id;
  if (v.status === 'paid' || v.status === 'pending' || v.status === 'refunded') cond.status = v.status;

  const res = await db.collection('shop_payment_flow').where(cond)
    .orderBy('created_at', 'desc')
    .limit(pageSize).skip((page - 1) * pageSize).get();
  const rows = (res && res.data) || [];

  const list = rows.map((o) => ({
    order_no: o.order_no || '',
    user_id: o.user_id || '',
    amount_fen: o.amount != null ? o.amount : 0,
    plan_id: o.plan_id || '',
    plan_name: o.plan_name || '',
    status: o.status || 'pending',
    channel: o.channel || '',
    paid_at: o.paid_at || 0,
    created_at: o.created_at || 0,
  }));

  return ok({ list, page, page_size: pageSize, count: list.length });
};