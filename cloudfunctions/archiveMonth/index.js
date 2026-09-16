// cloudfunctions/archiveMonth/index.js —— 批次 4 · M1 结账归档（Controller 层 · 写）
//
// 作用：手动「结账归档」某月（is_archive=true，默认只读）；或取消归档（archive=false）。
//   · 主触发：用户确认某月数据无误后主动归档。
//   · 归档月在下一次 saveLedger 时被守卫（ARCHIVED_LOCKED），7 天宽限补录由 saveLedger 的
//     archive_override 处理；本函数只负责翻转 is_archive 标记。
//
// ⚠️ 幂等：同一 shop_id + month + client_request_id 重复调用返回同结果（归档标记天然幂等）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, genId } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { validateInput } = require('./validate');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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

  const da = makeAdapter(db);
  const now = nowUtc();

  // ===== 3. 定位该月账（不存在则建一条空账再归档）=====
  const exRes = await da.list('shop_monthly_account', { shop_id: shopId, month: v.month });
  let acct = (exRes && exRes.data && exRes.data[0]) || null;
  if (!acct) {
    await da.insert('shop_monthly_account', {
      account_id: genId('acc_'),
      shop_id: shopId,
      month: v.month,
      income_items: [], expense_items: [],
      direct_consume_fen: 0, inventory: null, amortize_fen: 0,
      income_total_fen: 0, expense_total_fen: 0, material_cost_fen: 0,
      real_consume_fen: 0, gross_profit_fen: 0, gross_margin_pct: 0,
      operation_ref_profit_fen: 0, total_factor_real_profit_fen: 0,
      profit_diff_fen: 0, switch_used: {},
      is_archive: v.archive, archived_at: v.archive ? now : 0,
    });
    return ok({ shop_id: shopId, month: v.month, is_archive: v.archive, client_request_id: v.input.client_request_id || '' });
  }

  // ===== 4. 翻转归档标记（只 UPDATE 归档标记字段）=====
  const docId = acct._id || acct.id;
  await db.collection('shop_monthly_account').doc(docId).update({
    data: { is_archive: v.archive, archived_at: v.archive ? now : (acct.archived_at || 0), updated_at: now },
  });

  return ok({ shop_id: shopId, month: v.month, is_archive: v.archive, client_request_id: v.input.client_request_id || '' });
};

// 供 validate/module 复用（避免在 controller 引用未导出的 MONTH_RE 造成混乱）
exports.MONTH_RE = MONTH_RE;