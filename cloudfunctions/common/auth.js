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
const { ERROR_CODES, isDuplicateKeyError } = require('./errors');
const { nowUtc } = require('./utilTime');

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
 *   · `shop` / `shop_entitlement` 用**确定性业务键**（`defaultShopId()` / `defaultEntitlementId()`）
 *     写入 `shop_id` / `id` 字段，配合**下方插入后的存在性回读**保证并发下只留一份。
 *   🔴 R201 更正（2026-10-03）：此处原先写「用确定性 `_id` ⇒ 撞 `_id` 由库拒」——
 *     **该前提不成立**：微信云开发 `collection.add()` 的 `_id` 由库自动生成，`data` 里带的 `_id` 不生效
 *     ⇒ 从来没有"确定性 `_id`"这回事，幂等其实是**假象**（真云实测：读侧 `doc(shopId)` 全 miss）。
 *     现行做法 = 插入后**回读校验**，读不到就按赢家那份走（fail-closed，不猜）。
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
        // 🔴 R201：`data` 里**不再写 `_id`** —— 微信云开发 `add()` 的 `_id` 由库自动生成，
        //   携带的 `_id` 不生效（旧代码写了却以为生效 ⇒ 读侧 `doc(shopId)` 全部 404，R201 实锤）。
        //   业务键是 `shop_id` 字段；读侧由 `assertShopOwner` 的 where 兜底按它查。
        id: shopId, shop_id: shopId,
        user_id: userId, name: '默认店铺', remark: '', created_at: nowUtc(), is_deleted: false,
      },
    });
  } catch (e) { if (!isDuplicateKeyError(e)) throw e; }

  try {
    await db.collection('shop_entitlement').add({
      data: {
        // 🔴 R201 同上：不写 `_id`，用确定性业务键 + 下方回读保证幂等
        id: defaultEntitlementId(userId), entitlement_id: defaultEntitlementId(userId),
        user_id: userId, expire_at: 0, source: 'auto', updated_at: nowUtc(), is_deleted: false,
      },
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
 * 🔴🔴🔴 R201（2026-10-03）**真机实锤：「用业务键当文档主键读库」⇒ 全站 404**
 *   现场（真云 wx.cloud.callFunction 探针实测，证据 `review/evidence/R201_*.txt`）：
 *     `getShopList` / `getShopContext`（走 `da.list('shop',{user_id})`＝按**字段**查）→ SUCCESS；
 *     `getMonthList` / `getLedger` / `getCostCard` / `getMaterial` / `getCardVersions` /
 *     `getAmortSchedule`（走本函数＝按 **`_id`** 查）→ 统一 `RESOURCE_NOT_FOUND`。
 *   真因：`autoProvision` 建店时 `add({ data: { _id: shopId, ... } })` ——
 *     🔴 **微信云开发 `collection.add()` 的 `_id` 由库自动生成，`data` 里携带的 `_id` 不生效**
 *     ⇒ 文档真实 `_id` ≠ `shop_id` 字段值 ⇒ `doc(shopId)` 必然 miss。
 *   ⇒ 修法：**先按 `_id` 查（快路径，新数据直接命中），miss 再按 `shop_id` 字段查（兼容存量）**。
 *     存量数据零迁移；`FORBIDDEN` 越权拦截本体**一字不动**。
 *   🔴 同族坑（写侧）：`saveShopSetting` / `manageShop` 已用 `doc(shopDoc._id || shopDoc.id || shopId)`
 *     —— 正确形态是**先取行数据的 `_id`**，本仓其余 `doc()` 调用点均已是此形态。
 *   ⚠️ 调用点传进来的必须是**业务键**（= `getShopContext` 回的那个 `shop.shop_id || shop.id`），
 *     不是库内 `_id`。
 *   🔴 R202 更正（此前写的是「本函数只认 `shop_id` 字段」—— **错**）：存量 `shop` 文档
 *     **没有 `shop_id` 字段**，业务键在 `id` 上。故本函数按 ① `_id` → ② `shop_id` → ③ `id`
 *     三个候选依次查，与读侧 `shop.shop_id || shop.id` 同口径。
 *   ⚠️ ③ 段的 `where({ id })` 若 `shop` 上没有 `id` 单键索引，dev 量级（个位数文档）无碍；
 *     生产量级需在控制台补 `id` 索引（已在索引清单待办里登记）。
 *   ⚠️ 守卫 `tools/check_shop_read_by_bizkey.js` 会同时核「单源里有 `shop_id` 与 `id` 两段兜底」
 *     +「单源里不再出现裸 `doc(shopId)` 形态」。
 */
async function assertShopOwner(db, shopId, userId) {
  if (!shopId) return { error: ERROR_CODES.INVALID_PARAM };

  // ① 快路径：按文档 `_id` 查（新建且 `_id` 恰好等于业务键时命中）
  let shop = null;
  try {
    const r = await db.collection('shop').doc(shopId).get();
    shop = (r && r.data) || null;
  } catch (e) {
    shop = null; // 文档不存在时 SDK 会 reject，属预期分支
  }

  // ② 兼容路径 1：`_id` miss ⇒ 按 `shop_id` 业务键字段查
  if (!shop) {
    try {
      const q = await db.collection('shop').where({ shop_id: shopId, is_deleted: false }).limit(1).get();
      shop = (q && q.data && q.data[0]) || null;
    } catch (e2) {
      shop = null;
    }
  }

  // ③ 兼容路径 2：仍 miss ⇒ 按 `id` 业务键字段查
  //   🔴🔴 R202 真云实锤（由 `initDb{only:'diag_shop'}` 只读诊断取得，**非推测**）：
  //     存量 `shop` 文档真实 `keys` = [_id, id, user_id, name, remark, created_at, is_deleted, updated_at, biz_type]
  //     —— **根本没有 `shop_id` 这个字段**。同一业务键 `shop_mu6j87v1itrs` 三路实测：
  //       · where({ _id:     'shop_mu6j87v1itrs' }) → [] miss（`_id` 是库自动生成的 92994ce0…）
  //       · where({ shop_id: 'shop_mu6j87v1itrs' }) → [] miss（字段不存在 ⇒ R201 的 ② 段对存量形态无效）
  //       · where({ id:      'shop_mu6j87v1itrs' }) → ✅ 命中
  //   ⇒ 口径依据：读侧 `getShopContext` / `getShopList` 一直是 `shop.shop_id || shop.id`，
  //     鉴权侧必须与读侧**同候选集**，否则就是「读得到、鉴权 404」的口径分裂（本次真机现象的成因）。
  if (!shop) {
    try {
      const q2 = await db.collection('shop').where({ id: shopId, is_deleted: false }).limit(1).get();
      shop = (q2 && q2.data && q2.data[0]) || null;
    } catch (e3) {
      shop = null;
    }
  }

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
