// cloudfunctions/adminQueryUser/index.js —— 批次 6 · 用户查询（adminAuth）
//
// 按 keyword（openid / user_id / 昵称模糊）查 user + 其下 shop + entitlement.expire_at + 档位。
// ⚠️ user 表（第 8 章）字段为 user_id/openid/unionid/nickname/avatar，**无手机号列**；
//   手机号查询需在批次 6 后扩展 user 表或走用户绑定手机号功能，当前 keyword 覆盖 openid/user_id/nickname。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { parseBearer, requireAuth } = require('./adminAuth');

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  // ===== 1. adminAuth 中间件 =====
  const sess = await requireAuth(db.collection('admin_login_log'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  const v = (event && event.input) || event || {};
  const keyword = (typeof v.keyword === 'string' && v.keyword.trim()) ? v.keyword.trim() : '';
  const page = Math.max(1, Number(v.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(v.page_size) || 20));

  // ===== 2. 查 user（keyword 匹配 openid / user_id / nickname；无 keyword → 分页全量）=====
  const cmd = db.command;
  let userQuery = null;
  if (keyword) {
    const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    userQuery = await db.collection('user')
      .where(cmd.and([
        { is_deleted: false },
        cmd.or([
          { openid: cmd.regExp('^' + esc) },
          { user_id: keyword },
          { nickname: cmd.regExp(esc) },
        ]),
      ]))
      .limit(pageSize).skip((page - 1) * pageSize).get();
  } else {
    userQuery = await db.collection('user').where({ is_deleted: false })
      .limit(pageSize).skip((page - 1) * pageSize).get();
  }
  const users = (userQuery && userQuery.data) || [];

  // ===== 3. 逐用户装配：shop + entitlement =====
  const list = [];
  for (const u of users) {
    const userId = u.user_id || u.id;
    const shopsRes = await db.collection('shop').where({ user_id: userId, is_deleted: false }).limit(20).get();
    const entRes = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
    const ent = entRes && entRes.data && entRes.data[0];
    const expireAt = ent ? (ent.expire_at || 0) : 0;
    list.push({
      user_id: userId,
      openid_mask: maskOpenid(u.openid || ''),
      nickname: u.nickname || '',
      shops: ((shopsRes && shopsRes.data) || []).map((s) => ({ shop_id: s.id || s.shop_id, name: s.name || '' })),
      expire_at: expireAt,
      tier: expireAt > Date.now() ? 'paid' : 'free',   // 档位判定：只读 expire_at（解耦铁律）
      source: ent ? (ent.source || '') : '',
    });
  }

  return ok({ list, page, page_size: pageSize, count: list.length });
};

/** openid 打码（只留前 6 后 4，防敏感泄露；空则返回空串） */
function maskOpenid(openid) {
  if (!openid) return '';
  if (openid.length <= 10) return openid;
  return openid.slice(0, 6) + '****' + openid.slice(-4);
}