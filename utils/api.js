// utils/api.js —— 批次 4 · 前端统一请求适配层
//
// 职责（强制执行批次 4 §强制遵守）：
//   1) 所有云函数请求自动注入 shop_id（来自 app.globalData，读 getShopContext 后设置）。
//   2) 错误统一映射后端标准错误码（经 i18n/terms.js 的 msgOf），禁止页面自造错误文案。
//   3) 金额「元→分」转换：界面单位是「元」，适配层 Math.round(元×100) 转成整数「分」number 再传，
//      ❌ 禁止把 input 字符串直接透传（云函数对非 number 一律 INVALID_PARAM）。
module.exports = {
  /**
   * 调云函数（自动注入 shop_id + 统一错误映射）。
   * @returns {Promise<object>} 解析出的 data（后端 { code:'SUCCESS', data } 已解包）
   * @throws {{code,msg}} 非 SUCCESS 时抛 { code, msg }（msg 已 i18n 映射）
   */
  async call(name, payload) {
    const app = getApp && getApp();
    const shopId = (app && app.globalData && app.globalData.shop_id) || (payload && payload.shop_id) || '';
    const body = Object.assign({ shop_id: shopId }, payload || {});
    let res;
    try {
      res = await wx.cloud.callFunction({ name, data: body });
    } catch (e) {
      // G8：网络不可用（云调用底层失败，如断网/超时/环境不可达）→ 区分「网络不可用」与「服务端错误」
      const terms8 = require('../miniprogram/i18n/terms.js');
      const t8 = (terms8 && terms8.TERMS && terms8.TERMS.exp) || {};
      const networkMsg = t8.networkErr || 'NETWORK_ERROR';
      const serviceMsg = t8.serviceUnavailable || 'SERVICE_UNAVAILABLE';
      const msg = (e && e.errMsg && /cloud\.callFunction:fail|ERR_NETWORK|timeout|offline/i.test(e.errMsg))
        ? networkMsg
        : ((e && e.errMsg) || serviceMsg);
      // 2026-09-20 诊断加固：「网络不可用」这个提示把真实原因吞掉了 —— 上一次真机事故里，
      // 真实原因是云函数部署漏带依赖导致容器起不来（callFunction fail），却只显示"请检查网络连接"。
      // 现在把原始 errMsg 打到 console，真机可在「开发调试/日志」里看到，不再靠猜。
      console.error('[api.call] 云调用失败:', name, '| errMsg =', (e && e.errMsg) || e);
      throw { code: 'NETWORK_ERROR', msg };
    }
    const r = res && res.result;
    if (!r) {
      const terms = require('../miniprogram/i18n/terms.js');
      const msg = (terms && terms.msgOf) ? terms.msgOf('SYSTEM_ERROR') : '服务无响应';
      throw { code: 'SYSTEM_ERROR', msg };
    }
    if (r.code !== 'SUCCESS') {
      const terms = require('../miniprogram/i18n/terms.js');
      // 云函数内部抛异常时 result 形如 { error: '...' } 而非 { code, data }；
      // 此时 msgOf(undefined) 会统统显示「系统异常」，掩盖真实原因 → 打印原文供定位。
      if (r.error) console.error('[api.call] 云函数执行异常:', name, '| error =', r.error);
      const msg = (terms && terms.msgOf) ? terms.msgOf(r.code) : (r.msg || '操作失败');
      throw { code: r.code || 'SYSTEM_ERROR', msg };
    }
    return r.data || {};
  },

  /** 元（字符串/数字）→ 分（number）整数。input 值是字符串、界面单位是元。 */
  yuanToFen(yuanInput) {
    const n = Number(yuanInput);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  },

  /** 分 → 展示字符串（如 2200000 → "22000.00"）。仅展示，不参与任何计算。 */
  fenToYuan(fen, digits) {
    const v = (Number(fen) || 0) / 100;
    const d = digits === undefined ? 2 : digits;
    return v.toFixed(d);
  },

  /** 方案内：分 → 展示元（月核算大额用整数展示，如 916000 → "9160"）。 */
  fenToYuanInt(fen) {
    return String(Math.round((Number(fen) || 0) / 100));
  },

  /**
   * 确保店铺上下文已加载（首次进入拉 getShopContext 写入 globalData）。
   * 页面 onShow 调用；返回 ctx（含 shop_id / shop_name / switches）。
   */
  async ensureShop() {
    const app = getApp && getApp();
    if (app && app.globalData && app.globalData.shop_id) {
      return app.globalData;
    }
    const ctx = await this.call('getShopContext', {});
    if (app && app.setShopContext) app.setShopContext(ctx);
    return ctx;
  },

  /** 展示后端标准错误（已 i18n 映射）；供 catch 统一调用 */
  toastError(e) {
    const terms = require('../miniprogram/i18n/terms.js');
    const fallback = (terms && terms.msgOf) ? terms.msgOf('SYSTEM_ERROR') : '操作失败';
    wx.showToast({ title: (e && e.msg) || fallback, icon: 'none' });
  },
};