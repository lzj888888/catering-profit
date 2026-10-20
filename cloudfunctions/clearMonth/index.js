// cloudfunctions/clearMonth/index.js —— M1 · 清空某月（软删，可恢复）
//
// 为什么需要（R376）：
//   老板可能误建了一个月（或试算了一版不想留），需要把某个月"退回未建档"状态。
//   但**不能硬删**：`shop_monthly_account` 有唯一索引 `(shop_id, month)`，
//   硬删后再录同月会与残留行冲突；而且本仓纪律是"业务数据不硬删，软删优先"。
//   ⇒ 软删（is_deleted=true）：列表/详情一律看不到（dataAdapter 铁律注入 is_deleted=false），
//     重新录入时由 saveLedger **复活**同一行（保住 account_id 与唯一索引）。
//
// 不可清空的情形：
//   · 该月不存在            ⇒ ok({cleared:false})，幂等
//   · 该月已归档 is_archive  ⇒ ARCHIVED_LOCKED（先取消归档）
//
// 幂等：软删是覆盖式赋终值 ⇒ 重复调用终态相同；不新增任何实体。
//   已登记进 `tools/check_idempotency.js::EXEMPT_WRITE`（理由同上）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
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

  const da = makeAdapter(db);
  const now = nowUtc();

  // ===== 3. 定位该月（软删行天然查不到 ⇒ 重复调用返回 cleared:false）=====
  const exRes = await da.list('shop_monthly_account', { shop_id: shopId, month: v.month });
  const acct = (exRes && exRes.data && exRes.data[0]) || null;
  if (!acct) {
    return ok({ shop_id: shopId, month: v.month, cleared: false, reason: 'not_found' });
  }

  // ===== 4. 归档月不可清空 =====
  if (acct.is_archive) {
    return fail(ERROR_CODES.ARCHIVED_LOCKED, '已归档的月份不能清空，请先取消归档');
  }

  // ===== 5. 软删（保留原行，供 saveLedger 复活与客服恢复）=====
  await db.collection('shop_monthly_account').doc(acct._id || acct.id).update({
    data: { is_deleted: true, deleted_at: now, updated_at: now, deleted_by: userId },
  });

  // ===== 6. 留痕（谁、哪个月、清掉的是哪一版汇总）=====
  await common.audit.writeAudit(db, {
    action: 'clearMonth',
    operator_id: userId,
    shop_id: shopId,
    before_data: {
      month: v.month,
      account_id: acct.account_id || '',
      income_total_fen: acct.income_total_fen || 0,
      expense_total_fen: acct.expense_total_fen || 0,
      is_archive: !!acct.is_archive,
    },
    after_data: { is_deleted: true },
    remark: 'M1 清空某月（软删，可在重新录入时复活同一行）',
  });

  return ok({ shop_id: shopId, month: v.month, cleared: true, client_request_id: v.input.client_request_id || '' });
};
