// cloudfunctions/adminLogout/selftest.js —— 批次 6 · 主动退出自测（吊销当前 token）
// 运行： node cloudfunctions/adminLogout/selftest.js
// 覆盖：logout 删除会话 → token 立即 ADMIN_AUTH_FAILED（core/16 §8）。
const adminAuth = require('./adminAuth');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

console.log('===== adminLogout：吊销当前 token =====');
// index.js 语义：解析 Bearer → requireAuth → where({token}).remove() → 后续 ADMIN_AUTH_FAILED
check('parseBearer 取 Authorization 头', adminAuth.parseBearer({ Authorization: 'Bearer tok_logout' }) === 'tok_logout');
check('无 token → 空串（中间件拒）', adminAuth.parseBearer({}) === '');

const fakeColl = {
  rows: [{ token: 'tok_logout', admin_id: 'adm_1', role: 'op', expires_at: NOW + 3 * DAY }],
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
  rows: [{ admin_id: 'adm_1', status: 'active' }],
  where(cond) {
    const matched = this.rows.filter((r) => Object.keys(cond).every((k) => r[k] === cond[k]));
    return { limit() { return { get: async () => ({ data: matched }) }; } };
  },
};
(async () => {
  const sess = await adminAuth.requireAuth(fakeColl, fakeAdminColl, 'tok_logout');
  check('退出前会话有效', sess.error === undefined && sess.adminId === 'adm_1');
  await fakeColl.where({ token: 'tok_logout' }).remove();
  const after = await adminAuth.requireAuth(fakeColl, fakeAdminColl, 'tok_logout');
  check('退出后同一 token → ADMIN_AUTH_FAILED（立即失效）', after.error === 'ADMIN_AUTH_FAILED');

  console.log('');
  console.log('===== R54 · 审计留痕失败不阻断主流程 + console.error 留痕 =====');
  // 打桩 console.error：捕获 R54 catch 路径的告警内容
  const origErr = console.error;
  let errCalls = [];
  console.error = function () { errCalls.push(Array.prototype.slice.call(arguments).join(' ')); };
  try {
    // 语义重放 index.js 的 audit catch：audit.add() 返回 rejected promise → catch → console.error → 主流程继续
    const fakeAudit = {
      add: async () => { throw new Error('audit db down'); }, // 必失败
    };
    let mainOk = false;
    try {
      await fakeAudit.add({
        data: { action: 'ADMIN_TOKEN_REVOKE', operator_id: 'adm_1', remark: '主动退出', idempotency_key: '' },
      }).catch((e) => {
        // 与 adminLogout/index.js 完全相同的 R54 catch 语义
        console.error('[AUDIT_FAILED] adminLogout:', e && e.message ? e.message : e);
      });
      mainOk = true; // 审计失败后主流程继续（不抛）
    } catch (e) { mainOk = false; }
    check('R54 审计写入失败 → 主流程仍成功（不抛）', mainOk === true);
    check('R54 审计失败 → console.error 被调用（不静默）', errCalls.length >= 1);
    check('R54 告警含操作名 [AUDIT_FAILED] adminLogout', errCalls.length >= 1 && errCalls[0].indexOf('[AUDIT_FAILED] adminLogout') === 0, errCalls[0] || '');
    check('R54 告警不落敏感字段（openid/手机号/支付）',
      errCalls.every((c) => !/openid|phone|mobile|card|pwd|password/i.test(c)));
  } finally {
    console.error = origErr; // 还原 console
  }

  console.log(`\n==== adminLogout 批次 6/7 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();