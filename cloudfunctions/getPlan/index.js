// cloudfunctions/getPlan/index.js —— 批次 M2v1.2 · 多方案存储（列表 / 详情 · 读）
//
// ⚠️ 只读，**不重算、不写快照**：列表卡片用 `result_snapshot_json` 快速渲染，
//    点进详情 / 并排对比时才由前端用 `param_json` 另调 calcSandbox 实时重算（快照只作展示缓存）。
// ⚠️ 列表查询必须有**显式上限**（单源 common/dataAdapter.js::LIST_LIMIT）；「要全部行分组取最新」
//    属 listAll 场景，不得依赖聚合绕过上限。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { validateInput } = require('./validate');

const STALE_MS = 30 * 24 * 60 * 60 * 1000;           // 惰性清理：delete_at 超期 >30 天的旧版本物理删

async function cleanStale(da, shopId, sandboxIds) {
  try {
    for (const sid of (sandboxIds || [])) {
      if (!sid) continue;
      const res = await da.listIncludingDeleted('shop_sandbox', { shop_id: shopId, sandbox_id: sid });
      const rows = (res && res.data) || [];
      const now = nowUtc();
      for (const r of rows) {
        if (r.is_deleted && r.delete_at && (now - r.delete_at) > STALE_MS) {
          try { await db.collection('shop_sandbox').doc(r._id || r.id).remove(); } catch (e) { /* 不阻断 */ }
        }
      }
    }
  } catch (e) { /* 惰性清理不阻断主流程 */ }
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权（同 savePlan）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);
  const da = makeAdapter(db);

  const shape = (r) => ({
    sandbox_id: r.sandbox_id,
    version: r.version,
    name: r.name,
    sandbox_type: r.sandbox_type,
    param_json: r.param_json,
    result_snapshot_json: r.result_snapshot_json || null,
    engine_version: r.engine_version || '',
    updated_at: r.updated_at,
  });

  // ===== 3a. 列表（缺 plan_id）=====
  if (!v.plan_id) {
    const all = await da.listAll('shop_sandbox', { shop_id: shopId });
    // 按 sandbox_id 分组，取各 sandbox_id 的最大（最新）版本
    const bySb = new Map();
    for (const r of (all.data || [])) {
      const sid = r.sandbox_id;
      if (!sid) continue;
      const cur = bySb.get(sid);
      if (!cur || (r.version || 0) > (cur.version || 0)) bySb.set(sid, r);
    }
    const list = [...bySb.values()]
      .map(shape)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    await cleanStale(da, shopId, [...bySb.keys()]);
    return ok({ list });
  }

  // ===== 3b. 详情（shop_id + sandbox_id + version 取单条）=====
  const where = { shop_id: shopId, sandbox_id: v.plan_id };
  if (v.version != null) where.version = v.version;
  const res = await da.list('shop_sandbox', where);
  const rows = (res && res.data) || [];
  if (rows.length === 0) {
    return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `方案 ${v.plan_id} ${v.version != null ? 'v' + v.version : ''} 不存在`);
  }
  // 匹配指定 version；未给 version 时取最大 version（最新）
  let hit = rows[0];
  if (v.version == null) {
    for (const r of rows) if ((r.version || 0) > (hit.version || 0)) hit = r;
  } else {
    hit = rows.filter((r) => r.version === v.version)[0] || null;
    if (!hit) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `方案 ${v.plan_id} v${v.version} 不存在`);
  }
  await cleanStale(da, shopId, [hit.sandbox_id]);
  return ok({ list: [shape(hit)] });
};