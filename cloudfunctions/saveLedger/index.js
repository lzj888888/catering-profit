// cloudfunctions/saveLedger/index.js —— 批次 4 · M1 月度账保存（Controller 层 · 写）
//
// 流程：鉴权中间件（批次 0）→ 校验 → 归档守卫（is_archive=true 禁改；7 天宽限补录需 archive_override）
//      → 读服务端权威开关（shop_switch）→ 读摊销台账计算当月摊销（amortizeSwitch 开才计入）
//      → 内嵌双利润引擎重算 → 落 shop_monthly_account（is_archive 原样保留） → 返回 profit_ref/profit_true。
//
// ⚠️ 计算下沉：本函数**内部**用内嵌 calcMonthlyProfit / calcAmortize 引擎重算，不信任前端传入的利润。
// ⚠️ 归档守卫（2.6）：归档月 is_archive=true 全字段只读；仅归档后 7 天内且显式 archive_override 才允许补录
//    （保存后重算并保持归档）；超 7 天硬锁，返回 ARCHIVED_LOCKED。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner, genId } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { calcMonthlyProfit, amortizeTotalForMonth } = require('./service');
const { validateInput } = require('./validate');

const SWITCH_KEY_INVENTORY = 'inventory_switch';
const SWITCH_KEY_AMORTIZE = 'amortize_switch';
const GRACE_DAYS_MS = 7 * 24 * 3600 * 1000;

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

  // ===== 2b. 幂等预检（契约 §10：saveLedger = user+shop+幂等）=====
  // 🔒 R73：本函数按 (shop_id, month) upsert ⇒ **终态天然幂等**，但契约明文要求校验 client_request_id，
  //   且此处仍要拦"同一请求被重复投递"。放置位置刻意在**归档守卫之前**：
  //   否则一条晚到的重复投递会撞上 is_archive 而被误报 ARCHIVED_LOCKED —— 而该请求其实早已成功过。
  //   命中即返回首次结果、不再落库。空 client_request_id ⇒ 单源返回 null ⇒ 不做约束（守卫已登记在案）。
  const clientRequestId = v.input.client_request_id;
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  const da = makeAdapter(db);
  const now = nowUtc();

  // ===== 3. 归档守卫 =====
  let existing = null;
  // 用月主键查（id 或复合字段），回落 where 查
  const exRes = await da.list('shop_monthly_account', { shop_id: shopId, month: v.month });
  existing = (exRes && exRes.data && exRes.data[0]) || null;
  if (existing && existing.is_archive) {
    const archivedAt = existing.archived_at || now;
    const withinGrace = (now - archivedAt) < GRACE_DAYS_MS;
    if (!(v.archiveOverride && withinGrace)) {
      return fail(ERROR_CODES.ARCHIVED_LOCKED, '归档月份为只读，仅归档后 7 天内可补录（需二次确认）');
    }
  }

  // ===== 4. 服务端权威开关（shop_switch）=====
  const swRes = await da.list('shop_switch', { shop_id: shopId });
  const swRows = (swRes && swRes.data) || [];
  const swGet = (key) => { const r = swRows.find((x) => x.switch_key === key); return r ? !!r.enabled : false; };
  const inventorySwitchOn = swGet(SWITCH_KEY_INVENTORY);
  const amortizeSwitchOn = swGet(SWITCH_KEY_AMORTIZE);

  // ===== 5. 摊销：amortizeSwitch 开时由台账计算当月摊销（否则 0）=====
  let amortizeFen = 0;
  if (amortizeSwitchOn) {
    const assetsRes = await da.list('shop_amortize', { shop_id: shopId });
    const assets = ((assetsRes && assetsRes.data) || []).map((a) => ({
      asset_id: a.asset_id || a.id, start_month: a.start_month,
      total_months: a.total_months, terminate_month: a.terminate_month || '',
      total_value: a.value_fen != null ? a.value_fen : a.total_value,
    }));
    amortizeFen = amortizeTotalForMonth(assets, v.month);
  }

  // ===== 6. 内嵌双利润引擎重算（不信任前端利润）=====
  const result = calcMonthlyProfit({
    incomeItems: v.incomeItems,
    expenseItems: v.expenseItems,
    directConsumeFen: v.directConsumeFen,
    inventory: v.inventory,
    amortizeFen,
    amortizeSwitchOn,
    inventorySwitchOn,
  });

  // A2：内部 camelCase → 契约 snake_case（含二级细项 sub_items），落库用
  const toSnake = (items) => (items || []).map((it) => ({
    category: it.category || '',
    name: it.name || '',
    amount_fen: it.amountFen,            // 云函数汇总后的大类金额（分）
    sub_items: (it.subItems || []).map((si) => ({ sub_item: si.subItem, amount_fen: si.amountFen })),
  }));
  const incomeItemsSnake = toSnake(v.incomeItems);
  const expenseItemsSnake = toSnake(v.expenseItems);

  // ===== 7. 落库（upsert shop_monthly_account，归档标记原样保留）=====
  const doc = {
    shop_id: shopId, month: v.month,
    income_items: incomeItemsSnake, expense_items: expenseItemsSnake,
    direct_consume_fen: v.directConsumeFen,
    inventory: v.inventory,
    amortize_fen: amortizeFen,
    // 汇总结果（分整数）
    income_total_fen: result.incomeTotalFen,
    expense_total_fen: result.expenseTotalFen,
    material_cost_fen: result.materialCostFen,
    real_consume_fen: result.realConsumeFen,
    gross_profit_fen: result.grossProfitFen,
    gross_margin_pct: result.grossMarginRatePctDisplay,
    operation_ref_profit_fen: result.operationRefProfitFen,
    total_factor_real_profit_fen: result.totalFactorRealProfitFen,
    profit_diff_fen: result.profitDiffFen,
    switch_used: result.switchUsed,
    updated_at: now,
  };
  let accountId;
  if (existing) {
    accountId = existing._id || existing.id;
    await db.collection('shop_monthly_account').doc(accountId).update({ data: doc });
  } else {
    const ins = await da.insert('shop_monthly_account', Object.assign({ account_id: genId('acc_'), is_archive: false, archived_at: 0 }, doc));
    accountId = ins && ins._id;
  }

  const out = {
    shop_id: shopId, month: v.month,
    account_id: accountId,
    profit_ref: result.operationRefProfitFen,
    profit_true: result.totalFactorRealProfitFen,
    amortize_fen: amortizeFen,
    real_consume_fen: result.realConsumeFen,
    switch_used: result.switchUsed,
    client_request_id: clientRequestId || '',
  };

  // ===== 8. 幂等登记（键与上面查重键**同源**，一律走单源 shopKey）=====
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'SAVE_LEDGER',
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