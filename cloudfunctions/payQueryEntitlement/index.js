// cloudfunctions/payQueryEntitlement/index.js —— 批次 5 · 查询当前权益（Controller 层 · 读）
//
// ⚠️ 权限判定解耦铁律：只返回 expire_at 相关字段，**不返回 plan_id**（前端不读 plan_id）。
// 无记录 → expire_at:0, is_active:false（不报 RESOURCE_NOT_FOUND，前端回落免费档）。
// 有效期以服务端 UTC 为准（前端只负责展示转北京时间）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { entitlementToOut } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. 读权益（user_id 维度，主体=user_id，非 shop）=====
  // ⚠️ shop_entitlement 结构只有 user_id/expire_at/source/updated_at（无 is_deleted 字段，
  //    批次 0 resolveAuth 建档即如此），不能用 dataAdapter.list（会注入 is_deleted=false 恒空），
  //    直接按 user_id 查第一条。
  let ent = null;
  try {
    const res = await db.collection('shop_entitlement').where({ user_id: auth.user.id }).limit(1).get();
    ent = (res && res.data && res.data[0]) || null;
  } catch (e) { ent = null; }

  const out = entitlementToOut(ent, nowUtc());
  return ok({
    shop_id: v.shop_id,
    user_id: auth.user.id,
    expire_at: out.expire_at,
    is_active: out.is_active,
    source: out.source,
    days_left: out.days_left,
    client_request_id: v.input.client_request_id || '',
  });
};