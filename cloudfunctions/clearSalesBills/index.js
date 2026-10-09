// cloudfunctions/clearSalesBills/index.js —— 清除已导入账单（写侧 · R252）
//
// 职责：鉴权 → 校验 → 取该店流水 → 匹配目标 → **软删**（is_deleted:true + delete_at + delete_by）→ 审计 → 返回。
//
// 🔴 三条铁律（与本仓既有纪律一致）：
//   ① **绝不物理删除** —— 走 `is_deleted:true` 软删（读侧 `dataAdapter` 强制 `is_deleted:false`，
//      复盘页下次读取自然不含 ⇒ 无需触发任何重算）。数据可追溯，清除是**可逆的**（改回 false 即可）。
//   ② **幂等（重放形态）** —— `findPriorResult` 预检**在函数头部、早于任何业务写**；
//      命中即返回首次结果。契约行标「+幂等」⇒ 代码必须有 `findPriorResult` + `writeAudit`。
//   ③ **显式上限** —— `MAX_CLEAR_ROWS`，超出即 fail（云函数有时限，无上限的循环会超时且**半途而废**
//      ⇒ 部分删部分没删比不删更坏）。用户按上限分批即可。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { makeAdapter } = common.dataAdapter;

const { matchTargets } = require('./service');
const { validateInput } = require('./validate');

// 🔴 单次清除行数上限：5000（单店单平台单日的菜品行量级约 10²，5000 足够清掉数月的账单级数据）。
const MAX_CLEAR_ROWS = 5000;

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
  const clientRequestId = v.input.client_request_id;

  // ===== 3. 幂等（重放形态）：命中即返回首次结果，不重复写入 =====
  //   🔴 必须在**任何业务写之前**（含软删）—— 否则重放会二次写审计、二次改 delete_at。
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  // ===== 4. 取该店**未清除**的流水（软删的不再重复处理）=====
  const da = makeAdapter(db);
  const res = await da.listAll('external_sales_daily', { shop_id: shopId });
  const rows = (res && res.data) || [];

  // ===== 5. 匹配目标（纯函数）=====
  const { hits } = matchTargets(rows, v.targets, { all: v.all });

  if (hits.length === 0) {
    // 无事可做：**如实返回 0**，不报错（幂等友好：重复清除同一目标不应报错）
    const out0 = {
      shop_id: shopId,
      cleared_rows: 0,
      cleared_bills: 0,
      targets: v.all ? 'all' : v.targets,
      client_request_id: clientRequestId || '',
    };
    if (clientRequestId) {
      try {
        await common.audit.writeAudit(db, {
          action: 'CLEAR_SALES_BILL', operator_type: 'user', operator_id: userId, shop_id: shopId,
          before_data: { targets: v.all ? 'all' : v.targets },
          after_data: out0,
          remark: '无命中目标（可能已清除或本就不存在）',
          idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
        });
      } catch (e) { /* 审计失败不阻断主流程 */ }
    }
    return ok(out0);
  }

  // ===== 6. 上限护栏（fail-closed：宁可拒，不可半途）=====
  if (hits.length > MAX_CLEAR_ROWS) {
    return fail(ERROR_CODES.INVALID_PARAM,
      '单次清除超过 ' + MAX_CLEAR_ROWS + ' 行（本次命中 ' + hits.length + ' 行），请按日期或平台分批清除');
  }

  // ===== 7. 软删（逐条；_id 直接可用）=====
  const now = nowUtc();
  let clearedRows = 0;
  const billKeys = new Set();
  for (const h of hits) {
    await db.collection('external_sales_daily').doc(h._id).update({
      data: { is_deleted: true, delete_at: now, delete_by: userId },
    });
    clearedRows++;
    billKeys.add(h.kind + '|' + h.platform + '|' + h.biz_date);
  }

  const out = {
    shop_id: shopId,
    cleared_rows: clearedRows,
    cleared_bills: billKeys.size,
    targets: v.all ? 'all' : v.targets,
    client_request_id: clientRequestId || '',
  };

  // ===== 8. 审计（只 INSERT；危险操作必须可回溯到"删了哪些"）=====
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'CLEAR_SALES_BILL', operator_type: 'user', operator_id: userId, shop_id: shopId,
        before_data: { targets: v.all ? 'all' : v.targets, hit_ids: hits.map((x) => x._id) },
        after_data: out,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }
  return ok(out);
};
