// cloudfunctions/payQueryEntitlement/selftest.js —— 批次 5 · 权益查询映射自测
// 运行： node cloudfunctions/payQueryEntitlement/selftest.js
// ⚠️ 解耦铁律：只读 expire_at 判定；无记录回落免费档；服务端 UTC 为准。
const { entitlementToOut } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0); // 固定服务端 UTC 锚点（2026-09-15）
const DAY = 24 * 3600 * 1000;

console.log('===== 无记录 / 免费档 =====');
const none = entitlementToOut(null, NOW);
check('无记录 → expire_at:0, is_active:false（不报 RESOURCE_NOT_FOUND）', none.expire_at === 0 && none.is_active === false);

console.log('===== 有效 / 过期 =====');
const active = entitlementToOut({ expire_at: NOW + 30 * DAY, source: 'payment' }, NOW);
check('有效（+30 天）→ is_active=true, days_left=30', active.is_active === true && active.days_left === 30, `days_left=${active.days_left}`);
const expired = entitlementToOut({ expire_at: NOW - 2 * DAY, source: 'payment' }, NOW);
check('过期（-2 天）→ is_active=false', expired.is_active === false);
const edge = entitlementToOut({ expire_at: NOW + 5 * DAY, source: 'manual' }, NOW);
check('到期前 5 天 → days_left=5（结果页提示条用）', edge.days_left === 5, `days_left=${edge.days_left}`);
const due = entitlementToOut({ expire_at: NOW + 7 * DAY, source: 'manual' }, NOW);
check('到期前 7 天边界 → days_left=7', due.days_left === 7);

console.log('===== 解耦铁律（不返回 plan_id）=====');
const out = entitlementToOut({ expire_at: NOW + 10 * DAY, source: 'payment' }, NOW);
check('出参不含 plan_id', out.plan_id === undefined && !('plan_id' in out));

console.log('===== 入参校验 =====');
check('合法', validateInput({ shop_id: 's1' }).error === null);
check('缺 shop_id → INVALID_PARAM', validateInput({}).error === 'INVALID_PARAM');

console.log(`\n==== payQueryEntitlement 批次 5 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);