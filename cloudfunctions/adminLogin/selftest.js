// cloudfunctions/adminLogin/selftest.js —— 批次 6 · 管理端鉴权自测（密码哈希 / 5 错锁定 / token 7 天）
// 运行： node cloudfunctions/adminLogin/selftest.js
// 覆盖验收 1（5 错锁 30 分）、验收 2（token 7 天失效）。
const adminAuth = require('./adminAuth');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

console.log('===== 密码加盐哈希（非明文 / 非裸 MD5）=====');
const salt = adminAuth.genSalt();
const h1 = adminAuth.hashPassword('P@ssw0rd!', salt);
check('scrypt 哈希长度 64 字节 hex(128)', h1.length === 128, `len=${h1.length}`);
check('同一盐同一密码哈希稳定', h1 === adminAuth.hashPassword('P@ssw0rd!', salt));
check('同一密码不同盐 → 哈希不同', h1 !== adminAuth.hashPassword('P@ssw0rd!', adminAuth.genSalt()));
check('verifyPassword 正确密码通过', adminAuth.verifyPassword('P@ssw0rd!', salt, h1) === true);
check('verifyPassword 错误密码拒绝', adminAuth.verifyPassword('wrong', salt, h1) === false);
check('verifyPassword 缺 salt/hash 拒绝', adminAuth.verifyPassword('x', '', '') === false);
check('盐为随机 hex（32 字符）', /^[0-9a-f]{32}$/.test(salt));

console.log('===== 验收 1 · 5 次密码错误锁定 30 分钟 =====');
// lockUntilAfter：连续失败次数 >=5 → now+30min；否则 null
check('第 4 次失败 → 未锁定', adminAuth.lockUntilAfter(4, NOW) === null);
const lockedAt = adminAuth.lockUntilAfter(5, NOW);
check('第 5 次失败 → 锁定截止 now+30min', lockedAt === NOW + 30 * 60 * 1000, `diff=${lockedAt - NOW}`);
check('isLocked(locked_until=now+30min) → true', adminAuth.isLocked(lockedAt, NOW) === true);
check('锁定中（当前时间 < 截止）→ true', adminAuth.isLocked(NOW + 30 * 60 * 1000, NOW) === true);
check('已解锁（当前时间超过截止）→ false', adminAuth.isLocked(lockedAt, NOW + 31 * 60 * 1000) === false);
check('isLocked(0/null) → false', adminAuth.isLocked(0, NOW) === false && adminAuth.isLocked(null, NOW) === false);
check('LOCK_AFTER_FAILS=5 / LOCK_DURATION_MS=30min', adminAuth.LOCK_AFTER_FAILS === 5 && adminAuth.LOCK_DURATION_MS === 30 * 60 * 1000);

console.log('===== 验收 2 · token 7 天失效 =====');
const token = adminAuth.genToken();
check('token 为 64 位 hex', /^[0-9a-f]{64}$/.test(token), token.length);
check('TOKEN_TTL_MS = 7 天', adminAuth.TOKEN_TTL_MS === 7 * DAY);
check('tokenTtlMs() = 7 天', adminAuth.tokenTtlMs() === 7 * DAY);

// requireAuth 中间件（注入假会话集合）
console.log('===== adminAuth 中间件（requireAuth / parseBearer）=====');
const fakeColl = {
  rows: [
    { token: 'tok_ok', admin_id: 'adm_1', role: 'super', expires_at: NOW + 5 * DAY },
    { token: 'tok_expired', admin_id: 'adm_2', role: 'op', expires_at: NOW - DAY },
  ],
  where(cond) {
    const rows = this.rows.filter((r) => r.token === cond.token);
    return { limit() { return { get: async () => ({ data: rows }) }; } };
  },
};
(async () => {
  const okSess = await adminAuth.requireAuth(fakeColl, 'tok_ok');
  check('有效 token → 注入 adminId/role', okSess.adminId === 'adm_1' && okSess.role === 'super' && !okSess.error);
  const expired = await adminAuth.requireAuth(fakeColl, 'tok_expired');
  check('过期 token → ADMIN_TOKEN_EXPIRED', expired.error === 'ADMIN_TOKEN_EXPIRED');
  const none = await adminAuth.requireAuth(fakeColl, 'nope');
  check('不存在 token → ADMIN_AUTH_FAILED', none.error === 'ADMIN_AUTH_FAILED');
  const empty = await adminAuth.requireAuth(fakeColl, '');
  check('空 token → ADMIN_AUTH_FAILED', empty.error === 'ADMIN_AUTH_FAILED');

  check('parseBearer 标准头', adminAuth.parseBearer({ Authorization: 'Bearer abc123' }) === 'abc123');
  check('parseBearer 小写头', adminAuth.parseBearer({ authorization: 'Bearer xyz' }) === 'xyz');
  check('parseBearer 无 Bearer → 空串', adminAuth.parseBearer({ Authorization: 'Basic abc' }) === '');
  check('parseBearer 缺头 → 空串', adminAuth.parseBearer({}) === '');

  // requireRole 角色拦截
  check('super 可访问 super 专属', adminAuth.requireRole('super', ['super']) === null);
  check('op 访问 super 专属 → ADMIN_PERMISSION_DENIED', adminAuth.requireRole('op', ['super']) === 'ADMIN_PERMISSION_DENIED');
  check('op 可访问 op 允许', adminAuth.requireRole('op', ['super', 'op']) === null);

  console.log(`\n==== adminLogin 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();