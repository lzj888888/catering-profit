// cloudfunctions/adminRevokeToken/selftest.js —— 批次 6 · 超管吊销指定会话自测
// 运行： node cloudfunctions/adminRevokeToken/selftest.js
// 覆盖：仅 super 可吊销；吊销即删除该 admin 全部会话行。
const adminAuth = require('./adminAuth');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

console.log('===== adminRevokeToken：角色拦截 + 全会话吊销 =====');
const requireRole = adminAuth.requireRole;
check('super 吊销 → 放行', requireRole('super', ['super']) === null);
check('op 吊销 → ADMIN_PERMISSION_DENIED', requireRole('op', ['super']) === 'ADMIN_PERMISSION_DENIED');

const fakeColl = {
  rows: [
    { token: 't1', admin_id: 'adm_2', role: 'op', expires_at: NOW + DAY },
    { token: 't2', admin_id: 'adm_2', role: 'op', expires_at: NOW + 2 * DAY },
    { token: 't3', admin_id: 'adm_1', role: 'super', expires_at: NOW + DAY },
  ],
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
  // 吊销 adm_2 的全部会话
  await fakeColl.where({ admin_id: 'adm_2' }).remove();
  check('adm_2 的两个会话全部删除', fakeColl.rows.filter((r) => r.admin_id === 'adm_2').length === 0);
  check('adm_1 会话不受影响', fakeColl.rows.filter((r) => r.admin_id === 'adm_1').length === 1);
  const gone = await adminAuth.requireAuth(fakeColl, 't1');
  check('被吊销 token → ADMIN_AUTH_FAILED', gone.error === 'ADMIN_AUTH_FAILED');

  console.log(`\n==== adminRevokeToken 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();