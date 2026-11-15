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
const { calcMonthlyProfit, resolveArchiveSwitches, amortizeTotalForMonth, disposalLossForMonth } = require('./service');
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
      // R162：qty（有效订单数）回读 —— 库内没有该字段的老数据 ⇒ 不带该键（前端按 undefined 处理为未填）
      subItems: subRaw.map((si) => {
        const o = { subItem: si.sub_item !== undefined ? si.sub_item : si.subItem || '', amountFen: si.amount_fen !== undefined ? si.amount_fen : si.amountFen };
        if (typeof si.qty === 'number' && Number.isInteger(si.qty) && si.qty >= 0) o.qty = si.qty;
        return o;
      }),
    };
  });
}
function toSnake(items) {
  return (items || []).map((it) => ({
    category: it.category || '',
    name: it.name || '',
    amount_fen: it.amountFen,
    // R162：qty 出参（契约层 snake_case 与入参同名）；无 qty 的行不补键
    sub_items: (it.subItems || []).map((si) => {
      const o = { sub_item: si.subItem, amount_fen: si.amountFen };
      if (typeof si.qty === 'number' && Number.isInteger(si.qty) && si.qty >= 0) o.qty = si.qty;
      return o;
    }),
  }));
}

// round103：库存出参一律转 snake_case —— 契约 `core/10_云函数清单与接口契约.md` 第 42 行明文
//   `getLedger` 出参为 `inventory{opening_fen,purchase_fen,closing_fen}`。此前把 DB 的 camelCase
//   **原样透传**，而库存页是**照契约**读 `opening_fen` 的 ⇒ 三个框永远读不到值
//   （真机反馈「原来填写过的数字不出来」的根因）。此处兼容两种来源命名，不留新的「同义字段双轨」。
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
// R744：一次性投入按台账现算（与 saveLedger/index.js §5 逐字同口径：mode='lump' 且 start_month===本月）
function ledgerLumpFromRows(rows, month) {
  return (rows || []).filter((a) => a.mode === 'lump' && a.start_month === month)
    .reduce((s, a) => s + num0(a.total_value), 0);
}
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
// A11：月份序号（'YYYY-MM' → 连续整数），与 getAmortSchedule 的 monthIndex **同口径**。
//   不合法返回 NaN（上游据此跳过该资产，不猜）。
function monthIdxOf(ym) {
  const p = String(ym || '').split('-');
  const y = Number(p[0]), m = Number(p[1]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return NaN;
  return y * 12 + (m - 1);
}
// 序号 → 'YYYY-MM'（monthIdxOf 的逆；越界返回 ''）
function monthOfIdx(i) {
  if (!Number.isFinite(i)) return '';
  const y = Math.floor(i / 12), m = (i % 12) + 1;
  return y + '-' + String(m).padStart(2, '0');
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
  // 🔴 R736：摊销金额的取数随规则切换 ——
  //   v2 月份（>= 生效月）：**从台账重算**。不能沿用落库的 `amortize_fen`，
  //     因为 v2 上线前开关关着的店，saveLedger 压根没求和 ⇒ 落库值恒 0 ⇒
  //     「界面说本月计入、引擎算出来是 0」的静默错账（会诊后补的第三个坑）。
  //   老月份：仍用落库值 —— 那个数是当时按开关算出来的历史事实，重算等于改写旧账。
  const amortRes = await da.list('shop_amortize', { shop_id: shopId });
  // 🔴 R739（本轮探针抓出 · P0）：**必须先把落库行映射成引擎字段名，再喂公式**。
  //   落库字段是 `value_fen`（见 saveAsset/index.js:116），而引擎 `amountForMonth` 读 `asset.total_value`。
  //   原先这里直接把 DB 原始行塞进 `amortizeTotalForMonth` ⇒ `total_value` 恒 undefined ⇒
  //   `Math.round(undefined / 36)` = NaN ⇒ 合计 NaN ⇒ 下游 `num0()` 归 0。
  //   后果（2026-11 起每个未归档月份）：摊销页从台账算得好好的（它做了映射），
  //     结果页/月报算出来 ¥0.00 ⇒ **利润被高估一整笔摊销**，且两个页面互相打脸。
  //   ⚠️ 为什么 R737 的 fixture 没抓到：r737_fixture.js 用的是引擎字段名 `total_value`，
  //     而真库里根本没有这个字段 —— 「按引擎的样子造数据」而不是「按库的样子造数据」，必假绿。
  //   映射写法与 `getAmortSchedule/index.js:94`、`saveLedger/index.js:109`、
  //     `exportData/index.js:180` 逐字同源（同一个坑不能有四种补法）。
  // R744：全量台账行（含 mode='lump'）—— 供一次性投入按台账现算（L-2）。
  //   ⚠️ 不能复用下面的 amortRows：它已 filter 掉 lump 行，拿它算 lump 恒为 0。
  const ledgerRows = ((amortRes && amortRes.data) || [])
    .map((a) => Object.assign({}, a, {
      total_value: a.value_fen != null ? a.value_fen : a.total_value,
      asset_id: a.asset_id || a._id,
    }));
  const amortRows = ledgerRows.filter((a) => a.mode !== 'lump' && a.start_month);
  // 🔴 R740：**未归档月一律按台账算，归档月读落库快照**。这里不再有月份闸门。
  //   曾经是 `(amortV2Now && !isArchiveNow)` —— 多一层 `month >= '2026-11'` 判据。
  //   R737 那轮交叉审计抓出的 P0 就长在这个判据上：调用点漏传 month ⇒ 闸门恒 false
  //   ⇒ 每月少扣 5,277.78，而三份引擎副本各自都是对的、service 层单测全绿。
  //   ⇒ 闸门拆掉后，「漏传 month 导致规则失效」这类缺陷**结构上不可能再发生**。
  //   ⚠️ 但归档优先这条**必须保留**：归档 = 封账，那个月的数字连同「算它用的台账」一起冻结。
  //     若归档后仍从台账重算，老板删掉/改掉一条资产，封账月的利润就跟着变 ⇒「已归档=只读」变成假话
  //     （与 R257 用开关快照、R735 用归档快照是同一个病根的第四张脸）。
  const isArchiveNow = !!(acct && acct.is_archive);
  // 🔴 R744：提前报废的「资产处置损失」—— 未归档月从台账现算，归档月读落库快照（历史不追）。
  //   它并入 amortizeFen 传给引擎（amortizeFen 语义是「本月计入额」），利润因此自动扣这笔钱。
  //   ⚠️ 归档月必须原样读 acct.amortize_fen：那个月封账时落库的值已含（或不含）当时的处置损失，
  //      重算等于改写历史账（R741 裁决）。快照缺 disposal_loss_fen 的老数据 ⇒ 0，不追。
  const disposalLossFen = isArchiveNow
    ? num0(acct && acct.disposal_loss_fen)
    : disposalLossForMonth(amortRows, v.month);
  const amortizeFen = isArchiveNow
    ? ((acct && acct.amortize_fen) || 0)
    : (amortizeTotalForMonth(amortRows, v.month) + disposalLossFen);
  // 🔴 R744（L-2）：一次性投入与摊销 **对称** —— 未归档月按台账现算，归档月读落库快照。
  //   原实现未归档月也读 acct.lump_sum_fen ⇒ 老板先存账、后登记资产时，这笔投入不进利润（要重存一次才对）。
  const lumpSumFen = isArchiveNow
    ? num0(acct && acct.lump_sum_fen)
    : ledgerLumpFromRows(ledgerRows, v.month);

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
  const swRes = await da.list('shop_switch', { shop_id: shopId });
  const swRows = (swRes && swRes.data) || [];
  const swGet = (key) => { const r = swRows.find((x) => x.switch_key === key); return r ? !!r.enabled : false; };

  // ===== R257：归档月回读改用「落库时的开关快照」 =====
  //   getLedger 是**回读重算**（不信任落库存量），所以参与计算的**参数**也必须一起冻结 ——
  //   否则归档后改一次开关，封账月的利润就漂了（「已归档=只读」在这条路径上是假的）。
  //   快照由 saveLedger 落库（switch_used = 引擎产出的 {inventorySwitchOn, amortizeSwitchOn}）。
  //   未归档月仍用实时值（开关是实时建模控件，改了就应立刻看到效果；下次保存快照随之更新）。
  //   （`isArchiveNow` 已在摊销取数处提前声明 —— 归档月不重算摊销，见上方注释）
  const sw = resolveArchiveSwitches({
    isArchive: isArchiveNow,
    switchUsed: acct && acct.switch_used,
    liveInventorySwitchOn: swGet('inventory_switch'),
    liveAmortizeSwitchOn: swGet('amortize_switch'),
  });
  const inventorySwitchOn = sw.inventorySwitchOn;
  // R740：`amortizeSwitchOn` 不再参与任何计算（摊销一律计入）。归档快照里仍会读到它，
  //   但只作为历史留痕 —— 归档月「有没有扣摊销」由落库的 amortize_fen 表达，不由开关表达。

  // ===== 重算（防篡改）=====
  // 🔴 **必须传 month**。R740 之前是因为时间闸门读 `clean.month`；闸门拆掉后，
  //   month 仍是**台账取数参数**（`amortizeTotalForMonth(amortRows, v.month)` 靠它定位这一期），
  //   而且引擎重算的其它口径（如月份相关展示）也要它。
  //   历史教训保留在这里，因为它是「喂参完整性」最典型的一例：
  //   R737 时本处漏传 month ⇒ 闸门恒 false ⇒ 每月少扣 5,277.78，而三份引擎副本各自都对、
  //   service 层单测全绿 —— 错在**上游喂参**，行为测试喂参正确就永远抓不到。
  //   ⇒ 守卫 `check_amort_no_gate.js` 的 E 段仍逐个调用点核对传参。
  const result = calcMonthlyProfit({
    month: v.month,                    // 🔴 台账按此定位月份，漏传 ⇒ 摊销取数落到错误期
    incomeItems, expenseItems, directConsumeFen, amortizeFen,
    inventory, inventorySwitchOn,
    lumpSumFen,
  });

  // ===== A11（2026-11-05）：摊销三件套 —— 还剩几期 / 哪个月摊完 / 摊完后月利润 =====
  //   摊销是老板最容易忽略的一笔钱：它每月压着利润，但**有尽头**。把「尽头」和「尽头之后的利润」
  //   摆出来，是他判断「再扛几个月」的唯一可算依据。
  //   口径必须与 getAmortSchedule::progressOf 一致（两处各算一套 ⇒ 摊销页说剩 3 期、结果页说剩 5 期）。
  //   · 只吃 mode='amort' 的行（mode='lump' 当月就结束了，没有「还剩几期」）
  //   · 起 = start_month；止 = min(自然到期月, terminate_month)
  //   · 🔴 R739：剩余期数**不含本月** —— 本月这期在本月利润里已经扣掉了（`effective_amortize_fen`）。
  //     原写「含本月」是为了说「本月这期还得摊」，但那句话对老板是错的：钱已经扣了，
  //     他会拿摊销页的「已摊 2/36」去对结果页的「还剩 35 期」，2+35=37 > 36 ⇒ 多出一期，谁也解释不清。
  //     现口径：已摊期数（含本月，见 getAmortSchedule::progressOf）+ 剩余期数（不含本月）= 总期数。
  //   · 多条资产并存时取**最晚摊完**的那条撑时间轴（「全部摊完」才有意义）
  //   ⚠️ R736：`amortRows` 在上方摊销金额取数处已经读过（v2 需要它重算），此处**不再重复 list**。
  //     重复 list 不只是多一次 IO —— 两份数据若在两次读之间被改，进度与金额会来自不同快照。
  const mi = monthIdxOf(v.month);
  let remainPeriods = 0;
  let endMonthMax = '';
  for (const a of amortRows) {
    const st = monthIdxOf(a.start_month);
    const tm = Number(a.total_months);
    if (!Number.isFinite(st) || !Number.isFinite(mi)) continue;
    if (!Number.isInteger(tm) || tm <= 0) continue;
    let end = st + tm - 1;
    if (a.terminate_month) {
      const t = monthIdxOf(a.terminate_month);
      if (Number.isFinite(t) && t < end) end = t;
    }
    if (mi > end) continue;                        // 这笔已摊完
    // 本月已摊 ⇒ 剩 end-mi 期；本月早于起摊月 ⇒ 还剩整整 tm 期（end-st+1 与之一致）
    const r = (mi < st) ? (end - st + 1) : (end - mi);
    if (r > remainPeriods) remainPeriods = r;
    const em = monthOfIdx(end);
    if (em && (!endMonthMax || em > endMonthMax)) endMonthMax = em;
  }

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

  // ===== A17（2026-11-05）：三项刚性成本率（V钱-4）=====
  // 由上面 indicators 的三行**直接派生**（毛利率/房租/人工），零新增输入、零二次口径：
  //   🔴 不重算一遍占比 —— 那会造出第二个分母来源，页面上的「房租 12%」与三项和里的房租可能对不上。
  //   缺任一项 ⇒ pct=null + missing 列表（前端提示"缺房租"），**绝不按 0 补**。
  const indByKey = {};
  indicators.forEach((r) => { indByKey[r.key] = r; });
  const pctOfInd = (k) => (indByKey[k] ? indByKey[k].pct : null);
  const threeCost = indicatorRef.threeCostOf(bizType, {
    grossMarginPct: pctOfInd('grossMargin'),
    rentPct: pctOfInd('rent'),
    laborPct: pctOfInd('labor'),
  });

  return ok({
    shop_id: shopId, month: v.month,
    // 🔴 R443（2026-10-23）：现金流体检 —— 前端算「钱还能撑几个月」需要**金额**，
    //   而 indicators 只回占比 pct。单位**分**（与 sumByTag 的 amountFen 同源）。
    //   ⚠️ 缺项不出键（与 indicators 的「缺项不评级」同源）⇒ 前端不得按 0 算，
    //      否则会把「没填房租」当成「房租 0 元」，可撑月数被高估。
    // 🔴 R444 收口：**必须经 `toFixedFen` 取数**，不能直取 `byInd.utility`。
    //   `sumByTag` 的水电键叫 `energy`，`utility` 是**指标侧**的名字，映射单源在
    //   `FIXED_FEN_KEY = { energy: 'utility' }`。直取 `byInd.utility` 恒 undefined
    //   ⇒ 出参 `utility` 恒 null ⇒ 前端恒判「这月没填全」⇒ 整条功能死掉，
    //   而装配/校验/门禁全绿（同 R298Y「读到了 ≠ 送出去了」一族的第九例）。
    fixed_items_fen: (() => {
      const fx = indicatorRef.toFixedFen(byInd);
      return {
        rent: fx.rent != null ? fx.rent : null,
        labor: fx.labor != null ? fx.labor : null,
        utility: fx.utility != null ? fx.utility : null,
      };
    })(),
    account_id: acct ? (acct.account_id || acct._id) : '',
    is_archive: isArchiveNow,
    archived_at: acct ? (acct.archived_at || 0) : 0,
    // R257：本次重算用的开关来源（'snapshot' 归档快照 / 'live' 实时 / 'live_no_snapshot' 归档但快照缺失）
    //   前端不必渲染它；留着是为了「封账月数字为什么没跟着开关变」这类疑问有一条可查的线索。
    switch_source: sw.source,
    income_items: toSnake(incomeItems), expense_items: toSnake(expenseItems),
    direct_consume_fen: directConsumeFen, inventory: inventoryOut,
    // R493：本月是否真实盘点（库存页勾选落库；profitLabel 据此区分清仓月"盘了"与"没盘"）
    stock_take_done: !!(acct && acct.stock_take_done),
    // round103：期初来源做成**可观测**（auto = 系统结转；否则为老板填的值，prev 供差异提示）
    opening_auto: openingAuto,
    opening_source_month: openingAuto ? prevMonth : '',
    opening_prev_fen: prevClosingFen,
    amortize_fen: amortizeFen,
    // R744：本月「资产处置损失」（提前报废未摊余额）。归档月取落库快照，可为 0。
    disposal_loss_fen: disposalLossFen,
    // A11：摊销三件套。after_profit_fen 的口径是**总因素真实利润 + 本月摊销**，依据
    //   getLedger/service.js:73（摊销只进真实利润；参考利润本来就不扣摊销 ⇒ 拿参考利润去加等于凭空多算一笔）。
    //   🔴 R740：摊销一律计入 ⇒ switch_on 恒 true（这里报的是「摊销功能是否开启」，不是「本月有没有钱可扣」）。
    //     本月到底扣了多少由 this_fen 表达；「无资产在摊」由 remaining_periods=0 表达，两条判据分开。
    //     R736 时这里还跟着月份闸门走（闸门开 ⇒ true），R740 拆掉闸门后直接就是 true，
    //     行为与原先 11 月及以后完全一致，只是不再有"哪个月不一样"这回事。
    amort_extra: {
      switch_on: true,
      this_fen: result.effectiveAmortizeFen,
      remaining_periods: remainPeriods,
      end_month: endMonthMax,
      after_profit_fen: result.totalFactorRealProfitFen + result.effectiveAmortizeFen,
      profit_basis: 'total_factor',
    },
    // A13/A19：经营客流三字段 + 两个派生比例。
    //   🔴 任一输入缺失 ⇒ 对应派生为 null，**绝不按 0 算**（A18 同源纪律）：
    //      「复购率 0%」与「没填客流」是两句完全不同的话，前者会让老板以为老客全跑了。
    traffic: (() => {
      const t = (acct && acct.traffic_count != null) ? Number(acct.traffic_count) : null;
      const o = (acct && acct.old_customer_count != null) ? Number(acct.old_customer_count) : null;
      const m = (acct && acct.member_sales_fen != null) ? Number(acct.member_sales_fen) : null;
      const pct1 = (a, b) => (a == null || b == null || !(b > 0) ? null : Math.round((a / b) * 1000) / 10);
      const memRatio = pct1(m, incomeTotal);
      return {
        this_month: t,
        old_customer: o,
        member_sales_fen: m,
        repeat_rate_pct: pct1(o, t),
        // 会员销售占比的分母是**权责发生制收入**（与本页其余占比同源，不另立口径）
        member_ratio_pct: memRatio,
        // A18：会员占比判级（<20% 报警）。留空 ⇒ level='na'，**不判**（不按 0 分罚没会员体系的小店）。
        //   阈值单源在 indicatorRef.MEMBER_RATIO_WARN，页面不得写死 20。
        member_ratio_level: indicatorRef.memberRatioOf(memRatio).level,
      };
    })(),
    // round106（F2）/ round107：一次性投入（落库原值）+ 生效值。**两者恒等** ——
    //   round107 去掉了「按月分摊时恒 0」的互斥规则（摊销与一次算清是两笔不同的钱，可共存）。
    lump_sum_fen: lumpSumFen,
    effective_lump_sum_fen: result.effectiveLumpSumFen,
    // 🔴 R740：摊销一律计入 ⇒ switches 里摊销恒 true（否则前端「未启用」话术会与已扣的钱打架）
    switches: { inventorySwitchOn, amortizeSwitchOn: true },
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
      // R477：参考口径**取了哪个数**、**为什么**（前端解释「两口径差异」的取数单源，
      //   不许前端自己猜 —— 猜错就会拿新解释配旧数字，那叫说谎）。
      //   ref_material_source = 'reverse' ⇒ 库存模式下没填直接消耗，用了倒轧值；
      //                       = 'direct'  ⇒ 用了老板直接填的数（口径锁）。
      ref_material_fen: result.refMaterialFen,
      ref_material_source: result.refMaterialSource,
      profit_caliber_version: result.profitCaliberVersion,
    },
    // round115：M1 行业指标对照（5 项：毛利率 / 房租 / 人工 / 能耗 / 推广费；**不含 manage**）
    //   每项含 { key, pct, lo, hi, level, redline, redlineHit }；**pct=null 表示该项没数据（不评级）**
    //   —— 前端遇到 null 必须显示「—」，不得显示 0%
    indicators,
    // A17：三项刚性成本率（食材+人工+房租，分业态警戒 68/75/74/71 —— **不是统一 70%**）
    //   字段：pct / level / healthy / warn / danger / warnHit / dangerHit / missing[]
    three_cost: threeCost,
    // 参考带所依据的范围（供前端 picker 回显 + 明示「是否用的是默认口径」）
    indicator_scope: {
      biz_type: bizType,
      city_tier: cityTier,
      is_default_scope: !bizType || !cityTier,
    },
    client_request_id: v.input.client_request_id || '',
  });
};