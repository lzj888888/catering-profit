// utils/paywall.js —— 批次 5 · 付费弹窗（仅「保存超限 / 导出」两类触发 + 接真实下单流）
//
// ⚠️ 交互边界（批次 5 §2.1；R159 扩了触发面）：
//   · 只在「保存数量超限 FREE_LIMIT_EXCEEDED」「导出操作」「套餐 / 外卖 点计算时」触发；
//   · 进入页面 / 录入 / 试算 / 查看历史 **均不触发**（付费能力"可录入、算钱才拦"）；
//   · **M2 模块永不触发**。
// ⚠️ R159：放行类型集合 = `PAYWALL_TYPES`（下方常量）。它与云端 `PAID_FEATURES`
//   派生出的键集合**必须一致**，由 `tools/check_paywall_coverage.js` 强制
//   —— 防「云端登记了付费能力、前端却弹不出墙」（本仓 m3_combo / m3_takeaway 曾长期如此）。
// ⚠️ 文案全部来自 miniprogram/i18n/terms.js（terms.paywall / terms.buttons / terms.pay），禁止 wxml 硬编码。
// ⚠️ 当前阶段 enable_real_payment=false：主按钮走 payCreateOrder 生成订单 → 提示「联系客服开通」；
//   执照下来改后端配置即接真实支付，**前端一行不改**（§2.6）。

const { TERMS } = require('../miniprogram/i18n/terms.js');
const api = require('./api.js');
const { isIOS } = require('./platform.js');

/**
 * 允许的触发类型。**新增付费能力时只改这一处**（配 terms.paywall 同名键 + 守卫 check_paywall_coverage）。
 * 用常量数组，而不是 `type !== 'a' && type !== 'b'` —— 后者每加一个能力就多一截 `&&`，
 * 漏加的表现是"点了没反应"（静默），正是 R159 要根治的形态。
 */
const PAYWALL_TYPES = ['saveLimit', 'export', 'combo', 'takeaway'];

/**
 * 打开付费弹窗。
 * @param {'saveLimit'|'export'|'combo'|'takeaway'} type 触发类型（不在集合内直接忽略 = 防误触发）
 * @param {object} opts
 *   - shopId: 下单来源店铺
 *   - planId: 默认套餐（可选）
 *   - onOrderCreated: (order) => void 下单成功回调（可选）
 *   - onCancel: 用户点「再想想/取消」回调（可选）
 */
function openPaywall(type, opts) {
  if (PAYWALL_TYPES.indexOf(type) < 0) return; // 防误触发
  // R45：iOS 端不得提供虚拟商品购买入口 ⇒ 弹窗改为纯提示，**不给确认下单按钮**
  if (isIOS()) return showIOSBlocked();
  const def = TERMS.paywall[type];
  const buttons = TERMS.buttons;
  wx.showModal({
    title: def.title,
    content: def.content,
    cancelText: def.secondary || buttons.cancel,
    // ⚠️ 平台限制：confirmText ≤4 字符 —— 用 paywall.ctaShort，不用 primary（6 字会 fail）
    confirmText: TERMS.paywall.ctaShort || def.primary,
    confirmColor: '#1e3a5f',
    success(res) {
      if (res.confirm) {
        onConfirm(type, opts || {});
      } else if (opts && typeof opts.onCancel === 'function') {
        opts.onCancel();
      }
    },
    // 2026-09-20 加固：showModal 失败（页面栈/系统拦截）时原来完全静默，用户看到的就是「点了没反应」。
    // 现在兜底 toast 出真实 errMsg，保证任何一次点击都有可见反馈。
    fail(err) {
      wx.showToast({ title: (err && err.errMsg) || def.title, icon: 'none', duration: 2500 });
    },
  });
}

/**
 * R45 · iOS 端拦截提示：只告知、不下单（无 confirm 购买动作）。
 * 文案走 i18n 单源（TERMS.pay.iosBlocked*），禁硬编码。
 */
function showIOSBlocked() {
  wx.showModal({
    title: TERMS.pay.iosBlockedTitle,
    content: TERMS.pay.iosBlockedBody,
    showCancel: false,
    confirmText: TERMS.buttons.gotIt,
    confirmColor: '#1e3a5f',
    fail(err) {
      wx.showToast({ title: (err && err.errMsg) || TERMS.pay.iosBlockedTitle, icon: 'none', duration: 2500 });
    },
  });
}

/**
 * 主按钮确认：创建订单 → 当前阶段（enable_real_payment=false）提示联系客服开通。
 * 不接真实支付时，订单仍写入 shop_payment_flow（订单记录页可见），权益由后台 source=manual 发放。
 *
 * ⚠️ R45 纵深：即便调用方绕过 openPaywall 直接调本函数，iOS 端仍不得下单
 *    （守卫 tools/check_ios_pay.js 只保证"文件里做了判断"，本行保证"运行时真挡住"）。
 */
async function onConfirm(type, opts) {
  if (isIOS()) return showIOSBlocked();
  const shopId = (opts && opts.shopId) || (getApp && getApp().globalData && getApp().globalData.shop_id) || '';
  const planId = (opts && opts.planId) || 'plan_basic_month';
  try {
    const order = await api.call('payCreateOrder', {
      shop_id: shopId,
      plan_id: planId,
      channel: 'wechat',
      client_request_id: 'pw_' + Date.now(),
    });
    if (opts && typeof opts.onOrderCreated === 'function') opts.onOrderCreated(order);
    if (order && order.enable_real_payment === false) {
      // 私域阶段：提示联系客服（文案走 i18n）
      // 🔴 R193：原文案叫用户「请联系客服」，但**没有任何可点的地方**（全站此前 0 处客服入口）
      //   ⇒ 取消键留给「再想想」，确认键直接进客服会话。
      wx.showModal({
        title: TERMS.pay.contactService,
        content: TERMS.pay.contactServiceHint,
        cancelText: TERMS.buttons.thinkAgain,
        confirmText: TERMS.exp.serviceEntry,
        confirmColor: '#1e3a5f',
        success: (r) => { if (r.confirm) openService(); },
      });
    }
    // enable_real_payment=true 后：pay_params 非空 → 拉起 wx.requestPayment（批次 5 后接真实支付）
  } catch (e) {
    api.toastError(e);
  }
}

/**
 * 拉起微信客服会话（R193）。
 * 🔴 为什么要有它：付费墙 / 硬上限提示里写着「请联系客服」，但此前**没有可点的地方**。
 * 🔴 fail-closed：拉不起（后台未绑客服人员 / 基础库过低）时必须给替代路径，绝不静默失败。
 * ⚠️ 需 mp 后台「客服」里绑定客服人员，否则微信侧会话不可用（此时走兜底提示）。
 */
function openService() {
  if (wx.openCustomerServiceConversation) {
    wx.openCustomerServiceConversation({
      sessionFrom: 'paywall',
      fail: () => wx.showToast({ title: TERMS.exp.serviceNotOpen, icon: 'none' }),
    });
    return true;
  }
  wx.showToast({ title: TERMS.exp.serviceNotOpen, icon: 'none' });
  return false;
}

module.exports = { openPaywall, openService, TERMS };