// cloudfunctions/_adminCore/adminAuth.js —— 批次 6 · 管理端鉴权核心（单源，零 wx 依赖纯函数 + 注入式中间件）
//
// ⚠️ 本文件是「admin 共享单源」，由部署流程复制为每个 admin* 云函数目录内的 adminAuth.js
//   （云函数包自包含，无法跨函数 require）。不 require 任何 common 模块（零依赖，纯 node crypto），
//   selftest 可独立运行。
//
// 安全契约（对齐 core/16 后台鉴权规范 + 批次 6 §2.5）：
//   1. 密码加盐哈希：scryptSync（Node 内置，加盐抗 GPU，非明文、非裸 MD5）；随机盐单独存 salt 列。
//   2. token：randomBytes(32).toString('hex')，7 天有效，不落 URL/明文日志。
//   3. 5 次密码错误 → 账号锁定 30 分钟（locked_until = now + 30min）。
//   4. 角色：super（超管）/ op（运营）；运营不可访问管理员管理 / 全量导出。
//   5. 禁复用微信 openid 鉴权（独立账号体系）。
//   6. expire_at 计算规则（批次 6 §2.3）：未到期 → 原 expire_at 累加（不覆盖）；已过期 → 从操作当日算（不顺延）。
//
// ⚠️ 中间件 requireAuth 通过「注入 session 集合句柄」使用（本文件不 require wx-server-sdk，便于纯 node 单测）。

const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;       // 7 天
const LOCK_AFTER_FAILS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000;         // 30 分钟
const DAY_MS = 24 * 3600 * 1000;

// ===================== 密码哈希 =====================

/** 生成随机盐（hex）。 */
function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 密码 → 加盐哈希（scryptSync）。
 * @param {string} password 明文密码
 * @param {string} salt 十六进制盐（genSalt() 生成）
 * @returns {string} hex 哈希
 */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
}

/**
 * 校验密码：hashPassword(password, salt) === storedHash。
 * ⚠️ 恒时比较（timingSafeEqual），防时序侧信道。
 */
function verifyPassword(password, salt, storedHash) {
  if (!storedHash || !salt) return false;
  const a = Buffer.from(hashPassword(password, salt), 'hex');
  const b = Buffer.from(String(storedHash), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ===================== Token =====================

/** 生成 32 字节随机 token（hex）。 */
function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** token 有效期毫秒。 */
function tokenTtlMs() { return TOKEN_TTL_MS; }

/**
 * 从 headers 解析 Bearer token。
 * @param {object} headers 请求头（wx 云函数 event.header / headers 均可）
 * @returns {string} token 或 ''
 */
function parseBearer(headers) {
  const h = headers || {};
  const auth = h.Authorization || h.authorization || h['X-Authorization'] || h['x-authorization'] || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/);
  return m ? m[1].trim() : '';
}

// ===================== 会话中间件（注入式） =====================

// 管理员账号的可用状态（admin_user.status）。取不到记录 / 任何非此值 → fail-closed 拒绝。
const ADMIN_STATUS_ACTIVE = 'active';

/**
 * adminAuth 中间件：校验 token → 校验 admin_user 账号状态 → 返回会话信息或错误。
 * @param {object} sessionColl  注入的会话集合句柄（db.collection('admin_login_log')；测试可注入假集合）
 * @param {object} adminUserColl 注入的管理员集合句柄（db.collection('admin_user')；测试可注入假集合）
 * @param {string} token Bearer token
 * @returns {Promise<object>} 成功 { adminId, role, sessionId }；失败 { error: 'ADMIN_AUTH_FAILED'|'ADMIN_TOKEN_EXPIRED' }
 *
 * ⚠️ R48（安全加固）：token 有效 ≠ 账号可用。管理员被禁用（status !== 'active'）后，
 *   已签发 token 必须立即失效，不得用到自然过期 —— 否则禁用形同虚设。
 *   · 按会话行 admin_id 读 admin_user，仅当 status==='active' 才放行；
 *   · 取不到记录 / status 非 active / 读取异常 → **一律 fail-closed**（复用 ADMIN_AUTH_FAILED，不新增错误码）；
 *   · 读库容错：SDK 返回 { data } 形态（r && r.data && r.data[0]），包 try/catch（历史教训：doc().get()
 *     被当文档本体用 → 线上恒错；此处宁可拒绝也不放行）。
 */
async function requireAuth(sessionColl, adminUserColl, token) {
  if (!token) return { error: 'ADMIN_AUTH_FAILED' };

  // 1) 会话行：token 必须存在且未过期
  let row = null;
  try {
    const res = await sessionColl.where({ token }).limit(1).get();
    row = res && res.data && res.data[0];
  } catch (e) {
    return { error: 'ADMIN_AUTH_FAILED' };       // 会话读异常 → 拒绝
  }
  if (!row) return { error: 'ADMIN_AUTH_FAILED' };
  if ((row.expires_at || 0) < Date.now()) return { error: 'ADMIN_TOKEN_EXPIRED' };

  // 2) R48：账号状态校验（fail-closed）
  const adminId = row.admin_id || '';
  if (!adminId) return { error: 'ADMIN_AUTH_FAILED' };
  let adminRow = null;
  try {
    const ar = await adminUserColl.where({ admin_id: adminId }).limit(1).get();
    adminRow = ar && ar.data && ar.data[0];
  } catch (e) {
    return { error: 'ADMIN_AUTH_FAILED' };       // 账号读异常 → 拒绝（不因容错放行）
  }
  // 取不到记录 / 状态不是 active（禁用/停用/未知值）→ 一律拒绝
  if (!adminRow || adminRow.status !== ADMIN_STATUS_ACTIVE) {
    return { error: 'ADMIN_AUTH_FAILED' };
  }

  return { adminId, role: row.role || 'op', sessionId: row._id || '' };
}

/**
 * 角色拦截：允许角色列表包含当前角色 → null；否则错误码。
 * @param {string} role 当前角色
 * @param {string[]} allowed 允许角色
 */
function requireRole(role, allowed) {
  if (allowed && allowed.indexOf(role) >= 0) return null;
  return 'ADMIN_PERMISSION_DENIED';
}

// ===================== 锁定 =====================

/**
 * 是否处于锁定中。
 * @param {number|null} lockedUntilMs admin_user.locked_until（0/null = 未锁定）
 * @param {number} nowMs 服务端 UTC 毫秒
 */
function isLocked(lockedUntilMs, nowMs) {
  return !!lockedUntilMs && lockedUntilMs > nowMs;
}

/**
 * 计算新的锁定截止时间：连续失败次数 >= 5 → now + 30min；否则 null。
 * @param {number} failCount 连续失败次数（含本次）
 */
function lockUntilAfter(failCount, nowMs) {
  if (failCount >= LOCK_AFTER_FAILS) return nowMs + LOCK_DURATION_MS;
  return null;
}

// ===================== expire_at 计算（批次 6 §2.3） =====================

/**
 * 手动调权 / 私域订单发权益的 expire_at 计算。
 *   · 权益未到期（currentExpireAt > now）→ 在原 expire_at 基础上累加 days（不覆盖）
 *   · 权益已过期/无记录 → 从操作当日（now）起算 + days（不顺延原到期）
 * @param {number} currentExpireAt 当前 expire_at（0 = 无记录）
 * @param {number} nowMs 服务端 UTC 毫秒
 * @param {number} days 新增天数
 * @returns {number} 新 expire_at（毫秒）
 */
function calcGrantExpireAt(currentExpireAt, nowMs, days) {
  const base = (Number(currentExpireAt) || 0) > nowMs ? Number(currentExpireAt) : nowMs;
  return base + Number(days) * DAY_MS;
}

module.exports = {
  genSalt, hashPassword, verifyPassword,
  genToken, tokenTtlMs, TOKEN_TTL_MS,
  parseBearer, requireAuth, requireRole,
  isLocked, lockUntilAfter, LOCK_AFTER_FAILS, LOCK_DURATION_MS,
  calcGrantExpireAt, DAY_MS, SCRYPT_KEYLEN,
};