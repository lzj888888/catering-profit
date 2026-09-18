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

  // ===== 幂等预检（契约 §10：saveAsset = user+shop+幂等）=====
  // 🔒 R73：新增分支每次 genId('amort_') 后 INSERT ⇒ 天然**非**幂等；重复提交（网络重试 / 双击）
  //   会重复记一笔资产 ⇒ saveLedger 读 shop_amortize 台账算当月摊销时**翻倍** ⇒ M1 利润算错。
  //   命中即返回首次结果、不再落库。空 client_request_id ⇒ 单源返回 null ⇒ 不做约束（守卫已登记在案）。
  const clientRequestId = v.input.client_request_id;
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  let out;
  if (a.asset_id) {
    // ===== 编辑：目标必须存在且未软删 =====
    const exist = await da.get('shop_amortize', a.asset_id);
    if (!exist) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `资产 ${a.asset_id} 不存在或已软删`);
    // H1：分组字段只在「有值」时覆盖（编辑单笔/报废单笔不该把多笔资产拆散）；独立资产保持 '' 不写。
    const patch = {
      name: a.name, value_fen: a.value_fen, start_month: a.start_month,
      total_months: a.total_months, terminate_month: a.terminate_month,
      updated_at: now, is_deleted: false,
    };
    if (a.group_id) { patch.group_id = a.group_id; patch.batch_seq = a.batch_seq; }
    await db.collection('shop_amortize').doc(exist._id || a.asset_id).update({ data: patch });
    out = { shop_id: shopId, asset_id: a.asset_id, client_request_id: clientRequestId || '' };
  } else {
    // ===== 新增 =====
    const assetId = genId('amort_');
    await da.insert('shop_amortize', {
      asset_id: assetId, id: assetId, shop_id: shopId,
      name: a.name, value_fen: a.value_fen, start_month: a.start_month,
      total_months: a.total_months, terminate_month: a.terminate_month,
      // H1（批次 8c）：多次采购分组。「追加采购」= 新行 + group_id 指向首笔、batch_seq = 组内序号；
      //   独立资产 group_id=''、batch_seq=1（前端用自身 asset_id 当组键，故老数据行为不变）。
      group_id: a.group_id, batch_seq: a.batch_seq,
    });
    out = { shop_id: shopId, asset_id: assetId, client_request_id: clientRequestId || '' };
  }

  // ===== 幂等登记（键与上面查重键**同源**，一律走单源 shopKey）=====
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'SAVE_ASSET',
        operator_type: 'user',
        operator_id: userId,
        shop_id: shopId,
        after_data: out,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }
  return ok(out);
};