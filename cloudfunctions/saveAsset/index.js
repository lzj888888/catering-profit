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

// round107：一次性投入（mode='lump'）是挂在**某一个月**上的 ⇒ 那个月归档后不许再增删改。
//   与 saveLedger 用**同一把锁**（只读 + ARCHIVED_LOCKED），否则会出现「账锁了、但钱从台账被挪走」的缝。
//   ⚠️ 只对 mode='lump' 生效：摊销资产跨月管理，其归档约束是**既有缺口**，本轮不扩大改动面。
async function archiveLocked(da, shopId, month) {
  if (!month) return null;
  const res = await da.list('shop_monthly_account', { shop_id: shopId, month });
  const row = (res && res.data && res.data[0]) || null;
  if (row && row.is_archive) {
    return fail(ERROR_CODES.ARCHIVED_LOCKED, '该月已归档为只读，不能改动挂在它上面的一次性投入');
  }
  return null;
}

// round109：**摊销资产**的归档锁（随「放开摊销删除键」一并补上）。
//   为什么不能沿用上面那把（只看 start_month 那一个月）：
//     摊销资产是**跨月逐月生效**的 —— 它从 start_month 起，每个月都会产生一笔摊销。
//     所以「删它 / 改它」在语义上等于「改动它覆盖到的每一个月的账」。
//   判据：该店**已归档月里存在 month >= start_month** 的（YYYY-MM 字典序即时间序）⇒ 拒。
//   ⚠️ 为什么不只看 start_month：归档不强制按时间顺序做（可以先归档 10 月、再回头归档 9 月），
//      只看 start_month 会漏掉「start_month 未归档、但它后面某月已归档」这条例外路径。
//   ⚠️ 数据量：一个店一个月最多一条月度账，全量取回在 JS 里过滤即可（不做区间查询是为了不扩 dataAdapter 的接口面）。
//   ⚠️ 本轮只给「删除」加锁；「编辑 / 新增摊销」的同类缺口**仍然存在**（见 §10 契约与 NOTE 的记录），
//      不在这轮扩大改动面 —— 免得把未经前端预告的拒绝行为引进编辑路径。
async function amortArchiveLocked(da, shopId, startMonth) {
  if (!startMonth) return null;
  const res = await da.list('shop_monthly_account', { shop_id: shopId });
  const rows = (res && res.data) || [];
  const hit = rows.find((r) => r.is_archive && String(r.month || '') >= String(startMonth));
  if (!hit) return null;
  return fail(ERROR_CODES.ARCHIVED_LOCKED,
    `该资产从 ${startMonth} 起逐月摊销，而 ${hit.month} 已归档为只读；删掉它会让已封账月份的数字变化，请改用「提前报废」保留痕迹`);
}

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
  if (v.remove) {
    // ===== round107 删除：软删（不可复活）=====
    const exist = await da.get('shop_amortize', v.asset.asset_id);
    if (!exist) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `资产 ${v.asset.asset_id} 不存在或已软删`);
    if ((exist.mode || 'amort') === 'lump') {
      const locked = await archiveLocked(da, shopId, exist.start_month);
      if (locked) return locked;
    } else {
      // round109：摊销资产 —— 跨月生效 ⇒ 用区间锁（任一归档月 >= start_month 即拒）
      const locked = await amortArchiveLocked(da, shopId, exist.start_month);
      if (locked) return locked;
    }
    await db.collection('shop_amortize').doc(exist._id || v.asset.asset_id)
      .update({ data: { is_deleted: true, updated_at: now } });
    out = { shop_id: shopId, asset_id: v.asset.asset_id, deleted: true, client_request_id: clientRequestId || '' };
  } else if (a.asset_id) {
    // ===== 编辑：目标必须存在且未软删 =====
    const exist = await da.get('shop_amortize', a.asset_id);
    if (!exist) return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `资产 ${a.asset_id} 不存在或已软删`);
    // H1：分组字段只在「有值」时覆盖（编辑单笔/报废单笔不该把多笔资产拆散）；独立资产保持 '' 不写。
    const patch = {
      name: a.name, value_fen: a.value_fen, start_month: a.start_month,
      total_months: a.total_months, terminate_month: a.terminate_month,
      mode: a.mode,                      // round107：处置方式（'amort' / 'lump'）
      updated_at: now, is_deleted: false,
    };
    if (a.group_id) { patch.group_id = a.group_id; patch.batch_seq = a.batch_seq; }
    await db.collection('shop_amortize').doc(exist._id || a.asset_id).update({ data: patch });
    out = { shop_id: shopId, asset_id: a.asset_id, client_request_id: clientRequestId || '' };
  } else {
    // ===== 新增 =====
    // round107：一次性投入挂在 start_month 那个月 ⇒ 归档月不许新记
    if (a.mode === 'lump') {
      const locked = await archiveLocked(da, shopId, a.start_month);
      if (locked) return locked;
    }
    const assetId = genId('amort_');
    await da.insert('shop_amortize', {
      asset_id: assetId, id: assetId, shop_id: shopId,
      name: a.name, value_fen: a.value_fen, start_month: a.start_month,
      total_months: a.total_months, terminate_month: a.terminate_month,
      // H1（批次 8c）：多次采购分组。「追加采购」= 新行 + group_id 指向首笔、batch_seq = 组内序号；
      //   独立资产 group_id=''、batch_seq=1（前端用自身 asset_id 当组键，故老数据行为不变）。
      group_id: a.group_id, batch_seq: a.batch_seq,
      // round107：处置方式。'amort' = 分期摊销（老行为）；'lump' = 一次算清（只影响 start_month 当月）
      mode: a.mode,
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