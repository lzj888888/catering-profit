// utils/profitLabel.js —— R488 · 利润标签**单一来源**
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
//   · 真盘点过（库存开 + 期末填了正数）→「本月利润」+ 按实际耗用算
//       - 开了摊销 ⇒ 已扣当月摊销；没开摊销 ⇒ 必须明说"未含摊销"（否则被当落袋）
//   · 没盘点 →「估算利润」+ 说明拿什么顶的
//       - 库存开 ⇒ 按当月采购入库金额（期末没填）
//       - 库存关 ⇒ 按你直接填的消耗
//   · 取的是参考口径（operation_ref_profit_fen）→「经营参考利润」（免费档月首页那个数）
// ⇒ 同一个数在三处**必然同名**；不同名时，一定是数不同（免费档的参考口径）。
//
// ===== 边界 =====
// ⚠️ 纯函数：不拉权益、不读 globalData、**不引能力键**。
//   `real_profit` 不在 PAID_FEATURES 四键内（cloudfunctions/common/entitlement.js），
//   这里写 hasFeature 会撞 tools/check_paywall_coverage.js L6-①。
// ⚠️ 判定只看 getLedger 已下发的字段（switches / inventory / result.ref_material_source），
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

/**
 * 这个月到底有没有**真盘点**。
 * 判据 = 库存开关开 **且** 期末库存填了正数（库存页没填时恒传 0，见 R477）。
 * ⚠️ 别改成"只看 inventorySwitchOn"：库存开但没盘点时，倒轧会把"期初 + 全部采购"
 *   当成已消耗 ⇒ 那个数其实是按采购入库额算的估算，标签必须跟着变。
 * @param {Object} ledger getLedger 出参
 * @returns {boolean}
 */
function hasStockTake(ledger) {
  if (!ledger) return false;
  const sw = ledger.switches || {};
  if (!sw.inventorySwitchOn) return false;
  const inv = ledger.inventory || {};
  const closing = toFen(inv.closing_fen != null ? inv.closing_fen : inv.closing);
  return closing != null && closing > 0;
}

/**
 * 选一组「标题 / 副标题 / 提示」。
 * @param {Object} ledger getLedger 出参（读 switches、inventory、result.ref_material_source）
 * @param {string} [caliber] 'real'（默认，会计利润 total_factor_real_profit_fen）
 *                           | 'ref'（参考口径 operation_ref_profit_fen）
 * @returns {{caliber:string, title:string, note:string, tip:string}}
 */
function pickProfitLabel(ledger, caliber) {
  const res = (ledger && ledger.result) || {};

  if (caliber === 'ref') {
    return {
      caliber: 'ref',
      title: UI.netRef,
      note: res.ref_material_source === 'reverse' ? RP.refNoteReverse : RP.refNoteDirect,
      tip: '',
    };
  }

  const sw = (ledger && ledger.switches) || {};
  const invOn = !!sw.inventorySwitchOn;

  if (!hasStockTake(ledger)) {
    return {
      caliber: 'real',
      title: RP.profitEstimate,
      // 库存关时食材成本是"你直接填的消耗"，跟采购入库额无关 —— 别套错说明
      note: invOn ? RP.profitNotePurchase : RP.profitNoteEstimateDirect,
      tip: invOn ? RP.noStockTakeTip : '',
    };
  }

  return {
    caliber: 'real',
    title: RP.trueProfit,
    note: sw.amortizeSwitchOn ? RP.profitNoteStock : RP.profitNoteStockNoAmort,
    tip: '',
  };
}

module.exports = { hasStockTake, pickProfitLabel };
