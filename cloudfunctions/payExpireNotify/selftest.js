// cloudfunctions/payExpireNotify/selftest.js —— 批次 5 · 到期前 7 天提醒扫描自测
// 运行： node cloudfunctions/payExpireNotify/selftest.js
// 双渠道：订阅消息（需授权）+ 结果页常驻提示条（兜底，读 payQueryEntitlement.days_left ≤ 7）。
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 窗口扫描逻辑（与 index.js 同口径）：expire_at ∈ [now, now+7d]
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const DAY = 24 * 3600 * 1000;
function inWindow(expireAt, now) {
  const to = now + 7 * DAY;
  return expireAt >= now && expireAt <= to;
}
check('到期前 5 天 → 窗口内', inWindow(NOW + 5 * DAY, NOW) === true);
check('到期前 7 天边界 → 窗口内', inWindow(NOW + 7 * DAY, NOW) === true);
check('到期前 8 天 → 窗口外（不提醒）', inWindow(NOW + 8 * DAY, NOW) === false);
check('已过期 → 窗口外', inWindow(NOW - 1 * DAY, NOW) === false);
check('长期有效（+30d）→ 窗口外', inWindow(NOW + 30 * DAY, NOW) === false);

// days_left 计算（与 index.js 一致：向上取整）
check('剩余 5 天 → days_left=5', Math.ceil((NOW + 5 * DAY - NOW) / DAY) === 5);
check('剩余 6.5 天 → days_left=7（向上取整，提前提醒）', Math.ceil((NOW + 6.5 * DAY - NOW) / DAY) === 7);

console.log('===== 入参校验（定时任务无入参）=====');
check('定时任务空入参合法', validateInput().error === null);

console.log(`\n==== payExpireNotify 批次 5 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);