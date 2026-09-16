// cloudfunctions/payCreateOrder/index.js —— 批次 5 · 创建支付订单（Controller 层 · 写）
//
// 流程：鉴权中间件（批次 0）→ 校验 → 读 subscription_plan 配置（价格/名/是否一次性，后端下发，前端不硬编码）
//      → Service 生成订单 → 写 shop_payment_flow（status=pending）→ 返回 order_no / pay_params。
//
// ⚠️ 付费弹窗触发边界：本函数**只**被「保存超限 / 导出」两类场景调用（前端 paywall.js 把关），
//   进入页面/录入/试算不触发；M2 永不调用。
// ⚠️ iOS 降级（§2.5）：type='auto_subscribe' 的套餐在 iOS 端**不展示**（前端不传 channel='ios_auto' 即可；
//   本函数对自动订阅套餐在任意 channel 都放行创建——展示层的 iOS 过滤由前端/下单入口完成）。
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

  // ===== 3. 读套餐配置（后端下发价格/名；订阅版 type=auto_subscribe 在 iOS 由展示层过滤）=====
  const planRes = await db.collection('subscription_plan').where({ plan_id: v.plan_id }).limit(1).get();
  const plan = planRes && planRes.data && planRes.data[0];
  if (!plan) return fail(ERROR_CODES.INVALID_PARAM, 'plan_id 不存在');
  if (plan.enabled === false) return fail(ERROR_CODES.FEATURE_LOCKED, '该套餐未开放');

  // ===== 4. Service 生成订单 =====
  const order = createOrder({
    userId,
    planId: plan.plan_id,
    planName: plan.name,
    priceFen: plan.price,
    channel: v.channel,
  });

  // ===== 5. 写 shop_payment_flow（status=pending；主体=user_id，shop_id 为下单来源）=====
  const da = makeAdapter(db);
  await da.insert('shop_payment_flow', {
    order_no: order.order_no,
    user_id: order.user_id,
    shop_id: v.shop_id,
    amount: order.amount_fen,
    plan_id: order.plan_id,
    plan_name: order.plan_name,
    status: order.status,
    channel: order.channel,
    paid_at: 0,
  });

  return ok({
    shop_id: v.shop_id,
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