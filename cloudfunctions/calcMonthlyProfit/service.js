// cloudfunctions/calcMonthlyProfit/service.js
// 批次 1 · POC3 双利润引擎 —— Service 层纯计算函数。
//
// ⚠️ 分层铁律：本文件是「纯函数」，只做计算，绝不：
//   · require('wx-server-sdk') / 触碰数据库（批次 0 约定 Service 层禁止引入云开发 SDK）
//   · 接触前端请求对象
// 输入必须是 Controller 校验、清洗、读好服务端开关之后的「干净数据」，金额一律「分」整数。
//
// 口径锁（本批核心考点，刻意设计勿改）：
//   🟢 经营参考利润 = 营业收入 − 总费用 − 【参考口径的食材消耗】 − 一次性投入
//   🔵 全要素真实利润 = 营业收入 − 总费用 − 【真实消耗】 − 当月摊销总费用 − 一次性投入
//      —— 库存开关开 → realConsumeFen = 期初+采购-期末；关 → = directConsumeFen。
//   两利润差异 = (真实消耗 − 参考口径消耗) + 当月摊销(实际计入值)
//
// 🔴 R477（2026-10-25）补一条**此前没考虑过的分支**：「直接填的消耗」**没填**时怎么办。
//   原实现：库存开关一开，「直接填的消耗」那栏在前端**不显示**，值恒为 0 ⇒
//     经营参考利润 = 收入 − 费用 − **0** − 一次性投入 ⇒ **完全没扣食材**，虚高得离谱。
//     老板真机反馈「口径差异为什么等于食材成本？」—— 差异里的食材项其实就是整个食材成本。
//   修正：库存开 且「直接填的消耗」没有正数 ⇒ 参考口径回落到倒轧值。
//
// 🔴🔴 判据为什么是「≤ 0」而不是「未填」（本轮实测修正，别按外审原话理解）：
//   外审建议「未填」与「显式填 0」必须分开，听起来对，**实测在本仓行不通**：
//   库存页保存时前端写死 `direct_consume_fen: this.data.directConsumeFen || 0`
//   （`subpkg/biz/month/inventory.js:240`）⇒ 库存模式下**恒传 0**。
//   这个 0 是**前端占位**，不承载老板意图 —— 库存模式下那栏 UI 根本不显示，
//   老板**没有地方**去「声明这个月没消耗」。若硬按「显式 0 要尊重」处理，
//   等于把 bug 原样保留（实测：参考利润仍是完全没扣食材的 3,116,000 分）。
//   ⇒ 判据定为：**库存开 且 直接填的消耗 ≤ 0（未填/留空/0）⇒ 回落倒轧**。
//      · 库存开 + 填了**正数** ⇒ 用填的值（S2 锚点即此形态，**口径锁不变**）
//      · 库存开 + 0 / 未填    ⇒ 回落倒轧（修掉上面那个虚高）
//      · 库存关              ⇒ 恒用填的值（没有倒轧数据可用）
//   ⚠️ 若将来库存模式也开放这个输入框，"显式 0" 才重新具有语义，届时须回来改这里。
//
// 精度（对齐 POC2 口径 B）：中间全过程用「分」整数运算（禁止浮点存金额），
//   最终输出金额 round 到分整数；毛利率保留 2 位小数展示（同时给全精度字段）。

/**
 * @param {object} clean 干净入参（Controller 已校验/清洗/读好服务端开关）
 *  - incomeItems     收入明细（分）: [{ amountFen }]，系统内部汇总，禁止前端传合计
 *  - expenseItems    费用明细（分）: [{ amountFen }]（房租/人工/水电等在列，属费用非食材成本）
 *  - directConsumeFen 直接填的当月食材耗材总消耗（分）
 *  - amortizeFen      当月摊销总费用（分，外部传入；本批不实现摊销算法）
 *  - amortizeSwitchOn 摊销开关（服务端权威）
 *  - inventorySwitchOn 库存开关（服务端权威）
 *  - inventory        库存（分）: { openingFen, purchaseFen, closingFen }，库存开关开时用
 *  - pendingSettlementFen 待结算（分，现金流指标，绝不进入毛利/利润）
 * @returns {object} 计算报告（金额一律「分」整数 + 对应元数；毛利率双字段）
 */
function calcMonthlyProfit(clean) {
  // ===== 0. 输入防护（仅缺省容忍，负数/坏类型由 Controller 拦截）=====
  const incomeItems = (clean && clean.incomeItems) || [];
  const expenseItems = (clean && clean.expenseItems) || [];
  // ===== R477：直接填的消耗 —— 先**归一化**，再判断（不许直接 === 0）=====
  //  入参可能是 0 / null / undefined / '' / '200' / NaN（前端透传 + 脏数据都到得了这里）。
  //  directProvided = 「老板到底填过没有」；directConsumeFen = 归一化后的数字（未填记 0）。
  const rawDirect = (clean && clean.directConsumeFen);
  const directProvided = rawDirect !== undefined && rawDirect !== null && rawDirect !== ''
    && !(typeof rawDirect === 'number' && Number.isNaN(rawDirect));
  const directConsumeFen = directProvided ? num0(rawDirect) : 0;
  const amortizeFen = num0(clean && clean.amortizeFen);
  // round106（F2）：一次性投入（分）—— 与 getLedger/saveLedger 的引擎副本同源同口径
  const lumpSumFen = num0(clean && clean.lumpSumFen);
  const amortizeSwitchOn = !!(clean && clean.amortizeSwitchOn);
  const inventorySwitchOn = !!(clean && clean.inventorySwitchOn);
  const inv = (clean && clean.inventory) || {};
  const pendingSettlementFen = num0(clean && clean.pendingSettlementFen);

  // ===== 1. 系统汇总（不让收入/费用合计被手动编辑） =====
  // 收入合计/费用合计由 Service 对明细逐项累加得出，绝不取前端传入的总和。
  const incomeTotalFen = incomeItems.reduce((s, it) => s + num0(it && it.amountFen), 0);
  const expenseTotalFen = expenseItems.reduce((s, it) => s + num0(it && it.amountFen), 0);

  // ===== 2. 食材耗材两种取数（食材成本只含食材耗材） =====
  // 库存关 → 直接取用户填的总消耗；库存开 → 倒轧 真实消耗 = 期初 + 采购 − 期末。
  const realConsumeFen = inventorySwitchOn
    ? num0(inv.openingFen) + num0(inv.purchaseFen) - num0(inv.closingFen)
    : directConsumeFen;
  const materialCostFen = realConsumeFen; // 毛利铁律里的「食材成本」

  // ===== 3. 毛利（铁律：菜品毛利 = 营业收入 − 食材成本） =====
  const grossProfitFen = fenRoundN(incomeTotalFen - materialCostFen);

  // 毛利率：全精度（%），展示位单独 round 2 位小数（65.625% → 输出 65.63% 展示）
  const grossMarginRatePct =
    incomeTotalFen === 0 ? 0 : (grossProfitFen / incomeTotalFen) * 100;
  const grossMarginRatePctDisplay = rounded2(grossMarginRatePct);

  // ===== 4. 当月摊销实际计入值（摊销开关关 → 不计入 0） =====
  const effectiveAmortizeFen = amortizeSwitchOn ? fenRoundN(amortizeFen) : 0;
  // round107 纠正：原为「与按月分摊互斥」（amortizeSwitchOn ? 0 : lumpSumFen）—— 那是错的。
  //   摊销资产与一次算清的投入是两笔不同的钱，一个月可以两者都有；互斥会把后者悄悄丢掉。
  //   防重复靠「同一笔钱只登记一行」（mode 二选一）。三副本（本文件 / saveLedger / getLedger）同源同口径。
  const effectiveLumpSumFen = lumpSumFen;

  // ===== 5. 两个利润口径 =====
  // 🟢 参考口径取数（R477）：库存开且「直接填的消耗」没有正数 ⇒ 回落倒轧。
  //   详见本文件头部「判据为什么是 ≤ 0」那段（库存模式下前端恒传 0，那个 0 是占位不是意图）。
  const refMaterialSource = (inventorySwitchOn && !(directConsumeFen > 0)) ? 'reverse' : 'direct';
  const refMaterialFen = refMaterialSource === 'reverse' ? realConsumeFen : directConsumeFen;
  // 🟢 经营参考利润：用【参考口径消耗】 + 一次性投入（实际计入值）。
  const operationRefProfitFen = fenRoundN(
    incomeTotalFen - expenseTotalFen - refMaterialFen - effectiveLumpSumFen
  );
  // 🔵 全要素真实利润：用【真实消耗】 + 当月摊销（实际计入值） + 一次性投入（实际计入值）。
  const totalFactorRealProfitFen = fenRoundN(
    incomeTotalFen - expenseTotalFen - realConsumeFen - effectiveAmortizeFen - effectiveLumpSumFen
  );
  // 两利润差异 = (真实消耗 − 参考口径消耗) + 当月摊销
  //   ⇒ 库存开且未填时，前项为 0，差异**只剩当月摊销**（这正是老板能看懂的解释）。
  const profitDiffFen = fenRoundN(
    (realConsumeFen - refMaterialFen) + effectiveAmortizeFen
  );
  // 🔴 口径版本标识（R477）：库里已存的旧快照**不会**自动重算，页签/导出读到旧值时
  //    必须能认出来 ⇒ 出参带上，前端按版本解释差异，不许拿新解释配旧数字（那叫说谎）。
  const profitCaliberVersion = 'm1_v2';

  // 校验：两口径公式自洽（经营参考 − 全要素真实 === 差异）
  const diffCheck =
    operationRefProfitFen - totalFactorRealProfitFen === profitDiffFen;

  // ===== 6. 汇报 =====
  return {
    // 汇总（系统生成）
    incomeTotalFen, incomeTotalYuan: fenToYuanStr(incomeTotalFen),
    expenseTotalFen, expenseTotalYuan: fenToYuanStr(expenseTotalFen),
    // 食材与毛利
    materialCostFen, materialCostYuan: fenToYuanStr(materialCostFen),
    directConsumeFen, realConsumeFen,
    grossProfitFen, grossProfitYuan: fenToYuanStr(grossProfitFen),
    grossMarginRatePct,
    grossMarginRatePctDisplay,
    // 摊销（本批由外部传入；实际计入值随摊销开关）
    amortizeFen, effectiveAmortizeFen,
    lumpSumFen, effectiveLumpSumFen,
    // 双利润
    operationRefProfitFen, operationRefProfitYuan: fenToYuanStr(operationRefProfitFen),
    totalFactorRealProfitFen, totalFactorRealProfitYuan: fenToYuanStr(totalFactorRealProfitFen),
    profitDiffFen, profitDiffYuan: fenToYuanStr(profitDiffFen),
    // R477：参考口径取了哪个数、为什么（前端解释差异的**取数单源**，不许前端自己猜）
    refMaterialFen, refMaterialSource, directProvided,
    profitCaliberVersion,
    // 口径信息
    switchUsed: { inventorySwitchOn, amortizeSwitchOn },
    // 待结算为现金流指标，仅回显，绝不参与毛利/利润
    pendingSettlementFen,
    // 自洽校验
    diffCheck,
  };
}

// 金额取零兜底（坏引用 → 0；负数/非整数由 Controller 前置校验拦截）
function num0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 金额 round 到「分」整数（最终输出统一取整，中间全过程保持高精度）
function fenRoundN(fen) {
  return Math.round(fen);
}

// 百分比保留 2 位小数（65.625 → 65.63）
function rounded2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// 分 → 元展示字符串（如 916000 → "9160"、347667 → "3476.67"）
// ⚠️ 仅用于**展示**，不参与任何判据（判据一律用「分」整数，见 selftest.js 头部判据纪律）。
//    注：R22 之前此处写作 `Number.isInteger(yuan) ? String(yuan) : String(yuan)`，两个分支完全相同（死分支），现改为直白写法。
function fenToYuanStr(fen) {
  return String(fen / 100);
}

module.exports = { calcMonthlyProfit };