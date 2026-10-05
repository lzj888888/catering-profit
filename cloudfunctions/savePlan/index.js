// cloudfunctions/savePlan/index.js —— 批次 M2v1.2 · 多方案存储（保存 / 复制 / 软删 · 写）
//
// 分层（对齐既有先例 saveCostCard / saveAsset）：
//   Controller：鉴权 → 幂等预检 → 校验 → 分支（软删/复制/新版本/首次）→ 服务端快照 → 只 INSERT → 审计。
//
// 🔴 铁律（开发规范 v1.2）：
//   · **只 INSERT 不 UPDATE**：每次保存新建一条；旧版本只走软删（is_deleted + delete_at）。
//   · **version 在服务端算**（同 sandbox_id 内 max(version)+1），前端不得传。
//   · **sandbox_id 服务端生成**（复制 / 首次保存），前端不得传（防越权与撞号）。
//   · **快照服务端算**（不接受前端传入，可伪造）。
//   · **幂等单源**：findPriorResult 查重 + writeAudit 登记，两处键都走 common.idempotency.shopKey()。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, genId } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;
const { calcSandbox, calcSandboxReverse, ENGINE_VERSION } = require('./service');   // 🔴 内联引擎副本
const { paramToClean } = require('./paramMap');
const { validateInput } = require('./validate');

// 惰性清理（§3.4）：同 sandbox_id 中 delete_at 超期（>30 天）的旧版本物理删。零定时器。
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

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
  const clientRequestId = v.input.client_request_id;

  // ===== 3. 幂等预检（重放形态 · 单源 shopKey）=====
  if (clientRequestId) {
    const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
    if (prior) return ok(prior); // 重复调用直接返回首次结果，不重复落库
  }

  const da = makeAdapter(db);
  const plan = v.plan;
  const now = nowUtc();

  // ===== 4. 分支 =====
  let sandboxId = '';
  let version = 1;

  if (plan._delete === true) {
    // ===== 4a. 软删：该 sandbox_id 全部版本 is_deleted=true =====
    sandboxId = plan.sandbox_id;
    const n = await softDeleteVersions(da, shopId, sandboxId, userId);
    await cleanStale(da, shopId, sandboxId);
    const out = { plan_id: sandboxId, sandbox_id: sandboxId, version: 0, deleted: true, versions: n };
    if (clientRequestId) {
      await writeAudit(db, { action: 'SAVE_PLAN', operator_type: 'user', operator_id: userId, shop_id: shopId,
        after_data: out, idempotency_key: common.idempotency.shopKey(shopId, clientRequestId) });
    }
    return ok(out);
  }

  if (plan.is_copy === true) {
    // ===== 4b. 复制：新 sandbox_id（服务端生成），version = 1 =====
    sandboxId = genId('sb_');
    version = 1;
  } else if (plan.sandbox_id) {
    // ===== 4c. 新版本：version = max(version)+1；同 sandbox_id 旧版本软删 =====
    sandboxId = plan.sandbox_id;
    version = (await maxVersion(da, shopId, sandboxId)) + 1;
    await softDeleteVersions(da, shopId, sandboxId, userId);
  } else {
    // ===== 4d. 首次保存：新 sandbox_id，version = 1 =====
    sandboxId = genId('sb_');
    version = 1;
  }

  // ===== 5. 快照：**服务端算**，不接受前端传入 =====
  const clean = paramToClean(plan.param_json);
  const snapshot = calcSandbox(clean);
  if (clean.mode === 'reverse') {
    snapshot.reverse = calcSandboxReverse(clean);
  }

  // ===== 6. 写库：db.add()（绝不 update）=====
  const record = {
    shop_id: shopId,
    sandbox_id: sandboxId,
    version,
    sandbox_type: plan.sandbox_type,
    name: plan.name,
    param_json: plan.param_json,
    result_snapshot_json: snapshot,
    engine_version: ENGINE_VERSION,
    updated_at: now,
  };
  await da.insert('shop_sandbox', record);

  // ===== 6.5 惰性清理（顺手做）=====
  await cleanStale(da, shopId, sandboxId);

  // ===== 7. 审计登记（与第 3 步同源键）=====
  const out = { plan_id: sandboxId, sandbox_id: sandboxId, version };
  if (clientRequestId) {
    await writeAudit(db, { action: 'SAVE_PLAN', operator_type: 'user', operator_id: userId, shop_id: shopId,
      after_data: out, idempotency_key: common.idempotency.shopKey(shopId, clientRequestId) });
  }

  // ===== 8. 返回 =====
  return ok(out);
};

// ===== 以下为 main 用到的辅助函数（置于 main 之后：保证幂等预检在文本序上早于任何业务写）=====
// 惰性清理（§3.4）：同 sandbox_id 中 delete_at 超期（>30 天）的旧版本物理删。零定时器。
async function cleanStale(da, shopId, sandboxId) {
  try {
    if (!sandboxId) return;
    const res = await da.listIncludingDeleted('shop_sandbox', { shop_id: shopId, sandbox_id: sandboxId });
    const rows = (res && res.data) || [];
    const now = nowUtc();
    for (const r of rows) {
      if (r.is_deleted && r.delete_at && (now - r.delete_at) > STALE_MS) {
        try { await db.collection('shop_sandbox').doc(r._id || r.id).remove(); } catch (e) { /* 单项失败不阻断 */ }
      }
    }
  } catch (e) { /* 惰性清理不阻断主流程 */ }
}

// 同 sandbox_id 内最大 version（含软删版本：版本号递增不因软删回退）
async function maxVersion(da, shopId, sandboxId) {
  let m = 0;
  const res = await da.listIncludingDeleted('shop_sandbox', { shop_id: shopId, sandbox_id: sandboxId });
  const rows = (res && res.data) || [];
  for (const r of rows) {
    const v = Number(r.version) || 0;
    if (v > m) m = v;
  }
  return m;
}

// 软删同 sandbox_id 的全部版本（§3.3 分支 4a / 4c 的旧版本软删）
async function softDeleteVersions(da, shopId, sandboxId, userId) {
  const res = await da.listIncludingDeleted('shop_sandbox', { shop_id: shopId, sandbox_id: sandboxId });
  const rows = (res && res.data) || [];
  for (const r of rows) {
    if (r.is_deleted) continue;
    await da.softDelete('shop_sandbox', r._id || r.id, userId);
  }
  return rows.length;
}