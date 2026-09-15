// cloudfunctions/common/auth.js
// 批次 0 鉴权中间件（复审节点①·点1 / 点2）
//
// 点1（身份只来自云端）：resolveAuth 只接收 cloud.getWXContext() 的结果 ctx 与注入的 db。
//   ❌ 不接收 event，从函数签名上杜绝前端传入的 user_id / shop_id / openid 注入。
//   ❌ 不读 event.user_id / event.shop_id / event.openid（即便有人误传也被忽略）。
//   身份唯一来源 = ctx.OPENID（微信云端可信上下文）。
//
// 点2（店铺归属）：assertShopOwner 校验 shop.user_id === ctx.user.id，否则 FORBIDDEN。

const { ERROR_CODES, ok, fail } = require('./cx_errors');
const { nowUtc } = require('./cx_utilTime');

// 生成短 id（演示用；真实环境可换雪花/uuid）
function genId(prefix) {
  return (prefix || '') + nowUtc().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * 解析可信身份。仅依赖 ctx.OPENID。
 * @param {object} ctx 必须含 OPENID（来自 cloud.getWXContext()）
 * @param {object} db 注入的数据库句柄
 * @param {object} [audit] 可选审计写入器（需提供 write 方法）
 * @returns {Promise<{user:{id:string}, openid:string} | {error:string}>}
 */
async function resolveAuth(ctx, db, audit) {
  const OPENID = ctx && ctx.OPENID;
  if (!OPENID) return { error: ERROR_CODES.UNAUTHORIZED }; // 无 OPENID → 无法识别用户

  // 只按 OPENID 查 user，绝不读前端身份字段
  const rec = await db.collection('user').where({ openid: OPENID, is_deleted: false }).limit(1).get();
  let userRec = rec && rec.data && rec.data[0];

  if (!userRec) {
    // 首次进入：自动建档 user + 默认 shop + shop_entitlement(expire_at=0，免费档)
    // 建档动作写 audit_log（只 INSERT）
    const userId = genId('u_');
    await db.collection('user').add({
      data: {
        user_id: userId, openid: OPENID, unionid: (ctx.UNIONID || ''),
        nickname: '', avatar: '', created_at: nowUtc(), is_deleted: false,
      },
    });
    const shopId = genId('shop_');
    await db.collection('shop').add({
      data: { id: shopId, user_id: userId, name: '默认店铺', remark: '', created_at: nowUtc(), is_deleted: false },
    });
    await db.collection('shop_entitlement').add({
      data: { user_id: userId, expire_at: 0, source: 'auto', updated_at: nowUtc() },
    });
    if (audit && typeof audit.write === 'function') {
      await audit.write({
        action: 'AUTH_AUTO_PROVISION',
        operator_type: 'user',
        operator_id: userId,
        shop_id: shopId,
        before_data: null,
        after_data: { user_id: userId, shop_id: shopId },
        remark: '首次进入自动建档',
      });
    }
    userRec = { user_id: userId };
  }

  // 返回的 user.id 完全来自 OPENID 查库结果，与任何前端传入字段无关
  return { user: { id: userRec.user_id }, openid: OPENID };
}

/**
 * 店铺归属校验（点2）：shop.user_id !== ctx.user.id → FORBIDDEN
 * @param {object} db
 * @param {string} shopId
 * @param {string} userId 当前 ctx.user.id
 */
async function assertShopOwner(db, shopId, userId) {
  if (!shopId) return fail(ERROR_CODES.INVALID_PARAM);
  let r;
  try {
    r = await db.collection('shop').doc(shopId).get();
  } catch (e) {
    return fail(ERROR_CODES.RESOURCE_NOT_FOUND); // 文档不存在时 SDK 可能 reject
  }
  const shop = r && r.data;                      // ⚠️ doc().get() 返回结果对象 {data}
  if (!shop || shop.is_deleted) return fail(ERROR_CODES.RESOURCE_NOT_FOUND);
  if (shop.user_id !== userId) return fail(ERROR_CODES.FORBIDDEN); // 🔴 越权拦截本体，必须保留
  return ok(shop);
}

module.exports = { resolveAuth, assertShopOwner, genId };
