// cloudfunctions/grantAiConsent/index.js —— AI 授权（授权 / 重新授权 · 写）
//
// 分层（对齐既有先例 savePlan / saveShopSetting）：
//   Controller：鉴权 → 归属校验 → 校验 → 幂等预检 → 分支（新建 / 覆盖）→ 审计。
//
// 🔴 三条设计前提（写在这里，是为了让后来人改之前先看到）：
//   ① **scope 是能力粒度，不是布尔**（见 service.js 头注）——不能"一次同意、全部能力"。
//   ② **一店一份授权**（`shop_ai_consent` 上 `idx_ai_consent_user_shop` 唯一索引兜住并发）：
//      已有记录就**覆盖**，不新建。否则同一店会有多条授权，撤回时只翻其中一条 ⇒ 另一条仍然"有效"。
//   ③ **默认未授权**（fail-closed）：本函数只负责"把授权写上去"，从不假定任何已有状态。
//
// ⚠️ 撤回不删记录、只翻 `revoked_at`（留痕）；重新授权时把 `revoked_at` 归 0 并刷新 `granted_at`，
//   这样"什么时候同意过、什么时候撤过"在 audit_log 里是两件事，不会被覆盖掉。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, genId } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;
const { validateInput } = require('./validate');
const { auditSnapshot } = require('./service');

const COLL = 'shop_ai_consent';

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);
  const crid = v.input.client_request_id;

  // ===== 3. 幂等预检（重放形态 · 单源 shopKey）=====
  //   必须早于任何写：写完再查等于没查（写操作幂等覆盖守卫 I3）。
  if (crid) {
    const prior = await common.idempotency.findPriorResult(db, shopId, crid);
    // `replayed` 在重放时必须改写成 true —— 直接把首次结果原样回出去，
    // 前端/客服会把"重放"当成"刚刚又授权了一次"，排障时会数错次数。
    if (prior) return ok(Object.assign({}, prior, { replayed: true }));
  }

  const da = makeAdapter(db);
  const now = nowUtc();

  // ===== 4. 定位既有授权（一店一份，靠唯一索引兜底并发）=====
  const found = await da.list(COLL, { user_id: userId, shop_id: shopId });
  const row = (found && found.data && found.data[0]) || null;
  const before = auditSnapshot(row);

  const patch = {
    scope: v.scope,
    policy_version: v.policy_version,
    expire_at: v.expire_at,
    granted_at: now,
    revoked_at: 0,
    revoke_reason: '',
    client_request_id: crid,
    updated_at: now,
  };

  let consentId = row ? (row.consent_id || '') : '';
  let action = 'ai_consent_regrant';

  if (row) {
    // ---- 已有记录：覆盖（不新建）。重新授权 = 授权面整体替换，不做"求并集"----
    //   🔴 不做并集是**故意的**：如果上次授了 pricing、这次只勾了 diagnose，
    //      并集会悄悄保留一个老板这次没勾的能力 —— 那是把"缩小授权"变成"没变化"。
    if (!consentId) consentId = genId('con_');
    // 写库必须用**权威主键 `_id`**：`da.list` 命中的行里业务键未必等于 `_id`（round116 血案）。
    const rid = row._id || row.id;
    const up = await db.collection(COLL).doc(rid).update({ data: Object.assign({ consent_id: consentId }, patch) });
    const updated = (up && up.stats && up.stats.updated) || 0;
    if (!updated) {
      // `.update()` 对"值完全没变"可能回 0 行、不抛异常（云开发语义）⇒ 不能把 0 直接当失败，
      // 但也不能当成功。回读一次按**终态是否已是我们要的样子**判定（round116：静默失败必须消灭）。
      const re = await db.collection(COLL).doc(rid).get().catch(() => null);
      const doc = re && re.data;
      const sameScope = doc && Array.isArray(doc.scope)
        && doc.scope.length === v.scope.length
        && v.scope.every((k) => doc.scope.indexOf(k) >= 0);
      if (!doc || doc.revoked_at !== 0 || doc.policy_version !== v.policy_version || !sameScope) {
        return fail(ERROR_CODES.SYSTEM_ERROR, '授权未写入（consent_id=' + consentId + '）');
      }
    }
  } else {
    // ---- 无记录：新建 ----
    action = 'ai_consent_grant';
    consentId = genId('con_');
    try {
      await da.insert(COLL, {
        consent_id: consentId,
        user_id: userId,
        shop_id: shopId,
        scope: v.scope,
        policy_version: v.policy_version,
        granted_at: now,
        expire_at: v.expire_at,
        revoked_at: 0,
        revoke_reason: '',
        client_request_id: crid,
      });
    } catch (e) {
      // 并发下两个请求可能同时看到"无记录"：唯一索引 idx_ai_consent_user_shop 会拒掉后一个。
      // 这**不是错误**，是约束在起作用 ⇒ 转成覆盖写，终态与先到者一致。
      if (!common.isDuplicateKeyError(e)) {
        return fail(ERROR_CODES.SYSTEM_ERROR, '授权落库失败（consent_id=' + consentId + '）');
      }
      const again = await da.list(COLL, { user_id: userId, shop_id: shopId });
      const r2 = again && again.data && again.data[0];
      if (!r2) return fail(ERROR_CODES.SYSTEM_ERROR, '授权并发冲突且回读不到记录');
      if (!r2.consent_id) consentId = genId('con_');
      else consentId = r2.consent_id;
      const up2 = await db.collection(COLL).doc(r2._id || r2.id).update({ data: Object.assign({ consent_id: consentId }, patch) });
      const n2 = (up2 && up2.stats && up2.stats.updated) || 0;
      if (!n2) return fail(ERROR_CODES.SYSTEM_ERROR, '授权并发覆盖未写入（consent_id=' + consentId + '）');
      action = 'ai_consent_regrant';
    }
  }

  // ===== 5. 返回体 + 审计 =====
  //   出参形状**两条路（新建/覆盖）完全一致** —— 前端不该按"是不是第一次"分支渲染。
  const result = {
    shop_id: shopId,
    consent_id: consentId,
    scope: v.scope,
    policy_version: v.policy_version,
    granted_at: now,
    expire_at: v.expire_at,
    revoked_at: 0,
    replayed: false,
    client_request_id: crid,
  };

  await writeAudit(db, {
    action,
    operator_type: 'user',
    operator_id: userId,
    shop_id: shopId,
    before_data: before,
    after_data: result,
    remark: 'AI 授权 scope=' + v.scope.join(','),
    // 幂等键必须走单源 shopKey（两处各自拼串 ⇒ "登记了却查不到"）
    idempotency_key: common.idempotency.shopKey(shopId, crid),
  });

  return ok(result);
};
