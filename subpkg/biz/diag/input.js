// subpkg/biz/diag/input.js —— A20（2026-11-05）· 深度诊断 · 补录页
//
// 职责单一：把引擎**取不到的那几项客观值**收上来，存进 `shop.diag_facts`。
//   M1 的账能自动算 65 分（盈利/连亏/现金流结构/毛利率/人工率/房租率），
//   剩下 35 分要这几个值：去年同期客流 / 平台评分 / 差评趋势 / 商圈五档 / 剩余租期 / 借贷三档
//   + 账面现金（现金流那条红线的必要输入，缺它 R1 只能判「未判定」）。
//
// ============ 三条纪律 ============
// 🔴 1. 全部可留空。留空 = 那几项**不进分母**（引擎按"未判定"处理），**绝不按 0 分算** ——
//      按 0 算会把「没填」说成「你这项很烂」，老板第一次用就被冤枉。
// 🔴 2. 只送**枚举 key**（better / growing / none…），不送中文。中文只用于显示。
//      送中文 ⇒ 引擎 map 认不出 ⇒ 选了却不计分，且页面全绿（静默失效）。
// 🔴 3. 本次表单**只提交本页字段**。saveShopSetting 是白名单 patch，未传键一律不动库 ——
//      所以这里绝不能顺手带上 name/remark/switches（那会把别处的设置覆盖掉）。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');

const T = TERMS.diagInput;

Page({
  data: {
    t: {
      title: T.title,
      hint: T.hint,
      revenueFeel: T.revenueFeel,
      revenueFeelOpts: T.revenueFeelOpts,
      memberRatio: T.memberRatio,
      memberRatioPh: T.memberRatioPh,
      memberRatioHint: T.memberRatioHint,
      rating: T.rating,
      ratingPh: T.ratingPh,
      reviewTrend: T.reviewTrend,
      district: T.district,
      leaseMonths: T.leaseMonths,
      leaseMonthsPh: T.leaseMonthsPh,
      renewIncrease: T.renewIncrease,
      renewIncreasePh: T.renewIncreasePh,
      foodSafety: T.foodSafety,
      foodSafetyHint: T.foodSafetyHint,
      foodSafetyOpts: T.foodSafetyOpts,
      errRenew: T.errRenew,
      debt: T.debt,
      cash: T.cash,
      cashHint: T.cashHint,
      save: T.save,
      pending: T.pending,
      trendOpts: T.trendOpts,
      districtOpts: T.districtOpts,
      debtOpts: T.debtOpts,
      loading: TERMS.ui.loading,
    },
    // 三个 picker 的选中下标（-1 = 没选 ⇒ 提交 null）
    trendIdx: -1,
    districtIdx: -1,
    debtIdx: -1,
    foodIdx: -1,
    feelIdx: -1,
    // 三个数字输入（字符串，'' = 没填）
    memberRatio: '',
    rating: '',
    leaseMonths: '',
    renewIncrease: '',
    cashYuan: '',
    loading: true,
    saving: false,
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(T.title);
      // 读回：getShopContext 出参带 diag_facts（店级时点属性，不分月）
      const ctx = await api.call('getShopContext', {});
      const df = (ctx && ctx.diag_facts) || {};
      this.setData({
        feelIdx: T.revenueFeelKeys.indexOf(df.revenue_trend_feel),
        memberRatio: df.member_ratio_pct != null ? String(df.member_ratio_pct) : '',
        rating: df.rating != null ? String(df.rating) : '',
        leaseMonths: df.lease_months_left != null ? String(df.lease_months_left) : '',
        renewIncrease: df.renew_increase_pct != null ? String(df.renew_increase_pct) : '',
        cashYuan: df.cash_on_hand_fen != null ? api.fenToYuan(df.cash_on_hand_fen) : '',
        // 枚举回显：拿 key 反查下标。查不到（脏数据/旧枚举）⇒ -1（显示"待补"），不猜成第 0 项
        trendIdx: T.trendKeys.indexOf(df.review_trend),
        districtIdx: T.districtKeys.indexOf(df.business_district),
        debtIdx: T.debtKeys.indexOf(df.debt_level),
        // 重大食安是布尔：true→1(发生过) / false→0(没有) / 缺省→-1(待补)
        foodIdx: df.food_safety_event === true ? 1 : (df.food_safety_event === false ? 0 : -1),
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onMemberRatio(e) { this.setData({ memberRatio: e.detail.value }); },
  onPickFeel(e) { this.setData({ feelIdx: Number(e.detail.value) }); },
  onRating(e) { this.setData({ rating: e.detail.value }); },
  onLeaseMonths(e) { this.setData({ leaseMonths: e.detail.value }); },
  onRenewIncrease(e) { this.setData({ renewIncrease: e.detail.value }); },
  onCash(e) { this.setData({ cashYuan: e.detail.value }); },
  onPickTrend(e) { this.setData({ trendIdx: Number(e.detail.value) }); },
  onPickDistrict(e) { this.setData({ districtIdx: Number(e.detail.value) }); },
  onPickDebt(e) { this.setData({ debtIdx: Number(e.detail.value) }); },
  onPickFood(e) { this.setData({ foodIdx: Number(e.detail.value) }); },

  /**
   * 把表单变成 saveShopSetting 的 diag_facts。
   * 🔴 非法输入**报错中止**，不静默清洗：`api.yuanToFen` 对非数是 fail-soft（返回 0），
   *   照它兜底就会把「4,6」洗成 0 元现金 —— 现金流红线随即被误判为"枯竭"。
   */
  buildFacts() {
    const intOf = (s) => {
      const v = String(s == null ? '' : s).trim();
      if (v === '') return null;
      if (!/^\d+$/.test(v)) return { error: T.errInteger };
      return Number(v);
    };
    const lm = intOf(this.data.leaseMonths);
    if (lm && lm.error) return { error: T.errInteger + '（剩余租期）' };

    // R612：续租涨幅（%）—— 允许一位小数，0~500；留空 = 不判
    let renew = null;
    const rv = String(this.data.renewIncrease == null ? '' : this.data.renewIncrease).trim();
    if (rv !== '') {
      if (!/^\d{1,3}(\.\d)?$/.test(rv)) return { error: T.errRenew };
      const n = Number(rv);
      if (!(n >= 0 && n <= 500)) return { error: T.errRenew };
      renew = n;
    }

    // 评分：0~5，一位小数
    let rating = null;
    const rs = String(this.data.rating == null ? '' : this.data.rating).trim();
    if (rs !== '') {
      if (!/^[0-5](\.\d)?$/.test(rs)) return { error: T.errRating };
      const r = Number(rs);
      if (!(r >= 0 && r <= 5)) return { error: T.errRating };
      rating = Math.round(r * 10) / 10;
    }

    // 会员销售占比：0~100 的整数（百分比）。留空 = 不判（没会员体系的小店不该被扣分）
    let memberPct = null;
    const mr = String(this.data.memberRatio == null ? '' : this.data.memberRatio).trim();
    if (mr !== '') {
      if (!/^\d{1,3}$/.test(mr)) return { error: T.errInteger + '（会员占比）' };
      const n = Number(mr);
      if (!(n >= 0 && n <= 100)) return { error: T.errInteger + '（会员占比 0~100）' };
      memberPct = n;
    }

    // 现金：只接受纯数字（可带两位小数），不接受逗号/单位
    let cashFen = null;
    const cs = String(this.data.cashYuan == null ? '' : this.data.cashYuan).trim();
    if (cs !== '') {
      if (!/^\d+(\.\d{1,2})?$/.test(cs)) return { error: T.errCash };
      cashFen = api.yuanToFen(cs);
    }

    const pick = (keys, idx) => (idx >= 0 && idx < keys.length ? keys[idx] : null);

    return {
      error: null,
      facts: {
        // R614：原来的 traffic_last_year（去年同期客流人次）已废弃；
        //   改为"和去年同期比的生意趋势"。'unknown'（说不清）必须落 null，不能落 false 语义。
        revenue_trend_feel: (() => {
          const k = pick(T.revenueFeelKeys, this.data.feelIdx);
          return (k === 'better' || k === 'same' || k === 'worse') ? k : null;
        })(),
        member_ratio_pct: memberPct,
        rating,
        review_trend: pick(T.trendKeys, this.data.trendIdx),
        business_district: pick(T.districtKeys, this.data.districtIdx),
        lease_months_left: lm,
        renew_increase_pct: renew,
        debt_level: pick(T.debtKeys, this.data.debtIdx),
        // 重大食安：三态（true 有 / false 无 / null 未填）
        //   🔴 未填必须是 null，不能是 false —— 引擎把 false 当"确认没有"，把 null 当"未判定"；
        //   混用会把"没填"谎报成"查过没问题"，那是这套模型最危险的谎。
        food_safety_event: (() => {
          const k = pick(T.foodSafetyKeys, this.data.foodIdx);
          if (k === 'yes') return true;
          if (k === 'no') return false;
          return null;
        })(),
        cash_on_hand_fen: cashFen,
      },
    };
  },

  async onSave() {
    if (this.data.saving) return;
    const b = this.buildFacts();
    if (b.error) { wx.showToast({ title: b.error, icon: 'none' }); return; }
    this.setData({ saving: true });
    try {
      ui.setTitle(T.save);
      await api.call('saveShopSetting', { diag_facts: b.facts });
      wx.showToast({ title: T.saved, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (e) {
      api.toastError(e);
    } finally {
      this.setData({ saving: false });
    }
  },
});
