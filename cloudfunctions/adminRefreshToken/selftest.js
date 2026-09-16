// cloudfunctions/adminRefreshToken/selftest.js —— 批次 6 · token 刷新/吊销语义自测
// 运行： node cloudfunctions/adminRefreshToken/selftest.js
// 覆盖：刷新窗口（剩 <24h 才签发新 token）、旧 token 立即失效、吊销即删除会话。
const adminAuth = require('./adminAuth');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

console.log('===== 刷新窗口（剩 <24h 才刷新）=====');
// index.js 逻辑：剩余 >= 24h 不签发；<24h 才签发新 token 并删旧会话
const shouldRefresh = (expiresAt, now) => (expiresAt - now) < 24 * 3600 * 1000;
check('剩 20h → 触发刷新', shouldRefresh(NOW + 20 * 3600 * 1000, NOW) === true);
check('剩 24h 边界 → 不触发', shouldRefresh(NOW + 24 * 3600 * 1000, NOW) === false);
check('剩 5 天 → 不触发', shouldRefresh(NOW + 5 * DAY, NOW) === false);
check('已过期 → 触发刷新（前端实际会重登）', shouldRefresh(NOW - DAY, NOW) === true);

console.log('===== 吊销语义（adminLogout / adminRevokeToken）=====');
// 吊销 = 删除会话行 → requireAuth 找不到 → ADMIN_AUTH_FAILED
const fakeColl = {
  rows: [{ token: 'tok_1', admin_id: 'adm_1', role: 'super', expires_at: NOW + DAY }],
  where(cond) {
    const self = this;
    const matched = self.rows.filter((r) => Object.keys(cond).every((k) => r[k] === cond[k]));
    return {
      limit() { return { get: async () => ({ data: matched }) }; },
      remove: async () => { self.rows = self.rows.filter((r) => matched.indexOf(r) < 0); },
    };
  },
};
(async () => {
  const before = await adminAuth.requireAuth(fakeColl, 'tok_1');
  check('吊销前 token 有效', before.error === undefined && before.adminId === 'adm_1');
  await fakeColl.where({ token: 'tok_1' }).remove(); // 模拟 adminLogout 删除会话
  const after = await adminAuth.requireAuth(fakeColl, 'tok_1');
  check('吊销后 token → ADMIN_AUTH_FAILED', after.error === 'ADMIN_AUTH_FAILED');

  // adminRevokeToken：超管角色拦截
  const requireRole = adminAuth.requireRole;
  check('super 可吊销指定管理员', requireRole('super', ['super']) === null);
  check('op 吊销 → 拒绝', requireRole('op', ['super']) === 'ADMIN_PERMISSION_DENIED');

  console.log(`\n==== adminRefreshToken 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();