// cloudfunctions/getLedger/index.js —— 批次 4 · M1 月度账读取（Controller 层 · 读）
//
// 鉴权 → 校验 → 读 shop_monthly_account（软删过滤）→ 服务端权威开关 → 内嵌双利润引擎**重算**返回
//   （防篡改：不信任落库存量，回读时用明细重算）。无记录返回默认空账（不报 RESOURCE_NOT_FOUND）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { calcMonthlyProfit } = require('./service');
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

  // ===== 读账（无则空账）=====
  const ex = await da.list('shop_monthly_account', { shop_id: shopId, month: v.month });
  const acct = (ex && ex.data && ex.data[0]) || null;

  const incomeItems = (acct && acct.income_items) || [];
  const expenseItems = (acct && acct.expense_items) || [];
  const directConsumeFen = (acct && acct.direct_consume_fen) || 0;
  const inventory = (acct && acct.inventory) || { openingFen: 0, purchaseFen: 0, closingFen: 0 };
  const amortizeFen = (acct && acct.amortize_fen) || 0;

  // ===== 服务端权威开关 =====
  const swRes = await da.list('shop_switch', { shop_id: shopId });
  const swRows = (swRes && swRes.data) || [];
  const swGet = (key) => { const r = swRows.find((x) => x.switch_key === key); return r ? !!r.enabled : false; };
  const inventorySwitchOn = swGet('inventory_switch');
  const amortizeSwitchOn = swGet('amortize_switch');

  // ===== 重算（防篡改）=====
  const result = calcMonthlyProfit({
    incomeItems, expenseItems, directConsumeFen, amortizeFen,
    inventory, amortizeSwitchOn, inventorySwitchOn,
  });

  return ok({
    shop_id: shopId, month: v.month,
    account_id: acct ? (acct.account_id || acct._id) : '',
    is_archive: !!acct && !!acct.is_archive,
    archived_at: acct ? (acct.archived_at || 0) : 0,
    income_items: incomeItems, expense_items: expenseItems,
    direct_consume_fen: directConsumeFen, inventory,
    amortize_fen: amortizeFen,
    switches: { inventorySwitchOn, amortizeSwitchOn },
    result: {
      income_total_fen: result.incomeTotalFen,
      expense_total_fen: result.expenseTotalFen,
      material_cost_fen: result.materialCostFen,
      gross_profit_fen: result.grossProfitFen,
      gross_margin_pct: result.grossMarginRatePctDisplay,
      operation_ref_profit_fen: result.operationRefProfitFen,
      total_factor_real_profit_fen: result.totalFactorRealProfitFen,
      profit_diff_fen: result.profitDiffFen,
      real_consume_fen: result.realConsumeFen,
      effective_amortize_fen: result.effectiveAmortizeFen,
    },
    client_request_id: v.input.client_request_id || '',
  });
};