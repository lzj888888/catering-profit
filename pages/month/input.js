// pages/month/input.js —— 批次 4/8 · M1 收入/费用/食材消耗录入页
//
// ⚠️ 计算下沉：金额一律「元」界面输入 → 适配层 Math.round(元×100) 转「分」number 传后端；
//   大类金额由云函数按细项汇总（saveLedger/validate cleanItems），前端不汇总、不重算。
// ⚠️ A1/A2（批次 8）：收入/费用为「大类 → 二级细项」两级结构；
//   每大类默认单行（细项名可空 = 整类总额），可展开添加多行细项（新增/删除）。
// ⚠️ 归档守卫：is_archive=true → 全字段只读；归档后 7 天内补录需二次确认 + archive_override=true。
// ⚠️ AD-10/AD-23：onHide 自动存草稿（wx.setStorageSync），返回自动回填，不静默丢数据。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { normalizeDineRows, markFixedRows } = require('../../utils/dineChannels.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

const DRAFT_KEY = 'draft_month_input_';
// 堂食录入模式（快速 / 分项）**仅存本地**，不动后端契约；换设备或清缓存回默认，默认值由数据推断
const DINE_MODE_KEY = 'dine_mode_';

Page({
  data: {
    t: {
      title: TERMS.inputPage.title,
      incomeTitle: TERMS.ledger.incomeTitle,
      expenseTitle: TERMS.ledger.expenseTitle,
      income: TERMS.ledger.income,          // [{category,label,items:[...]}]
      expense: TERMS.ledger.expense,        // [{category,label,items:[...]}]
      subItem: TERMS.ledger.subItem,
      subItemPh: TERMS.ledger.subItemPh,
      addSubItem: TERMS.ledger.addSubItem,
      delSubItem: TERMS.ledger.delSubItem,
      amount: TERMS.ledger.amount,
      incomeHint: TERMS.ledger.incomeHint,   // E1
      expenseHint: TERMS.ledger.expenseHint, // E1
      // E2（批次 8c）：每类「包括 / 不包括」+ 顶部填写口径折叠块
      fillGuideTitle: TERMS.ledger.fillGuideTitle,
      fillGuide: TERMS.ledger.fillGuide,
      // 核算方式（2026-09-20：库存 / 摊销开关从店铺设置页迁入本页，就地二选一）
      cmSecTitle: TERMS.calcMethod.secTitle,
      cmSecHint: TERMS.calcMethod.secHint,
      cmConsumeTitle: TERMS.calcMethod.consumeTitle,
      cmConsumeDirect: TERMS.calcMethod.consumeDirect,
      cmConsumeDirectDesc: TERMS.calcMethod.consumeDirectDesc,
      cmConsumeInv: TERMS.calcMethod.consumeInv,
      cmConsumeInvDesc: TERMS.calcMethod.consumeInvDesc,
      cmConsumeDirectField: TERMS.calcMethod.consumeDirectField,
      cmConsumeDirectHint: TERMS.calcMethod.consumeDirectHint,
      cmConsumeInvGo: TERMS.calcMethod.consumeInvGo,
      cmConsumeInvEmpty: TERMS.calcMethod.consumeInvEmpty,
      cmConsumeInvHint: TERMS.calcMethod.consumeInvHint,
      cmAssetTitle: TERMS.calcMethod.assetTitle,
      cmAssetOnce: TERMS.calcMethod.assetOnce,
      cmAssetOnceDesc: TERMS.calcMethod.assetOnceDesc,
      cmAssetAmortize: TERMS.calcMethod.assetAmortize,
      cmAssetAmortizeDesc: TERMS.calcMethod.assetAmortizeDesc,
      cmAssetGo: TERMS.calcMethod.assetGo,
      cmAssetEmpty: TERMS.calcMethod.assetEmpty,
      cmAssetHint: TERMS.calcMethod.assetHint,
      save: TERMS.buttons.save,
      archiveReadonly: TERMS.inputPage.archiveReadonly,
      graceNote: TERMS.inputPage.graceNote,
      saveArchiveOverride: TERMS.inputPage.saveArchiveOverride,
      confirmGraceSave: TERMS.inputPage.confirmGraceSave,
      confirmLocked: TERMS.inputPage.confirmLocked,
      // 堂食录入模式（2026-09-21 李老师拍板 · 方案 A 严格互斥）
      dmSecTitle: TERMS.ledger.dineMode.secTitle,
      dmFast: TERMS.ledger.dineMode.fast,
      dmFastDesc: TERMS.ledger.dineMode.fastDesc,
      dmDetail: TERMS.ledger.dineMode.detail,
      dmDetailDesc: TERMS.ledger.dineMode.detailDesc,
      dmFastField: TERMS.ledger.dineMode.fastField,
      dmFastHint: TERMS.ledger.dineMode.fastHint,
      dmDetailHint: TERMS.ledger.dineMode.detailHint,
      dmSumLabel: TERMS.ledger.dineMode.sumLabel,
      dmSumAutoHint: TERMS.ledger.dineMode.sumAutoHint,
      dmAddChannel: TERMS.ledger.dineMode.addChannel,
      dmChannelPh: TERMS.ledger.dineMode.channelPh,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    month: '',
    isArchive: false,
    archivedAtMs: 0,
    inGrace: false,            // 归档后 7 天内
    readOnly: false,           // 归档且超宽限 → 硬锁
    // A2：每大类一组细项行 rows: [{ subItem, amountYuan }]；expanded 控制该大类展开
    incomeGroups: [],          // [{ category, label, items(模板), expanded, rows }]
    expenseGroups: [],
    fillGuideOpen: false,      // E2：顶部「填写口径」折叠块（默认收起）
    dineMode: 'fast',          // 堂食录入模式：'fast' | 'detail'（严格互斥；方案 A）
    dineDetailRows: [],        // 分项行**快照**：切到快速前保留，切回分项时原样恢复（防 round-trip 丢值）
    dineSumYuan: '0.00',       // 分项模式：各渠道相加**自动算出**（预计算，WXML 不支持方法调用）
    directConsumeYuan: '',
    // 核算方式（就地二选一）：真值以服务端 switches 为准；改动即时写库，失败回滚
    inventoryOn: false,
    amortizeOn: false,
    invSummary: '',
    assetSummary: '',
    // 切换口径时必须把店铺名/备注原样回传：saveShopSetting 对未传字段归一 '' 并写库
    shopName: '',
    shopRemark: '',
    shopBaseLoaded: false,
    loading: true,
  },

  onLoad(q) {
    const month = (q && q.month) || ui.nowMonth();
    this.setData({ month });
    this.initGroups();
    this.load();
  },
  onShow() {
    // AD-10/AD-23：回来回填草稿（仅当本页还有未保存内容时）
    const draft = wx.getStorageSync(DRAFT_KEY + this.data.month);
    if (draft && !this.data.saved) {
      this.setData({
        incomeGroups: draft.incomeGroups || this.data.incomeGroups,
        expenseGroups: draft.expenseGroups || this.data.expenseGroups,
        directConsumeYuan: draft.directConsumeYuan !== undefined ? draft.directConsumeYuan : this.data.directConsumeYuan,
        dineDetailRows: draft.dineDetailRows ? draft.dineDetailRows.map((r) => ({ subItem: r.subItem || '', amountYuan: r.amountYuan || '', fixed: !!r.fixed, note: r.note || '' })) : this.data.dineDetailRows,
      });
    }
  },
  onHide() {
    // AD-10：自动存草稿（含已录入值）
    wx.setStorageSync(DRAFT_KEY + this.data.month, {
      incomeGroups: this.data.incomeGroups,
      expenseGroups: this.data.expenseGroups,
      directConsumeYuan: this.data.directConsumeYuan,
      dineDetailRows: this.data.dineDetailRows,
    });
  },

  // A2：按模板初始化大类组（每类默认单行：细项名空 = 整类总额）
  // ⚠️ showRows = 实际渲染行：折叠时仅首行（整类总额），展开时全部细项行（WXML 不支持方法调用，故预计算）
  // E2：每类带一句 scope（包括 / 不包括），来源 i18n（incomeScope / expenseScope），页面不写死文案
  initGroups() {
    const mk = (defs, scopeMap) => defs.map((g) => {
      const rows = [{ subItem: '', amountYuan: '' }];
      return {
        category: g.category, label: g.label, items: g.items || [],
        scope: (scopeMap || {})[g.category] || '',
        scopeOpen: false,   // 2026-09-21：口径句默认收起（李老师反馈原样展开太占地方）
        expanded: false,
        rows: this.decorateRows(g, rows),
        showRows: rows,
      };
    }).map((g) => (g.category === 'dine_in'
      ? Object.assign({}, g, { showRows: g.rows })
      : g));
    this.setData({
      incomeGroups: mk(TERMS.ledger.income, TERMS.ledger.incomeScope),
      expenseGroups: mk(TERMS.ledger.expense, TERMS.ledger.expenseScope),
    });
  },

  // E2：顶部「填写口径」折叠块开关
  onToggleFillGuide() {
    this.setData({ fillGuideOpen: !this.data.fillGuideOpen });
  },

  // 2026-09-21：每类「怎么填」口径句折叠开关（默认收起，只留一行引导语）
  //   ⚠️ 与 onToggleGroup 同为「就地改一份 + 整数组回写」，不要图省事直接改 this.data。
  onToggleScope(e) {
    const kind = e.currentTarget.dataset.kind;   // 'income' | 'expense'
    const idx = Number(e.currentTarget.dataset.idx);
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[idx]);
    g.scopeOpen = !g.scopeOpen;
    groups[idx] = g;
    this.setData({ [key]: groups });
  },

  // 从后端明细（snake_case income_items/expense_items）重建组：每大类 → rows = sub_items（无细项则单行整类）
  rebuildFromItems(defs, items, scopeMap) {
    return defs.map((g) => {
      const found = (items || []).find((it) => (it.category || '') === g.category);
      let rows = [{ subItem: '', amountYuan: '' }];
      if (found) {
        const subs = found.sub_items || [];
        if (subs.length > 0) {
          rows = subs.map((si) => ({ subItem: si.sub_item || '', amountYuan: si.amount_fen ? api.fenToYuan(si.amount_fen) : '' }));
        } else if (found.amount_fen) {
          rows = [{ subItem: '', amountYuan: api.fenToYuan(found.amount_fen) }];
        }
      }
      const expanded = rows.length > 1;
      const out = {
        category: g.category, label: g.label, items: g.items || [],
        scope: (scopeMap || {})[g.category] || '',
        scopeOpen: false,   // 与 initGroups 一致：读回后端数据也默认收起
        expanded,
        rows: this.decorateRows(g, rows),
        showRows: expanded ? rows : rows.slice(0, 1),
      };
      if (g.category === 'dine_in') {
        out.showRows = expanded ? out.rows : out.rows.slice(0, 1);
      }
      return out;
    });
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.inputPage.title);
      const d = await api.call('getLedger', { month: this.data.month });
      const sw = d.switches || {};
      const isArchive = !!d.is_archive;
      const archivedAtMs = d.archived_at || 0;
      const inGrace = ui.withinGrace(archivedAtMs, Date.now());
      const readOnly = isArchive && !inGrace;   // 归档且超 7 天 → 硬锁
      const incomeGroups = this.rebuildFromItems(TERMS.ledger.income, d.income_items, TERMS.ledger.incomeScope);
      const expenseGroups = this.rebuildFromItems(TERMS.ledger.expense, d.expense_items, TERMS.ledger.expenseScope);
      const directConsumeYuan = d.direct_consume_fen ? api.fenToYuan(d.direct_consume_fen) : '';
      // 堂食分项快照：若后端已存分项（>1 行），原样带入 dineDetailRows，切回分项可恢复（防 round-trip 丢值）
      const dG = incomeGroups.find((x) => x.category === 'dine_in');
      const dineDetailRows = (dG && dG.rows && dG.rows.length > 1)
        ? dG.rows.map((r) => ({ subItem: r.subItem || '', amountYuan: r.amountYuan || '', fixed: !!r.fixed, note: r.note || '' }))
        : [];
      // 核算方式读回（服务端权威；口径锁：经营参考利润用直接填值，真实利润才倒轧）
      const inventoryOn = !!sw.inventorySwitchOn;
      const amortizeOn = !!sw.amortizeSwitchOn;
      const inv = d.inventory || {};
      const invSummary = (inv.openingFen || inv.purchaseFen || inv.closingFen)
        ? TERMS.calcMethod.consumeInvSummary(
            api.fenToYuan(inv.openingFen || 0, 2),
            api.fenToYuan(inv.purchaseFen || 0, 2),
            api.fenToYuan(inv.closingFen || 0, 2))
        : '';
      // 若草稿存在且已保存过 → 用后端值（服务端为准）；否则后端值直接回填
      this.setData({
        isArchive, archivedAtMs, inGrace, readOnly,
        inventory: d.inventory || {},          // 原样带回，库存页保存时不丢
        incomeGroups,
        expenseGroups,
        dineMode: this.pickDineMode(incomeGroups),
        dineDetailRows,
        inventoryOn, amortizeOn, invSummary,
        directConsumeYuan: directConsumeYuan || this.data.directConsumeYuan,
        loading: false,
      });
      if (amortizeOn) this.loadAssetCount();   // 笔数只是提示，失败不打扰
      this.loadShopBase();                     // 切换口径时要原样回传店铺名 / 备注
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  // 堂食模式初始判定：本地缓存优先；无缓存则按数据推断（细项行 > 1 ⇒ 分项）
  pickDineMode(incomeGroups) {
    const cached = this.loadDineMode();
    if (cached) return cached;
    const g = (incomeGroups || []).find((x) => x.category === 'dine_in');
    return (g && g.rows && g.rows.length > 1) ? 'detail' : 'fast';
  },

  // ===== 大类展开/收起 =====
  // ⚠️ 堂食走「快速 / 分项」模式开关（dineMode），不再用这里的手风琴展开
  onToggleGroup(e) {
    const kind = e.currentTarget.dataset.kind;   // 'income' | 'expense'
    const idx = Number(e.currentTarget.dataset.idx);
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[idx]);
    g.expanded = !g.expanded;
    g.showRows = g.expanded ? g.rows : g.rows.slice(0, 1); // 折叠只显示首行（整类总额）
    groups[idx] = g;
    this.setData({ [key]: groups });
  },

  // ===== 细项行：细项名 / 金额 / 新增 / 删除 =====
  onSubItem(e) {
    const { kind, gidx, ridx } = e.currentTarget.dataset;
    this.updateRow(kind, Number(gidx), Number(ridx), { subItem: e.detail.value });
  },
  onSubAmount(e) {
    const { kind, gidx, ridx } = e.currentTarget.dataset;
    this.updateRow(kind, Number(gidx), Number(ridx), { amountYuan: e.detail.value });
  },
  updateRow(kind, gidx, ridx, patch) {
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[gidx]);
    const rows = g.rows.slice();
    rows[ridx] = Object.assign({}, rows[ridx], patch);
    g.rows = rows;
    g.showRows = g.expanded ? rows : rows.slice(0, 1);
    groups[gidx] = g;
    this.setData({ [key]: groups });
    this.syncDineSum();
  },
  addRow(e) {
    const { kind, gidx } = e.currentTarget.dataset;
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[Number(gidx)]);
    // custom:true = 「刚点添加、还没填」的空行，装配时要放行（否则点了没反应）
    g.rows = g.rows.concat([{ subItem: '', amountYuan: '', custom: true }]);
    g.rows = this.decorateRows(g, g.rows);
    g.showRows = g.rows;
    groups[Number(gidx)] = g;
    this.setData({ [key]: groups });
    this.syncDineSum();
  },
  delRow(e) {
    const { kind, gidx, ridx } = e.currentTarget.dataset;
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[Number(gidx)]);
    let rows = g.rows.slice();
    rows.splice(Number(ridx), 1);
    if (rows.length === 0) rows = [{ subItem: '', amountYuan: '' }]; // 至少保留一行（老板只填一行也能走）
    g.rows = this.decorateRows(g, rows);
    g.showRows = g.expanded ? g.rows : g.rows.slice(0, 1);
    groups[Number(gidx)] = g;
    this.setData({ [key]: groups });
    this.syncDineSum();
  },

  // ===== 堂食录入模式（严格互斥二选一 · 方案 A）=====
  // ⚠️ 方案 A 语义：选「分项」时总额由各渠道相加**自动得出、不可手填** ⇒ 单一数据源，
  //    天然一致，压根不需要「分项之和==总额」的校验（互斥单选下两模式不并存，本就无两值可比）。
  // ⚠️ 防 round-trip 丢值（李老师 2026-09-21 反馈）：分项→快速→分项 来回切，原填的各渠道数值必须原样恢复，
  //    不能重铺成「总额塞第一行让你手填」。做法：切到快速前把分项行快照进 dineDetailRows，
  //    切回分项时若快照非空则整体恢复，只有【从未填过分项】才走「总额铺首行、交人分配」旧逻辑。
  // ⚠️ 模式只存本地（wx.setStorageSync），不动后端；换设备/清缓存回默认，默认值由数据推断。

  // 堂食渠道行装配（🔒 唯一入口）：预设渠道全集常在 + 别名归并 + 自定义行留末尾 + 金额按名回填。
  // ⚠️ 所有产出堂食行的路径都必须调这里（读后端/加行/删行/切模式/初始化），
  //    不许任何地方自己 map 拼装 —— 否则「改一处漏三处」（渠道凭空消失）会复发（G10g 守）。
  // ⚠️ 渠道清单只来自 terms.js，本页不写死渠道名（G10h 守）。
  decorateDineRows(rows) {
    const def = TERMS.ledger.income.find((g) => g.category === 'dine_in');
    return normalizeDineRows(rows, (def && def.items) || [], TERMS.ledger.channelNotes || {},
      TERMS.ledger.channelAliases || {});
  },

  // 任意大类行装配（🔒 唯一入口）：堂食走渠道装配；其余大类只标「预设行不可删」（fixed）。
  // ⚠️ 别在这里另写分支逻辑，堂食的渠道全集/别名规则只在 dineChannels.js 里（G11 守）。
  decorateRows(g, rows) {
    return g.category === 'dine_in' ? this.decorateDineRows(rows) : markFixedRows(rows, g.items);
  },

  // 分项模式合计（预计算，WXML 不支持方法调用）
  syncDineSum() {
    const g = this.data.incomeGroups.find((x) => x.category === 'dine_in');
    if (!g) return;
    const sum = (g.rows || []).reduce((s, r) => s + (Number(r.amountYuan) || 0), 0);
    this.setData({ dineSumYuan: sum ? sum.toFixed(2) : '0.00' });
  },

  dineModeKey() {
    const app = getApp();
    const shopId = (app && app.globalData && app.globalData.shop_id) || '';
    return DINE_MODE_KEY + shopId + '_' + this.data.month;
  },
  saveDineMode(m) { try { wx.setStorageSync(this.dineModeKey(), m); } catch (e) { /* 存不了不影响填表 */ } },
  loadDineMode() {
    try {
      const v = wx.getStorageSync(this.dineModeKey());
      if (v === 'fast' || v === 'detail') return v;
    } catch (e) { /* 读不到 → 由数据推断 */ }
    return null;
  },

  onPickDineMode(e) {
    if (this.data.readOnly) {
      wx.showModal({
        title: TERMS.inputPage.archiveReadonly,
        content: TERMS.inputPage.confirmLocked,
        showCancel: false,
      });
      return;
    }
    const val = e.currentTarget.dataset.val === 'detail' ? 'detail' : 'fast';
    if (this.data.dineMode === val) return;
    const gi = this.data.incomeGroups.findIndex((g) => g.category === 'dine_in');
    if (gi < 0) return;
    const groups = this.data.incomeGroups.slice();
    const g = Object.assign({}, groups[gi]);

    if (val === 'detail') {
      // 切回分项：优先恢复快照（原样回填各渠道数值，不重铺、不弹提示）
      const snap = this.data.dineDetailRows || [];
      if (snap.length > 0) {
        g.rows = this.decorateDineRows(snap.map((r) => ({ subItem: r.subItem || '', amountYuan: r.amountYuan || '' })));
      } else {
        // 从未填过分项（或已清空）：把快速总额铺到第一行，交人分配（系统不知道拆分比例）
        const total = (g.rows[0] && g.rows[0].amountYuan) || '';
        const def = TERMS.ledger.income.find((x) => x.category === 'dine_in');
        const seed = ((def && def.items) || []).map((name, i) => ({ subItem: name, amountYuan: i === 0 ? total : '' }));
        g.rows = this.decorateDineRows(seed.length ? seed : [{ subItem: '', amountYuan: total }]);
        if (total) wx.showToast({ title: TERMS.ledger.dineMode.splitNotice, icon: 'none' });
      }
      g.expanded = true;
    } else {
      // 切到快速：先把当前分项行**快照**保住（原样恢复用），再收拢为单行总额
      const cur = (g.rows || []).map((r) => ({ subItem: r.subItem || '', amountYuan: r.amountYuan || '' }));
      const sum = cur.reduce((s2, r) => s2 + (Number(r.amountYuan) || 0), 0);
      g.rows = this.decorateDineRows([{ subItem: '', amountYuan: sum ? sum.toFixed(2) : '' }]);
      g.expanded = false;
      g.showRows = g.rows;
      groups[gi] = g;
      this.setData({ incomeGroups: groups, dineMode: val, dineDetailRows: this.decorateDineRows(cur) });
      this.syncDineSum();
      this.saveDineMode(val);
      return;
    }
    g.showRows = g.rows;
    groups[gi] = g;
    this.setData({ incomeGroups: groups, dineMode: val, dineDetailRows: g.rows.map((r) => ({ subItem: r.subItem || '', amountYuan: r.amountYuan || '', fixed: !!r.fixed, note: r.note || '' })) });
    this.syncDineSum();
    this.saveDineMode(val);
  },

  onDirectConsume(e) { this.setData({ directConsumeYuan: e.detail.value }); },

  // ===== 核算方式（就地二选一 · 2026-09-20 从店铺设置页迁入）=====
  // ⚠️ 服务端唯一权威：这里只做「乐观更新 → 写库 → 失败回滚」，不自行推导计算口径。
  // ⚠️ name / remark 必须一并回传：saveShopSetting 对未传字段归一为 '' 并写库 → 会把店铺名清空。
  async onPickMethod(e) {
    if (this.data.readOnly) {
      wx.showModal({
        title: TERMS.inputPage.archiveReadonly,
        content: TERMS.inputPage.confirmLocked,
        showCancel: false,
      });
      return;
    }
    const kind = e.currentTarget.dataset.kind;                 // 'inventory' | 'amortize'
    const val = String(e.currentTarget.dataset.val) === '1';   // dataset 一律字符串
    const key = kind === 'inventory' ? 'inventoryOn' : 'amortizeOn';
    if (this.data[key] === val) return;                        // 已选中，不重复写库

    if (!this.data.shopBaseLoaded) await this.loadShopBase();
    const prev = this.data[key];
    this.setData({ [key]: val });                              // 乐观更新
    try {
      await api.call('saveShopSetting', {
        name: this.data.shopName,
        remark: this.data.shopRemark,
        switches: kind === 'inventory' ? { inventory: val } : { amortize: val },
        client_request_id: 'cm_' + Date.now(),
      });
      wx.showToast({ title: TERMS.calcMethod.switchSaved, icon: 'success' });
      if (kind === 'amortize' && val) this.loadAssetCount();
    } catch (err) {
      this.setData({ [key]: prev });                           // 服务端才是权威 → 回滚
      api.toastError(err);
    }
  },

  // 店铺名 / 备注（仅用于切换口径时原样回传，避免被写空）
  async loadShopBase() {
    try {
      const ctx = await api.call('getShopContext', {});
      this.setData({ shopName: ctx.shop_name || '', shopRemark: ctx.shop_remark || '', shopBaseLoaded: true });
    } catch (e) {
      this.setData({ shopBaseLoaded: true });   // 取不到就不回传（后端 undefined = 不动库）
    }
  },

  // 摊销资产笔数（纯提示位：显示"已登记 N 笔"，失败不打断填表）
  async loadAssetCount() {
    try {
      const d = await api.call('getAmortSchedule', { month: this.data.month });
      const n = (d.assets || []).length;
      this.setData({ assetSummary: n > 0 ? TERMS.calcMethod.assetCount(n) : '' });
    } catch (e) {
      this.setData({ assetSummary: '' });
    }
  },

  goInventory() { wx.navigateTo({ url: '/pages/month/inventory?month=' + this.data.month }); },
  goAmortize() { wx.navigateTo({ url: '/pages/month/amortize?month=' + this.data.month }); },

  // 归档守卫 + 保存（保存时带已有库存数据，避免丢失）
  onSave() {
    if (this.data.readOnly) {
      wx.showModal({ title: TERMS.inputPage.archiveReadonly, content: TERMS.inputPage.confirmLocked, showCancel: false });
      return;
    }
    const doSave = () => this.save(!!this.data.isArchive); // 归档补录 → archive_override
    if (this.data.isArchive && this.data.inGrace) {
      wx.showModal({
        title: TERMS.inputPage.saveArchiveOverride,
        content: TERMS.inputPage.confirmGraceSave,
        confirmColor: '#1e3a5f',
        success: (r) => { if (r.confirm) doSave(); },
      });
    } else {
      doSave();
    }
  },

  // 组装提交：每大类 → sub_items（云函数汇总大类金额，前端不汇总）；旧调用兼容（无细项时也走 sub_items 单行）
  buildItems(groups) {
    return groups.map((g) => ({
      category: g.category,
      name: g.label,
      // ⚠️ 堂食预设渠道是「全集常驻」，多数行是空的 ⇒ 只提交**填了金额**的行，
      //    否则每保存一次就往后端塞一堆空 sub_item（G10i 守）。
      //    注意：快速模式单行（无名、有金额）必须保留 ⇒ 判据看金额，不看名字。
      sub_items: g.rows
        .filter((r) => String(r.amountYuan === undefined || r.amountYuan === null ? '' : r.amountYuan).trim() !== '')
        .map((r) => ({ sub_item: (r.subItem || '').trim(), amount_fen: api.yuanToFen(r.amountYuan) })),
    }));
  },

  async save(archiveOverride) {
    try {
      ui.setTitle(TERMS.buttons.save);
      await api.call('saveLedger', {
        month: this.data.month,
        income_items: this.buildItems(this.data.incomeGroups),
        expense_items: this.buildItems(this.data.expenseGroups),
        direct_consume_fen: api.yuanToFen(this.data.directConsumeYuan),
        inventory: this.data.inventory || undefined,
        archive_override: archiveOverride || undefined,
        client_request_id: 'li_' + Date.now(),
      });
      this.setData({ saved: true });
      wx.removeStorageSync(DRAFT_KEY + this.data.month); // 已保存 → 清草稿
      wx.showToast({ title: TERMS.buttons.save, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) { api.toastError(e); }
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});