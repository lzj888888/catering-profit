// cloudfunctions/payCallback/index.js —— 批次 5 · 微信支付回调（Controller 层 · 写）
//
// ⚠️ 本函数**不鉴权 OPENID**（微信回调无登录态），先校验官方签名：
//   · 验签失败 → 丢弃请求 + 写 audit_log（action=PAY_CALLBACK_REJECT），返回微信要求的失败报文；
//   · 验签通过 → handleCallback（transaction_id 幂等）→ 只做两件事：写流水 + 更新 expire_at。
//
// 当前阶段（enable_real_payment=false，§2.6）：无真实回调；验签器默认 fail-closed。
// 执照+商户号就绪后，注入官方 SDK 验签实现即可，本文件其余逻辑不改。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { verifyCallbackSign, handleCallback } = require('./service');
const { validateInput } = require('./validate');

// 微信回调成功报文（按微信文档；业务包装 {code:'OK'} 在此不适用）
const WECHAT_SUCCESS = { return_code: 'SUCCESS', return_msg: 'OK' };
const WECHAT_FAIL = { return_code: 'FAIL', return_msg: '签名校验失败' };

exports.main = async (event) => {
  // ===== 1. 基础结构校验 =====
  const v = validateInput(event);
  if (v.error) return WECHAT_FAIL;

  // ===== 2. 验签（fail-closed：未注入官方验签器 → 一律拒绝并留痕）=====
  // 生产注入：官方 SDK 验签（platform cert + RSA-SHA256）；本文件无密钥，保持默认拒绝。
  const signOk = verifyCallbackSign(v.raw);
  if (!signOk) {
    try {
      await db.collection('audit_log').add({
        data: {
          action: 'PAY_CALLBACK_REJECT',
          operator_type: 'system',
          operator_id: '',
          shop_id: '',
          before_data: null,
          after_data: { reason: 'signature_verify_failed', txn: (v.raw && v.raw.body && v.raw.body.transaction_id) || '' },
          remark: '支付回调签名校验失败，请求已丢弃',
          idempotency_key: '',
          created_at: nowUtc(),
        },
      });
    } catch (e) { /* 审计失败不阻断返回 */ }
    return WECHAT_FAIL;
  }

  // ===== 3. 验签通过 → 幂等处理（只写流水 + 更新 expire_at）=====
  const body = v.raw.body || {};
  const da = makeAdapter(db);

  try {
    const result = await handleCallback({
      transactionId: body.transaction_id,
      orderNo: body.out_trade_no,
      openid: body.openid,
      amountFen: body.total_fee != null ? Number(body.total_fee) : 0,
      planId: body.attach || body.plan_id || '',
      paidAtMs: nowUtc(),
      serverNowMs: nowUtc(),
      readFlow: async (txn) => {
        const r = await db.collection('shop_payment_flow').where({ transaction_id: txn }).limit(1).get();
        return (r && r.data && r.data[0]) || null;
      },
      insertFlow: async (flow) => {
        await da.insert('shop_payment_flow', flow);
      },
      resolveUser: async (openid) => {
        const r = await db.collection('user').where({ openid, is_deleted: false }).limit(1).get();
        return (r && r.data && r.data[0]) ? r.data[0].user_id : null;
      },
      readEntitlement: async (userId) => {
        const r = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
        return (r && r.data && r.data[0]) || null;
      },
      updateExpire: async (userId, newExpireAt, source) => {
        // shop_entitlement 无 is_deleted 字段，直接 upsert
        const existRes = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
        const exist = existRes && existRes.data && existRes.data[0];
        if (exist) {
          await db.collection('shop_entitlement').doc(exist._id).update({
            data: { expire_at: newExpireAt, source, updated_at: nowUtc() },
          });
        } else {
          await db.collection('shop_entitlement').add({
            data: { user_id: userId, expire_at: newExpireAt, source, updated_at: nowUtc() },
          });
        }
      },
      daysOfPlan: async (planId) => {
        if (!planId) return 30;
        const r = await db.collection('subscription_plan').where({ plan_id: planId }).limit(1).get();
        const plan = r && r.data && r.data[0];
        return plan ? (plan.days || 30) : 30;
      },
    });

    // 幂等命中或处理成功 → 都返回微信成功报文（重复回调直接返回成功，不重复发权益）
    return WECHAT_SUCCESS;
  } catch (e) {
    await db.collection('audit_log').add({
      data: {
        action: 'PAY_CALLBACK_ERROR',
        operator_type: 'system',
        operator_id: '',
        shop_id: '',
        before_data: null,
        after_data: { reason: e && e.message, txn: body.transaction_id || '' },
        remark: '支付回调处理异常',
        idempotency_key: '',
        created_at: nowUtc(),
      },
    }).catch(() => {});
    return WECHAT_FAIL;
  }
};

// 导出供 selftest 断言「回调不返回业务包装」（契约 core/10 §5）
exports.WECHAT_SUCCESS = WECHAT_SUCCESS;
exports.WECHAT_FAIL = WECHAT_FAIL;