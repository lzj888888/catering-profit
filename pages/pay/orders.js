// pages/pay/orders.js —— 批次 5 · 订单记录页
//
// ⚠️ 数据源 = payOrderList（订单主体=user_id，全店通用）；金额分整数仅格式化展示。
// ⚠️ 展示「当前有效期至」+「续费」入口（到期前 30 天内、到期后均可见——由后端返回的 days_left 判断，
//   前端只读 expire_at 相关值，不读 plan_id）。续费调 payRenew。
// ⚠️ 当前阶段 enable_real_payment=false：续费下单后提示「联系客服开通」，权益由后台发放。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const entitle = require('../../utils/entitlement.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      title: TERMS.pay.orderTitle,
      orderNo: TERMS.pay.orderNo,
      plan: TERMS.pay.plan,
      amount: TERMS.pay.amount,
      channel: TERMS.pay.channel,
      status: TERMS.pay.status,
      statusPaid: TERMS.pay.statusPaid,
      statusPending: TERMS.pay.statusPending,
      statusManual: TERMS.pay.statusManual,
      paidAt: TERMS.pay.paidAt,
      empty: TERMS.pay.empty,
      expireInfo: TERMS.pay.expireInfo,
      renew: TERMS.pay.renew,
      contactService: TERMS.pay.contactService,
      contactServiceHint: TERMS.pay.contactServiceHint,
      thinkAgain: TERMS.buttons.thinkAgain,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    expireText: '',
    showRenew: false,       // 到期前 30 天内或到期后 → 可见续费
    orders: [],
    loading: true,
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.pay.orderTitle);
      // 1) 权益（只读 expire_at）
      let ent = { expire_at: 0, is_active: false, days_left: 0 };
      try { ent = await entitle.fetchEntitlement(); } catch (e) { /* 权益查询失败不影响订单列表 */ }
      const expireText = ent.expire_at > 0 ? entitle.beijingDate(ent.expire_at) : '';
      // 2) 订单列表
      const d = await api.call('payOrderList', {});
      const orders = (d.list || []).map((o) => ({
        order_no: o.order_no,
        plan_name: o.plan_name || '',
        amount: api.fenToYuan(o.amount_fen, 2),
        channel: o.channel || '',
        status_text: this.statusText(o.status),
        status: o.status,
        paid_at: o.paid_at ? this.fmtTime(o.paid_at) : '—',
      }));
      this.setData({
        orders,
        expireText,
        // 续费入口：到期前 30 天内（days_left<=30）或已到期均可见；长期有效不显示
        showRenew: ent.expire_at === 0 || ent.days_left <= 30,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  statusText(s) {
    const t = this.data.t;
    if (s === 'paid') return t.statusPaid;
    if (s === 'pending') return t.statusPending;
    return t.statusManual;
  },

  fmtTime(ms) {
    const d = new Date(Number(ms));
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  // 续费：下单（复用 payCreateOrder 逻辑的 payRenew）；私域阶段提示联系客服
  async onRenew() {
    try {
      await api.ensureShop();
      const order = await api.call('payRenew', {
        plan_id: 'plan_basic_month',
        channel: 'wechat',
        client_request_id: 'rn_' + Date.now(),
      });
      if (order && order.enable_real_payment === false) {
        wx.showModal({
          title: TERMS.pay.contactService,
          content: TERMS.pay.contactServiceHint,
          showCancel: false,
          confirmText: TERMS.buttons.thinkAgain,
          confirmColor: '#ff6b35',
        });
      }
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});