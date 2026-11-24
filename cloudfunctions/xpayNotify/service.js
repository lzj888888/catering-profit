// cloudfunctions/xpayNotify/service.js —— 微信虚拟支付发货回调（纯逻辑内核 / Service 层）
//
// 🔴 为什么新建本函数、而不是改 payCallback（三司会诊 2026-11-22 裁定）：
//   1) payCallback 是**普通微信支付 v3** 报文（Wechatpay-Signature / total_fee / attach），
//      而小程序**虚拟支付**是另一套接口族（OutTradeNo / Env / WeChatPayInfo / GoodsInfo），
//      验签与字段语义都不同 —— 「注入验签器即可、其余不改」是与「前端一行不改」同族的错误。
//   2) payCallback 已被 7 套守卫引用（check_pay_orders_stub.js:248 等）且冻结清单要求不动语义
//      ⇒ 全新建 xpayNotify，payCallback 保留冻结、只摘路由（见 review/AUDIT_...接支付方案三司会诊裁定.md）。
//
// 🔴 本文件是**纯逻辑**：不 require wx-server-sdk、不碰 DB，所有 IO 由 Controller 注入。
//    这样重复/乱序/并发三种致命场景可用 mock 完整覆盖，本地全绿才上现网。
//
// 幂等键裁定（豆包主 / DeepSeek 辅，见裁定 §1 Q4）：
//   · 幂等主键 = **业务单号 order_no**（= payCreateOrder 生成的 PO...，shop_payment_flow 已有
//     unique 索引 idx_pay_order）—— 我们要防的是「同一笔业务单被回调重试 15 次重复发货」。
//   · transaction_id 是微信流水号，**只做对账、不做幂等键**（并发重发会换号，不能当业务主键）。
//   · order_no 已存在且唯一 ⇒ **零 schema 改动**（不新建 goods_order_id 字段、不动索引镜像/三份文档）。
//     裁定原文写「加 goods_order_id」是字段命名差异；本仓语义里 order_no 即 goods_order_id。
//
// 状态机（裁定 §2 P0-1）：PENDING → PAID → DELIVERED（+ REFUNDING / REFUNDED），只允许单向推进。
// 发货铁律（虚拟支付）：前端 success 只代表「支付调起成功」，**唯一发货依据 = xpay_goods_deliver_notify 推送**。

// ⚠️ 不 require('./common')：本内核只用 7 个稳定错误码常量，内联可让纯逻辑 selftest
//    在 sync_common 派生之前独立跑（Controller 层仍用 common 的 ok/fail）。
//    与 cloudfunctions/common/errors.js 逐字对齐（见 selftest 的 parity 断言）。
const ERROR_CODES = {
  INVALID_PARAM: 'INVALID_PARAM',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  PLAN_MISMATCH: 'PLAN_MISMATCH',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
};

const DAY_MS = 24 * 3600 * 1000;

// 订单状态机（内核内部用**大写**常量，只为可读性；落库一律经 `toDbStatus()` 转小写）。
// 🔴 2026-11-24（R1 修复）：`shop_payment_flow.status` 的历史约定是**小写** ——
//   payCreateOrder/payRenew 写 'pending'、adminManualOrder 写 'paid'、adminRefundMark 写 'refunded'。
//   本内核原先直接把大写写进 DB、又按大写查，导致「旧单查不到 + 新值旧代码不认识」两处断裂。
//   ⇒ 定两条铁律：① 写 DB 必须过 toDbStatus；② 读 DB 比较前必须过 normStatus。
const ORDER_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  DELIVERED: 'DELIVERED',
  REFUNDING: 'REFUNDING',
  REFUNDED: 'REFUNDED',
};

// 大写（内核语义）→ 小写（DB 实际存值）
const DB_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  DELIVERED: 'delivered',
  REFUNDING: 'refunding',
  REFUNDED: 'refunded',
};
/** 内核状态 → 落库值（写 DB 前**必须**过这一层） */
function toDbStatus(s) {
  return DB_STATUS[s] || String(s == null ? '' : s).toLowerCase();
}
/** 落库值（或任意来源）→ 内核状态（比较前**必须**过这一层）；未知值原样大写返回，交给状态机 fail-closed */
function normStatus(s) {
  return String(s == null ? '' : s).toUpperCase();
}

// 合法迁移：只允许单向推进；终态 REFUNDED 不可再迁出。
const ALLOWED_TRANSITIONS = {
  PENDING: ['PAID'],
  PAID: ['DELIVERED', 'REFUNDING'],
  DELIVERED: ['REFUNDING'],
  REFUNDING: ['REFUNDED'],
  REFUNDED: [],
};

/**
 * 状态机推进（纯函数）。
 * @param {string} from 当前状态
 * @param {string} to   目标状态
 * @returns {{ok:boolean, same:boolean, code?:string}}
 *   - same=true 表示「已在目标态」（幂等命中，不重复发货）
 *   - ok=false + code=INVALID_PARAM 表示非法跨态/回退（fail-closed，不许静默放行）
 */
function transitionStatus(from, to) {
  if (from === to) return { ok: true, same: true };
  const next = ALLOWED_TRANSITIONS[from] || [];
  if (next.indexOf(to) < 0) {
    const e = new Error(`非法状态迁移 ${from} → ${to}`);
    e.code = ERROR_CODES.INVALID_PARAM;
    throw e;
  }
  return { ok: true, same: false };
}

/**
 * 校验发货前置条件（纯函数，fail-closed）。
 * 防的是三司 Q6 第二风险：验签通过但 attach/金额比对缺失 ⇒ 季/年卡按 30 天发（旧 bug 被继承）。
 * @param {object} p {
 *   order:       订单文档（含 order_no / user_id / amount_fen / plan_id / status）,
 *   outTradeNo:  回调里的业务单号（虚拟支付 OutTradeNo，= 我方 order_no）,
 *   amountFen:   回调金额（分），
 *   planId:      回调 plan_id（来自服务端下单快照，不信任前端 attach）,
 *   plan白名单:   verifyPlan(p) => {ok, days, grants, diag_credits} （后端读配置，注入）
 * }
 * @returns {{ok:boolean, plan:object}} 不通过抛带 code 的 Error
 */
function verifyDeliveryPreconditions(p) {
  const order = p && p.order;
  if (!order) {
    const e = new Error('订单不存在（order_no 未命中）');
    e.code = ERROR_CODES.ORDER_NOT_FOUND;
    throw e;
  }
  if (!p.outTradeNo || p.outTradeNo !== order.order_no) {
    const e = new Error('OutTradeNo 与订单业务单号不一致');
    e.code = ERROR_CODES.ORDER_NOT_FOUND;
    throw e;
  }
  // 金额校验：回调金额必须 === 订单快照金额（下单时由后端读 subscription_plan 写入，前端不硬编码）
  // 🔴 2026-11-24（R1 修复）：下单侧（payCreateOrder/payRenew/adminManualOrder）落的字段名是 **`amount`**，
  //   本内核原先只读 `amount_fen` ⇒ Number(undefined)=NaN ⇒ 真回调必 PLAN_MISMATCH（付了钱发不出货）。
  //   ⇒ 两种字段都认，`amount_fen` 优先（新链路若将来统一到它，此兼容层自然退化）。
  const orderFen = order.amount_fen != null ? order.amount_fen : order.amount;
  if (Number(p.amountFen) !== Number(orderFen)) {
    const e = new Error(`金额不符：回调 ${p.amountFen} ≠ 订单 ${orderFen}`);
    e.code = ERROR_CODES.PLAN_MISMATCH;
    throw e;
  }
  // planId 校验：回调 plan_id 必须与订单快照一致（防「用月卡的钱买年卡」）
  if (!p.planId || p.planId !== order.plan_id) {
    const e = new Error('plan_id 与订单快照不一致');
    e.code = ERROR_CODES.PLAN_MISMATCH;
    throw e;
  }
  // 白名单校验：plan 必须后端可解析且仍启用（不信任任何前端传入的天数/权益）
  const plan = p.verifyPlan ? p.verifyPlan(p.planId) : null;
  if (!plan || plan.ok === false) {
    const e = new Error('plan_id 不在后端白名单或未启用');
    e.code = ERROR_CODES.PLAN_MISMATCH;
    throw e;
  }
  return { ok: true, plan };
}

/**
 * 权益分流判定（纯函数）——裁定 P0-3 的「diag_credit 不碰月卡」。
 * 单次诊断档 grants='diag_credit'：只加诊断额度，**绝不改 expire_at**
 *   （否则买 19.9 单次会把已付费月卡的 expire_at 覆盖成 now，钱级缺陷）。
 * 订阅档：走有效期累加。
 * @param {object} plan {days, grants, diag_credits}
 * @returns {{kind:'expire'|'credit', days:number, credits:number}}
 */
function resolveGrantKind(plan) {
  if (!plan || typeof plan !== 'object') {
    const e = new Error('plan 缺失，无法判定权益类型');
    e.code = ERROR_CODES.SYSTEM_ERROR;
    throw e;
  }
  if (plan.grants === 'diag_credit') {
    return { kind: 'credit', days: 0, credits: Math.max(1, Number(plan.diag_credits) || 1) };
  }
  // ⚠️ 不许用 `Number(plan.days) || 30` 兜底：days=0 会被兜成 30，
  //    于是「单次诊断误配成订阅档」时静默按 30 天发 —— fail-closed 必须显式拒绝。
  const days = Number(plan.days);
  if (!(days > 0)) {
    const e = new Error(`订阅档 days 必须 > 0（实际 ${plan.days}）`);
    e.code = ERROR_CODES.SYSTEM_ERROR;
    throw e;
  }
  return { kind: 'expire', days, credits: 0 };
}

/**
 * 有效期累加计算（纯函数）——沿用 payCallback.calcNewExpireAt 语义（未过期在原值上累加）。
 * ⚠️ 本函数只**算**目标值；真正的写必须走下方 makeAtomicExpireWrite 的条件累加，
 *    不能「先 get 后整条覆盖」（并发买两次只加一次）。
 */
function calcNewExpireAt(currentExpireAt, serverNowMs, days) {
  const now = Number(serverNowMs) || Date.now();
  const base = (Number(currentExpireAt) || 0) > now ? Number(currentExpireAt) : now;
  return base + Number(days) * DAY_MS;
}

/**
 * 生成「原子条件累加」写指令（纯函数，不执行 DB）。
 * 用 where({user_id, [守卫字段]: 期望值}).update({inc}) + 检查 stats.updated 实现 CAS：
 *   - 若当前 expire_at === expectedExpireAt ⇒ inc days（并发第二笔因值已变而 updated=0，需重试重算）。
 *   - 若不存在 ⇒ 走 insert 分支（由 Controller 用唯一索引冲突兜底）。
 * 这是把 DeepSeek 的 SQL「GREATEST / ON CONFLICT」翻译成微信云开发 MongoDB 可落地的写法
 * （先例：cx_diagnosisEntitlement.js:220 的 where(gte).update(inc) + stats.updated）。
 * @returns {{where:object, update:object, expectedExpireAt:number}}
 */
function makeAtomicExpireWrite(userId, expectedExpireAt, serverNowMs, days) {
  if (!userId) {
    const e = new Error('缺 userId，无法生成原子写');
    e.code = ERROR_CODES.USER_NOT_FOUND;
    throw e;
  }
  const d = Number(days);
  if (!(d > 0)) {
    const e = new Error('days 必须 > 0');
    e.code = ERROR_CODES.INVALID_PARAM;
    throw e;
  }
  return {
    where: { user_id: userId, expire_at: Number(expectedExpireAt) || 0 },
    update: { expire_at: { __inc: d * DAY_MS }, updated_at: Number(serverNowMs) || Date.now() },
    expectedExpireAt: Number(expectedExpireAt) || 0,
  };
}

/**
 * 发货主流程（纯编排，所有 DB IO 由注入的 deps 提供；可完整 mock 并发/乱序/重复）。
 *
 * deps 契约：
 *   readOrder(outTradeNo)      => order|null             按业务单号查订单（读 shop_payment_flow）
 *   resolveUser(openid)        => userId|null
 *   verifyPlan(planId)         => {ok, days, grants, diag_credits}|null  后端白名单
 *   casMarkPaid(order, ...)    => {ok:boolean}           原子把 PENDING→PAID（CAS，updated=1 才赢）
 *   markDelivered(order)       => void                   原子把 PAID→DELIVERED
 *   grantExpire(userId, days)  => {ok:boolean}           原子条件累加有效期（内部重试直到成功）
 *   grantCredit(userId, n)     => {ok:boolean}           原子加诊断额度（独立于月卡）
 *   writeFlow(flowDoc)         => void                   写发货流水（对账用，幂等键=order_no）
 *   now()                      => number
 *
 * @returns {{ok:boolean, duplicated:boolean, status:string, kind:string, detail:object}}
 */
async function handleDelivery(p, deps) {
  const outTradeNo = p && p.outTradeNo;
  if (!outTradeNo) {
    const e = new Error('缺 OutTradeNo（业务单号）');
    e.code = ERROR_CODES.INVALID_PARAM;
    throw e;
  }

  // 1) 读订单（按业务单号；幂等主键）
  const order = await deps.readOrder(outTradeNo);
  if (!order) {
    const e = new Error('订单不存在');
    e.code = ERROR_CODES.ORDER_NOT_FOUND;
    throw e;
  }

  // 2) 幂等预检：已发货 ⇒ 3 秒内直接返回成功，不重复发权益（回调最多重试 15 次）
  // 🔴 2026-11-24（R1）：比较前统一 normStatus —— DB 存小写 'delivered'，内核常量是大写 'DELIVERED'。
  const stNow = normStatus(order.status);
  if (stNow === ORDER_STATUS.DELIVERED) {
    return { ok: true, duplicated: true, status: ORDER_STATUS.DELIVERED, kind: 'noop', detail: { order_no: outTradeNo } };
  }
  // 2b) 退款终态（REFUNDING/REFUNDED）的迟到回调 ⇒ 发货前就吞掉，绝不复活权益。
  //     🔴 必须在发权益之前拦：若放到状态推进阶段，会「先发权益再吞」= 退款后仍发了权益（资损）。
  if (stNow === ORDER_STATUS.REFUNDING || stNow === ORDER_STATUS.REFUNDED) {
    return { ok: true, duplicated: true, status: stNow, kind: 'refund-noop', detail: { order_no: outTradeNo } };
  }

  // 3) 前置校验（金额/plan/白名单，全用订单快照，不信任回调 attach）
  const pre = verifyDeliveryPreconditions({
    order,
    outTradeNo,
    amountFen: p.amountFen,
    planId: p.planId,
    verifyPlan: deps.verifyPlan,
  });

  // 4) 权益主体：openid → user_id（fail-closed）
  const userId = await deps.resolveUser(p.openid);
  if (!userId) {
    const e = new Error('openid 未关联用户');
    e.code = ERROR_CODES.USER_NOT_FOUND;
    throw e;
  }

  // 5) 分流：订阅档加有效期 / 单次诊断加独立额度（绝不碰月卡）
  const grant = resolveGrantKind(pre.plan);
  const now = deps.now ? deps.now() : Date.now();

  if (grant.kind === 'credit') {
    // 诊断单次：只加 diag_credit，expire_at 一个字节都不动
    const g = await deps.grantCredit(userId, grant.credits);
    if (!g || g.ok === false) {
      const e = new Error('诊断额度发放失败');
      e.code = ERROR_CODES.SYSTEM_ERROR;
      throw e;
    }
  } else {
    const g = await deps.grantExpire(userId, grant.days, now);
    if (!g || g.ok === false) {
      const e = new Error('有效期累加失败（并发重试仍未成功）');
      e.code = ERROR_CODES.SYSTEM_ERROR;
      throw e;
    }
  }

  // 6) 状态推进：严格遵守状态机 PENDING → PAID → DELIVERED（禁止跨态）。
  //    发货回调到来时订单可能仍是 PENDING（下单后直接收到推送）或已是 PAID（先收到支付再收到发货），
  //    两种都要能推进到 DELIVERED，但绝不跳步。
  //    退款终态（REFUNDING/REFUNDED）的迟到回调 → 幂等吞掉，不复活发货（避免 15 次重试无限打）。
  if (stNow === ORDER_STATUS.REFUNDING || stNow === ORDER_STATUS.REFUNDED) {
    return { ok: true, duplicated: true, status: stNow, kind: 'refund-noop', detail: { order_no: outTradeNo } };
  }
  let from = stNow;
  if (from === ORDER_STATUS.PENDING) {
    await deps.casMarkPaid(order);          // 原子 PENDING→PAID（cas 失败=并发已推进，也视为 PAID 继续）
    from = ORDER_STATUS.PAID;
  }
  // 注意顺序：先发权益再标 DELIVERED。中途失败时状态仍非 DELIVERED，下次回调重试会重发权益 —— 故发放必须幂等。
  transitionStatus(from, ORDER_STATUS.DELIVERED);
  await deps.markDelivered(order);

  // 7) 发货流水（对账用；order_no 唯一索引保证重复写不放大）
  await deps.writeFlow({
    order_no: outTradeNo,
    transaction_id: p.transactionId || '',
    user_id: userId,
    amount_fen: Number(p.amountFen) || 0,
    plan_id: p.planId,
    grant_kind: grant.kind,
    status: ORDER_STATUS.DELIVERED,
    paid_at: now,
  });

  return {
    ok: true,
    duplicated: false,
    status: ORDER_STATUS.DELIVERED,
    kind: grant.kind,
    detail: { order_no: outTradeNo, days: grant.days, credits: grant.credits },
  };
}

// ===================== P0-C：主动查单兜底 + signData 服务端骨架 =====================

/**
 * 主动查单决策（纯函数）——补丁「回调彻底丢失」缺口（三司 Q2/Q3：无主动查单 ⇒ 用户付了钱没权益）。
 * 前端在「支付处理中」超过阈值后主动查单；本函数根据「订单状态 + 微信实付结果」决定是否补发货。
 * @param {object} p {
 *   order:     本地订单文档（order_no / amount_fen / plan_id / status）,
 *   wxPaid:    boolean 微信侧查单结果（二期真实查单注入；现可 mock）,
 *   wxAmountFen: number 微信侧实付金额（分）,
 * }
 * @returns {{action:'none'|'grant'|'refund_check', reason:string}}
 *   - none         : 无需动作（未支付或已发货）
 *   - grant        : 已支付未发货且金额一致 ⇒ 触发 handleDelivery 补发货
 *   - refund_check : 金额不符 ⇒ 走退款核查（不发货，避免错发）
 */
function decideReconcile(p) {
  const order = p && p.order;
  if (!order) {
    const e = new Error('查单：订单不存在');
    e.code = ERROR_CODES.ORDER_NOT_FOUND;
    throw e;
  }
  if (order.status === ORDER_STATUS.DELIVERED ||
      order.status === ORDER_STATUS.REFUNDING || order.status === ORDER_STATUS.REFUNDED) {
    return { action: 'none', reason: 'status_' + order.status };
  }
  if (!p.wxPaid) return { action: 'none', reason: 'wx_unpaid' };
  if (Number(p.wxAmountFen) !== Number(order.amount_fen)) {
    return { action: 'refund_check', reason: 'amount_mismatch' };
  }
  return { action: 'grant', reason: 'paid_not_delivered' };
}

/**
 * 虚拟支付道具直购 signData 参数构造（纯函数，服务端生成，前端只透传）。
 * 🔴 铁律（规则核实 §1.3）：
 *   · signData **必须服务端生成**；offerId/productId/goodsPrice 由后端道具配置下发，前端不硬编码；
 *   · goodsPrice 必须与后台道具价一致（否则 -15013）；
 *   · outTradeNo **每单一次、8–32 字符、非 `_` 开头**（违反 -15002）——本地先校验，不等微信报错；
 *   · 真实签名（RSA/HMAC）二期注入注入 signer，本函数只产出待签参数结构。
 * @param {object} p { offerId, productId, goodsPriceFen, outTradeNo, attach, signer? }
 * @returns {object} { signData:object, paySig:string }
 */
function buildVirtualPaySign(p) {
  const q = p || {};
  const no = q.outTradeNo;
  if (typeof no !== 'string' || no.length < 8 || no.length > 32 || no.charAt(0) === '_') {
    const e = new Error(`outTradeNo 不合规（须 8–32 字符、非 _ 开头）：${no}`);
    e.code = ERROR_CODES.INVALID_PARAM;
    throw e;
  }
  const price = Number(q.goodsPriceFen);
  if (!(price > 0) || !Number.isInteger(price)) {
    const e = new Error('goodsPriceFen 必须是正整数分');
    e.code = ERROR_CODES.INVALID_PARAM;
    throw e;
  }
  if (!q.offerId || !q.productId) {
    const e = new Error('offerId / productId 必须来自后端道具配置');
    e.code = ERROR_CODES.INVALID_PARAM;
    throw e;
  }
  const signData = {
    offerId: q.offerId,
    productId: q.productId,
    goodsPrice: price,
    outTradeNo: no,
    attach: q.attach || '',
  };
  // 二期注入官方 signer；未注入时返回空串（fail-closed：前端不得拿空签名去调起）
  const paySig = (typeof q.signer === 'function') ? q.signer(signData) : '';
  return { signData, paySig };
}

module.exports = {
  ERROR_CODES,
  DAY_MS,
  ORDER_STATUS,
  // 🔴 2026-11-24（R1）：落库/读取的状态转换层，Controller 写 DB 前必须用 toDbStatus
  DB_STATUS,
  toDbStatus,
  normStatus,
  ALLOWED_TRANSITIONS,
  transitionStatus,
  verifyDeliveryPreconditions,
  resolveGrantKind,
  calcNewExpireAt,
  makeAtomicExpireWrite,
  handleDelivery,
  decideReconcile,
  buildVirtualPaySign,
};
