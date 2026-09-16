// cloudfunctions/checkQuota/index.js —— 批次 5 · 免费配额查询（Controller 层 · 读）
//
// 鉴权中间件（批次 0）→ 校验 → DataAdapter 计数该 user 活跃店铺/成本卡（软删自动过滤）
//   → Service 判定是否触及免费额度/硬上限。
// ⚠️ 计数维度 = user_id（跨店共享）；shop_id 仅用于鉴权归属，不参与计数范围。
// ⚠️ M2 永久全免费，不提供 m2 配额查询（永不弹窗）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { checkQuota } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  if (typeof shopId !== 'string' || !shopId) return fail(ERROR_CODES.INVALID_PARAM, 'shop_id 必须是非空字符串');

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. DataAdapter 计数（user_id 维度，软删自动排除）=====
  const da = makeAdapter(db);
  let activeCount = 0;
  if (v.scope === 'shop') {
    const res = await da.list('shop', { user_id: userId });
    activeCount = ((res && res.data) || []).length;
  } else {
    // M3 成本卡按 card_code 去重计数（版本不计）；DataAdapter 已过滤 is_deleted=false
    const res = await da.list('shop_cost_card', { shop_id: shopId });
    const codes = new Set();
    for (const c of ((res && res.data) || [])) if (c.card_code) codes.add(c.card_code);
    activeCount = codes.size;
  }

  // ===== 4. Service 判定 =====
  const r = checkQuota({ userId, scope: v.scope, activeCount });

  return ok({
    user_id: r.user_id,
    scope: r.scope,
    used: r.used,
    free_limit: r.free_limit,
    hard_limit: r.hard_limit,
    hit_free_limit: r.hit_free_limit,
    hit_hard_limit: r.hit_hard_limit,
    client_request_id: v.input.client_request_id || '',
  });
};