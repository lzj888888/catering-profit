// cloudfunctions/adminManualOrder/selftest.js —— 批次 6 · 私域订单录入自测（录单 → 自动发权益）
// 运行： node cloudfunctions/adminManualOrder/selftest.js
// 覆盖验收 6（手动录入私域订单 → 订单可见 + 权益同步生效）。
const { manualOrder } = require('./service');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const DAY = 24 * 3600 * 1000;

(async () => {
  const plans = [
    { plan_id: 'plan_basic_month', name: '真实利润·月', days: 31, price: 2590 },
    { plan_id: 'plan_basic_year', name: '真实利润·年', days: 365, price: 19900 },
  ];
  let entitlement = null;
  let orders = [];
  let audits = [];
  let idemKeys = [];

  const deps = {
    nowMs: NOW,
    clientRequestId: 'req_ord_001',
    readPlan: async (id) => plans.find((p) => p.plan_id === id) || null,
    readEntitlement: async () => entitlement,
    upsertEntitlement: async (doc) => { entitlement = Object.assign({}, doc); delete entitlement._id; },
    insertOrder: async (doc) => { orders.push(doc); },
    checkIdempotent: async (key) => idemKeys.indexOf(key) >= 0,
    writeAudit: async (p) => { audits.push(p); idemKeys.push(p.idempotency_key || ''); },
  };

  // 场景 A：无权益（新用户）→ 从今日起算
  const rA = await manualOrder(deps, { userId: 'u_new', planId: 'plan_basic_month', amountFen: 2590, paidAt: NOW, remark: '私域收款', operatorId: 'adm_op' });
  check('新用户录单 → expire_at = 今日 + 31 天', rA.expire_at === NOW + 31 * DAY && entitlement.expire_at === NOW + 31 * DAY);
  check('权益 source=manual', entitlement.source === 'manual');
  check('订单写入（status=paid / channel=manual / 金额分）', orders.length === 1 && orders[0].status === 'paid' && orders[0].channel === 'manual' && orders[0].amount === 2590);
  check('订单号 MO 前缀', /^MO/.test(orders[0].order_no), orders[0].order_no);
  check('订单关联 plan/user', orders[0].plan_id === 'plan_basic_month' && orders[0].user_id === 'u_new');
  check('审计 action=ADMIN_MANUAL_ORDER 且含前后值', audits[0].action === 'ADMIN_MANUAL_ORDER' && audits[0].before_data.expire_at === 0 && audits[0].after_data.expire_at === NOW + 31 * DAY);

  // 场景 B：已付费未到期用户续费 → 累加（不覆盖）
  entitlement = { _id: 'ent_x', user_id: 'u_paid', expire_at: NOW + 20 * DAY, source: 'manual' };
  const rB = await manualOrder(Object.assign({}, deps, { clientRequestId: 'req_ord_002' }), { userId: 'u_paid', planId: 'plan_basic_year', amountFen: 19900, paidAt: NOW, remark: '续费', operatorId: 'adm_op' });
  check('未到期续费 → 原值 + 365 天（累加非覆盖）', rB.expire_at === NOW + 385 * DAY, `diff=${rB.expire_at - NOW}`);

  // 幂等：重复 client_request_id
  const beforeOrders = orders.length;
  let threw = false;
  try { await manualOrder(deps, { userId: 'u_new', planId: 'plan_basic_month', amountFen: 2590, paidAt: NOW, remark: 'dup', operatorId: 'adm_op' }); } catch (e) { threw = e.code === 'ADMIN_OP_IDEMPOTENT'; }
  check('重复录单 → ADMIN_OP_IDEMPOTENT', threw);
  check('重复录单不重复写订单/权益', orders.length === beforeOrders);

  // plan 不存在
  let planErr = false;
  try { await manualOrder(Object.assign({}, deps, { clientRequestId: 'req_ord_003' }), { userId: 'u_new', planId: 'nope', amountFen: 1, paidAt: NOW, remark: 'x', operatorId: 'adm_op' }); } catch (e) { planErr = e.code === 'INVALID_PARAM'; }
  check('plan_id 不存在 → INVALID_PARAM', planErr);

  console.log(`\n==== adminManualOrder 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();