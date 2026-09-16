// cloudfunctions/adminInit/index.js —— 批次 6 · 首超管引导（一次性）
//
// ⚠️ 安全契约（core/16 §7）：
//   · 传入预共享 setup token（环境变量 ADMIN_SETUP_TOKEN，线下交付，**不入代码/不入仓库/不进日志**）；
//   · 仅首次有效：admin_user 已有记录 → ADMIN_ALREADY_INIT；
//   · env 门禁：dev 环境白名单放行，prod 恒拒（对齐批次 0 initDb.gate 语义，本函数内联实现，不改 initDb）；
//   · 创建首个 super：密码加盐哈希（scryptSync），写 admin_user + audit_log（action=ADMIN_INIT）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { genSalt, hashPassword, genToken, TOKEN_TTL_MS } = require('./adminAuth'); // 单源派生副本

const ADMIN_SETUP_TOKEN = (process.env.ADMIN_SETUP_TOKEN || '').trim();

// env 门禁（对齐批次 0 initDb.gate：dev 白名单 / prod 恒拒；本函数内联，禁止改 initDb）
function envGate(envRaw) {
  const env = String(envRaw == null ? '' : envRaw).toLowerCase();
  if (!env || /prod/.test(env)) return 'INITDB_DEV_ONLY: adminInit 仅允许 dev 环境';
  return null;
}

exports.main = async (event) => {
  // ===== 1. setup token 比对（预共享，线下交付；未配置环境变量 → 拒绝）=====
  if (!ADMIN_SETUP_TOKEN) return fail(ERROR_CODES.ADMIN_AUTH_FAILED, '未配置 ADMIN_SETUP_TOKEN');
  const v = (event && event.input) || event || {};
  if (typeof v.setup_token !== 'string' || v.setup_token !== ADMIN_SETUP_TOKEN) {
    return fail(ERROR_CODES.ADMIN_AUTH_FAILED, 'setup token 无效');
  }

  // ===== 2. env 门禁（prod 恒拒）=====
  const envId = (cloud.getWXContext && cloud.getWXContext().ENV) || process.env.TCB_ENV || '';
  const gateErr = envGate(envId);
  if (gateErr) return fail(ERROR_CODES.ADMIN_PERMISSION_DENIED, gateErr);

  // ===== 3. 入参校验 =====
  if (typeof v.username !== 'string' || !/^[A-Za-z0-9_]{2,32}$/.test(v.username)) {
    return fail(ERROR_CODES.INVALID_PARAM, 'username 必须为 2~32 位字母/数字/下划线');
  }
  if (typeof v.password !== 'string' || v.password.length < 8 || v.password.length > 64) {
    return fail(ERROR_CODES.INVALID_PARAM, 'password 必须为 8~64 位');
  }

  // ===== 4. 仅首次有效 =====
  const existRes = await db.collection('admin_user').limit(1).get();
  if (existRes && existRes.data && existRes.data.length > 0) {
    return fail(ERROR_CODES.ADMIN_ALREADY_INIT, '管理员已初始化');
  }

  // ===== 5. 创建首个 super（加盐哈希）=====
  const salt = genSalt();
  const pwdHash = hashPassword(v.password, salt);
  const adminId = 'adm_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const now = nowUtc();
  await db.collection('admin_user').add({
    data: {
      admin_id: adminId,
      username: v.username,
      pwd_hash: pwdHash,
      salt,
      role: 'super',
      status: 'active',
      locked_until: 0,
      last_login_at: 0,
      created_at: now,
      updated_at: now,
    },
  });

  // ===== 6. 留痕（action=ADMIN_INIT；写审计含操作人/前值/后值）=====
  await db.collection('audit_log').add({
    data: {
      action: 'ADMIN_INIT',
      operator_type: 'admin',
      operator_id: adminId,
      shop_id: '',
      before_data: null,
      after_data: { admin_id: adminId, username: v.username, role: 'super' },
      remark: '首超管初始化（setup token 用后即焚）',
      idempotency_key: '',
      created_at: now,
    },
  });

  return ok({ admin_id: adminId, username: v.username, role: 'super' });
};