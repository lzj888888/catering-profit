// cloudfunctions/getSalesBills/index.js —— 已导入账单列表（读侧 · R252）
//
// 职责：鉴权 → 校验 → 取 `external_sales_daily`（含软删，供"已清除"追溯）→ 调 service 聚合 → 返回。
// 🔴 本函数**只读**：不写任何集合（不含 dataAdapter.insert / softDelete 调用）。
// 🔴 不加付费墙：看自己导过的数据属基础能力（与 getCostCard 同类，非付费域）。
// 🔴 日期过滤在**读完之后**做（不在 where 里做）：因为聚合粒度是 (platform, biz_date)，
//   而 `biz_date` 存在行上；用量小（单店流水）时先取全再筛更简单可靠，
//   且 `listAll` 的 `truncated` 语义能如实上报（避免 where 组合写错导致静默空态）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;

const { buildBillList } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权 =====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  // ===== 3. 取数（含软删 —— 供"已清除"追溯；listIncludingDeleted 不注入 is_deleted 过滤）=====
  const da = makeAdapter(db);
  // 🔴 listIncludingDeleted 单页上限 LIST_LIMIT(1000)，且**不带 skip 翻页**。
  //   本场景是"看导过什么"（账单条数级），单店正常量级 << 1000；
  //   但仍如实上报 `truncated`（命中上限即告知"可能不全"，绝不静默）。
  const raw = await da.listIncludingDeleted('external_sales_daily', { shop_id: shopId });
  const rows = (raw && raw.data) || [];
  const truncated = rows.length >= common.dataAdapter.LIST_LIMIT;

  // ===== 4. 聚合（纯函数）=====
  const { list, summary, unknownCount } = buildBillList(rows, { includeCleared: v.include_cleared });

  // ===== 5. 过滤（日期区间 + 平台）=====
  const filtered = list.filter((x) => {
    if (v.biz_date_from && x.biz_date < v.biz_date_from) return false;
    if (v.biz_date_to && x.biz_date > v.biz_date_to) return false;
    if (v.platform && x.platform !== v.platform) return false;
    return true;
  });
  const active = filtered.filter((x) => !x.cleared);
  const filteredSummary = {
    active_bills: active.length,
    cleared_bills: filtered.length - active.length,
    active_rows: active.reduce((s, x) => s + x.row_count, 0),
    active_qty: active.reduce((s, x) => s + x.qty, 0),
    active_amount_fen: active.reduce((s, x) => s + x.amount_fen, 0),
    platforms: [...new Set(active.map((x) => x.platform))].sort(),
    all_platforms: summary.platforms,
    unknown_rows: unknownCount,
  };

  return ok({
    shop_id: shopId,
    list: filtered,
    summary: filteredSummary,
    truncated,
    client_request_id: v.input.client_request_id,
  });
};
