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
const { indicatorRef } = common;                    // round115：M1 行业指标对照（口径单源，见 common/indicatorRef.js §七）
const { makeAdapter } = common.dataAdapter;
const { calcMonthlyProfit } = require('./service');
const { validateInput } = require('./validate');

// A2 兼容：库内明细可能是旧格式（camelCase amountFen）或新格式（snake_case amount_fen + sub_items）。
//   · 读库统一归一为 camelCase 喂引擎（引擎读 it.amountFen）；
//   · 返回统一 snake_case（契约层，含二级细项 sub_items）。
function normalizeToCamel(rawItems) {
  return (rawItems || []).map((it) => {
    const amt = it.amount_fen !== undefined ? it.amount_fen : it.amountFen;
    const subRaw = it.sub_items || it.subItems || [];
    return {
      category: it.category || '',
      name: it.name || '',
      amountFen: amt != null ? amt : 0,
      subItems: subRaw.map((si) => ({ subItem: si.sub_item !== undefined ? si.sub_item : si.subItem || '', amountFen: si.amount_fen !== undefined ? si.amount_fen : si.amountFen })),
    };
  });
}
function toSnake(items) {
  return (items || []).map((it) => ({
    category: it.category || '',
    name: it.name || '',
    amount_fen: it.amountFen,
    sub_items: (it.subItems || []).map((si) => ({ sub_item: si.subItem, amount_fen: si.amountFen })),
  }));
}

// round103：库存出参一律转 snake_case —— 契约 `core/10_云函数清单与接口契约.md` 第 42 行明文
//   `getLedger` 出参为 `inventory{opening_fen,purchase_fen,closing_fen}`。此前把 DB 的 camelCase
//   **原样透传**，而库存页是**照契约**读 `opening_fen` 的 ⇒ 三个框永远读不到值
//   （真机反馈「原来填写过的数字不出来」的根因）。此处兼容两种来源命名，不留新的「同义字段双轨」。
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function invToSnake(inv) {
  const s = inv || {};
  return {
    opening_fen: num0(s.openingFen !== undefined ? s.openingFen : s.opening_fen),
    purchase_fen: num0(s.purchaseFen !== undefined ? s.purchaseFen : s.purchase_fen),
    closing_fen: num0(s.closingFen !== undefined ? s.closingFen : s.closing_fen),
  };
}
// 上一个自然月（'YYYY-MM' → 'YYYY-MM'）；入参不合法返回 ''（fail-closed，不猜月份）
function prevMonthOf(ym) {
  const p = String(ym || '').split('-');
  const y = Number(p[0]), m = Number(p[1]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return '';
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
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

  // ===== 读账（无则空账）=====
  const ex = await da.list('shop_monthly_account', { shop_id: shopId, month: v.month });
  const acct = (ex && ex.data && ex.data[0]) || null;

  const rawIncome = (acct && acct.income_items) || [];
  const rawExpense = (acct && acct.expense_items) || [];
  const directConsumeFen = (acct && acct.direct_consume_fen) || 0;
  const inventory = (acct && acct.inventory) || { openingFen: 0, purchaseFen: 0, closingFen: 0 };

  // round103：期初结转 —— 规范 `core/02_模拟测试数据集.md` 第 127 行「期初存货 …从上月期末结转，不可编辑」
  //   · 本月**没保存过**（acct == null）⇒ 期初自动取上月期末，前端只读展示（opening_auto = true）
  //   · 本月**保存过** ⇒ 一律尊重老板填的值（他可能确实要修正），另带上月期末供前端做差异提示
  //   · 首月 / 上月无记录 ⇒ prevClosingFen 恒 0 ⇒ 期初留空待填（即规范里的「期初建账引导」）
  const prevMonth = prevMonthOf(v.month);
  let prevClosingFen = 0;
  if (prevMonth) {
    const pRes = await da.list('shop_monthly_account', { shop_id: shopId, month: prevMonth });
    const pAcct = (pRes && pRes.data && pRes.data[0]) || null;
    prevClosingFen = num0(pAcct && pAcct.inventory && pAcct.inventory.closingFen);
  }
  const inventoryOut = invToSnake(inventory);
  const openingAuto = !acct && !!prevMonth;
  if (openingAuto) inventoryOut.opening_fen = prevClosingFen;
  const amortizeFen = (acct && acct.amortize_fen) || 0;
  // round106（F2）：一次性投入（分）—— 回读时必须带进引擎，否则重算的利润与落库值对不上
  const lumpSumFen = num0(acct && acct.lump_sum_fen);

  // A2：归一为 camelCase 喂引擎（引擎读 amountFen）；返回侧再转 snake_case
  const incomeItems = normalizeToCamel(rawIncome);
  const expenseItems = normalizeToCamel(rawExpense);

  // ===== round115：店铺设置（业态 / 城市层级）=====
  // 指标参考带是**分业态 × 分城市层级**的（火锅店的房租带与正餐不同），而 M1 此前
  // **完全没有**这两个值 ⇒ 必须取（否则对照只能瞎给）。
  // ⚠️ 未设置（''）时回落：bandOf 内置 `BANDS[bizKey] || BANDS.dining` + 默认 tier23
  //    ⇒ 等价于「正餐 × 二三线」，由前端明示「按正餐·二三线估算，可改」。
  const shopDoc = await da.get('shop', shopId);
  const bizType = (shopDoc && shopDoc.biz_type) || '';
  const cityTier = (shopDoc && shopDoc.city_tier) || '';

  // ===== 服务端权威开关 =====
  const swRes = await da.list('shop_switch', { shop_id: shopId });  const swRows = (swRes && swRes.data) || [];
  const swGet = (key) => { const r = swRows.find((x) => x.switch_key === key); return r ? !!r.enabled : false; };
  const inventorySwitchOn = swGet('inventory_switch');
  const amortizeSwitchOn = swGet('amortize_switch');

  // ===== 重算（防篡改）=====
  const result = calcMonthlyProfit({
    incomeItems, expenseItems, directConsumeFen, amortizeFen,
    inventory, amortizeSwitchOn, inventorySwitchOn,
    lumpSumFen,
  });

  // ===== round115：M1 行业指标对照 =====
  // 口径（李老师 2026-09-24 拍板 + 本仓既立红线）：
  //   · 分母 = M1 自己的**权责发生制收入**（incomeTotalFen），与上方 result **同源** ——
  //     不另立"实收现金"口径，否则页面上的毛利率会与下面的占比互相矛盾（客户一算就发现）。
  //   · 缺项**不出键**（sumByTag 保证）⇒ pct=null ⇒ level='na'（**不评级**）。
  //     绝不算成 0% —— 那会得出「房租占比 0%，优秀」这种荒谬结论（round115 实测抓过该 bug）。
  //   · 不含 manage（M1 无对应科目，硬凑会把房租或人工重复计入）。
  const byInd = indicatorRef.sumByTag(expenseItems);
  const incomeTotal = result.incomeTotalFen;
  const indicators = indicatorRef.m1IndicatorsOf(indicatorRef.evaluateIndicators({
    bizKey: bizType,
    cityKey: cityTier,
    revenueFen: incomeTotal,
    fixedFen: indicatorRef.toFixedFen(byInd),
    // ⚠️ M1 的毛利率是**整店**口径（含外卖），与 M2 的「菜品毛利率」不完全同义 ⇒ 前端须标注
    grossMarginPct: incomeTotal > 0 ? result.grossMarginRatePctDisplay : null,
    // ⚠️ 推广费在 M1 是**金额**（营销费用大类，含外卖佣金/补贴/推广），与 M2 的「挂钩费率」
    //    不同义 ⇒ 前端须标注；转成占比后与 M2 同量纲但口径不同。
    platformPct: (byInd.mkt != null && incomeTotal > 0) ? (byInd.mkt / incomeTotal) * 100 : null,
  }));

  return ok({
    shop_id: shopId, month: v.month,
    account_id: acct ? (acct.account_id || acct._id) : '',
    is_archive: !!acct && !!acct.is_archive,
    archived_at: acct ? (acct.archived_at || 0) : 0,
    income_items: toSnake(incomeItems), expense_items: toSnake(expenseItems),
    direct_consume_fen: directConsumeFen, inventory: inventoryOut,
    // round103：期初来源做成**可观测**（auto = 系统结转；否则为老板填的值，prev 供差异提示）
    opening_auto: openingAuto,
    opening_source_month: openingAuto ? prevMonth : '',
    opening_prev_fen: prevClosingFen,
    amortize_fen: amortizeFen,
    // round106（F2）/ round107：一次性投入（落库原值）+ 生效值。**两者恒等** ——
    //   round107 去掉了「按月分摊时恒 0」的互斥规则（摊销与一次算清是两笔不同的钱，可共存）。
    lump_sum_fen: lumpSumFen,
    effective_lump_sum_fen: result.effectiveLumpSumFen,
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
    // round115：M1 行业指标对照（5 项：毛利率 / 房租 / 人工 / 能耗 / 推广费；**不含 manage**）
    //   每项含 { key, pct, lo, hi, level, redline, redlineHit }；**pct=null 表示该项没数据（不评级）**
    //   —— 前端遇到 null 必须显示「—」，不得显示 0%
    indicators,
    // 参考带所依据的范围（供前端 picker 回显 + 明示「是否用的是默认口径」）
    indicator_scope: {
      biz_type: bizType,
      city_tier: cityTier,
      is_default_scope: !bizType || !cityTier,
    },
    client_request_id: v.input.client_request_id || '',
  });
};