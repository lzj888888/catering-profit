// cloudfunctions/calcSandbox/index.js —— 批次 4 · M2 开店测算（Controller 层 · 纯计算锚点）
//
// 分层：鉴权中间件（批次 0）→ 校验/清洗 → Service 纯引擎 → 返回（只算不写）。
// ⚠️ 前端**不做**任何公式，只展示本函数返回的分整数；展示值以此为准（防篡改由 Service 重算校验兜底）。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { calcSandbox } = require('./service');
const { validateInput } = require('./validate');

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

  // ===== 3. Service 纯计算 =====
  const r = calcSandbox(v.clean);

  return ok({
    shop_id: shopId,
    client_request_id: v.input.client_request_id || '',
    ...r,
  });
};