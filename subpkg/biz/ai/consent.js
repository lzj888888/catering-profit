// subpkg/biz/ai/consent.js —— R434（队列 #29）AI 辅助分析授权页
//
// 三态：未开（stNone）/ 已开（stOk）/ 条款已更新（stStale，需重新确认）
// 🔴 判"已开"用 effective_scope 是否有值，不依赖 state 枚举字符串 —— 枚举改名页面不会跟着坏。
// 🔴 grant 必须回传 policy_version_now（服务端校验"旧同意不能覆盖新条款"）；
//    没有它就不能开，页面会禁用按钮并提示，**不硬编码版本号**。
// 🔴 三项能力对应 common/aiGate.js 的 PURPOSES = diagnose / pricing / expand（同源，不另立枚举）。
const api = require('../../../utils/api.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');

const T = TERMS.aiConsent;
const SCOPES = ['diagnose', 'pricing', 'expand'];

Page({
  data: {
    t: {
      navTitle: T.navTitle,
      title: T.title,
      lead: T.lead,
      stNone: T.stNone,
      stOk: T.stOk,
      stStale: T.stStale,
      secWhat: T.secWhat,
      pDiagnose: T.pDiagnose,
      pDiagnoseDesc: T.pDiagnoseDesc,
      pPricing: T.pPricing,
      pPricingDesc: T.pPricingDesc,
      pExpand: T.pExpand,
      pExpandDesc: T.pExpandDesc,
      secData: T.secData,
      data1: T.data1,
      data2: T.data2,
      data3: T.data3,
      btnGrant: T.btnGrant,
      btnRevoke: T.btnRevoke,
      btnReagree: T.btnReagree,
      doneGrant: T.doneGrant,
      doneRevoke: T.doneRevoke,
      loadFail: T.loadFail,
    },
    loading: true,
    granted: false,
    stale: false,
    busy: false,
    scopeCount: 0,
  },

  onLoad() {
    this.load();
  },

  async load() {
    try {
      const d = (await api.call('getAiConsent', {})) || {};
      const eff = Array.isArray(d.effective_scope) ? d.effective_scope : [];
      this._policyNow = d.policy_version_now || '';
      this.setData({
        loading: false,
        granted: eff.length > 0,
        stale: !!d.policy_stale,
        scopeCount: eff.length,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: T.loadFail, icon: 'none' });
    }
  },

  async onToggle() {
    if (this.data.busy) return;
    if (this.data.granted) return this.revoke();
    return this.grant();
  },

  async grant() {
    if (!this._policyNow) {
      wx.showToast({ title: T.loadFail, icon: 'none' });
      return;
    }
    this.setData({ busy: true });
    try {
      await api.call('grantAiConsent', { scope: SCOPES, policy_version: this._policyNow });
      wx.showToast({ title: T.doneGrant, icon: 'success' });
      await this.load();
    } catch (e) {
      // 后端 fail 的 msg 到不了用户眼前（utils/api.js 会覆盖成通用文案）⇒ 用通用提示
      wx.showToast({ title: T.loadFail, icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async revoke() {
    this.setData({ busy: true });
    try {
      await api.call('revokeAiConsent', {});
      wx.showToast({ title: T.doneRevoke, icon: 'success' });
      await this.load();
    } catch (e) {
      wx.showToast({ title: T.loadFail, icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },
});
