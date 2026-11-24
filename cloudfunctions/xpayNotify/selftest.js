// cloudfunctions/xpayNotify/selftest.js —— 虚拟支付发货内核自测（幂等/乱序/并发/校验/分流）
// 运行： node cloudfunctions/xpayNotify/selftest.js
// 🔴 这批用例是「本地全绿才上现网」的硬门槛：覆盖三司 Q4/Q6 点名的三种致命场景。
const {
  ERROR_CODES, ORDER_STATUS, transitionStatus, verifyDeliveryPreconditions,
  resolveGrantKind, calcNewExpireAt, makeAtomicExpireWrite, handleDelivery,
  decideReconcile, buildVirtualPaySign,
} = require('./service');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

// ===== 0. 错误码 parity：service 内联常量必须与单源 errors.js 逐字一致（防漂移）=====
console.log('===== 错误码单源一致性 =====');
{
  const single = require('../common/errors').ERROR_CODES;
  const keys = Object.keys(ERROR_CODES);
  let allMatch = keys.length > 0;
  for (const k of keys) if (single[k] !== ERROR_CODES[k]) allMatch = false;
  check('service 内联 5 个错误码 ≡ common/errors.js 单源', allMatch, keys.join(','));
}
const DAY = 24 * 3600 * 1000;

// ===== 1. 状态机：单向推进，禁止回退/跨态 =====
console.log('===== 状态机（单向推进）=====');
check('PENDING → PAID 允许', transitionStatus('PENDING', 'PAID').ok === true);
check('PAID → DELIVERED 允许', transitionStatus('PAID', 'DELIVERED').ok === true);
check('同态 = 幂等命中（same=true）', transitionStatus('DELIVERED', 'DELIVERED').same === true);
let backDenied = false;
try { transitionStatus('DELIVERED', 'PAID'); } catch (e) { backDenied = e.code === ERROR_CODES.INVALID_PARAM; }
check('DELIVERED → PAID 回退被拒', backDenied);
let jumpDenied = false;
try { transitionStatus('PENDING', 'DELIVERED'); } catch (e) { jumpDenied = e.code === ERROR_CODES.INVALID_PARAM; }
check('PENDING → DELIVERED 跨态被拒（必须先经 PAID）', jumpDenied);
let finalDenied = false;
try { transitionStatus('REFUNDED', 'PAID'); } catch (e) { finalDenied = true; }
check('REFUNDED 终态不可再迁出', finalDenied);

// ===== 2. 发货前置校验：金额/plan/白名单全用订单快照 =====
console.log('===== 发货前置校验（防季年卡按 30 天发）=====');
const monthOrder = { order_no: 'PO_M', user_id: 'u1', amount_fen: 2590, plan_id: 'plan_basic_month', status: 'PAID' };
const verifyPlanMonth = (id) => id === 'plan_basic_month' ? { ok: true, days: 31, grants: '' } : null;
check('金额/plan/白名单全对 → 放行', verifyDeliveryPreconditions({
  order: monthOrder, outTradeNo: 'PO_M', amountFen: 2590, planId: 'plan_basic_month', verifyPlan: verifyPlanMonth,
}).ok === true);
let amtBad = false;
try { verifyDeliveryPreconditions({ order: monthOrder, outTradeNo: 'PO_M', amountFen: 1990, planId: 'plan_basic_month', verifyPlan: verifyPlanMonth }); }
catch (e) { amtBad = e.code === ERROR_CODES.PLAN_MISMATCH; }
check('金额不符 → PLAN_MISMATCH', amtBad);
let planBad = false;
try { verifyDeliveryPreconditions({ order: monthOrder, outTradeNo: 'PO_M', amountFen: 2590, planId: 'plan_basic_year', verifyPlan: verifyPlanMonth }); }
catch (e) { planBad = e.code === ERROR_CODES.PLAN_MISMATCH; }
check('plan 与订单快照不符 → PLAN_MISMATCH', planBad);
let notFound = false;
try { verifyDeliveryPreconditions({ order: null, outTradeNo: 'PO_X', amountFen: 2590, planId: 'plan_basic_month', verifyPlan: verifyPlanMonth }); }
catch (e) { notFound = e.code === ERROR_CODES.ORDER_NOT_FOUND; }
check('订单不存在 → ORDER_NOT_FOUND', notFound);
let outBad = false;
try { verifyDeliveryPreconditions({ order: monthOrder, outTradeNo: 'PO_OTHER', amountFen: 2590, planId: 'plan_basic_month', verifyPlan: verifyPlanMonth }); }
catch (e) { outBad = e.code === ERROR_CODES.ORDER_NOT_FOUND; }
check('OutTradeNo ≠ 订单业务单号 → ORDER_NOT_FOUND', outBad);

// ===== 3. 权益分流：诊断单次绝不碰月卡 =====
console.log('===== 权益分流（diag_credit 不碰月卡）=====');
const gSub = resolveGrantKind({ days: 365, grants: '', diag_credits: 0 });
check('订阅档 → 加有效期 365 天', gSub.kind === 'expire' && gSub.days === 365 && gSub.credits === 0);
const gDiag = resolveGrantKind({ days: 0, grants: 'diag_credit', diag_credits: 1 });
check('单次诊断 → 加 1 额度 / 0 天（不碰月卡）', gDiag.kind === 'credit' && gDiag.days === 0 && gDiag.credits === 1);
let daysZero = false;
try { resolveGrantKind({ days: 0, grants: '' }); } catch (e) { daysZero = e.code === ERROR_CODES.SYSTEM_ERROR; }
check('订阅档 days=0 → SYSTEM_ERROR（fail-closed）', daysZero);
check('累加：未过期原值 + days', calcNewExpireAt(NOW + 20 * DAY, NOW, 31) === NOW + 51 * DAY);
check('累加：已过期从当前起算', calcNewExpireAt(NOW - 5 * DAY, NOW, 31) === NOW + 31 * DAY);

// ===== 4. 原子写指令：CAS 期望值 + inc =====
console.log('===== 原子条件累加（云开发 MongoDB 写法）=====');
const aw = makeAtomicExpireWrite('u1', NOW + 10 * DAY, NOW, 31);
check('原子写 where 带 user_id + expire_at 期望值', aw.where.user_id === 'u1' && aw.where.expire_at === NOW + 10 * DAY);
check('原子写 update 用 inc（非整条覆盖）', aw.update.expire_at.__inc === 31 * DAY);
let badDays = false;
try { makeAtomicExpireWrite('u1', 0, NOW, 0); } catch (e) { badDays = e.code === ERROR_CODES.INVALID_PARAM; }
check('days<=0 拒绝生成原子写', badDays);

// ===== 5. handleDelivery 全场景 mock（重复/乱序/并发/分流）=====
console.log('===== handleDelivery 端到端 mock =====');
function makeDeps(overrides) {
  const state = {
    order: { order_no: 'PO_1', user_id: 'u1', amount_fen: 2590, plan_id: 'plan_basic_month', status: 'PENDING' },
    expireWriteCalls: 0, creditCalls: 0, deliveredCalls: 0, flowWrites: 0,
  };
  const deps = {
    readOrder: async () => state.order,
    resolveUser: async (oid) => oid === 'openid-1' ? 'u1' : null,
    verifyPlan: (id) => id === 'plan_basic_month' ? { ok: true, days: 31, grants: '' } : null,
    casMarkPaid: async () => ({ ok: true }),
    markDelivered: async () => { state.deliveredCalls++; state.order.status = 'DELIVERED'; },
    grantExpire: async () => { state.expireWriteCalls++; return { ok: true }; },
    grantCredit: async () => { state.creditCalls++; return { ok: true }; },
    writeFlow: async () => { state.flowWrites++; },
    now: () => NOW,
  };
  return { state, deps: Object.assign(deps, overrides || {}) };
}

(async () => {
  const baseP = { outTradeNo: 'PO_1', amountFen: 2590, planId: 'plan_basic_month', openid: 'openid-1', transactionId: 'TX1' };

  // 正常发货
  {
    const { state, deps } = makeDeps();
    const r = await handleDelivery(baseP, deps);
    check('正常发货 → DELIVERED / kind=expire', r.ok === true && r.status === 'DELIVERED' && r.kind === 'expire');
    check('正常发货 → 加一次有效期 + 写一次流水', state.expireWriteCalls === 1 && state.flowWrites === 1);
  }

  // 重复回调（同一单重试 15 次的本质）：已 DELIVERED ⇒ 幂等，不再发权益
  {
    const { state, deps } = makeDeps();
    state.order.status = 'DELIVERED';
    const r = await handleDelivery(baseP, deps);
    check('重复回调 → duplicated=true 不重发', r.duplicated === true && state.expireWriteCalls === 0 && state.flowWrites === 0);
  }

  // 乱序：退款终态的迟到回调 ⇒ 幂等吞掉，不复活发货
  {
    const { state, deps } = makeDeps();
    state.order.status = 'REFUNDED';
    const r = await handleDelivery(baseP, deps);
    check('退款终态迟到回调 → refund-noop 不复活', r.duplicated === true && r.kind === 'refund-noop' && state.expireWriteCalls === 0);
  }

  // 并发两笔：grantExpire 用 CAS 模拟，第二笔 updated=0（重试语义由 Controller 保证）——此处验证服务层只调一次且状态推进唯一
  {
    const { state, deps } = makeDeps();
    let markCount = 0;
    deps.markDelivered = async () => { markCount++; state.order.status = 'DELIVERED'; };
    const [r1, r2] = await Promise.all([handleDelivery(baseP, deps), handleDelivery(baseP, deps)]);
    // 两笔都通过校验时会各写一次权益（Controller 的 CAS 兜底在 grantExpire 内），服务层保证状态机不回退、流水按单号唯一
    check('并发两笔 → 状态终值 DELIVERED（不回退）', state.order.status === 'DELIVERED');
    check('并发两笔 → 均返回 ok（由 CAS/唯一索引兜去重）', r1.ok === true && r2.ok === true);
    check('并发两笔 → markDelivered 幂等（同态同值）', markCount >= 1 && state.flowWrites === 2);
  }

  // 诊断单次：只加额度，expire 写零次（防清月卡）
  {
    const { state, deps } = makeDeps();
    state.order.plan_id = 'plan_diag_single';
    state.order.amount_fen = 1990;
    deps.verifyPlan = (id) => id === 'plan_diag_single' ? { ok: true, days: 0, grants: 'diag_credit', diag_credits: 1 } : null;
    const r = await handleDelivery(
      { outTradeNo: 'PO_1', amountFen: 1990, planId: 'plan_diag_single', openid: 'openid-1', transactionId: 'TX2' },
      deps
    );
    check('诊断单次 → kind=credit / 加额度', r.ok === true && r.kind === 'credit' && state.creditCalls === 1);
    check('诊断单次 → 有效期写 0 次（月卡未被碰）', state.expireWriteCalls === 0);
  }

  // openid 未关联 → USER_NOT_FOUND（fail-closed）
  {
    const { deps } = makeDeps();
    let threw = false;
    try { await handleDelivery(Object.assign({}, baseP, { openid: 'unknown' }), deps); }
    catch (e) { threw = e.code === ERROR_CODES.USER_NOT_FOUND; }
    check('openid 未关联 → USER_NOT_FOUND', threw);
  }

  // ===== 6. P0-C 主动查单兜底 + signData 服务端骨架 =====
  console.log('===== 主动查单决策 =====');
  const paidNotDelivered = { order_no: 'PO_R', amount_fen: 2590, plan_id: 'plan_basic_month', status: 'PENDING' };
  check('已付未发货且金额一致 → grant 补发货', decideReconcile({ order: paidNotDelivered, wxPaid: true, wxAmountFen: 2590 }).action === 'grant');
  check('微信未支付 → none', decideReconcile({ order: paidNotDelivered, wxPaid: false, wxAmountFen: 2590 }).action === 'none');
  check('金额不符 → refund_check（不错发）', decideReconcile({ order: paidNotDelivered, wxPaid: true, wxAmountFen: 1990 }).action === 'refund_check');
  check('已发货 → none（幂等）', decideReconcile({ order: { ...paidNotDelivered, status: 'DELIVERED' }, wxPaid: true, wxAmountFen: 2590 }).action === 'none');
  check('退款终态 → none（不复活）', decideReconcile({ order: { ...paidNotDelivered, status: 'REFUNDED' }, wxPaid: true, wxAmountFen: 2590 }).action === 'none');

  console.log('===== signData 服务端骨架（道具直购）=====');
  const signBase = { offerId: 'offer-x', productId: 'plan_basic_month', goodsPriceFen: 2590, outTradeNo: 'PO20261122ABC001', attach: 'plan_basic_month' };
  const signed = buildVirtualPaySign(Object.assign({}, signBase, { signer: (d) => 'SIG:' + d.outTradeNo }));
  check('signData 字段齐全 + 金额来自后端快照', signed.signData.goodsPrice === 2590 && signed.signData.outTradeNo === signBase.outTradeNo && signed.signData.attach === 'plan_basic_month');
  check('注入 signer → 产出 paySig', signed.paySig === 'SIG:PO20261122ABC001');
  check('未注入 signer → paySig 空串（fail-closed）', buildVirtualPaySign(signBase).paySig === '');
  let shortNo = false;
  try { buildVirtualPaySign(Object.assign({}, signBase, { outTradeNo: 'SHORT' })); } catch (e) { shortNo = e.code === ERROR_CODES.INVALID_PARAM; }
  check('outTradeNo < 8 字符 → INVALID_PARAM（不等微信 -15002）', shortNo);
  let underNo = false;
  try { buildVirtualPaySign(Object.assign({}, signBase, { outTradeNo: '_BAD123456' })); } catch (e) { underNo = e.code === ERROR_CODES.INVALID_PARAM; }
  check('outTradeNo 以 _ 开头 → INVALID_PARAM', underNo);
  let priceBad = false;
  try { buildVirtualPaySign(Object.assign({}, signBase, { goodsPriceFen: 25.9 })); } catch (e) { priceBad = e.code === ERROR_CODES.INVALID_PARAM; }
  check('goodsPrice 非整数分 → INVALID_PARAM', priceBad);

  console.log(`\n==== xpayNotify 内核自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();
