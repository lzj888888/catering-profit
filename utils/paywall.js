// utils/paywall.js —— 批次 5 · 付费弹窗（仅「保存超限 / 导出」两类触发 + 接真实下单流）
//
// ⚠️ 交互边界（批次 5 §2.1）：
//   · 只在「保存数量超限 FREE_LIMIT_EXCEEDED」「导出操作」时触发；
//   · 进入页面 / 录入 / 试算 / 查看历史 **均不触发**；
//   · **M2 模块永不触发**。
// ⚠️ 文案全部来自 miniprogram/i18n/terms.js（terms.paywall / terms.buttons / terms.pay），禁止 wxml 硬编码。
// ⚠️ 当前阶段 enable_real_payment=false：主按钮走 payCreateOrder 生成订单 → 提示「联系客服开通」；
//   执照下来改后端配置即接真实支付，**前端一行不改**（§2.6）。

const { TERMS } = require('../miniprogram/i18n/terms.js');
const api = require('./api.js');

/**
 * 打开付费弹窗。
 * @param {'saveLimit'|'export'} type 触发类型（仅允许这两种；其他值直接忽略 = 防误触发）
 * @param {object} opts
 *   - shopId: 下单来源店铺
 *   - planId: 默认套餐（可选）
 *   - onOrderCreated: (order) => void 下单成功回调（可选）
 *   - onCancel: 用户点「再想想/取消」回调（可选）
 */
function openPaywall(type, opts) {
  if (type !== 'saveLimit' && type !== 'export') return; // 防误触发
  const def = TERMS.paywall[type];
  const buttons = TERMS.buttons;
  wx.showModal({
    title: def.title,
    content: def.content,
    cancelText: def.secondary || buttons.cancel,
    confirmText: def.primary || buttons.unlockPro,
    confirmColor: '#ff6b35',
    success(res) {
      if (res.confirm) {
        onConfirm(type, opts || {});
      } else if (opts && typeof opts.onCancel === 'function') {
        opts.onCancel();
      }
    },
  });
}

/**
 * 主按钮确认：创建订单 → 当前阶段（enable_real_payment=false）提示联系客服开通。
 * 不接真实支付时，订单仍写入 shop_payment_flow（订单记录页可见），权益由后台 source=manual 发放。
 */
async function onConfirm(type, opts) {
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
      wx.showModal({
        title: TERMS.pay.contactService,
        content: TERMS.pay.contactServiceHint,
        showCancel: false,
        confirmText: TERMS.buttons.thinkAgain,
        confirmColor: '#ff6b35',
      });
    }
    // enable_real_payment=true 后：pay_params 非空 → 拉起 wx.requestPayment（批次 5 后接真实支付）
  } catch (e) {
    api.toastError(e);
  }
}

module.exports = { openPaywall, TERMS };