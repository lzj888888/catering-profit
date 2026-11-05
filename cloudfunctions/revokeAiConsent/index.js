// cloudfunctions/revokeAiConsent/index.js —— AI 授权撤回（写）
//
// 分层（对齐既有先例 grantAiConsent）：
//   Controller：鉴权 → 归属校验 → 校验 → 幂等预检 → 翻标记 → 清派生数据 → 审计。
//
// 🔴 顺序是**有讲究的**，不要为了"事务感"调换：
//   ① 先翻 `revoked_at`（此后一切读取都判未授权，越权面**立刻**关掉）；
//   ② 再清 `shop_ai_insight`（派生数据，清不完也不能让授权继续有效）。
//   反过来的话，清缓存期间老板仍是"已授权"状态，而请求可能正在引用旧结论。
//
// 🔴 清不干净**不能静默**：派生结论可能有成千行，云端单次 remove 有上限。
//   所以这里分轮清，并在出参里给 `clear_pending:true`（显式降级）—— 静默只清一部分，
//   等于"撤回了但结论还在被引用"，正是设计稿 §4 要消灭的那件事。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;
const { validateInput } = require('./validate');
const { revokeState, auditSnapshot } = require('./service');

const CONSENT_COLL = 'shop_ai_consent';
const INSIGHT_COLL = 'shop_ai_insight';

// 派生数据清理轮数上限。每轮一次 `where().remove()`；上一轮 removed=0 即判定清完。
// 取值理由：结论是「按月 × 能力」，单店实体量级是"个位数到几十行"，5 轮已远超实际需要；
// 设上限是为了**不让云函数超时**（20s 硬顶），超出则如实回 `clear_pending`。
const MAX_CLEAR_ROUNDS = 5;

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
  if (crid) {
    const prior = await common.idempotency.findPriorResult(db, shopId, crid);
    if (prior) return ok(Object.assign({}, prior, { replayed: true }));
  }

  const da = makeAdapter(db);
  const now = nowUtc();

  // ===== 4. 定位授权（一店一份；只找**本人**的，防止撤别人的）=====
  const found = await da.list(CONSENT_COLL, { user_id: userId, shop_id: shopId });
  const row = (found && found.data && found.data[0]) || null;
  const state = revokeState(row);
  const before = auditSnapshot(row);

  let consentId = '';
  let revokedAt = 0;
  let cleared = 0;
  let pending = false;

  if (row) {
    consentId = row.consent_id || '';
    revokedAt = row.revoked_at || 0;

    if (state === 'revoked') {
      const rid = row._id || row.id;
      const up = await db.collection(CONSENT_COLL).doc(rid).update({
        data: { revoked_at: now, revoke_reason: v.reason, client_request_id: crid, updated_at: now },
      });
      const updated = (up && up.stats && up.stats.updated) || 0;
      if (!updated) {
        // 同 grant 侧：`.update()` 对"值没变"可能回 0 行，但这里 `revoked_at` 一定变了
        // （before 是 0、now 是当前毫秒）⇒ 0 行就是真失败，回读再确认一次（失败要可见）。
        const re = await db.collection(CONSENT_COLL).doc(rid).get().catch(() => null);
        if (!re || !re.data || !(re.data.revoked_at > 0)) {
          return fail(ERROR_CODES.SYSTEM_ERROR, '撤回未写入（consent_id=' + consentId + '）');
        }
        revokedAt = re.data.revoked_at;
      } else {
        revokedAt = now;
      }
    }
    // 已撤回（state='already_revoked'）**不刷新** revoked_at：那是终态，重刷会改写历史。

    // ===== 5. 清派生数据（按 consent_id 一次定位）=====
    //   已撤回也再扫一遍：上一轮可能清到一半就超时/失败，这里是修复孤儿数据的唯一机会。
    if (!consentId) {
      // 没有 consent_id 就无法"按授权定位派生数据"⇒ 如实上报，不猜、不按 shop_id 扩大删除面
      //   （按 shop_id 删会连带删掉**别条授权**产出的结论）。
      pending = true;
    } else {
      try {
        for (let i = 0; i < MAX_CLEAR_ROUNDS; i++) {
          const r = await db.collection(INSIGHT_COLL).where({ consent_id: consentId }).remove();
          const n = (r && r.stats && r.stats.removed) || 0;
          cleared += n;
          if (n === 0) { pending = false; break; }
          // 本轮删掉了但不确定删完：先置 true，下一轮 removed=0 会把它改回 false
          pending = true;
        }
      } catch (e) {
        // 清派生数据失败**不影响撤回本身**（授权已失效），但必须显式降级上报
        pending = true;
      }
    }
  }

  // ===== 6. 返回体 + 审计 =====
  const result = {
    shop_id: shopId,
    consent_id: consentId,
    state,
    revoked_at: revokedAt,
    cleared_insights: cleared,
    clear_pending: pending,
    replayed: false,
    client_request_id: crid,
  };

  await writeAudit(db, {
    action: 'ai_consent_revoke',
    operator_type: 'user',
    operator_id: userId,
    shop_id: shopId,
    before_data: before,
    after_data: result,
    remark: 'AI 撤回 reason=' + v.reason + (pending ? '（派生数据未清完）' : ''),
    idempotency_key: common.idempotency.shopKey(shopId, crid),
  });

  return ok(result);
};
