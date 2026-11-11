// subpkg/biz/revenue/index.js —— R616 渠道营收（从老板的收款日报算，双口径展示）
//
// 这个页面只做一件事：让老板看清「我这个月经营营收多少」和「为什么跟我记的对不上」。
//
// 🔴 三条设计红线：
//   1. **主数只给经营营收（M1 权责制）**。现金流入口径永远只作副数，并明写「含充值，只对账用」。
//      依据 M1 既有红线（terms.js fastHint）：「顾客充值的钱不算收入，只有用余额买单才算」。
//   2. **差额必须摊开给老板看**（差额桥），不能只给两个数让他自己猜。给两个数不给解释 = 制造疑问。
//   3. **只读**：不写任何库、不改任何已有账目。老板选完文件出结果，关掉就没了。
//      要落进 M1 月度账得先定 incomeItems 结构（独立一轮），本页不碰契约。
const api = require('../../../utils/api.js');
const ui = require('../../../utils/ui.js');
const { TERMS } = require('../../../miniprogram/i18n/terms.js');
const T = TERMS.revenue;

// 千分位 + 两位小数（页面只显示，不参与计算）
function money(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  const neg = n < 0;
  const s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + s;
}
function fill(tpl, map) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (map[k] == null ? '' : String(map[k])));
}

// 五个渠道的展示顺序与文案（顺序 = 老板关心的强弱：团购在前、外卖按金额）
const CHANNELS = [
  { key: 'grouponMeituan', label: T.chanGrouponMeituan, tag: '团购' },
  { key: 'grouponDouyin', label: T.chanGrouponDouyin, tag: '团购' },
  { key: 'waimaiMeituan', label: T.chanWaimaiMeituan, tag: '外卖' },
  { key: 'waimaiJd', label: T.chanWaimaiJd, tag: '外卖' },
  { key: 'waimaiTaobao', label: T.chanWaimaiTaobao, tag: '外卖' },
];

// 云端结构 → 展示态。数字全部来自云端，页面不自己算营收。
function buildView(rd) {
  const m1 = rd.revenueM1 || {};
  const ci = rd.cashInflow || {};
  const br = rd.bridge || {};

  const m1Over = (br.m1Over || []).filter((x) => Number(x.yuan) > 0)
    .map((x) => ({ key: x.key, label: x.label, text: money(x.yuan) }));
  const bossOver = (br.bossOver || []).filter((x) => Number(x.yuan) > 0)
    .map((x) => ({ key: x.key, label: x.label, text: money(x.yuan) }));

  const rawChannels = rd.channelYuan || {};
  const channels = CHANNELS
    .filter((c) => Number(rawChannels[c.key]) > 0)
    .map((c) => ({ key: c.key, label: c.label, tag: c.tag, text: money(rawChannels[c.key]) }));

  const diff = Number(br.diffYuan) || 0;
  const diffUp = diff >= 0;
  const missCount = (ci.mismatches || []).length;

  return {
    mainText: money(m1.totalYuan),
    dineInText: money(m1.dineInYuan),
    takeawayText: money(m1.takeawayYuan),
    cashText: money(ci.totalYuan),
    diffText: (diffUp ? '+' : '') + money(diff) + (br.diffPct == null ? '' : '（' + br.diffPct + '%）'),
    diffUp,
    m1Over,
    bossOver,
    channels,
    hasChannel: channels.length > 0,
    // 对账结果：老板表里那列与我们反推公式是否一致（一致 = 他的记账方式没变）
    reconOk: ci.pass === true,
    reconText: ci.pass === true
      ? fill(T.reconOk, { n: ci.checkedShifts })
      : fill(T.reconBad, { n: missCount }),
    // 未确认含义的列（茶楼）—— 不混进营收，但要告诉老板有这么一笔
    pendingText: Number(m1.pendingOtherYuan) > 0
      ? fill(T.pendingOther, { name: '茶楼', yuan: money(m1.pendingOtherYuan) })
      : '',
    dayCount: (rd.days || []).length,
    shiftCount: rd.shiftCount || 0,
    rangeText: (rd.days && rd.days.length)
      ? (rd.days[0].date + ' ~ ' + rd.days[rd.days.length - 1].date)
      : '',
    // 🔴 R618 覆盖范围：把「只填到几号」摆出来，让老板自己判断是没营业还是没导全
    cover: buildCover(rd.coverage),
  };
}

// 覆盖范围 → 展示态。只描述事实（到哪天 / 缺几天），不替老板下结论。
function buildCover(cv) {
  if (!cv || !cv.ok) return null;
  const short = (d) => String(d).slice(5).replace('-', '.');
  if (cv.tailMissingCount > 0) {
    const list = cv.tailMissingDates.map(short);
    const shown = list.length <= 3 ? list.join('、') : (list.slice(0, 3).join('、') + ' 等');
    return {
      kind: 'tail',
      text: fill(T.coverTail, { last: short(cv.lastDate), n: cv.tailMissingCount, dates: shown }),
      note: T.coverNote,
    };
  }
  if (cv.missingCount > 0) {
    const list = cv.missingDates.map(short);
    const shown = list.length <= 5 ? list.join('、') : (list.slice(0, 5).join('、') + ' 等');
    return {
      kind: 'mid',
      text: fill(T.coverMid, { n: cv.missingCount, dates: shown }),
      note: T.coverNote,
    };
  }
  return { kind: 'ok', text: fill(T.coverOk, { n: cv.monthDays }), note: '' };
}

Page({
  data: {
    loading: false,
    r: null,            // 结果展示态（null = 还没选文件）
    bridgeOpen: false,  // 差额桥默认收起（先说结论，再展开依据）
    srcNote: '',        // R619：这组数是从库里读的还是刚导的
    fromStore: false,
    // R712：折叠块开合状态（与 card/index、card/edit、takeaway/index 同一套机制：
    //   data-key 标识 + hintFold 字典，加一块**零 js 改动** —— 只加 wxml 与文案）
    hintFold: {},
    t: {
      mainLabel: T.mainLabel,
      mainNote: T.mainNote,
      cashLabel: T.cashLabel,
      cashNote: T.cashNote,
      diffLabel: T.diffLabel,
      diffNote: T.diffNote,
      bridgeTitle: T.bridgeTitle,
      bridgeM1Over: T.bridgeM1Over,
      bridgeBossOver: T.bridgeBossOver,
      chanTitle: T.chanTitle,
      caliberTip: T.caliberTip,
      coverTitle: T.coverTitle,
      pickBtn: T.pickBtn,
      pickHint: T.pickHint,
      // 🔴 R712：选文件前必须预告「会跳到微信聊天列表」，外加「去哪拿表 / 要哪些列」两块指引。
      //   外卖页 trio 早就有，本页一个都没有（李老师真机：「它也没说怎么选，也没引导」）。
      importWechatHint: TERMS.ui.importWechatHint,
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
      pickWhereTitle: T.pickWhereTitle,
      pickWhereBody: T.pickWhereBody,
      pickColsTitle: T.pickColsTitle,
      pickColsBody: T.pickColsBody,
      manualEntry: T.manualEntry,
      manualSub: T.manualSub,
      empty: T.empty,
      notMine: T.notMine,
      again: T.again,
    },
  },

  // 🔴 挂到 Page 上是为了让守卫能**真跑**装配逻辑（同 month/input 的 diffFacts 做法）：
  //   静态分析看不出「主数到底是营收还是现金流入」，只有真跑一遍才知道。
  buildView,

  // R631：把「为什么认不出」说清楚（与外卖页同一套文案，避免两页说法不一）
  showNotMine(dg) {
    const TK = TERMS.ledger.takeaway;
    if (!dg) {
      wx.showModal({ title: T.title, content: T.notMine, showCancel: false });
      return;
    }
    const miss = (dg.missing && dg.missing[dg.nearest]) || [];
    let body = '';
    if (dg.reason === 'empty_table') body = TK.importDiagEmpty || '';
    else if (dg.reason === 'cols_ok_but_excluded') body = (TK.importDiagExcluded || '').replace('{col}', dg.excludedBy || '');
    else if (dg.reason === 'mixed_goods_column') body = (TK.importDiagMixed || '').replace('{col}', dg.mixedCol || '');
    else body = (TK.importDiagBody || '').replace('{cols}', miss.join('、'));
    const found = (dg.foundCols && dg.foundCols.length)
      ? '\n' + (TK.importDiagFound || '').replace('{cols}', dg.foundCols.slice(0, 8).join('、'))
      : '';
    wx.showModal({ title: T.title, content: body + found, showCancel: false });
  },

  onLoad() {
    ui.setTitle(T.title);
    // 🔴 R619：进页面先看库里有没有 —— 导过一次就直接显示，不用再传文件。
    //   这是这个页面从"计算器"变成"留得住数据"的关键一步。
    this.loadStored();
  },

  // 读库：不带 month ⇒ 取最近一次导入的那一版
  async loadStored(opts) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const d = await api.call('importSalesBill', { action: 'revenue_get' });
      const rd = d && d.revenue_stored;
      this.setData({ loading: false });
      if (!rd) return;                      // 库里没有 ⇒ 保持「未选文件」态，让他导
      this.setData({
        r: this.buildView(rd),
        srcNote: fill(T.storedNote, {
          date: String(rd.created_at || '').slice(0, 10),
          file: rd.file_name || '上次导入的表',
        }),
        fromStore: true,
      });
      if (opts && opts.done) wx.showToast({ title: T.storedToast, icon: 'success' });
    } catch (e) {
      this.setData({ loading: false });
      // 读库失败不打扰（旧云端没这个分支时会报错，此时退回「上传」态即可）
      if (opts && opts.strict) api.toastError(e);
    }
  },

  onToggleBridge() {
    this.setData({ bridgeOpen: !this.data.bridgeOpen });
  },

  onAgain() {
    this.setData({ r: null, bridgeOpen: false });
  },

  // R712：折叠块开合。与 takeaway/index.js 同形（dataset.key → hintFold 字典），
  //   不抽公共函数：三处实现都只有 6 行，抽出去要多一个模块与被 mock 面；
  //   真要抽应连 card/index、card/edit 一起收，那是另一轮的活。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
  },

  // R620：不会做表的老板走手填
  goManual() {
    wx.navigateTo({ url: '/subpkg/biz/revenue/manual/index' });
  },

  // 从手填页回来要重新读库（他刚填的应该立刻出现）
  onShow() {
    if (this._loaded) this.loadStored();
    this._loaded = true;
  },

  // 选文件 → 上传云存储 → importSalesBill 解析 + **落库**（R619）
  async onChoose() {
    if (this.data.loading) return;
    let file;
    try {
      const res = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx', 'xls'] });
      file = res.tempFiles && res.tempFiles[0];
    } catch (e) {
      return;   // 用户取消，不当错误
    }
    if (!file) return;

    this.setData({ loading: true, r: null, bridgeOpen: false, srcNote: '', fromStore: false });
    wx.showLoading({ title: T.loading, mask: true });
    try {
      const cloudPath = 'revenue_daily/' + Date.now() + '_' + (file.name || 'revenue.xlsx');
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: file.path });
      const d = await api.call('importSalesBill', {
        fileID: up.fileID,
        commit: true,                       // 🔴 落库：导一次以后都能看
        file_name: file.name || '',
      });
      wx.hideLoading();
      const rd = d && d.revenue_daily;
      if (!rd) {
        // 🔴 R631：认不出这张表 —— 云函数**早就**把「缺哪几列」算好放在 `d.diagnosis` 里了
        //   （见 importSalesBill/index.js 里 `return ok({ diagnosis: diagnoseColumns(matrix) })`，
        //    注释明写"文案由前端按 terms 拼"），而这里此前只弹一句通用的 T.notMine
        //   ⇒ 诊断被扔掉，老板还是不知道要补哪一列，只能反复换文件。
        //   ⚠️ 与外卖页 R286 同一套口径：四个 reason 分支 + "读到哪些列"，直接复用同一批文案，
        //     不新造第二份说法（否则两页对同一张表会给出不同解释）。
        this.setData({ loading: false });
        this.showNotMine(d && d.diagnosis);
        return;
      }
      // 同月已有数据、这次换了文件 ⇒ 先给差异，让他决定（不静默覆盖）
      if (d && d.need_confirm) {
        this.setData({ loading: false, r: this.buildView(rd) });
        const df = d.diff || {};
        const lines = [
          '这个月已经有数据了。',
          '原来：' + money(df.oldTotalYuan) + ' 元 / ' + (df.oldDayCount || 0) + ' 天',
          '这份：' + money(df.newTotalYuan) + ' 元 / ' + (df.newDayCount || 0) + ' 天',
          '差额：' + (df.totalDeltaYuan >= 0 ? '+' : '') + money(df.totalDeltaYuan) + ' 元',
          '',
          '确认替换？旧版本会保留，以后能查。',
        ];
        wx.showModal({
          title: '要不要换成这份',
          content: lines.join('\n'),
          confirmText: '换成这份',
          cancelText: '先不动',
          success: (m) => {
            if (m.confirm) this.recommit(up.fileID, file.name);
          },
        });
        return;
      }
      this.setData({
        loading: false,
        r: this.buildView(rd),
        srcNote: fill(T.storedNote, { date: T.today, file: file.name || '这份表' }),
        fromStore: true,
      });
      const mode = d && d.stored && d.stored.mode;
      wx.showToast({ title: mode === 'duplicate' ? T.dupToast : T.savedToast, icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // 老板确认替换后，带 confirm 重跑一次（此时云端才把旧版本降级）
  async recommit(fileID, fileName) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    wx.showLoading({ title: T.loading, mask: true });
    try {
      const d = await api.call('importSalesBill', {
        fileID, commit: true, confirm: true, file_name: fileName || '',
      });
      wx.hideLoading();
      const rd = d && d.revenue_daily;
      this.setData({ loading: false });
      if (!rd) { wx.showModal({ title: T.title, content: T.notMine, showCancel: false }); return; }
      this.setData({
        r: this.buildView(rd),
        srcNote: fill(T.storedNote, { date: T.today, file: fileName || '这份表' }),
        fromStore: true,
      });
      wx.showToast({ title: T.savedToast, icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      this.setData({ loading: false });
      api.toastError(e);
    }
  },
});
