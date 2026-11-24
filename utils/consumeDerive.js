// utils/consumeDerive.js —— 耗用核查（理论耗用 vs 实际耗用 → 偏差 + 倒推应有采购）
//
// 🔴 定位（李老师 2026-11-24 提出的需求）：
//   老板的原始问题有两个说法。**2026-11-24 三司会诊修正了这里的表述，别再写"两者等价"**：
//     ① 「食材有没有跑冒滴漏」= 实际耗用 − 理论耗用  ⇒ **本模块能答**
//     ② 「采购该采多少钱」   = 实际采购 − 应有采购
//   代数上 `采购 − (理论 + 期末实际 − 期初) ≡ (期初 + 采购 − 期末) − 理论`，恒等成立；
//   **但这不等于「买多了」和「用超了」是同一个业务问题**。反例（豆包提出，成立）：
//     标准耗用 100，要备期末 10 ⇒ 最优采购 110。实际采购 120（买多了 10）；
//     又因生产节约，期末变 30，实际耗用 90（反而用省了 10）。两式都得 −10，业务结论却相反。
//   原因：本模块的「应有采购」以**实际期末库存**为基准，而真正的「买多了」要以**目标库存**为基准。
//   ⇒ 结论：本模块回答的是「**耗用**比标准多了多少」（问题 ①）；
//     对「采购量是否合理」（问题 ②）**只能给一个以实际期末为基准的参照数，不能当买多买少的判据**。
//   会诊全记录：工作区 `_三司_采购消耗核查_最终结论_20261124.md`。
//
// 数据来源（全部为现有云函数出参，**不新增云函数、不落库**）：
//   · 实际耗用：`getLedger` 出参 —— `inventory{opening_fen,purchase_fen,closing_fen}` 倒轧，
//                或直接用引擎已算好的 `result.real_consume_fen`（两者同源，本模块自己算一遍做交叉印证）
//   · 理论耗用：`getDishReview`(tier='full') 出参 —— `totals.costFen` = Σ(qty × 卡内标准成本)
//                同时用 `dine_in[].qty` 与 `totals.qty` 算**销量覆盖率**（见下）
//   · 覆盖率：`reconDerive` 已有「已建卡数 ÷ 在售菜品数」口径；本模块另给**销量加权覆盖率**，
//            因为它直接反映「理论耗用覆盖了多少实际销量」，比卡数口径更贴近本功能
//
// 🔴 红线（本仓最贵的一类错误：给一个看着合理的错数）：
//   ① **覆盖率不足一律抑制**，不给偏差（没建卡的菜无标准成本，理论值必然偏低 ⇒ 偏差假性虚高）。
//   ② **免费层不给算**：`getDishReview` 的 free 档刻意不返回 costFen（"给了等于把毛利白送出去"），
//      此时 costFen 缺失 ⇒ 必须 reason='unpaid'，**绝不把缺失当 0**。
//   ③ **不出绝对阈值评价**：业态差异极大（火锅与快餐损耗率天差地别），凭空给"超过 5% 就是浪费"
//      是假精确。本模块只出事实（理论/实际/偏差/应有采购），评价交给页面按"跟自己历史比"处理。
//   ④ 金额一律「分」；**偏差率**用百分数（13.5 表示 13.5%）；
//      **覆盖率**用比率 0~1（0.6 表示 60%）—— 与 `reconDerive::reconcile` 的 coverage 口径**同源**。
//      两者刻意不同：覆盖率是与 0.6 下界直接比较的阈值量，跟既有守卫保持一致比"统一成百分数"更重要。

const round2 = (n) => Math.round(n * 100 + 1e-9) / 100;
const num0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 销量覆盖率下限：低于此值理论耗用样本不可比，抑制。
//
// 🔴🔴 2026-11-24 实测从 0.6 提到 0.9（这是本模块最贵的一条修正，必须留证）：
//   原设 0.6（沿用 reconDerive 的卡数口径），但在「菜品多、销量悬殊」的真实餐厅下会**凭空造偏差**：
//   实测 100 道菜长尾分布、账上实际耗用正好等于全量理论耗用（即真实偏差 = 0）时：
//     覆盖率 71% ⇒ 显示偏差 +93.7%    覆盖率 78% ⇒ +57.0%    覆盖率 85% ⇒ +31.4%
//     覆盖率 94% ⇒ +11.7%             覆盖率 96% ⇒ +7.6%     覆盖率 100% ⇒ 0.0%
//   根因：理论耗用只含**已建卡**的菜（分母小），实际耗用是**全量**（分子大）⇒ 偏差恒虚高。
//   危害：老板看到「多花 93.7%」会去追责厨师/换供应商 —— **拿错数冤枉人比不给数恶劣得多**。
//   ⇒ 提到 0.9：未修正时误差约 15~20%，叠加下面的「按覆盖率外推」后约 8%，可接受；
//     0.6 时即便外推仍差 37.8%（外推假设「未建卡菜成本结构与已建卡相近」，长尾下不成立）。
//   ⚠️ 上界不设 1：销量覆盖率天然 ≤ 1（matchedQty ≤ totalQty），不会出现卡数口径那种「卡比菜多」。
const MIN_QTY_COVERAGE = 0.9;

const REASONS = {
  NO_SALES: 'no_sales',             // 本月没导入销量 / 销量为 0 ⇒ 理论耗用无从谈起
  NO_INVENTORY: 'no_inventory',     // 没填库存三栏（或库存开关关）⇒ 实际耗用无从倒轧
  UNPAID: 'unpaid',                 // 免费层：getDishReview 未返回 costFen
  COVERAGE_LOW: 'coverage_low',     // 已建卡菜的销量占比不足 ⇒ 偏差不可比
  ZERO_THEORY: 'zero_theory',       // 理论耗用为 0（成本卡成本全 0？）⇒ 偏差率无法计算
};

/**
 * 从 getDishReview 出参取销量覆盖率：matchedQty ÷ totals.qty
 * 🔴 为什么用销量而不是卡数：本功能的分母是「理论耗用」，它只含已建卡菜的成本；
 *   所以要衡量的是「已建卡菜覆盖了多少销量」，卡数口径会在「一卡对应多菜/停售卡」时失真。
 * @param {object} review getDishReview 出参
 * @returns {{coverage:number|null, matchedQty:number, totalQty:number}}
 */
function qtyCoverageOf(review) {
  const list = (review && Array.isArray(review.dine_in)) ? review.dine_in : [];
  const matchedQty = list.reduce((s, x) => s + num0(x && x.qty), 0);
  const totalQty = num0(review && review.totals && review.totals.qty);
  if (!(totalQty > 0)) return { coverage: null, matchedQty, totalQty };
  // 🔴 比率 0~1（不是百分数）：与 reconDerive 的 coverage 同源，便于共用 0.6 下界语义
  return { coverage: round2(matchedQty / totalQty), matchedQty, totalQty };
}

/**
 * 耗用核查主函数。
 * @param {object} input
 * @param {object} input.ledger        getLedger 出参
 * @param {object} input.review        getDishReview 出参（可为 null / {} ⇒ 按"没销量"处理）
 * @param {boolean} [input.inventorySwitchOn] 库存开关（缺省读 ledger.switches.inventorySwitchOn）
 * @returns {object} ok=true 时给全套数；ok=false 时给 reason（页面据此显示「算不了 + 缺什么」）
 */
function consumeVariance(input) {
  const p = input || {};
  const ledger = p.ledger || {};
  const review = p.review || {};
  const inv = ledger.inventory || {};

  // ---------- 1) review 完全没数据（没调用 / 调用失败 / 空对象）----------
  // 🔴 必须先于「免费层」判定：否则 review={} 会因为 costFen 缺失而误报 unpaid，
  //   让老板以为"升级就能算"，而真正的问题是**本月没导入销量**——诊断方向被带反
  //   （同族于 reconDerive R298X 修过的「抑制原因串到覆盖率文案」）。
  const reviewEmpty = !review || typeof review !== 'object' || Object.keys(review).length === 0;
  if (reviewEmpty) return { ok: false, reason: REASONS.NO_SALES };

  // ---------- 2) 免费层：拿不到 costFen ⇒ 直接抑制 ----------
  // 🔴 判定用「字段是否存在」而不是 tier 字符串：tier 是契约字段，但真正会算错的是 costFen 缺失。
  //   两条件取或：tier==='free' 明确是免费层；costFen 非数字说明这次返回里根本没有这项。
  const rawCost = review && review.totals ? review.totals.costFen : undefined;
  const tierFree = (review && review.tier === 'free');
  if (tierFree || typeof rawCost !== 'number') {
    return { ok: false, reason: REASONS.UNPAID };
  }

  // ---------- 3) 销量：没有销量就没有理论耗用 ----------
  const qc = qtyCoverageOf(review);
  if (!(qc.totalQty > 0)) return { ok: false, reason: REASONS.NO_SALES, qtyCoverage: qc.coverage };

  // ---------- 3) 库存三栏：没有三栏就倒轧不出实际耗用 ----------
  const switchOn = (p.inventorySwitchOn !== undefined)
    ? !!p.inventorySwitchOn
    : !!(ledger.switches && ledger.switches.inventorySwitchOn);
  const openingFen = num0(inv.opening_fen);
  const purchaseFen = num0(inv.purchase_fen);
  const closingFen = num0(inv.closing_fen);
  // 🔴 三栏全 0 视为「没填」而不是「真的没库存」：全 0 会让实际耗用恒为 0，偏差恒等于 −理论值，
  //   得出「这个月一粒米都没用」的荒谬结论。宁可说算不了。
  const invBlank = (openingFen === 0 && purchaseFen === 0 && closingFen === 0);
  if (!switchOn || invBlank) {
    return { ok: false, reason: REASONS.NO_INVENTORY, inventorySwitchOn: switchOn, invBlank };
  }

  // ---------- 4) 覆盖率闸门：样本不可比就抑制 ----------
  if (qc.coverage == null || qc.coverage < MIN_QTY_COVERAGE) {
    return {
      ok: false,
      reason: REASONS.COVERAGE_LOW,
      qtyCoverage: qc.coverage,
      matchedQty: qc.matchedQty,
      totalQty: qc.totalQty,
      minCoverage: MIN_QTY_COVERAGE,
    };
  }

  // ---------- 5) 计算 ----------
  const theoryMatchedFen = Math.round(num0(rawCost));   // 只含**已建卡**的菜（实算，无假设）
  // 🔴 按覆盖率外推全量理论耗用：未建卡的菜按「与已建卡同比例成本」估。
  //   为什么必须外推：不比的话分子（全量实际）配小分母（只含建卡的理论）⇒ 偏差恒虚高，
  //   实测 94% 覆盖率下真实无偏差也会显示 +11.7%（详见 MIN_QTY_COVERAGE 处留证）。
  //   为什么外推也不完美：它假设「未建卡菜的成本结构与已建卡相近」，长尾菜偏高/偏低时不成立
  //   ⇒ 所以 0.9 下界 + 页面标注 `extrapolated` 双保险，绝不把估算当实算展示。
  const theoreticalFen = Math.round(theoryMatchedFen / qc.coverage);
  const extrapolated = qc.coverage < 1;

  // 实际耗用：本模块自己倒轧一遍，并与引擎出参交叉印证（不一致说明数据被改过或口径漂了）
  const actualFen = Math.round(openingFen + purchaseFen - closingFen);
  const engineActualFen = (ledger.result && ledger.result.real_consume_fen != null)
    ? Math.round(num0(ledger.result.real_consume_fen)) : null;
  // ⚠️ 不因不一致而改数：以「本模块按三栏直算」为准（三栏是老板亲眼录的原值），
  //   引擎值与它不符只做提示字段返回，由页面决定是否提示「数据可能被改动」。
  const crossCheckOk = (engineActualFen == null) ? null : (engineActualFen === actualFen);

  if (!(theoryMatchedFen > 0)) {
    // 理论耗用为 0 时偏差率无意义（除零）；仍返回两个金额让页面能说「理论上该用 0」
    return {
      ok: false,
      reason: REASONS.ZERO_THEORY,
      actualFen,
      theoreticalFen,
      theoryMatchedFen,
      qtyCoverage: qc.coverage,
    };
  }

  const varianceFen = actualFen - theoreticalFen;      // 正数 = 比应有多花了
  const variancePct = round2((varianceFen / theoreticalFen) * 100);

  // 倒推应有采购（与方差同源，见文件头恒等式证明）
  const shouldPurchaseFen = Math.round(theoreticalFen + closingFen - openingFen);
  const purchaseVarianceFen = purchaseFen - shouldPurchaseFen;   // 恒等于 varianceFen

  return {
    ok: true,
    // 三个核心数（元为单位由页面换算，本模块一律「分」）
    theoreticalFen,
    actualFen,
    varianceFen,
    variancePct,
    // 🔴 理论耗用的两个口径必须都给：实算（只含已建卡）与外推（全量估算）。
    //   页面在 extrapolated=true 时必须标明「含未建卡菜按比例估算」，不许把估算当实算展示。
    theoryMatchedFen,
    extrapolated,
    // ⚠️ shouldPurchaseFen 是以**实际期末库存**为基准的参照值，回答的是耗用偏差（代数恒等），
  //   **不能当作「买多买少」的判据**（那需要目标库存，本模块没有）——见文件头会诊修正。
    shouldPurchaseFen,
    actualPurchaseFen: Math.round(purchaseFen),
    purchaseVarianceFen,
    // 明细（页面可直接展示三栏，帮老板核对）
    openingFen: Math.round(openingFen),
    closingFen: Math.round(closingFen),
    // 覆盖率与样本量
    qtyCoverage: qc.coverage,
    matchedQty: qc.matchedQty,
    totalQty: qc.totalQty,
    // 交叉印证：本模块倒轧值 与 引擎 real_consume_fen 是否一致（null=引擎没给）
    engineActualFen,
    crossCheckOk,
  };
}

/**
 * 「算不了」时告诉老板**缺什么、去哪儿补**（文案键由页面映射，本函数只给键与去向）。
 * 🔴 与 reconDerive::fixTargetOf 同族：只给「去别的页才能解决」的直达入口，
 *   覆盖率不足/理论为 0 属本页可解释范围，不跳走（跳走会把老板带错方向）。
 * @param {string} reason consumeVariance 返回的 reason
 * @returns {{labelKey:string, url:string}}
 */
function missingOf(reason) {
  if (reason === REASONS.NO_SALES) return { labelKey: 'reconConsumeNeedSales', url: '/pages/m3/dishreview/index' };
  if (reason === REASONS.NO_INVENTORY) return { labelKey: 'reconConsumeNeedInventory', url: '/subpkg/biz/month/inventory' };
  if (reason === REASONS.UNPAID) return { labelKey: 'reconConsumeNeedUpgrade', url: '' };
  if (reason === REASONS.COVERAGE_LOW) return { labelKey: 'reconConsumeNeedCoverage', url: '/subpkg/biz/card/index' };
  return { labelKey: 'reconConsumeNeedTheory', url: '/subpkg/biz/card/index' };
}

module.exports = {
  consumeVariance,
  qtyCoverageOf,
  missingOf,
  REASONS,
  MIN_QTY_COVERAGE,
};
