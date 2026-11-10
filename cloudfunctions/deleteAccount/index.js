// cloudfunctions/deleteAccount/index.js —— 批次 7 · 账号注销（Controller 层 · 写）
//
// ⚠️ 个人信息保护（批次 7 §2.11）：
//   · 软删 user + **匿名化 openid/昵称/unionid**（置为脱敏占位，PII 不可逆复原）
//   · 关联 shop / shop_entitlement 置 is_deleted=true（或留待定时任务脱敏；本实现同步软删）
//   · 历史业务数据（月账/成本卡/订单）**不硬删**（数据可追溯；误删恢复优先软删恢复）
//   · 幂等：client_request_id 校验；二次确认在前端（本函数不弹窗）
//   · 承诺 15 个工作日内完成数据处理（前端文案展示，本函数执行软删+匿名化）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth } = common;
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;

// 匿名化占位（不可逆：丢弃原值）
//
// 🔴 R688 修复：原先 `ANON_OPENID = 'anonymous_' + '0'.repeat(12)` 是**全局固定常量**，
//   而 `user.idx_openid` 是 **unique** 索引（`initDb/collections.js`）。
//   ⇒ 第 1 个用户注销时把 openid 写成该常量并占用它；**第 2 个用户注销时 update 撞唯一键**
//     ⇒ 整个注销流程抛错失败。症状只在"第 2 个人注销"时出现，极难被发现。
//   证据：`review/evidence/r688_delete_bug/probe_anon_openid.js`（A-③ 唯一索引 + B-① 值重复必撞）。
//
//   改法：由 `user_id` 派生，逐用户唯一。
//   为什么这样不破坏「不可逆」：`user_id` 来自 `genId('u_')`（`common/auth.js:18`），
//   是 时间base36+随机base36，**与原 openid 无任何关联**，反推不出 openid。
//   为什么不用时间戳/随机数：同一用户重复注销时应得到**同一个**值（幂等），
//   而 `user_id` 在同一文档生命周期内不变 ⇒ 天然幂等。
function anonOpenidFor(userId) {
  return 'anonymous_' + String(userId || 'unknown');
}
const ANON_NICK = '已注销用户';

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;
  const openid = auth.openid;

  const v = (event && event.input) || event || {};
  const clientRequestId = v.client_request_id || '';

  // ===== 2. 幂等预检（🔒 R72：走单源 common/idempotency.js，不再内联重写）=====
  if (clientRequestId) {
    const key = `acc_del_${clientRequestId}`;
    if (await common.idempotency.checkIdempotent(db, key)) {
      return fail(ERROR_CODES.ADMIN_OP_IDEMPOTENT, '重复提交');
    }
  }

  const now = nowUtc();

  // ===== 3. 软删 + 匿名化 user（PII 不可逆）=====
  const userRes = await db.collection('user').where({ openid, is_deleted: false }).limit(1).get();
  const userDoc = userRes && userRes.data && userRes.data[0];
  if (userDoc) {
    await db.collection('user').doc(userDoc._id).update({
      data: {
        openid: anonOpenidFor(userId),     // 匿名化：原 openid 不可复原（R688：逐用户唯一）
        unionid: '',
        nickname: ANON_NICK,
        avatar: '',
        is_deleted: true,                 // 软删（可恢复入口为误删场景；注销本身 PII 已匿名化）
        delete_at: now,
        updated_at: now,
      },
    });
  }

  // ===== 4. 关联 shop 软删 =====
  const shopsRes = await db.collection('shop').where({ user_id: userId, is_deleted: false }).limit(100).get();
  for (const s of ((shopsRes && shopsRes.data) || [])) {
    await db.collection('shop').doc(s._id).update({
      data: { is_deleted: true, delete_at: now, updated_at: now },
    });
  }

  // ===== 5. shop_entitlement 软删（权限回收）=====
  const entRes = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
  const ent = entRes && entRes.data && entRes.data[0];
  if (ent) {
    await db.collection('shop_entitlement').doc(ent._id).update({
      data: { expire_at: 0, updated_at: now, is_deleted: true },
    });
  }

  // ===== 6. 留痕（action=USER_ACCOUNT_DELETE；不含 PII 明文）=====
  await writeAudit(db, {
    action: 'USER_ACCOUNT_DELETE',
    operator_type: 'user',
    operator_id: userId,
    shop_id: '',
    before_data: { user_id: userId },
    after_data: { user_id: userId, anon: true, shops_soft_deleted: ((shopsRes && shopsRes.data) || []).length },
    remark: '用户注销：软删 user + 匿名化 PII + 关联店铺软删',
    idempotency_key: clientRequestId ? `acc_del_${clientRequestId}` : '',
  });

  return ok({
    user_id: userId,
    deleted: true,
    anon: true,
    note: '账号已注销，历史数据已匿名化处理（15 个工作日内完成数据清理）',
    client_request_id: clientRequestId || '',
  });
};