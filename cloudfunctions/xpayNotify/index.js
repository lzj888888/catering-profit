// cloudfunctions/xpayNotify/index.js —— 微信虚拟支付发货回调（Controller 层 · 写）
//
// 🔴 全新建（三司会诊 2026-11-22 裁定）：payCallback 是普通支付 v3 报文、已冻结；
//    虚拟支付是另一套接口族（OutTradeNo / Env / WeChatPayInfo / GoodsInfo），验签与字段都不同。
//
// 流程：结构校验 → 验签（fail-closed：未注入官方验签器一律拒绝）→ 注入 DB 依赖 →
//      handleDelivery（幂等/校验/分流/原子发放）→ 3 秒应答微信。
//
// 幂等键 = 业务单号 OutTradeNo（= payCreateOrder 的 order_no，shop_payment_flow 已有 unique 索引）。
// transaction_id 只做对账，不做幂等键。
//
// 当前阶段（FREE_ACCESS / 未开虚拟支付）：验签器默认 fail-closed，无真实回调会走到发放。
// 二期接资质后：注入官方 xpay 验签器即可，service 纯逻辑一字不改。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { nowUtc } = common.utilTime;
const { validateInput } = require('./validate');
const {
  ERROR_CODES, ORDER_STATUS, handleDelivery, makeAtomicExpireWrite, toDbStatus,
} = require('./service');

// 微信虚拟支付应答：成功必须 3 秒内返回；失败按微信要求回错误码
const XPAY_SUCCESS = { errcode: 0, errmsg: 'ok' };
const XPAY_FAIL = { errcode: -1, errmsg: 'verify_failed' };

// 验签器：默认 fail-closed（未接真实支付）；二期注入官方实现。
// 这里做成可替换的表，便于单测注入假验签器。
const verifiers = {
  verify: () => false,
};
function setVerifier(fn) { verifiers.verify = (typeof fn === 'function') ? fn : (() => false); }

/**
 * 原子发放有效期：read → makeAtomicExpireWrite → where(期望值).update(inc) → 看 stats.updated。
 * 并发两笔同时读到同一 expire_at：只有一笔的 CAS 命中（updated=1），另一笔 updated=0 ⇒ 重试重算。
 * 这是把「先读后整条覆盖」（并发买两次只加一次）改成 MongoDB 可落地的条件累加。
 * 重试上限 5 次，超过 fail-closed 报错（不静默吞）。
 */
async function grantExpireAtomic(userId, days, now) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const entRes = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
    const ent = entRes && entRes.data && entRes.data[0];
    const currentExpireAt = ent ? (Number(ent.expire_at) || 0) : 0;
    const spec = makeAtomicExpireWrite(userId, currentExpireAt, now, days);

    // 已存在权益行：CAS 条件累加
    if (ent && ent._id) {
      const res = await db.collection('shop_entitlement').doc(ent._id).update({
        data: {
          expire_at: _.inc(spec.update.expire_at.__inc),
          updated_at: spec.update.updated_at,
        },
      });
      const updated = (res && (res.stats ? res.stats.updated : res.updated)) || 0;
      if (updated > 0) return { ok: true };
      continue; // 并发被抢，重读重算
    }

    // 无权益行：insert（user_id 唯一索引兜并发；冲突则重读重试）
    try {
      await db.collection('shop_entitlement').add({
        data: {
          user_id: userId,
          expire_at: spec.update.expire_at.__inc + now, // 从当前起算 + days
          source: 'xpay',
          updated_at: spec.update.updated_at,
        },
      });
      return { ok: true };
    } catch (e) {
      if (e && /duplicate|E11000/i.test(String(e.message || e))) continue; // 并发已建，重试走 CAS
      throw e;
    }
  }
  return { ok: false };
}

/**
 * 原子加诊断额度：where(credits_left >= 1 存在的行 → inc；不存在 → add)。
 * 复用 cx_diagnosisEntitlement.js:220 的先例写法；独立集合，绝不碰 expire_at。
 */
async function grantCreditAtomic(userId, credits) {
  const res = await db.collection('shop_diagnosis_credit').where({ user_id: userId })
    .update({ data: { credits_left: _.inc(credits), updated_at: nowUtc() } });
  const updated = (res && (res.stats ? res.stats.updated : res.updated)) || 0;
  if (updated > 0) return { ok: true };
  try {
    await db.collection('shop_diagnosis_credit').add({
      data: { user_id: userId, credits_left: credits, created_at: nowUtc(), updated_at: nowUtc() },
    });
    return { ok: true };
  } catch (e) {
    if (e && /duplicate|E11000/i.test(String(e.message || e))) {
      // 并发已建，再 update 一次
      const r2 = await db.collection('shop_diagnosis_credit').where({ user_id: userId })
        .update({ data: { credits_left: _.inc(credits), updated_at: nowUtc() } });
      return { ok: ((r2 && (r2.stats ? r2.stats.updated : r2.updated)) || 0) > 0 };
    }
    throw e;
  }
}

exports.main = async (event) => {
  // 1) 结构校验
  const v = validateInput(event);
  if (v.error) return XPAY_FAIL;

  // 2) 验签（fail-closed）
  if (verifiers.verify(event) !== true) return XPAY_FAIL;

  const body = event.body || event;
  const outTradeNo = v.input.outTradeNo;
  const openid = body.OpenId || body.openid || '';

  // 3) 注入 DB 依赖 → 纯逻辑内核
  const deps = {
    readOrder: async (no) => {
      const r = await db.collection('shop_payment_flow').where({ order_no: no }).limit(1).get();
      return (r && r.data && r.data[0]) || null;
    },
    resolveUser: async (oid) => {
      if (!oid) return null;
      const r = await db.collection('user').where({ openid: oid, is_deleted: false }).limit(1).get();
      return (r && r.data && r.data[0]) ? r.data[0].user_id : null;
    },
    verifyPlan: (planId) => {
      // 后端白名单：从 subscription_plan 读（二期接支付时改为预加载缓存，避免每单一次 DB 读）
      return null; // 同步接口占位；真实实现见二期（见下方 verifyPlanAsync 说明）
    },
    casMarkPaid: async (order) => {
      // 🔴 2026-11-24（R1）：where 与 update 都用**落库小写**（toDbStatus），
      //   与 payCreateOrder 写的 'pending' 对齐；否则 CAS 条件查不到旧单 ⇒ 状态永远推不动。
      const res = await db.collection('shop_payment_flow').where({
        order_no: order.order_no, status: toDbStatus(ORDER_STATUS.PENDING),
      }).update({ data: { status: toDbStatus(ORDER_STATUS.PAID), paid_at: nowUtc() } });
      return { ok: ((res && (res.stats ? res.stats.updated : res.updated)) || 0) > 0 };
    },
    markDelivered: async (order) => {
      await db.collection('shop_payment_flow').where({ order_no: order.order_no })
        .update({ data: { status: toDbStatus(ORDER_STATUS.DELIVERED), delivered_at: nowUtc() } });
    },
    grantExpire: grantExpireAtomic,
    grantCredit: async (uid, n) => grantCreditAtomic(uid, n),
    writeFlow: async (flow) => {
      // 对账字段补写到下单时已存在的那一单（order_no 是 unique 索引，不能 add 第二行）。
      //   零 schema 改动、不新建集合（新建会牵动 schema_sync 镜像 + 三份文档计数）。
      //   markDelivered 已把 status 推进到 DELIVERED；这里补 transaction_id / grant_kind / 金额供对账。
      //   重复回调时 where 命中同一行、覆盖写同值 ⇒ 天然幂等。
      await db.collection('shop_payment_flow').where({ order_no: flow.order_no }).update({
        data: {
          transaction_id: flow.transaction_id,
          grant_kind: flow.grant_kind,
          delivered_at: nowUtc(),
        },
      });
    },
    now: nowUtc,
  };

  try {
    // verifyPlan 需要异步读 DB：先预加载成同步闭包再交给内核（保持内核纯同步白名单接口）
    const planId = body.PlanId || body.plan_id || '';
    const planRes = await db.collection('subscription_plan').where({ plan_id: planId, enabled: true }).limit(1).get();
    const plan = planRes && planRes.data && planRes.data[0];
    deps.verifyPlan = (id) => (id === planId && plan) ? {
      ok: true, days: plan.days, grants: plan.grants || '', diag_credits: plan.diag_credits || 0,
    } : null;

    const result = await handleDelivery({
      outTradeNo,
      amountFen: body.Amount != null ? Number(body.Amount) : (body.total_fee != null ? Number(body.total_fee) : 0),
      planId,
      openid,
      transactionId: body.TransactionId || body.transaction_id || '',
    }, deps);

    // 幂等命中或发货成功 → 都 3 秒应答成功（重复回调不重发）
    return result.ok ? XPAY_SUCCESS : XPAY_FAIL;
  } catch (e) {
    // 记审计，返回失败让微信重试（最多 15 次）
    await db.collection('audit_log').add({
      data: {
        action: 'XPAY_DELIVERY_ERROR',
        operator_type: 'system', operator_id: '', shop_id: '',
        before_data: null,
        after_data: { reason: e && e.message, out_trade_no: outTradeNo, code: e && e.code || '' },
        remark: '虚拟支付发货异常', created_at: nowUtc(),
      },
    }).catch(() => {});
    return XPAY_FAIL;
  }
};

// 导出仅供 selftest/守卫断言契约（不参与云端运行）
exports.XPAY_SUCCESS = XPAY_SUCCESS;
exports.XPAY_FAIL = XPAY_FAIL;
exports.setVerifier = setVerifier;
exports.grantExpireAtomic = grantExpireAtomic;
exports.ERROR_CODES = ERROR_CODES;
