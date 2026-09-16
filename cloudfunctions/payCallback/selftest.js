// cloudfunctions/payCallback/selftest.js —— 批次 5 · 支付回调安全自测（验签/幂等/累加）
// 运行： node cloudfunctions/payCallback/selftest.js
// ⚠️ 安全铁律：验签失败丢弃、transaction_id 全局幂等不重复发放、续费有效期累加。
const { verifyCallbackSign, calcNewExpireAt, handleCallback } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const DAY = 24 * 3600 * 1000;

console.log('===== 验签（fail-closed + 可注入）=====');
check('未注入验签器 → 拒绝（fail-closed）', verifyCallbackSign({}) === false);
check('注入假验签器通过 → 放行', verifyCallbackSign({}, () => true) === true);
check('注入假验签器拒绝 → 丢弃', verifyCallbackSign({}, () => false) === false);
check('验签器抛异常 → 视为失败（不吞异常放行）', verifyCallbackSign({}, () => { throw new Error('boom'); }) === false);

console.log('===== 有效期累加（续费）=====');
check('未过期续费：原 expire_at + 30 天（累加）', calcNewExpireAt(NOW + 20 * DAY, NOW, 30) === NOW + 50 * DAY);
check('已过期续费：从当前时刻起算 +30 天', calcNewExpireAt(NOW - 5 * DAY, NOW, 30) === NOW + 30 * DAY);
check('无记录续费：从当前时刻 + 30 天', calcNewExpireAt(0, NOW, 30) === NOW + 30 * DAY);

console.log('===== 回调幂等（transaction_id 全局）=====');
(async () => {
  // 假 DB 状态
  const flows = [];                       // shop_payment_flow
  let entitlement = null;                 // shop_entitlement（user 维度）
  let insertCount = 0;

  const deps = {
    readFlow: async (txn) => flows.find((f) => f.transaction_id === txn) || null,
    insertFlow: async (f) => { flows.push(f); insertCount++; },
    resolveUser: async () => 'u_123',
    readEntitlement: async (userId) => entitlement,
    updateExpire: async (userId, expireAt, source) => { entitlement = { user_id: userId, expire_at: expireAt, source }; },
    daysOfPlan: async (planId) => ({ plan_basic_month: 30, plan_basic_quarter: 90 })[planId] || 30,
    serverNowMs: NOW,
  };

  // 第一次回调
  const r1 = await handleCallback(Object.assign({}, deps, {
    transactionId: 'txn_001', orderNo: 'PO1', openid: 'openid_a',
    amountFen: 2590, planId: 'plan_basic_month', paidAtMs: NOW,
  }));
  check('首次回调：处理成功、非重复', r1.duplicated === false && r1.ok === true);
  check('首次回调后 expire_at = now+30d', entitlement && entitlement.expire_at === NOW + 30 * DAY);
  check('流水写入 1 条', insertCount === 1 && flows.length === 1);

  // 同一 transaction_id 重复回调 → 幂等：不重复发放
  const r2 = await handleCallback(Object.assign({}, deps, {
    transactionId: 'txn_001', orderNo: 'PO1', openid: 'openid_a',
    amountFen: 2590, planId: 'plan_basic_month', paidAtMs: NOW,
  }));
  check('重复回调：duplicated=true（幂等命中）', r2.duplicated === true);
  check('重复回调：不再插入流水、不重复更新权益', insertCount === 1 && entitlement.expire_at === NOW + 30 * DAY, `flows=${flows.length}`);

  // 不同 transaction_id（续费）→ 累加
  const r3 = await handleCallback(Object.assign({}, deps, {
    transactionId: 'txn_002', orderNo: 'PO2', openid: 'openid_a',
    amountFen: 6900, planId: 'plan_basic_quarter', paidAtMs: NOW + DAY,
  }));
  check('新交易（续费）：累加 30+90 天', r3.duplicated === false && entitlement.expire_at === NOW + 120 * DAY, `expire=${entitlement.expire_at - NOW}`);

  // 缺 transaction_id → 抛 INVALID_PARAM
  let threw = false;
  try { await handleCallback(Object.assign({}, deps, { transactionId: '' })); } catch (e) { threw = e.code === 'INVALID_PARAM'; }
  check('缺 transaction_id → 抛 INVALID_PARAM', threw);

  console.log('===== 入参校验 =====');
  check('合法（回调报文）', validateInput({ body: { transaction_id: 'x' } }).error === null);
  check('空 event → INVALID_PARAM', validateInput(null).error === 'INVALID_PARAM');

  console.log(`\n==== payCallback 批次 5 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();