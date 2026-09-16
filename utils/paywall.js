// utils/paywall.js —— 批次 4 · 付费弹窗（仅「保存超限 / 导出」两类触发）
//
// ⚠️ 交互边界（批次 4 §强制遵守 7）：
//   · 只在「保存数量超限 FREe_LIMIT_EXCEEDED」「导出操作」时触发；
//   · 进入页面 / 录入 / 试算 / 查看历史 **均不触发**；
//   · **M2 模块永不触发**。
// 文案全部来自 miniprogram/i18n/terms.js（terms.paywall / terms.buttons），禁止 wxml 硬编码。
// ⚠️ 支付在批次 5 实现：本批 primary 按钮仅弹「功能将在下一版开放」toast 占位，不执行支付。

const { TERMS } = require('../miniprogram/i18n/terms.js');

/**
 * 打开付费弹窗。
 * @param {'saveLimit'|'export'} type 触发类型（仅允许这两种）
 * @param {object} opts
 *   - onUnlock: 主按钮回调（批次 5 接支付；本批为占位）
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
        if (opts && typeof opts.onUnlock === 'function') opts.onUnlock();
        else {
          // 批次 5 前占位：提示开通功能将在后续版本开放（文案走 i18n）
          wx.showToast({ title: TERMS.ui.unlockLater, icon: 'none' });
        }
      }
    },
  });
}

module.exports = { openPaywall, TERMS };