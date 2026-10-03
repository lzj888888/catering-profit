// cloudfunctions/common/auth.js
// 批次 0 鉴权中间件（复审节点①·点1 / 点2）
//
// 点1（身份只来自云端）：resolveAuth 只接收 cloud.getWXContext() 的结果 ctx 与注入的 db。
//   ❌ 不接收 event，从函数签名上杜绝前端传入的 user_id / shop_id / openid 注入。
//   ❌ 不读 event.user_id / event.shop_id / event.openid（即便有人误传也被忽略）。
//   身份唯一来源 = ctx.OPENID（微信云端可信上下文）。
//
// 点2（店铺归属）：assertShopOwner 校验 shop.user_id === ctx.user.id，否则 FORBIDDEN。

// 🔴 R194：本文件**不再**引入 `ok` / `fail` —— 两者的返回形状是 `{code,msg,data}`（无 `error` 字段），
//   正是「assertShopOwner 用 fail() ⇒ 调用点判 owner.error 恒假 ⇒ 越权拦截失效」的根因。
//   本文件对外一律用 `{ error, data }` 形状（与 resolveAuth / autoProvision 一致）。
const { ERROR_CODES, isDuplicateKeyError } = require('./cx_errors');
const { nowUtc } = require('./cx_utilTime');

// 生成短 id（演示用；真实环境可换雪花/uuid）
function genId(prefix) {
  return (prefix || '') + nowUtc().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

// 🔴 A6b 兜底（2026-09-19 真云实测）：`shop` 上只有**非** unique 的 `idx_shop_user` / `idx_shop_user_del`
//   （真云证据：同一 user_id 连插两次**都成功** —— `review/evidence/uniq_probe_result.json`）
//   ⇒ 「先查后建」在并发/重试下**不是原子的**，同一 user 可能建出**两个**店；
//     而 `resolveAuth` 是**每个云函数的必经路径**，风险面 = 全部。
//   修法：自动建的首店用**由 user_id 派生的确定性 `_id`**（`shop_<user_id>`）——
//   第二次插入必然撞 `_id` 被库拒 ⇒ 幂等**由构造保证**，不依赖索引、不依赖时序。
//   ⚠️ 只约束「自动建的首店」；将来允许一个 user 多店时，额外店仍走 `genId` ⇒ 不冲突。
//   ⚠️ 键格式**单源在此**，调用点禁止自己拼（R72 纪律；`getShopContext` 也必须复用本函数）。
function defaultShopId(userId) { return 'shop_' + String(userId || ''); }

// 同理：免费档权益。`shop_entitlement.idx_ent_user` 虽是 unique，**并发建档同样会硬失败**
//   （第二个请求直接报错，而不是优雅回读）⇒ 同样用确定性 `_id` + 容错。
function defaultEntitlementId(userId) { return 'ent_' + String(userId || ''); }

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
    const prov = await autoProvision(ctx, db, audit);
    if (prov && prov.error) return { error: prov.error };
    userRec = { user_id: prov.user_id };
  }

  // 返回的 user.id 完全来自 OPENID 查库结果，与任何前端传入字段无关
  return { user: { id: userRec.user_id }, openid: OPENID };
}

/**
 * 首次进入自动建档：user + 默认 shop + shop_entitlement(expire_at=0，免费档)。
 *
 * 🔴 幂等设计（A6b，2026-09-19）：
 *   · `user` 的权威唯一性来自 `idx_openid`（真云实测 unique 生效）；
 *     但**并发时第二个请求会直接抛库错** ⇒ 这里捕获「唯一键冲突」并**回读采用赢家的 user_id**。
 *   · **顺序不可换**：必须先抢 `user`、拿到最终的 `user_id`，**再**建店。
 *     反过来（先建店）会给自己的临时 user_id 建出一间**孤儿店**。
 *   · `shop` / `shop_entitlement` 用 `defaultShopId()` / `defaultEntitlementId()` 的**确定性 `_id`**
 *     ⇒ 即便并发也建不出第二份（撞 `_id` 由库拒，不是靠我先查一遍）。
 */
async function autoProvision(ctx, db, audit) {
  const OPENID = ctx.OPENID;
  const userId = genId('u_');
  try {
    await db.collection('user').add({
      data: {
        user_id: userId, openid: OPENID, unionid: (ctx.UNIONID || ''),
        nickname: '', avatar: '', created_at: nowUtc(), is_deleted: false,
      },
    });
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
    // 并发方（或重试）已建档 ⇒ 采用它的 user_id；其 shop / entitlement 已由它建好
    const again = await db.collection('user').where({ openid: OPENID, is_deleted: false }).limit(1).get();
    const r = again && again.data && again.data[0];
    if (!r) return { error: ERROR_CODES.SYSTEM_ERROR }; // 撞键却读不到 ⇒ fail-closed，不猜
    return { user_id: r.user_id };
  }

  const shopId = defaultShopId(userId);
  try {
    await db.collection('shop').add({
      data: {
        _id: shopId, id: shopId, shop_id: shopId,
        user_id: userId, name: '默认店铺', remark: '', created_at: nowUtc(), is_deleted: false,
      },
    });
  } catch (e) { if (!isDuplicateKeyError(e)) throw e; }

  try {
    await db.collection('shop_entitlement').add({
      data: { _id: defaultEntitlementId(userId), user_id: userId, expire_at: 0, source: 'auto', updated_at: nowUtc() },
    });
  } catch (e) { if (!isDuplicateKeyError(e)) throw e; }

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
  return { user_id: userId };
}

/**
 * 店铺归属校验（点2）：shop.user_id !== ctx.user.id → FORBIDDEN
 * @param {object} db
 * @param {string} shopId
 * @param {string} userId 当前 ctx.user.id
 * @returns {Promise<{error:null,data:object}|{error:string}>}
 *
 * 🔴🔴 R194（2026-10-03）**越权拦截曾整体失效** —— 本函数原用 `fail(code)` 构造失败返回，而
 *   `common/errors.js::fail()` 产出的是 **`{code, msg, data}`**（**没有 `error` 字段**）；
 *   全部 **20 处**调用点却统一写成 `if (owner.error) return fail(owner.error, owner.msg);`
 *   ⇒ `owner.error` **恒为 undefined** ⇒ 分支永不进入 ⇒ **归属校验形同不存在**。
 *   后果（真实可达）：任意已登录用户只要把 `shop_id` 换成别人的，即可**读/写他人店铺数据**
 *   （getLedger / exportData / saveLedger / saveCostCard / saveShopSetting … 共 20 个函数）。
 *   实证（本地探针，`node -e` 直调派生副本 cx_auth.js）：
 *     别人的店 → 返回 `{"code":"FORBIDDEN","msg":"FORBIDDEN","data":{}}`，`owner.error === undefined` ⇒ 放行。
 *   ⇒ 修法：**失败一律返回 `{ error: <code> }`**（与调用点判据同形），成功补 `error: null`。
 *   ⚠️ 同一文件里 `resolveAuth` / `autoProvision` **本来就是** `{error}` 形状 ⇒ 本函数是唯一的异形，
 *      修成同族即可；守卫 `tools/check_auth_guard_shape.js`（R194 新增）守这条不变式。
 */
async function assertShopOwner(db, shopId, userId) {
  if (!shopId) return { error: ERROR_CODES.INVALID_PARAM };
  let r;
  try {
    r = await db.collection('shop').doc(shopId).get();
  } catch (e) {
    return { error: ERROR_CODES.RESOURCE_NOT_FOUND }; // 文档不存在时 SDK 可能 reject
  }
  const shop = r && r.data;                      // ⚠️ doc().get() 返回结果对象 {data}
  if (!shop || shop.is_deleted) return { error: ERROR_CODES.RESOURCE_NOT_FOUND };
  if (shop.user_id !== userId) return { error: ERROR_CODES.FORBIDDEN }; // 🔴 越权拦截本体，必须保留
  return { error: null, data: shop };
}

module.exports = {
  resolveAuth, assertShopOwner, genId,
  defaultShopId, defaultEntitlementId,
  // 供测试与调用点复用（避免各处自写正则）
  isDuplicateKeyError,
};
