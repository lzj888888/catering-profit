// pages/month/amortize.js —— round107 · M1「一次性投入」页（本月一次算清清单 + 分期摊销台账）
//
// 这一页同时管两类「一次花的钱」：
//   · 一次算清（mode='lump'）：全部算进投入那个月的费用，不跨月摊 —— 本月清单，可多笔
//   · 分期摊销（mode='amort'）：按月摊开，不把当月压太狠 —— 台账，可多笔、可再投一笔
// 两类**互不排斥**（李老师真机反馈：现在一个月既有一笔摊销、又有几笔小额一次算清，都能记）。
//
// ⚠️ 计算下沉：本月合计 / 各资产当月摊销 / 剩余未摊 全部由 getAmortSchedule 后端算，前端只展示分整数。
// ⚠️ 表单不再用底部弹层：新增/编辑/再投一笔一律跳 pages/month/assetEdit（独立页）。
//   真机截图证明「底部弹层 + 键盘」会让面板被整个盖住 ⇒ 看不见、存不了。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

Page({
  data: {
    t: {
      title: TERMS.amortizePage.title,
      monthTotal: TERMS.amortizePage.monthTotal,
      // round107：本月一次算清清单
      lumpSectionTitle: TERMS.amortizePage.lumpSectionTitle,
      lumpSectionHint: TERMS.amortizePage.lumpSectionHint,
      lumpEmpty: TERMS.amortizePage.lumpEmpty,
      lumpSumLabel: TERMS.amortizePage.lumpSumLabel,
      lumpAdd: TERMS.amortizePage.lumpAdd,
      // 分期摊销区块
      amortSectionTitle: TERMS.amortizePage.amortSectionTitle,
      // ⚠️ round108 修复：这里原来写 `TERMS.amortizePage.amortAdd` —— **该键在 terms.js 里不存在**
      //   ⇒ 取到 undefined ⇒ 页面底部那个主按钮渲染成**纯蓝色、无文字**（李老师真机反馈）。
      //   术语本体一直是 `amortizePage.add`（「新增摊销资产」）。守卫 check_page_terms 已补上防复发。
      amortAdd: TERMS.amortizePage.add,
      amortSwitchLabel: TERMS.amortizePage.amortSwitchLabel,
      amortSwitchHint: TERMS.amortizePage.amortSwitchHint,
      swSaved: TERMS.calcMethod.switchSaved,
      name: TERMS.amortizePage.name,
      value: TERMS.amortizePage.value,
      startMonth: TERMS.amortizePage.startMonth,
      totalMonths: TERMS.amortizePage.totalMonths,
      monthAmountShort: TERMS.amortizePage.monthAmountShort,
      terminateNow: TERMS.amortizePage.terminateNow,
      confirmTerminate: TERMS.amortizePage.confirmTerminate,
      edit: TERMS.amortizePage.edit,
      empty: TERMS.amortizePage.empty,
      monthUnit: TERMS.amortizePage.monthUnit,
      // H1（批次 8c）：同一资产多次投入
      scopeHint: TERMS.amortizePage.scopeHint,
      appendPurchase: TERMS.amortizePage.appendPurchase,
      batchPrefix: TERMS.amortizePage.batchPrefix,
      batchSuffix: TERMS.amortizePage.batchSuffix,
      batchTotalPrefix: TERMS.amortizePage.batchTotalPrefix,
      batchTotalSuffix: TERMS.amortizePage.batchTotalSuffix,
      groupValueLabel: TERMS.amortizePage.groupValueLabel,
      expandHint: TERMS.amortizePage.expandHint,
      collapseHint: TERMS.amortizePage.collapseHint,
      loading: TERMS.ui.loading,
      cur: '¥',
      archiveReadonly: TERMS.inputPage.archiveReadonly,
      confirmLocked: TERMS.inputPage.confirmLocked,
    },
    month: '',
    totalFen: 0,
    totalYuan: '0.00',       // 初值必须有（接口失败时渲染「¥0.00」而非裸「¥」）
    lumps: [],               // 本月一次算清清单（金额全由后端出参换算）
    lumpTotalYuan: '0.00',
    assets: [],
    groups: [],              // 按「同一资产」分组的视图（每组 = 该资产的 N 笔投入）
    amortizeOn: false,       // 服务端权威开关（shop_switch.amortize_switch）
    isArchive: false,
    loading: true,
  },

  onLoad(q) {
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.load();
  },

  // round104 同族纪律：本页会被 assetEdit 的 navigateBack 唤回（**已有实例**，onLoad 不会重跑）
  //   ⇒ 必须靠 onShow 重拉，否则改完一笔回来数字还是旧的。首次 onShow 紧跟 onLoad，跳过省一次云调用。
  onShow() {
    if (this._shown) this.load();
    this._shown = true;
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.amortizePage.title);
      const d = await api.call('getAmortSchedule', { month: this.data.month });

      // round107：本月一次算清清单 —— 名称与金额都由后端出参直取，前端只做 fenToYuan 格式化
      const lumps = (d.lumps || []).map((x) => ({
        item_id: x.item_id,
        name: x.name,
        amount_fen: x.amount_fen || 0,
        amountYuan: api.fenToYuan(x.amount_fen || 0, 2),
        month: x.month || '',
      }));

      const assets = (d.assets || []).map((a) => {
        const amountFen = this.findMonthAmount(d.details, a.asset_id);
        // round106（F5b）：留存数据 —— paid_months / remaining_fen / end_month 一律取后端出参，
        //   前端**不重算摊销**（摊销公式单源在引擎 amountForMonth），这里只拼文案。
        const prog = this.progressOf(a);
        return {
          asset_id: a.asset_id,
          name: a.name,
          value_fen: a.value_fen,
          value: api.fenToYuan(a.value_fen, 2),
          start_month: a.start_month,
          total_months: a.total_months,
          terminate_month: a.terminate_month || '',
          group_id: a.group_id || '',
          batch_seq: a.batch_seq || 1,
          amount_fen: amountFen,
          amountYuan: api.fenToYuan(amountFen, 2),
          paid_months: a.paid_months || 0,
          total_periods: a.total_periods || a.total_months || 0,
          remaining_fen: a.remaining_fen != null ? a.remaining_fen : (a.value_fen || 0),
          end_month: a.end_month || '',
          progressNote: prog.progressNote,
          endNote: prog.endNote,
        };
      });

      this.setData({
        totalFen: d.total_amount_fen || 0,
        totalYuan: api.fenToYuan(d.total_amount_fen || 0, 2),
        lumps,
        lumpTotalYuan: api.fenToYuan(d.lump_total_fen || 0, 2),
        assets,
        groups: this.buildGroups(assets),
        // round108（真机缺陷修复）：开关值**只认本次云函数出参**（`amortize_switch_on`），
        //   不再读 `app.globalData.switches` —— 那是只在 getShopContext 时刷新的前端缓存，
        //   保存开关后没人刷新它 ⇒ 重拉时读回旧值 ⇒ 开关「自己弹回打开」（李老师真机反馈）。
        amortizeOn: !!d.amortize_switch_on,
        isArchive: !!d.is_archive,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // round106（F5b）：留存数据文案 —— 期数与剩余额全部来自后端出参（引擎累加），前端只做格式化拼接。
  progressOf(a) {
    const T = TERMS.amortizePage;
    const remainingYuan = '¥' + api.fenToYuan((a && a.remaining_fen) || 0, 2);
    const periods = (a && (a.total_periods || a.total_months)) || 0;
    const progressNote = periods > 0
      ? T.paidProgress((a && a.paid_months) || 0, periods, remainingYuan)
      : T.remainingOnly(remainingYuan);
    const endMonth = (a && a.end_month) || '';
    const endNote = endMonth
      ? ((a && a.terminate_month) ? T.endTerminated(endMonth) : T.endNote(endMonth))
      : '';
    return { progressNote, endNote };
  },

  // H1：把摊销资产行按组键（group_id || asset_id）聚成「同一资产的多次投入」
  //   ⚠️ 计算仍全部由后端算：这里只做展示合计（元金额由 fenToYuan 换算），不参与摊销公式。
  buildGroups(rows) {
    const map = {};
    const order = [];
    (rows || []).forEach((r) => {
      const key = r.group_id || r.asset_id;   // 无 group_id 的独立资产 = 自成一组（老数据行为不变）
      if (!map[key]) {
        map[key] = { key, name: r.name, count: 0, valueFen: 0, monthFen: 0, batches: [], expanded: false };
        order.push(key);
      }
      const g = map[key];
      g.batches.push(r);
      g.count += 1;
      g.valueFen += r.value_fen || 0;
      g.monthFen += r.amount_fen || 0;
    });
    return order.map((k) => {
      const g = map[k];
      g.batches.sort((x, y) => (x.batch_seq || 1) - (y.batch_seq || 1));
      g.valueYuan = api.fenToYuan(g.valueFen, 2);
      g.monthYuan = api.fenToYuan(g.monthFen, 2);
      g.multi = g.count > 1;
      // round106（F5b）：组级留存数据 —— 多笔组给「合计剩余未摊 + 末笔摊完」，单笔沿用该笔自己的文案
      g.remainingFen = g.batches.reduce((s, b) => s + (b.remaining_fen || 0), 0);
      const ends = g.batches.map((b) => b.end_month).filter(Boolean).sort();
      if (g.multi) {
        g.progressNote = TERMS.amortizePage.progressMulti(g.count, '¥' + api.fenToYuan(g.remainingFen, 2));
        g.endNote = ends.length ? TERMS.amortizePage.endNoteLast(ends[ends.length - 1]) : '';
      } else {
        g.progressNote = g.batches[0].progressNote;
        g.endNote = g.batches[0].endNote;
      }
      return g;
    });
  },

  onToggleGroup(e) {
    const key = e.currentTarget.dataset.group;
    const groups = this.data.groups.map((g) => (g.key === key ? Object.assign({}, g, { expanded: !g.expanded }) : g));
    this.setData({ groups });
  },

  // 从 getAmortSchedule.details 找该资产当月摊销（分）
  findMonthAmount(details, assetId) {
    const row = (details || []).find((x) => x.asset_id === assetId);
    return row ? (row.amount_fen || 0) : 0;
  },

  // ===== 跳独立编辑页（round107：表单不再用底部弹层）=====
  go(url) {
    if (this.data.isArchive) {
      wx.showModal({ title: TERMS.inputPage.archiveReadonly, content: TERMS.inputPage.confirmLocked, showCancel: false });
      return;
    }
    wx.navigateTo({ url });
  },
  onAddLump() { this.go('/pages/month/assetEdit?kind=lump&month=' + this.data.month); },
  onEditLump(e) {
    const it = e.currentTarget.dataset.item;
    if (!it || !it.item_id) return;
    this.go('/pages/month/assetEdit?kind=lump&month=' + this.data.month + '&asset_id=' + it.item_id);
  },
  onAddAmort() { this.go('/pages/month/assetEdit?kind=amort&month=' + this.data.month); },
  onEditAsset(e) {
    const a = e.currentTarget.dataset.asset;
    if (!a || !a.asset_id) return;
    this.go('/pages/month/assetEdit?kind=amort&month=' + this.data.month + '&asset_id=' + a.asset_id);
  },
  // H1：再投一笔 —— 同一资产再记一笔（沿用组键，起摊月默认本月，每笔独立起摊）
  onAppend(e) {
    const key = e.currentTarget.dataset.group;
    if (!key) return;
    this.go('/pages/month/assetEdit?kind=amort&month=' + this.data.month + '&group=' + key);
  },

  // ===== 分期摊销开关（服务端权威 shop_switch.amortize_switch）=====
  //   ⚠️ 口径未变（关掉 ⇒ 登记的摊销资产不计入利润）；变的只是**入口** ——
  //      原来它是录入页的「一次性 / 按月」二选一，结构上把两类投入变成互斥，故搬到本页做成独立开关。
  async onToggleAmortize(e) {
    const val = !!e.detail.value;
    if (this.data.isArchive) {
      wx.showModal({ title: TERMS.inputPage.archiveReadonly, content: TERMS.inputPage.confirmLocked, showCancel: false });
      this.load();
      return;
    }
    const prev = this.data.amortizeOn;
    if (prev === val) return;
    this.setData({ amortizeOn: val });          // 乐观更新
    try {
      await api.call('saveShopSetting', {
        switches: { amortize: val },
        client_request_id: 'am_' + Date.now(),
      });
      wx.showToast({ title: TERMS.calcMethod.switchSaved, icon: 'success' });
      this.load();
    } catch (err) {
      this.setData({ amortizeOn: prev });       // 服务端才是权威 → 回滚
      api.toastError(err);
    }
  },

  // 提前报废：软删前的「终止」语义（保留资产痕迹），二次确认 + 触觉反馈（G6 不可逆操作）
  onTerminate(e) {
    const a = e.currentTarget.dataset.asset;
    wx.showModal({
      title: TERMS.amortizePage.terminateNow,
      content: TERMS.amortizePage.confirmTerminate,
      confirmColor: '#e74c3c',
      success: async (r) => {
        if (!r.confirm) return;
        // G6：不可逆操作（提前报废）→ 触觉反馈
        if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'medium' }); } catch (err) { /* 部分机型不支持，忽略 */ } }
        try {
          // 报废 = 保留资产但标记终止（terminate_month=当前月）→ 未摊余额作为处置损失；
          // 资产本身保留在台账（不可复活），前端列表由 DataAdapter 只展示活跃。
          const payload = {
            asset_id: a.asset_id,
            name: a.name,
            value_fen: api.yuanToFen(a.value),
            start_month: a.start_month,
            total_months: a.total_months,
            terminate_month: this.data.month,
            mode: 'amort',
          };
          // H1：只报废这一笔，保留它的组归属（多笔资产的其他笔不受影响）
          if (a.group_id) { payload.group_id = a.group_id; payload.batch_seq = a.batch_seq || 1; }
          await api.call('saveAsset', {
            asset: payload,
            client_request_id: 'at_' + Date.now(),
          });
          wx.showToast({ title: TERMS.amortizePage.terminateNow, icon: 'success' });
          this.load();
        } catch (err) { api.toastError(err); }
      },
    });
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
