// cloudfunctions/saveAsset/index.js —— 批次 4 · M1 摊销资产新增/编辑（Controller 层 · 写）
//
// 鉴权 → 校验 → DataAdapter 软删过滤读目标（编辑时不可复活软删）→ INSERT 或 UPDATE shop_amortize。
// 当月摊销合计不在此算（由 getAmortSchedule / saveLedger 内嵌 calcAmortize 引擎计算）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, genId } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
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
  const now = nowUtc();
  const a = v.asset;

  // ===== 编辑：目标必须存在且未软删 =====
  if (a.asset_id) {
    const exist = await da.get('shop_amortize', a.asset_id);
    if (!exist) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `资产 ${a.asset_id} 不存在或已软删`);
    await db.collection('shop_amortize').doc(exist._id || a.asset_id).update({
      data: {
        name: a.name, value_fen: a.value_fen, start_month: a.start_month,
        total_months: a.total_months, terminate_month: a.terminate_month, updated_at: now, is_deleted: false,
      },
    });
    return ok({ shop_id: shopId, asset_id: a.asset_id, client_request_id: v.input.client_request_id || '' });
  }

  // ===== 新增 =====
  const assetId = genId('amort_');
  await da.insert('shop_amortize', {
    asset_id: assetId, id: assetId, shop_id: shopId,
    name: a.name, value_fen: a.value_fen, start_month: a.start_month,
    total_months: a.total_months, terminate_month: a.terminate_month,
  });
  return ok({ shop_id: shopId, asset_id: assetId, client_request_id: v.input.client_request_id || '' });
};