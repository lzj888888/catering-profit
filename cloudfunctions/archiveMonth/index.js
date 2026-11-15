// cloudfunctions/archiveMonth/index.js —— 批次 4 · M1 结账归档（Controller 层 · 写）
//
// 作用：手动「结账归档」某月（is_archive=true，默认只读）；或取消归档（archive=false）。
//   · 主触发：用户确认某月数据无误后主动归档。
//   · 归档月在下一次 saveLedger 时被守卫（ARCHIVED_LOCKED），7 天宽限补录由 saveLedger 的
//     archive_override 处理；本函数只负责翻转 is_archive 标记。
//
// ⚠️ 幂等：同一 shop_id + month + client_request_id 重复调用返回同结果（归档标记天然幂等）。
// 🔴 R741（三司会诊 D-3）：本函数**绝不创建账目**。该月没有 shop_monthly_account 行 ⇒
//   RESOURCE_NOT_FOUND。原实现在缺账时会 insert 一条全 0 账再标归档 —— 等于替用户生成一笔
//   「利润 0」的零申报，且此后永久只读。归档的语义是「确认一个已存在的数」，不是「生成一个数」。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;   // R741：genId 随「建空账」一起退役
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

  // ===== 3. 定位该月账 =====
  const exRes = await da.list('shop_monthly_account', { shop_id: shopId, month: v.month });
  const acct = (exRes && exRes.data && exRes.data[0]) || null;

  // 🔴 R741（三司会诊裁决 D-3）：该月没有账 ⇒ **fail-closed，不建空账**。
  //   原实现会 insert 一条全 0 账再标归档：用户对准一个从没录过数的月份点「归档」，
  //   系统就凭空生成一处「利润 0」的封账记录，且此后被 ARCHIVED_LOCKED 永久锁死。
  //   会计上这是造了一笔零申报 —— 比"少一个功能"危险得多。
  //   取消归档（v.archive=false）同理：没有账就没有"解开"这回事，照实报找不到。
  if (!acct) {
    return fail(ERROR_CODES.RESOURCE_NOT_FOUND, v.archive
      ? '该月还没有任何账目记录，请先录入再归档'
      : '该月还没有任何账目记录，无需取消归档');
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