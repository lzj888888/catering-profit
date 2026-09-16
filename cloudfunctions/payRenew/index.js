// cloudfunctions/payRenew/index.js —— 批次 5 · 续费入口（Controller 层 · 写）
//
// 续费 = 再次创建订单（复用 payCreateOrder 逻辑），有效期**累加**由 payCallback 完成：
//   payCallback 的 calcNewExpireAt：未过期 → 原 expire_at + days（累加）；已过期 → 当前时刻 + days。
// 本函数仅创建 pending 订单（enable_real_payment=false → pay_params=null，前端提示联系客服）。
//
// ⚠️ 契约（core/10 §5）：前端**无需直接调用本接口**；保留作为统一续费入口（入参 = 选中的套餐）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { createOrder } = require('./service');
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

  // ===== 3. 读套餐配置 =====
  const planRes = await db.collection('subscription_plan').where({ plan_id: v.plan_id }).limit(1).get();
  const plan = planRes && planRes.data && planRes.data[0];
  if (!plan) return fail(ERROR_CODES.INVALID_PARAM, 'plan_id 不存在');
  if (plan.enabled === false) return fail(ERROR_CODES.FEATURE_LOCKED, '该套餐未开放');

  // ===== 4. 创建续费订单（复用 createOrder）=====
  const order = createOrder({ userId, planId: plan.plan_id, planName: plan.name, priceFen: plan.price, channel: v.channel });

  const da = makeAdapter(db);
  await da.insert('shop_payment_flow', {
    order_no: order.order_no,
    user_id: order.user_id,
    shop_id: v.shop_id || '',
    amount: order.amount_fen,
    plan_id: order.plan_id,
    plan_name: order.plan_name,
    status: order.status,
    channel: order.channel,
    paid_at: 0,
  });

  return ok({
    order_no: order.order_no,
    amount_fen: order.amount_fen,
    plan_id: order.plan_id,
    plan_name: order.plan_name,
    enable_real_payment: order.enable_real_payment,
    pay_params: order.pay_params,
    status: order.status,
    client_request_id: v.input.client_request_id || '',
  });
};