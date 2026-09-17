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

// requireAuth 中间件（注入假会话集合 + 假 admin_user 集合）
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
// 假 admin_user 集合（钉死平台返回契约：res.data 形态）
const fakeAdminColl = {
  rows: [
    { admin_id: 'adm_1', status: 'active' },
    { admin_id: 'adm_2', status: 'active' },
  ],
  where(cond) {
    const rows = this.rows.filter((r) => r.admin_id === cond.admin_id);
    return { limit() { return { get: async () => ({ data: rows }) }; } };
  },
};
(async () => {
  const okSess = await adminAuth.requireAuth(fakeColl, fakeAdminColl, 'tok_ok');
  check('有效 token + active 账号 → 注入 adminId/role', okSess.adminId === 'adm_1' && okSess.role === 'super' && !okSess.error);
  const expired = await adminAuth.requireAuth(fakeColl, fakeAdminColl, 'tok_expired');
  check('过期 token → ADMIN_TOKEN_EXPIRED', expired.error === 'ADMIN_TOKEN_EXPIRED');
  const none = await adminAuth.requireAuth(fakeColl, fakeAdminColl, 'nope');
  check('不存在 token → ADMIN_AUTH_FAILED', none.error === 'ADMIN_AUTH_FAILED');
  const empty = await adminAuth.requireAuth(fakeColl, fakeAdminColl, '');
  check('空 token → ADMIN_AUTH_FAILED', empty.error === 'ADMIN_AUTH_FAILED');

  // ===== R48 三例（账号状态校验，fail-closed）=====
  console.log('');
  console.log('===== R48 · 账号状态校验（禁用旧 token 立即失效）=====');
  // ① 禁用管理员的旧 token → 被拒
  const disabledColl = {
    rows: [{ admin_id: 'adm_disabled', status: 'disabled' }],
    where(cond) { const rows = this.rows.filter((r) => r.admin_id === cond.admin_id); return { limit() { return { get: async () => ({ data: rows }) }; } }; },
  };
  const sessionForDisabled = {
    rows: [{ token: 'tok_disabled', admin_id: 'adm_disabled', role: 'op', expires_at: NOW + 3 * DAY }],
    where(cond) { const rows = this.rows.filter((r) => r.token === cond.token); return { limit() { return { get: async () => ({ data: rows }) }; } }; },
  };
  const disabledAuth = await adminAuth.requireAuth(sessionForDisabled, disabledColl, 'tok_disabled');
  check('① 禁用管理员旧 token → ADMIN_AUTH_FAILED（不等自然过期）', disabledAuth.error === 'ADMIN_AUTH_FAILED');

  // ② 正常管理员的 token → 放行
  const activeAuth = await adminAuth.requireAuth(fakeColl, fakeAdminColl, 'tok_ok');
  check('② 正常管理员 token → 放行', activeAuth.error === undefined && activeAuth.adminId === 'adm_1');

  // ③ 账号记录取不到（如被删）→ fail-closed 拒绝
  const emptyAdminColl = {
    rows: [],
    where() { return { limit() { return { get: async () => ({ data: [] }) }; } }; },
  };
  const noAdmin = await adminAuth.requireAuth(fakeColl, emptyAdminColl, 'tok_ok');
  check('③ 账号记录不存在 → 拒绝（fail-closed）', noAdmin.error === 'ADMIN_AUTH_FAILED');

  // ④ 账号读异常（SDK 抛错）→ 拒绝（不因容错放行）
  const throwAdminColl = {
    where() { return { limit() { return { get: async () => { throw new Error('db down'); } }; } }; },
  };
  const dbErr = await adminAuth.requireAuth(fakeColl, throwAdminColl, 'tok_ok');
  check('④ 账号读异常 → 拒绝（容错不放行）', dbErr.error === 'ADMIN_AUTH_FAILED');

  // ⑤ status 未知值 → 拒绝（fail-closed）
  const weirdColl = {
    rows: [{ admin_id: 'adm_1', status: 'pending_review' }],
    where(cond) { const rows = this.rows.filter((r) => r.admin_id === cond.admin_id); return { limit() { return { get: async () => ({ data: rows }) }; } }; },
  };
  const weirdAuth = await adminAuth.requireAuth(fakeColl, weirdColl, 'tok_ok');
  check('⑤ status 未知值 → 拒绝（fail-closed）', weirdAuth.error === 'ADMIN_AUTH_FAILED');

  check('parseBearer 标准头', adminAuth.parseBearer({ Authorization: 'Bearer abc123' }) === 'abc123');
  check('parseBearer 小写头', adminAuth.parseBearer({ authorization: 'Bearer xyz' }) === 'xyz');
  check('parseBearer 无 Bearer → 空串', adminAuth.parseBearer({ Authorization: 'Basic abc' }) === '');
  check('parseBearer 缺头 → 空串', adminAuth.parseBearer({}) === '');

  // requireRole 角色拦截
  check('super 可访问 super 专属', adminAuth.requireRole('super', ['super']) === null);
  check('op 访问 super 专属 → ADMIN_PERMISSION_DENIED', adminAuth.requireRole('op', ['super']) === 'ADMIN_PERMISSION_DENIED');
  check('op 可访问 op 允许', adminAuth.requireRole('op', ['super', 'op']) === null);

  // ===== R62：登录闸门判据单源化（登录闸门 ≡ 请求闸门，共用 isAdminActive）=====
  // 背景：adminLogin 原用 `status === 'disabled'`（只堵一个已知值），requireAuth 用
  //   `status !== ADMIN_STATUS_ACTIVE`（fail-closed）⇒ 未知状态能"登录成功"却处处被拒。
  // 两层断言：① 纯函数层 = 行为断言（可单测的真实现）；② 源码形状断言（等级：形状 ——
  //   index.js 带 wx-server-sdk 无法纯 node 加载，故只钉"登录闸门不得退回字面量写法"）。
  console.log('');
  console.log('===== R62 · 账号状态判据单源化（登录闸门 ≡ 请求闸门）=====');
  check('R62-① isAdminActive({status:active}) → true', adminAuth.isAdminActive({ status: 'active' }) === true);
  check('R62-② isAdminActive({status:disabled}) → false', adminAuth.isAdminActive({ status: 'disabled' }) === false);
  check('R62-③ isAdminActive(未知值 pending_review) → false（fail-closed）',
    adminAuth.isAdminActive({ status: 'pending_review' }) === false);
  check('R62-④ isAdminActive(status 为空串) → false（此前可"登录成功"）',
    adminAuth.isAdminActive({ status: '' }) === false);
  check('R62-⑤ isAdminActive(缺 status 字段) → false', adminAuth.isAdminActive({ admin_id: 'adm_x' }) === false);
  check('R62-⑥ isAdminActive(null / undefined 行) → false',
    adminAuth.isAdminActive(null) === false && adminAuth.isAdminActive(undefined) === false);
  check('R62-⑦ ADMIN_STATUS_ACTIVE 常量已随单源导出', adminAuth.ADMIN_STATUS_ACTIVE === 'active');
  // ⑦ 与 requireAuth 的一致性：两闸门对同一组输入必须给出同一判定（这正是 R62 的病根）
  const sameJudgement = ['active', 'disabled', 'pending_review', ''].every((st) => {
    const byFn = adminAuth.isAdminActive({ status: st });
    const byMiddlewareRule = !!({ status: st }) && ({ status: st }).status === adminAuth.ADMIN_STATUS_ACTIVE;
    return byFn === byMiddlewareRule;
  });
  check('R62-⑧ 纯函数判据与中间件判据等价（两闸门同源）', sameJudgement);

  // ② 源码形状断言：剥离整行注释后测（否则会命中本改动自己的说明注释）
  const fs = require('fs');
  const pathMod = require('path');
  const loginSrc = fs.readFileSync(pathMod.join(__dirname, 'index.js'), 'utf8');
  const codeOnly = loginSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  check('R62-⑨ 登录闸门调用单源 isAdminActive(admin)', /isAdminActive\(admin\)/.test(codeOnly));
  check("R62-⑩ 已无 status === 'disabled' 字面量判据（代码区）",
    !/\bstatus\s*===\s*'disabled'/.test(codeOnly));
  const authLine = loginSrc.split('\n').find((l) => l.indexOf("require('./adminAuth')") >= 0) || '';
  check('R62-⑪ 登录闸门从 ./adminAuth 解构 isAdminActive', authLine.indexOf('isAdminActive') >= 0);

  console.log(`\n==== adminLogin 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(failN === 0 ? 0 : 1);
})();