// cloudfunctions/checkQuota/index.js —— 批次 5 / M3.22 批次 A1 · 免费配额查询（Controller 层 · 读）
//
// 鉴权中间件（批次 0）→ 校验 → 读 feature_permissions.plan_free.limits（唯一真相源）→
//   DataAdapter 计数活跃店铺/成本卡（软删自动过滤）→ Service 判定。
// ⚠️ 计数维度（M3.22#3 实测口径修正）：店铺维度按 user_id（免费档仅 1 账套）；成本卡维度按 shop_id
//   （shop_cost_card 无 user_id 字段，只有 created_by；跨店维度需 created_by 索引，本批次不引入）。
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

  // ===== 2.5. 读免费配额配置（唯一真相源 feature_permissions.plan_free.limits）=====
  const fpRes = await db.collection('feature_permissions').where({ plan_id: 'plan_free' }).limit(1).get();
  const fp = fpRes && fpRes.data && fpRes.data[0];
  const limits = fp && fp.limits;
  if (!limits || typeof limits !== 'object') {
    return fail(ERROR_CODES.SYSTEM_ERROR, '配额配置缺失（plan_id=plan_free）');
  }

  // ===== 3. DataAdapter 计数（软删自动排除）=====
  const da = makeAdapter(db);
  let activeCount = 0;
  if (v.scope === 'shop') {
    const res = await da.list('shop', { user_id: userId });
    activeCount = ((res && res.data) || []).length;
  } else {
    // M3 成本卡按 card_code 去重计数（版本不计）；DataAdapter 已过滤 is_deleted=false
    // M3.28（批次 Q2）：额度计的是**可算数** —— 只统计算过成本的卡，草稿（calc_status='draft'）不占额度。
    //   ⚠️ 存量兼容铁律：本批次上线前落库的行**没有 calc_status 字段**，故判定必须写 `!== 'draft'`（缺字段视为已算），
    //      绝不能写 `=== 'calculated'` —— 那样会把全部存量排除在计数外 ⇒ 免费额度形同失效（放大泄漏，不是收紧）。
    const res = await da.list('shop_cost_card', { shop_id: shopId });
    const codes = new Set();
    for (const c of ((res && res.data) || [])) {
      if (!c.card_code) continue;
      if (c.calc_status === 'draft') continue; // 草稿：仅建档/保存，未出成本 ⇒ 不占额度
      codes.add(c.card_code);
    }
    activeCount = codes.size;
  }

  // ===== 4. Service 判定（limits 注入）=====
  let r;
  try {
    r = checkQuota({ userId, scope: v.scope, activeCount, limits });
  } catch (e) {
    if (e && e.code === ERROR_CODES.SYSTEM_ERROR) return fail(e.code, e.message);
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '配额判定失败');
  }

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