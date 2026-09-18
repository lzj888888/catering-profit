// cloudfunctions/getAmortSchedule/index.js —— 批次 4 · M1 摊销台账 + 当月摊销（Controller 层 · 读）
//
// 鉴权 → 校验 → DataAdapter 读该店活跃摊销资产（软删自动排除）→ 内嵌 calcAmortize 引擎算当月摊销。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { amortizeForMonth } = require('./service');
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
  const res = await da.list('shop_amortize', { shop_id: shopId });
  const assets = ((res && res.data) || []).map((a) => ({
    asset_id: a.asset_id || a.id, name: a.name || '',
    total_value: a.value_fen != null ? a.value_fen : a.total_value,
    start_month: a.start_month, total_months: a.total_months,
    terminate_month: a.terminate_month || '',
    // H1（批次 8c）：多次采购分组字段透传（老数据无此字段 → '' / 1，前端按独立资产处理）
    group_id: a.group_id || '', batch_seq: a.batch_seq || 1,
  }));
  const sched = amortizeForMonth(assets, v.month);

  return ok({
    shop_id: shopId, month: v.month,
    assets: assets.map((a) => ({
      asset_id: a.asset_id, name: a.name, value_fen: a.total_value,
      start_month: a.start_month, total_months: a.total_months, terminate_month: a.terminate_month,
      group_id: a.group_id, batch_seq: a.batch_seq,
    })),
    total_amount_fen: sched.total_amount_fen,
    details: sched.details,
    client_request_id: v.input.client_request_id || '',
  });
};