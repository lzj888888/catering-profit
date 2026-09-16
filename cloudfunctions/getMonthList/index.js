// cloudfunctions/getMonthList/index.js —— 批次 4 · M1 历史月份列表（Controller 层 · 读）
//
// 返回该店所有已建档月份 + 归档态（is_archive）。前端据此做历史切换 / 归档禁改 / 「待归档」徽标。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  const da = makeAdapter(db);
  const res = await da.list('shop_monthly_account', { shop_id: shopId });
  const rows = (res && res.data) || [];

  // 按 month 去重（同一月理论上一条，落库为 upsert）
  const byMonth = new Map();
  for (const r of rows) if (r.month && !byMonth.has(r.month)) byMonth.set(r.month, r);

  const list = Array.from(byMonth.values())
    .map((r) => ({ month: r.month, is_archive: !!r.is_archive }))
    .sort((a, b) => (a.month < b.month ? 1 : -1)); // 倒序（新在前）

  return ok({ shop_id: shopId, list, client_request_id: v.input.client_request_id || '' });
};