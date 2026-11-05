// cloudfunctions/common/refundPolicy.js —— A14（2026-11-05）退款规则**唯一判定处**（纯函数，零 IO）
//
// 为什么退款要单独成一个模块（而不是写在下单/回调里）：
//   虚拟商品的退款是投诉重灾区（黑猫上"买了不给退"是常态），而规则本身只有 6 条；
//   写进云函数后，**判定逻辑会随支付链路演进而分散**（下单处判一次、退款处判一次、人工客服再判一次）
//   ⇒ 同一个订单三种结论。这里是唯一处：谁要判退款，就调它，不许各写一套 if。
//
// 规则来源：`review/收费与权益_总设计师规范_20261105.md` §6（李老师 2026-11-05 拍板）
//   | 情形 | 处理 |
//   | 买后 7 天内 且 未使用核心权益（未导出、未生成深度诊断报告） | 全额退（无理由退货惯例） |
//   | 已导出报表 / 已生成深度诊断报告 | **不退**（购买前已明示"虚拟商品一经使用不退款"） |
//   | 重复支付 / 系统故障 / 支付成功未到账 | 全额退，不设条件（我方责任） |
//   | 自动续费 | 不存在（全部 one_time，结构性规避） |
//   | iOS 用户走苹果 IAP 退款 | 苹果单方处理，**我们拦不住**，损失自担（需预留运营成本） |
//   | 退款后诊断报告 | **收回访问权**（否则退款仍可看=白嫖，须写入协议） |
//
// 🔴 三条纪律（改本文件前先读）：
//   ① **fail-closed**：判不了（缺支付时间/时间戳非法/未知输入）⇒ `refundable=false` + `need_manual=true`，
//      转人工。绝不"猜一个能退"—— 误退是直接损失，误拒还能人工补救。
//   ② **我方责任优先于使用状态**：重复扣款/系统故障/付了没到账，**即使已导出也必须退**。
//      顺序不能反：先判"有没有用"会把"扣了两次钱"的用户挡在门外（这是最招投诉的形态）。
//   ③ **"已使用"只认两种凭证**：导出记录（`audit_log` 的导出留痕）、深度诊断报告（`shop_diagnosis_report`）。
//      ⚠️ 不许把"登录过""看过页面""算过账"算作已使用 —— 那等于「买了就不许碰」。
//
// ⚠️ 阶段边界（诚实标注）：本模块**只判定，不动钱**。
//   真实退款（`wx.requestVirtualPayment` 的原路退回）+ 落 `order_refund` 台账 + 收权，
//   要等个体工商户主体下来、虚拟支付接通后（规范 §阶段 B）。届时调用方：
//     · 下单/退款云函数：`judgeRefund()` 得结论 → 退 → 写 `order_refund`（索引 idx_refund_order）
//     · 退款成功后必须执行 `verdict.revoke` 里列的动作（收回报告/额度），不许只退不收回。

const DAY_MS = 24 * 60 * 60 * 1000;
/** 无理由退货窗口（自然日）。规范 §6 写死 7 天。 */
const REFUND_WINDOW_DAYS = 7;

/** 判定结论码（前端/客服话术按码取，不靠解析中文） */
const CODES = {
  OUR_FAULT: 'our_fault',              // 重复支付/系统故障/付了没到账 ⇒ 无条件全额退
  IOS_IAP: 'ios_iap',                  // 苹果单方处理 ⇒ 我方不判定，只登记
  USED: 'used',                        // 已导出/已出报告 ⇒ 不退
  UNUSED_IN_WINDOW: 'unused_in_window',// 未使用且在窗口内 ⇒ 全额退
  OUT_OF_WINDOW: 'out_of_window',      // 未使用但超窗口 ⇒ 不退（可人工通融）
  NEED_MANUAL: 'need_manual',          // 判不了 ⇒ 转人工（fail-closed）
};

/**
 * 判定某笔订单能不能退。
 *
 * @param {object} o
 *   - paidAtMs      {number} 支付成功时间戳（毫秒）。缺失/非法 ⇒ 走 NEED_MANUAL
 *   - nowMs         {number} 当前时间戳（毫秒）。**由调用方传入**，本模块不读时钟（纯函数、可测）
 *   - exported      {boolean} 是否已导出过报表（凭证：audit_log 导出留痕）
 *   - diagIssued    {boolean} 是否已生成深度诊断报告（凭证：shop_diagnosis_report）
 *   - duplicatePay  {boolean} 重复扣款
 *   - systemFault   {boolean} 系统故障（我方原因导致交付失败）
 *   - paidNotDelivered {boolean} 支付成功但权益没到账
 *   - iosIap        {boolean} 该笔来自苹果 IAP
 * @returns {{refundable:boolean, code:string, needManual:boolean, usedCore:boolean,
 *            daysSincePaid:number|null, windowDays:number, revoke:string[], reason:string}}
 */
function judgeRefund(o) {
  const opt = o || {};
  const now = Number(opt.nowMs);
  const paid = Number(opt.paidAtMs);
  const exported = opt.exported === true;
  const diagIssued = opt.diagIssued === true;
  const usedCore = exported || diagIssued;
  const ours = opt.duplicatePay === true || opt.systemFault === true || opt.paidNotDelivered === true;

  const base = {
    usedCore,
    windowDays: REFUND_WINDOW_DAYS,
    daysSincePaid: null,
    revoke: [],
  };
  const mk = (refundable, code, reason, extra) => Object.assign({}, base, {
    refundable, code, reason, needManual: code === CODES.NEED_MANUAL,
  }, extra || {});

  // ① 我方责任：**优先于使用状态**（扣两次钱 / 系统故障 / 付了没到账，不该被"你已导出"挡住）
  if (ours) {
    return mk(true, CODES.OUR_FAULT, '我方原因（重复扣款 / 系统故障 / 支付成功未到账），无条件全额退');
  }

  // ② iOS IAP：苹果单方面处理退款，我方既拦不住也不该替它承诺
  if (opt.iosIap === true) {
    return mk(false, CODES.IOS_IAP, '苹果 IAP 订单由苹果单方处理退款，我方无法拦截（需在运营成本里预留）', {
      needManual: true,
    });
  }

  // ③ 时间戳判不了 ⇒ 转人工（fail-closed：不猜窗口）
  if (!Number.isFinite(paid) || !Number.isFinite(now) || paid <= 0) {
    return mk(false, CODES.NEED_MANUAL, '缺少可信的支付时间，无法判定是否在 7 天窗口内，转人工核实');
  }
  const days = Math.floor((now - paid) / DAY_MS);
  base.daysSincePaid = days;
  if (days < 0) {
    // 未来时间 = 时钟/数据异常 ⇒ 同样转人工，不按"刚买"放行
    return mk(false, CODES.NEED_MANUAL, '支付时间晚于当前时间（时钟或数据异常），转人工核实');
  }

  // ④ 已使用核心权益 ⇒ 不退（购买前已明示）。退款后若仍要退（人工通融），必须收回访问权。
  if (usedCore) {
    return mk(false, CODES.USED, exported && diagIssued
      ? '已导出报表且已生成深度诊断报告，虚拟商品已实际交付，不退'
      : (exported ? '已导出报表，虚拟商品已实际交付，不退' : '已生成深度诊断报告，虚拟商品已实际交付，不退'), {
      revoke: revokePlan(exported, diagIssued),
    });
  }

  // ⑤ 未使用 + 窗口内 ⇒ 全额退；超窗口 ⇒ 不退（可人工通融）
  if (days <= REFUND_WINDOW_DAYS) {
    return mk(true, CODES.UNUSED_IN_WINDOW,
      '买后 ' + REFUND_WINDOW_DAYS + ' 天内且未使用核心权益（未导出、未生成报告），全额退');
  }
  return mk(false, CODES.OUT_OF_WINDOW,
    '已超 ' + REFUND_WINDOW_DAYS + ' 天无理由窗口且未使用，按规则不退（可人工通融）');
}

/**
 * 退款成功后**必须收回**的东西（规范 §6 末行：否则退款仍可看 = 白嫖）。
 * ⚠️ 目前只列"有凭证可收"的两项；月卡权益到期由 `payCallback`/`shop_entitlement` 自然处理，
 *   单次额度（`shop_diagnosis_credit`）若已发而报告未出，需回滚额度 —— 列出来，别让调用方自己猜。
 * @returns {string[]} 动作名（调用方按名执行，不解析中文）
 */
function revokePlan(exported, diagIssued) {
  const acts = [];
  if (diagIssued) acts.push('revoke_diag_report');       // shop_diagnosis_report.status → revoked
  acts.push('revoke_diag_credit');                        // shop_diagnosis_credit.credits_left 回滚（若未消耗）
  if (exported) acts.push('log_export_retained');          // 已导出的文件收不回 ⇒ 只留痕（诚实标注，不假装能收）
  return acts;
}

module.exports = { judgeRefund, revokePlan, CODES, REFUND_WINDOW_DAYS, DAY_MS };
