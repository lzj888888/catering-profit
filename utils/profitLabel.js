// utils/profitLabel.js —— R488 · 利润标签**单一来源**（R489 补「摊销 / 一次性投入 / 输入可见」）
//
// ===== 为什么要有这个文件 =====
// 同一个利润数（total_factor_real_profit_fen）曾在三个地方各起一个名字：
//   首页头卡「本月经营参考利润」｜月首页摘要卡「真实利润」｜结果页「本月利润」。
// 老板的原话是「以前双 TAB，刚减下去一个，现在不同场景口径又不一致」——
// 三处实现还各自只看了**一个**开关（首页只看字段来源、月首页只看付费状态、结果页只看库存开关），
// 于是任何一个开关动了，三处就分裂成三种说法。
//
// ===== 定则：名随数走 =====
// 标签描述的是**这个数怎么算出来的**，不是"这一页叫什么"：
//   · 真盘点过（库存开 + 期末填了正数）→「本月利润」+ 按库存倒轧算
//   · 没盘点 →「估算利润」+ 说明拿什么顶的
//       - 库存开 ⇒ 按当月采购入库金额（期末没填）
//       - 库存关 ⇒ 按你直接填的消耗
//   · 取的是参考口径（operation_ref_profit_fen）→「经营参考利润」（免费档月首页那个数）
// ⇒ 同一个数在三处**必然同名**；不同名时，一定是数不同（免费档的参考口径）。
//
// ===== R489：标签只陈述算法，不担保输入准不准 =====
// 旧副标题写「按实际耗用算」，等于替**老板填的期末库存**背书 —— 他随手填一个 28000，
// 这句话照样成立，可食材成本被少算 28000（实测：成本率算出 7%，行业常见 30–48%）。
// 系统无法分辨"真盘点"和"随手填"（服务端不返回布尔，只能由期末>0 推断），
// 所以**不猜**：标签只说算法（按库存倒轧算），同时把**倒轧用的期末库存金额**原样摆出来
// （`basis` + `closingFen`），让老板自己看见那个数 —— 零判断、零误报。
// ⚠️ 不写「成本率 7%、行业 30–48%」这类判据：① 撞 PLAN_AI §3 口径红线（不给行业均值）；
//   ② 高毛利业态/返利月会误报，而餐饮老板对财务提示的信任阈值极高，一次误报废掉全部自检。
//
// ===== 边界 =====
// ⚠️ 纯函数：不拉权益、不读 globalData、**不引能力键**。
//   `real_profit` 不在 PAID_FEATURES 四键内（cloudfunctions/common/entitlement.js），
//   这里写 hasFeature 会撞 tools/check_paywall_coverage.js L6-①。
// ⚠️ 判定只看 getLedger 已下发的字段（switches / inventory / result.* / effective_lump_sum_fen），
//   服务端**不返回**"是否盘点"布尔 ⇒ 只能由「库存开 且 期末 > 0」推断（R485 同源判据）。

const { TERMS } = require('../miniprogram/i18n/terms.js');

const UI = TERMS.ui;
const RP = TERMS.resultPage;

/** 宽松取数：分整数可能是 number，也可能是字符串（历史账/快照） */
function toFen(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 分 → 元字符串。与 utils/api.js::fenToYuan 同款（toFixed(2)、无千分位），不引 api 以保持纯函数。 */
function yuan(fen) {
  return ((Number(fen) || 0) / 100).toFixed(2);
}

/**
 * 这个月到底有没有**真盘点**。
 * 判据 = 库存开关开 **且** 期末库存填了正数（库存页没填时恒传 0，见 R477）。
 * ⚠️ 别改成"只看 inventorySwitchOn"：库存开但没盘点时，倒轧会把"期初 + 全部采购"
 *   当成已消耗 ⇒ 那个数其实是按采购入库额算的估算，标签必须跟着变。
 * ⚠️ 也无法分辨"真盘点"与"随手填"（服务端不返回该事实）⇒ 结论只用于**选说法**，
 *   不用于担保准确；准确性由 `basis`/`closingFen` 摆出来的输入让老板自查。
 * @param {Object} ledger getLedger 出参
 * @returns {boolean}
 */
function hasStockTake(ledger) {
  if (!ledger) return false;
  const sw = ledger.switches || {};
  if (!sw.inventorySwitchOn) return false;
  const inv = ledger.inventory || {};
  const closing = toFen(inv.closing_fen != null ? inv.closing_fen : inv.closing);
  // 期末填正数 ⇒ 必然真盘点（倒轧有数），显式勾选不覆盖（防旧 flag 污染：某月填了正数仍被上月存的 false 误判）
  if (closing != null && closing > 0) return true;
  // 期末为 0 的歧义场景（清仓 / 没盘），才看库存页「本月已盘点」显式勾选：
  //   · 勾选 = 清仓但确实盘了 ⇒ 真盘点
  //   · 未勾选 / 字段缺失 ⇒ 按没盘点算（标签回落「估算利润」）
  const explicit = ledger.stock_take_done;
  return explicit === true;
}

/** 倒轧用的期末库存（分）。没有期末数时返回 null —— 别把 null 当 0 显示成「¥0.00」。 */
function closingFenOf(ledger) {
  const inv = (ledger && ledger.inventory) || {};
  return toFen(inv.closing_fen != null ? inv.closing_fen : inv.closing);
}

/**
 * 选一组「标题 / 副标题 / 提示 / 摊销说明 / 一次性投入」。
 * @param {Object} ledger getLedger 出参（读 switches、inventory、result.*、effective_lump_sum_fen）
 * @param {string} [caliber] 'real'（默认，会计利润 total_factor_real_profit_fen）
 *                           | 'ref'（参考口径 operation_ref_profit_fen）
 * @returns {{caliber:string, title:string, note:string, tip:string,
 *            basis:string, closingFen:number|null, amortText:string, lumpText:string}}
 *   · basis：'stocktake'（按期末库存倒轧，`closingFen` 可用）| 'purchase'（按采购入库额）| 'direct'（按填的消耗）
 *   · amortText：只在**真扣了摊销 / 明确没扣**时说，且只说一句；与副标题不重复
 *   · lumpText：「一次算清」的投入（不受摊销开关控制），有才说
 */
function pickProfitLabel(ledger, caliber) {
  const res = (ledger && ledger.result) || {};
  const sw = (ledger && ledger.switches) || {};
  const invOn = !!sw.inventorySwitchOn;
  const amortOn = !!sw.amortizeSwitchOn;
  const amortFen = Math.max(0, toFen(res.effective_amortize_fen) || 0);
  const lumpFen = Math.max(0, toFen(ledger && ledger.effective_lump_sum_fen) || 0);

  // 「一次算清」的投入：两个口径**都扣**、只在当月扣一次（不受摊销开关控制）。
  //   ⚠️ 它是"摊销关"那个月最容易误读的一笔 —— 副标题说"未扣摊销"，
  //      老板会读成"装修钱一分没算"，实际这笔照扣了 ⇒ 必须单独说一句。
  const lumpText = lumpFen > 0 ? RP.lumpNote(yuan(lumpFen)) : '';

  if (caliber === 'ref') {
    const reverse = res.ref_material_source === 'reverse';
    return {
      caliber: 'ref',
      title: UI.netRef,
      note: reverse ? RP.refNoteReverse : RP.refNoteDirect,
      tip: '',
      basis: reverse ? 'stocktake' : 'direct',
      closingFen: reverse ? closingFenOf(ledger) : null,
      // 参考口径不含摊销 ⇒ 绝不说"已扣摊销"（那是另一个数的属性）
      amortText: '',
      lumpText,
    };
  }

  if (!hasStockTake(ledger)) {
    return {
      caliber: 'real',
      title: RP.profitEstimate,
      // 库存关时食材成本是"你直接填的消耗"，跟采购入库额无关 —— 别套错说明
      note: invOn ? RP.profitNotePurchase : RP.profitNoteEstimateDirect,
      tip: invOn ? RP.noStockTakeTip : '',
      basis: invOn ? 'purchase' : 'direct',
      closingFen: null,
      // R492：与盘点分支（下同）保持**同一套三态** —— 摊销关 ⇒ 不说；开且扣了 ⇒ 报金额；开但为 0 ⇒ 明说没有。
      //   旧写法只在"扣了"时说一句，同样「摊销开 + 本月 0」的组合会因为没盘点而**少一句话**
      //   （NOTE_R489 §3.3 定的是"摊销开则同上"）⇒ 老板分不清"摊销表空着"和"没扣"，与"钱扣在哪要说清"相反。
      amortText: !amortOn ? '' : (amortFen > 0 ? RP.amortLine(yuan(amortFen)) : RP.amortNone),
      lumpText,
    };
  }

  return {
    caliber: 'real',
    title: RP.trueProfit,
    // ⚠️ 措辞只说算法（按库存倒轧算），不写"按实际耗用算"——后者替老板的输入担保准确性
    note: amortOn ? RP.profitNoteStock : RP.profitNoteStockNoAmort,
    tip: '',
    basis: 'stocktake',
    closingFen: closingFenOf(ledger),
    // 摊销金额说一次就够：开关开且真扣了 ⇒ 报金额；开关开但本月为 0 ⇒ 明说没有
    amortText: !amortOn ? '' : (amortFen > 0 ? RP.amortLine(yuan(amortFen)) : RP.amortNone),
    lumpText,
  };
}

module.exports = { hasStockTake, closingFenOf, pickProfitLabel, yuan };
