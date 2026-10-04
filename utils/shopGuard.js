// utils/shopGuard.js —— R215 · 无店铺态（no_shop）统一引导
//
// 为什么要它（R214 全链路通跑发现）：
//   服务端 `getShopContext` 自 R208 起会返回 `no_shop: true`（用户把店铺**主动删空**，
//   且服务端**刻意不再自动补建** —— 见 cloudfunctions/getShopContext/index.js:46-66，
//   那里同时讲清了"若还自动建店会撞确定性 _id 导致全站报错"的坑）。
//   但**前端零处理**：全仓 grep `no_shop` 零命中 ⇒ 删空唯一店铺后，
//   用户进任何页面都是「店铺名空白 + 各页请求带空 shop_id」，**没有任何引导**，
//   看上去就是"小程序坏了"。
// 本工具是那唯一一处收口：页面 onShow 拉上下文时，若 no_shop ⇒ 弹一次引导并送去店铺页。
//
// 🔴 两条硬约束：
//   ① showModal 的 confirmText 平台上限 **4 字符**（超了整窗 fail 且**静默**）⇒
//      这里**复用既有术语键**（`exp.switchTitle` = 4 字），不新造文案（新文案要动 terms 单源三处）。
//   ② 同会话只弹一次（`globalData.noShopPrompted`）—— 用户在三个 tab 间来回切时不再重复打扰。
const api = require('./api.js');
const { TERMS } = require('../miniprogram/i18n/terms.js');

// 只弹引导，不拉上下文（供首页这类"每次 onShow 都要刷新"的页面复用）。
function promptNoShop() {
  const app = getApp && getApp();
  if (!app || !app.globalData) return false;
  if (app.globalData.noShopPrompted) return false;   // 同会话只弹一次
  app.globalData.noShopPrompted = true;
  wx.showModal({
    title: TERMS.exp.noShop,
    content: TERMS.exp.noShopHint,
    cancelText: TERMS.buttons.cancel,
    confirmText: TERMS.exp.switchTitle,
    confirmColor: '#1e3a5f',
    success: (r) => {
      if (r.confirm) wx.navigateTo({ url: '/pages/shop/switch' });
    },
  });
  return true;
}

module.exports = {
  promptNoShop,

  /**
   * 拉店铺上下文（带会话缓存，见 utils/api.js::ensureShop）；若用户已把店铺清空 ⇒
   * 弹一次引导并返回 **null**（页面据此提前 return，别再拿空 shop_id 往下发请求）。
   * @returns {Promise<object|null>}
   */
  async ensureShop() {
    const ctx = await api.ensureShop();
    if (ctx && ctx.no_shop) {
      promptNoShop();
      return null;
    }
    return ctx;
  },
};
