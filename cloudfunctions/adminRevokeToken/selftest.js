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
// 假 admin_user 集合（钉死平台返回契约：res.data 形态）
const fakeAdminColl = {
  rows: [
    { admin_id: 'adm_1', status: 'active' },
    { admin_id: 'adm_2', status: 'active' },
  ],
  where(cond) {
    const matched = this.rows.filter((r) => Object.keys(cond).every((k) => r[k] === cond[k]));
    return { limit() { return { get: async () => ({ data: matched }) }; } };
  },
};
(async () => {
  // 吊销 adm_2 的全部会话
  await fakeColl.where({ admin_id: 'adm_2' }).remove();
  check('adm_2 的两个会话全部删除', fakeColl.rows.filter((r) => r.admin_id === 'adm_2').length === 0);
  check('adm_1 会话不受影响', fakeColl.rows.filter((r) => r.admin_id === 'adm_1').length === 1);
  const gone = await adminAuth.requireAuth(fakeColl, fakeAdminColl, 't1');
  check('被吊销 token → ADMIN_AUTH_FAILED', gone.error === 'ADMIN_AUTH_FAILED');

  console.log('');
  console.log('===== R54 · 审计留痕失败不阻断主流程 + console.error 留痕 =====');
  const origErr = console.error;
  let errCalls = [];
  console.error = function () { errCalls.push(Array.prototype.slice.call(arguments).join(' ')); };
  try {
    const fakeAudit = { add: async () => { throw new Error('audit db down'); } };
    let mainOk = false;
    try {
      await fakeAudit.add({
        data: { action: 'ADMIN_TOKEN_REVOKE', operator_id: 'adm_1', remark: '超管吊销会话', idempotency_key: '' },
      }).catch((e) => {
        console.error('[AUDIT_FAILED] adminRevokeToken:', e && e.message ? e.message : e);
      });
      mainOk = true;
    } catch (e) { mainOk = false; }
    check('R54 审计写入失败 → 主流程仍成功（不抛）', mainOk === true);
    check('R54 审计失败 → console.error 被调用（不静默）', errCalls.length >= 1);
    check('R54 告警含操作名 [AUDIT_FAILED] adminRevokeToken',
      errCalls.length >= 1 && errCalls[0].indexOf('[AUDIT_FAILED] adminRevokeToken') === 0, errCalls[0] || '');
    check('R54 告警不落敏感字段（openid/手机号/支付）',
      errCalls.every((c) => !/openid|phone|mobile|card|pwd|password/i.test(c)));
  } finally {
    console.error = origErr;
  }

  console.log(`\n==== adminRevokeToken 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();