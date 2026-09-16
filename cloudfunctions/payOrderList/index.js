// cloudfunctions/payOrderList/index.js —— 批次 5 · 订单记录页数据源（Controller 层 · 读）
//
// 订单主体 = user_id（全店通用，非按店铺）；shop_id 仅鉴权归属。
// 返回该用户全部支付流水（倒序），含订单号/套餐/金额/渠道/状态/生效期。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { flowToOut } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. 读该用户支付流水（DataAdapter 过滤软删；shop_payment_flow 主体=user_id）=====
  const da = makeAdapter(db);
  const res = await da.list('shop_payment_flow', { user_id: userId });
  const list = ((res && res.data) || [])
    .map(flowToOut)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)); // 新单在前

  return ok({
    shop_id: v.shop_id,
    list,
    client_request_id: v.input.client_request_id || '',
  });
};