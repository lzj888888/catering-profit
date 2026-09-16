// cloudfunctions/adminGrantEntitlement/selftest.js —— 批次 6 · 手动调权自测（expire_at 规则 + 留痕）
// 运行： node cloudfunctions/adminGrantEntitlement/selftest.js
// 覆盖验收 3（未到期累加）、验收 4（过期从当日）、验收 5（audit_log 前后值 + 操作人）。
const { calcGrantExpireAt } = require('./adminAuth');
const { grantEntitlement } = require('./service');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0); // 固定服务端 UTC 锚点
const DAY = 24 * 3600 * 1000;

console.log('===== 验收 3 · 未到期 → 原 expire_at 累加（不覆盖）=====');
const unexpired = NOW + 20 * DAY; // 还有 20 天
check('未到期 +30 天 → 原值+30（非今日+30）', calcGrantExpireAt(unexpired, NOW, 30) === unexpired + 30 * DAY,
  `=${calcGrantExpireAt(unexpired, NOW, 30) - NOW}ms`);

console.log('===== 验收 4 · 已过期/无记录 → 从操作当日 + days（不顺延）=====');
const expired = NOW - 5 * DAY; // 5 天前过期
check('已过期 +30 天 → 今日+30（不顺延原到期）', calcGrantExpireAt(expired, NOW, 30) === NOW + 30 * DAY,
  `=${calcGrantExpireAt(expired, NOW, 30) - NOW}ms`);
check('无记录(0) +30 天 → 今日+30', calcGrantExpireAt(0, NOW, 30) === NOW + 30 * DAY);

console.log('===== 验收 5 · 调权留痕（前后值/原因/操作人）=====');
(async () => {
  // 假 DB 状态
  let entitlement = { _id: 'ent_1', user_id: 'u1', expire_at: NOW + 20 * DAY, source: 'payment' };
  let auditRows = [];
  let idemKeys = [];

  const deps = {
    nowMs: NOW,
    clientRequestId: 'req_001',
    readEntitlement: async (userId) => entitlement,
    upsertEntitlement: async (doc) => { entitlement = Object.assign(entitlement, { expire_at: doc.expire_at, source: doc.source, updated_at: doc.updated_at }); },
    checkIdempotent: async (key) => idemKeys.indexOf(key) >= 0,
    writeAudit: async (p) => { auditRows.push(p); idemKeys.push(p.idempotency_key || ''); },
  };

  const r = await grantEntitlement(deps, { userId: 'u1', days: 30, reason: '活动补偿', operatorId: 'adm_super' });
  check('调权后 expire_at = 原值 + 30 天', r.expire_at === NOW + 50 * DAY && entitlement.expire_at === NOW + 50 * DAY);
  check('返回 before/after', r.before_expire_at === NOW + 20 * DAY && r.expire_at === NOW + 50 * DAY);
  check('source=manual', r.source === 'manual' && entitlement.source === 'manual');

  // 留痕断言
  const audit = auditRows[0];
  check('action=ADMIN_GRANT_ENTITLEMENT', audit.action === 'ADMIN_GRANT_ENTITLEMENT');
  check('前值记录（before_data.expire_at=原值）', audit.before_data.expire_at === NOW + 20 * DAY);
  check('后值记录（after_data.expire_at=新值 + days + source）', audit.after_data.expire_at === NOW + 50 * DAY && audit.after_data.days === 30 && audit.after_data.source === 'manual');
  check('原因/操作人入审计', audit.remark === '活动补偿' && audit.operator_id === 'adm_super');
  check('幂等键写入审计', audit.idempotency_key === 'adm_grant_req_001');

  // 幂等：重复 client_request_id → 抛 ADMIN_OP_IDEMPOTENT，不重复处理/留痕
  const auditCountBefore = auditRows.length;
  let threw = false;
  try { await grantEntitlement(deps, { userId: 'u1', days: 30, reason: 'dup', operatorId: 'adm_super' }); } catch (e) { threw = e.code === 'ADMIN_OP_IDEMPOTENT'; }
  check('重复提交 → ADMIN_OP_IDEMPOTENT', threw);
  check('重复提交不重复留痕/处理', auditRows.length === auditCountBefore && entitlement.expire_at === NOW + 50 * DAY);

  // 无 client_request_id → 不幂等拦截
  const deps2 = Object.assign({}, deps, { clientRequestId: '' });
  const r2 = await grantEntitlement(deps2, { userId: 'u1', days: 10, reason: '无幂等键', operatorId: 'adm_super' });
  check('无 client_request_id → 正常处理（累加 +10）', r2.expire_at === NOW + 60 * DAY);

  console.log(`\n==== adminGrantEntitlement 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();