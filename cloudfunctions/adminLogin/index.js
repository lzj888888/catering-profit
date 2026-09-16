// cloudfunctions/adminLogin/index.js —— 批次 6 · 管理员登录（独立账号体系，禁复用 openid）
//
// ⚠️ 安全契约（core/16 §2/§4）：
//   · 密码加盐哈希校验（scryptSync + timingSafeEqual，非明文非裸 MD5）
//   · 连续 5 次密码错误 → 账号锁定 30 分钟（locked_until = now + 30min），锁定中拒绝登录
//   · 登录成功生成 7 天有效 token（randomBytes 32，落 admin_login_log 会话行），不落 URL/明文日志
//   · 登录成功/失败均写 admin_login_log（时间/IP/结果）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { verifyPassword, genToken, TOKEN_TTL_MS, isLocked, lockUntilAfter, LOCK_AFTER_FAILS } = require('./adminAuth');

exports.main = async (event) => {
  const v = (event && event.input) || event || {};
  if (typeof v.username !== 'string' || !v.username) return fail(ERROR_CODES.INVALID_PARAM, 'username 必填');
  if (typeof v.password !== 'string' || !v.password) return fail(ERROR_CODES.INVALID_PARAM, 'password 必填');

  const now = nowUtc();
  // ===== 1. 查管理员 =====
  const res = await db.collection('admin_user').where({ username: v.username }).limit(1).get();
  const admin = res && res.data && res.data[0];

  // 记录登录 IP（云函数上下文可取客户端 IP；取不到则留空）
  const ip = (cloud.getWXContext && cloud.getWXContext().CLIENTIP) || '';

  const writeLoginLog = async (adminId, result, extra) => {
    await db.collection('admin_login_log').add({
      data: Object.assign({
        admin_id: adminId || '',
        ip,
        result,
        created_at: nowUtc(),
      }, extra || {}),
    });
  };

  if (!admin) {
    // 账号不存在：也记失败日志（防枚举信息泄露，响应统一 ADMIN_AUTH_FAILED）
    await writeLoginLog('', 'fail', { reason: 'no_such_user' });
    return fail(ERROR_CODES.ADMIN_AUTH_FAILED, '账号或密码错误');
  }

  // ===== 2. 锁定检查（5 错锁 30 分钟）=====
  if (isLocked(admin.locked_until, now)) {
    await writeLoginLog(admin.admin_id, 'locked', { reason: 'account_locked' });
    return fail(ERROR_CODES.ADMIN_LOCKED, '账号已锁定，请 30 分钟后再试');
  }
  if (admin.status === 'disabled') {
    await writeLoginLog(admin.admin_id, 'fail', { reason: 'disabled' });
    return fail(ERROR_CODES.ADMIN_AUTH_FAILED, '账号已停用');
  }

  // ===== 3. 密码校验（恒时比较）=====
  const pwdOk = verifyPassword(v.password, admin.salt, admin.pwd_hash);
  if (!pwdOk) {
    // 连续失败计数：上一轮失败次数 + 1；>=5 → 锁定 30 分钟
    const failCount = (admin.fail_count || 0) + 1;
    const lockedUntil = lockUntilAfter(failCount, now);
    await db.collection('admin_user').doc(admin._id).update({
      data: {
        fail_count: failCount,
        locked_until: lockedUntil || (admin.locked_until || 0),
        updated_at: now,
      },
    });
    await writeLoginLog(admin.admin_id, 'fail', { fail_count: failCount });
    if (lockedUntil) {
      return fail(ERROR_CODES.ADMIN_LOCKED, '密码错误 5 次，账号已锁定 30 分钟');
    }
    return fail(ERROR_CODES.ADMIN_AUTH_FAILED, '账号或密码错误');
  }

  // ===== 4. 登录成功：重置计数 + 签发 7 天 token（落会话行）=====
  const token = genToken();
  const expiresAt = now + TOKEN_TTL_MS;
  const adminId = admin.admin_id || admin.id;
  await db.collection('admin_user').doc(admin._id).update({
    data: { fail_count: 0, locked_until: 0, last_login_at: now, updated_at: now },
  });
  await db.collection('admin_login_log').add({
    data: {
      admin_id: adminId,
      ip,
      result: 'success',
      token,                       // 会话行（token 7 天）
      role: admin.role || 'op',
      expires_at: expiresAt,
      created_at: now,
    },
  });

  return ok({
    token,
    role: admin.role || 'op',
    expires_at: expiresAt,
  });
};