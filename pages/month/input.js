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
const { pickTakeawayMode, takeawayModeKey, snapshotDetail, restoreDetail, subtotalOf,
  extractPaste, pasteFillValue, pasteFilledFromTotal, filledLabel, subsidyTotal, reconcile,
  mkByPlatTotal, mkByPlatFilled } = require('../../utils/takeaway.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

const DRAFT_KEY = 'draft_month_input_';
// 堂食录入模式（快速 / 分项）**仅存本地**，不动后端契约；换设备或清缓存回默认，默认值由数据推断
const DINE_MODE_KEY = 'dine_mode_';
// R85：外卖录入模式（快速 / 分项），同堂食约定（仅存本地；默认按数据推断）
const TAKEOUT_MODE_KEY = 'takeout_mode_';

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
      // T4b（round97）：预设项选择面板文案（页面零硬编码 ⇒ 必须在此映射，否则 wxml 取到空串）
      presetPickTitle: TERMS.ledger.presetPickTitle,
      presetPickCustom: TERMS.ledger.presetPickCustom,
      presetPickEmpty: TERMS.ledger.presetPickEmpty,
      delSubItem: TERMS.ledger.delSubItem,
      amount: TERMS.ledger.amount,
      incomeHint: TERMS.ledger.incomeHint,   // E1
      expenseHint: TERMS.ledger.expenseHint, // E1
      // E2（批次 8c）：每类「包括 / 不包括」+ 顶部填写口径折叠块
      fillGuideTitle: TERMS.ledger.fillGuideTitle,
      fillGuide: TERMS.ledger.fillGuide,
      // round108 修复（同族病：**wxml 用了、t 里没映射 ⇒ 渲染成空串**）：
      //   下面 4 个键 input.wxml 一直在用，却从来没映射进来 —— 术语本体一直在 TERMS.ledger 里。
      //   症状：「怎么填？点开看口径」/「收起口径」的引导文字变空白、小计后缀（「食材合计」的「合计」）
      //   与预设项提示前缀（「还没加的有：」）消失。守卫 check_page_terms 已补上防复发。
      scopeShow: TERMS.ledger.scopeShow,
      scopeHide: TERMS.ledger.scopeHide,
      classTotalSuffix: TERMS.ledger.classTotalSuffix,
      presetHintPrefix: TERMS.ledger.presetHintPrefix,
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
      // round107：「一次性投入」段 —— 二选一卡片整块删除（那对选项写的是 shop 级 amortize_switch，
      //   结构上排除了「本月既有一笔摊销、又有几笔小额一次算清」）。现在只留：口径说明 + 两行摘要 + 一个入口。
      cmAssetTitle: TERMS.calcMethod.assetTitle,
      cmAssetHint: TERMS.calcMethod.assetHint,
      cmAssetGo: TERMS.calcMethod.assetGo,
      cmAssetSumEmpty: TERMS.calcMethod.assetSumEmpty,
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
      // round108 修复：渠道金额输入框的 placeholder（「填金额（元）」）此前取到 undefined ⇒ 空白
      dmAmtPh: TERMS.ledger.dineMode.amtPh,
      // R85：外卖段（规范 §A.11）—— 模式开关 / 分项三框 / 粘贴 / 配平 / 带出 / 推广费取数路径
      twSecTitle: TERMS.ledger.takeawayMode.secTitle,
      twFast: TERMS.ledger.takeawayMode.fast,
      twFastDesc: TERMS.ledger.takeawayMode.fastDesc,
      twDetail: TERMS.ledger.takeawayMode.detail,
      twDetailDesc: TERMS.ledger.takeawayMode.detailDesc,
      twFastHint: TERMS.ledger.takeawayMode.fastHint,
      twDetailHint: TERMS.ledger.takeawayMode.detailHint,
      twSumLabel: TERMS.ledger.takeawayMode.sumLabel,
      twSumAutoHint: TERMS.ledger.takeawayMode.sumAutoHint,
    twTotalLabel: TERMS.ledger.takeawayMode.totalLabel,
    twTotalAutoHint: TERMS.ledger.takeawayMode.totalAutoHint,
    twFastPh: TERMS.ledger.takeawayMode.fastPh,
      twGoodsField: TERMS.ledger.takeawayMode.goodsField,
      twPackField: TERMS.ledger.takeawayMode.packField,
      twSubsidyField: TERMS.ledger.takeawayMode.subsidyField,
      twGoodsPh: TERMS.ledger.takeawayMode.goodsPh,
      twPackPh: TERMS.ledger.takeawayMode.packPh,
      twSubsidyPh: TERMS.ledger.takeawayMode.subsidyPh,
      twPasteBtn: TERMS.ledger.takeawayMode.pasteBtn,
      twPasteAreaTitle: TERMS.ledger.takeawayMode.pasteAreaTitle,
      twPasteAreaPh: TERMS.ledger.takeawayMode.pasteAreaPh,
      twPasteExtract: TERMS.ledger.takeawayMode.pasteExtract,
      twPasteCancel: TERMS.ledger.takeawayMode.pasteCancel,
      twSelfCheckMiss: TERMS.ledger.takeawayMode.selfCheckMiss,
      // T1（round97）：营销段「分平台佣金小计」（只回显不入库）；提示句里的项名走 reconcileRoles 单源
      mkPlatTitle: TERMS.ledger.takeawayMode.mkPlatTitle,
      mkPlatHint: (TERMS.ledger.takeawayMode.mkPlatHintTpl || '').replace('{name}', (TERMS.ledger.takeawayMode.reconcileRoles || {}).commission || ''),
      mkPlatPh: TERMS.ledger.takeawayMode.mkPlatPh,
      mkPlatSumLabel: TERMS.ledger.takeawayMode.mkPlatSumLabel,
      mkPlatClear: TERMS.ledger.takeawayMode.mkPlatClear,
      twPasteConfirmTitle: TERMS.ledger.takeawayMode.pasteConfirmTitle,
      twPasteConfirmBody: TERMS.ledger.takeawayMode.pasteConfirmBody,
      twPasteDone: TERMS.ledger.takeawayMode.pasteDone,
      twPasteFromTotal: TERMS.ledger.takeawayMode.pasteFromTotal,
      twPasteEmpty: TERMS.ledger.takeawayMode.pasteEmpty,
      twPasteRawKept: TERMS.ledger.takeawayMode.pasteRawKept,
      twScopeGuide: TERMS.ledger.takeawayMode.scopeGuide,
      twRecTitle: TERMS.ledger.takeawayMode.reconcileTitle,
      twRecField: TERMS.ledger.takeawayMode.recField,
      twRecPh: TERMS.ledger.takeawayMode.recPh,
      twRecCalcHint: TERMS.ledger.takeawayMode.recCalcHint,
      twRecNoInput: TERMS.ledger.takeawayMode.recNoInput,
      twAutoCarryLabel: TERMS.ledger.takeawayMode.autoCarryLabel,
      twAutoCarryHint: TERMS.ledger.takeawayMode.autoCarryHint,
      twPromoPathLabel: TERMS.ledger.takeawayMode.promoPathLabel,
      twPromoPathHint: TERMS.ledger.takeawayMode.promoPathHint,
      expenseItemNotes: TERMS.ledger.expenseItemNotes || {},
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
    // R85：外卖录入模式（'fast' | 'detail'，同堂食方案 A 严格互斥）
    takeoutMode: 'fast',
    takeoutDetailRows: [],     // 分项模式行快照 [{platform,goods,pack,subsidy}]（切模式/草稿留存）
    takeoutSumYuan: '0.00',    // 外卖收入合计（预计算；按模式取数：快速=Σ平台单值 / 分项=Σ小计）
    takeoutFilledText: '',     // 「已填 N / M 个平台」预计算串（WXML 不支持方法调用）
    twPasteFor: '',            // 当前粘贴目标（'goods'|'pack'|'subsidy'|'platform' + idx）
    twPasteText: '',           // 粘贴区文本（textarea v-model）
    twPasteOpen: false,        // 粘贴面板是否打开
    // T4b（round97）：费用段「+ 添加细项」的预设项选择面板（清单每次打开现算 = 该类预设 ∖ 已有行名）
    presetPick: { open: false, kind: '', gi: 0, list: [] },
    twSelfCheck: '',           // T3′（round97）：快速模式轻量自查提示（预计算，WXML 直接取）
    // T1（round97）：分平台佣金小计（只回显、不入库；进本地草稿，同分项三明细待遇）
    twMkByPlat: [],            // [{platform, amountYuan}] —— 平台名取自收入侧外卖 items 单源
    twMkByPlatSum: '0.00',     // 分平台合计（预计算，WXML 直接取）
    twMkByPlatActive: false,   // 任一小计非空 ⇒ 接管佣金总额那一行（该行转只读）
    twMkRowGi: -1,             // 被接管的佣金行所在组下标（-1 = 未接管）
    twMkRowRi: -1,             // 被接管的佣金行在组内下标
    twRecYuan: '',             // 账单商家应收款（客户手填，选填）
    twRecText: '',             // 配平提示文案（软提示；不阻断、不入库）
    directConsumeYuan: '',
    // 核算方式（就地二选一）：真值以服务端 switches 为准；改动即时写库，失败回滚
    inventoryOn: false,
    invSummary: '',
    // round107：「一次性投入」两行摘要 —— ① 本月一次算清（lumps）② 本月分月摊（assets）。
    //   两行都由 getAmortSchedule 出参拼文案，空串 = 该行不显示。
    assetSummaryLump: '',
    assetSummaryAmort: '',
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
        // R85：外卖段草稿回填（分项明细 / 粘贴原文 / 账单商家应收款；均只存本地，不入库）
        takeoutMode: (draft.takeoutMode === 'fast' || draft.takeoutMode === 'detail') ? draft.takeoutMode : this.data.takeoutMode,
        takeoutDetailRows: draft.takeoutDetailRows || this.data.takeoutDetailRows,
        twRecYuan: draft.twRecYuan !== undefined ? draft.twRecYuan : this.data.twRecYuan,
        twPasteRaw: draft.twPasteRaw || this.data.twPasteRaw || [],
        // T1：分平台小计（只存本地、不入库）
        twMkByPlat: this.buildMkByPlat(draft.twMkByPlat || this.data.twMkByPlat),
      });
      this.syncTakeoutSum();   // R119：两种模式都要重算（快速模式的合计取自 groups）
      this.syncMkByPlat();     // T1：小计回草稿后重算（全空 ⇒ 不碰那一行）
    }
    // round104：从「库存盘点 / 摊销」子页返回时，按钮下面那行摘要必须重读 ——
    //   invSummary / 两行投入摘要（assetSummaryLump / assetSummaryAmort，round107 前身是 assetSummary）
    //   原来只在 load()（= onLoad）里算 ⇒ 返回后恒显旧数字
    //   （李老师实机反馈 2026-09-23：「去填库存盘点」下面那行不变）。
    //   ⚠️ 首次 onShow 紧跟 onLoad，load() 已经拉过 ⇒ 用 _shown 跳过，省一次云调用。
    if (this._shown) this.refreshCalcSummaries();
    this._shown = true;
  },
  onHide() {
    // AD-10：自动存草稿（含已录入值）
    wx.setStorageSync(DRAFT_KEY + this.data.month, {
      incomeGroups: this.data.incomeGroups,
      expenseGroups: this.data.expenseGroups,
      directConsumeYuan: this.data.directConsumeYuan,
      dineDetailRows: this.data.dineDetailRows,
      // R85：外卖段草稿（分项明细 / 粘贴原文可回溯 / 账单商家应收款；均不入库）
      takeoutMode: this.data.takeoutMode,
      takeoutDetailRows: this.data.takeoutDetailRows,
      twRecYuan: this.data.twRecYuan,
      twPasteRaw: this.data.twPasteRaw || [],
      // T1：分平台小计（只回显不入库 ⇒ 只进草稿）
      twMkByPlat: this.data.twMkByPlat,
    });
  },

  // A2：按模板初始化大类组（每类默认单行：细项名空 = 整类总额）
  // ⚠️ showRows = 实际渲染行：折叠时仅首行（整类总额），展开时全部细项行（WXML 不支持方法调用，故预计算）
  // E2：每类带一句 scope（包括 / 不包括），来源 i18n（incomeScope / expenseScope），页面不写死文案
  initGroups() {
    // T1：分平台小计行按收入侧平台单源铺开（此时通常全空 ⇒ 不接管任何行）
    const byPlat = this.buildMkByPlat(this.data.twMkByPlat);
    // ⚠️ round102：先建出**页面对象**再装配 rows —— decorateRows 会往 g 上挂只读派生字段
    //   （unused / mkPlatAfterRi），若把 terms 单源元素直接传进去会污染单源。
    const mk = (defs, scopeMap) => defs.map((d) => {
      const raw = [{ subItem: '', amountYuan: '' }];
      const g = {
        category: d.category, label: d.label, items: d.items || [],
        scope: (scopeMap || {})[d.category] || '',
        scopeOpen: false,   // 2026-09-21：口径句默认收起（李老师反馈原样展开太占地方）
        expanded: false,
        rows: [],
        showRows: [],
      };
      g.rows = this.decorateRows(g, raw);
      g.showRows = g.category === 'dine_in' ? g.rows : raw;
      return g;
    });
    this.setData({
      incomeGroups: mk(TERMS.ledger.income, TERMS.ledger.incomeScope),
      expenseGroups: this.decorateExpenseNotes(mk(TERMS.ledger.expense, TERMS.ledger.expenseScope)),
      twMkByPlat: byPlat,
      twMkByPlatSum: mkByPlatTotal(byPlat) ? mkByPlatTotal(byPlat).toFixed(2) : '0.00',
      twMkByPlatActive: mkByPlatFilled(byPlat),
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
    return defs.map((d) => {
      const found = (items || []).find((it) => (it.category || '') === d.category);
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
      // ⚠️ round102：同 initGroups —— 先建页面对象再装配（decorateRows 会往 g 挂只读派生字段）
      const g = {
        category: d.category, label: d.label, items: d.items || [],
        scope: (scopeMap || {})[d.category] || '',
        scopeOpen: false,   // 与 initGroups 一致：读回后端数据也默认收起
        expanded,
        rows: [],
        showRows: [],
      };
      g.rows = this.decorateRows(g, rows);
      g.showRows = expanded ? rows : rows.slice(0, 1);
      if (d.category === 'dine_in') {
        g.showRows = expanded ? g.rows : g.rows.slice(0, 1);
      }
      return g;
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
      const expenseGroups = this.decorateExpenseNotes(this.rebuildFromItems(TERMS.ledger.expense, d.expense_items, TERMS.ledger.expenseScope));
      const directConsumeYuan = d.direct_consume_fen ? api.fenToYuan(d.direct_consume_fen) : '';
      // 堂食分项快照：若后端已存分项（>1 行），原样带入 dineDetailRows，切回分项可恢复（防 round-trip 丢值）
      const dG = incomeGroups.find((x) => x.category === 'dine_in');
      const dineDetailRows = (dG && dG.rows && dG.rows.length > 1)
        ? dG.rows.map((r) => ({ subItem: r.subItem || '', amountYuan: r.amountYuan || '', fixed: !!r.fixed, note: r.note || '' }))
        : [];
      // R85：外卖段 —— 从后端回读的 takeaway 行（每平台 1 个数）铺到分项「商品总价」行
      //   （分项三明细不落库，只有小计回后端；切分项时按小计铺 goods，用户可继续拆）
      const twG = incomeGroups.find((x) => x.category === 'takeaway');
      const takeoutDetailRows = restoreDetail(
        (twG && twG.rows || []).map((r) => ({ platform: r.subItem || '', goods: r.amountYuan || '' })),
        TERMS.ledger.income.find((g) => g.category === 'takeaway') ? TERMS.ledger.income.find((g) => g.category === 'takeaway').items : [],
      );
      // 核算方式读回（服务端权威；口径锁：经营参考利润用直接填值，真实利润才倒轧）
      const inventoryOn = !!sw.inventorySwitchOn;
      const inv = d.inventory || {};
      // round103：getLedger 出参 inventory 已按契约转 snake_case。此前后端透传 DB 的 camelCase，
      //   本页读 camelCase「碰巧能跑」—— 一旦后端按契约修好，这里会静默变空（同族隐患，一并统一）。
      // round104：摘要算法抽到 invSummaryOf()，与「子页返回刷新」共用同一份（防两处漂移）
      const invSummary = this.invSummaryOf(d);
      // 若草稿存在且已保存过 → 用后端值（服务端为准）；否则后端值直接回填
      this.setData({
        isArchive, archivedAtMs, inGrace, readOnly,
        // round103：**不再回带库存**。契约里 saveLedger 的 `inventory?` 是可选的，缺省即「不动库存」；
        //   原先把 getLedger 的 camelCase 原样回带，而 saveLedger 只认 snake_case
        //   ⇒ 保存一次就把盘点**静默清零**（实跑复现：真实消耗 23,000 → 0，零报错）。
        incomeGroups,
        expenseGroups,
        dineMode: this.pickDineMode(incomeGroups),
        dineDetailRows,
        // R85：外卖模式（本地缓存优先，默认按数据推断）+ 分项行（从小计回铺 goods）
        takeoutMode: this.pickTakeoutMode(incomeGroups),
        takeoutDetailRows,
        inventoryOn, invSummary,
        directConsumeYuan: directConsumeYuan || this.data.directConsumeYuan,
        loading: false,
      });
      // R85/R119：模式确定后算合计与带出。**两种模式都要算合计** —— 快速模式的合计取自各平台单值
      //   （原先只在分项模式算 ⇒ 快速模式合计恒显 0.00）。配平仍只在分项：快速模式拆不出「活动补贴」。
      this.syncTakeoutSum();
      if (this.data.takeoutMode === 'detail') this.runReconcile();
      this.loadAssetCount();   // round107：两行摘要与「按月分摊」开关无关（一次性投入也走这里）⇒ 无条件拉
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
    // R85：费用侧「外卖活动补贴」被用户手改 → 上锁（syncSubsidyCarry 不再覆盖；除非再动收入侧分项值）
    if (kind === 'expense' && g.category === 'marketing' && rows[ridx].subItem === '外卖活动补贴' && patch.amountYuan !== undefined) {
      rows[ridx].twCarryLock = true;
    }
    g.rows = rows;
    g.showRows = g.expanded ? rows : rows.slice(0, 1);
    groups[gidx] = g;
    this.setData({ [key]: groups });
    this.syncDineSum();
    // R119：外卖收入（收入侧 takeaway 组）在快速模式下就在这里改 → 合计必须跟着重算
    if (kind === 'income' && g.category === 'takeaway') this.syncTakeoutSum();
    // T3′：费用侧营销行被改 → 轻量自查提示要跟着消/显（幂等，无变化不 setData）
    if (kind === 'expense') this.syncTakeoutSelfCheck();
  },
  // T4b（round97）：费用段「+ 添加细项」→ 先弹该类**尚未添加**的预设项清单。
  //   ⚠️ 本轮只作用于费用侧（data-kind="expense"）；收入侧仍走 addRow（空白行）—— 范围刻意限定。
  //   ⚠️ 清单**每次打开现算**（= g.items 去掉已有行名），不预存 data ⇒ 不会与 rows 状态不一致。
  onOpenPresetPick(e) {
    const kind = e.currentTarget.dataset.kind;
    const gi = Number(e.currentTarget.dataset.gidx);
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const g = (this.data[key] || [])[gi];
    if (!g) return;
    const used = (g.rows || []).map((r) => (r.subItem || '').trim()).filter(Boolean);
    const list = (g.items || []).filter((n) => used.indexOf(n) < 0);
    this.setData({ presetPick: { open: true, kind, gi, list } });
  },
  closePresetPick() {
    this.setData({ 'presetPick.open': false });
  },
  // 选中预设项（name 非空）或末位「自定义」（name 空 ⇒ 空白行，行为与旧 addRow 一致）
  onPickPreset(e) {
    const pp = this.data.presetPick || {};
    const name = e.currentTarget.dataset.name || '';
    this.setData({ 'presetPick.open': false });
    this.addSubRow(pp.kind, pp.gi, name);
  },
  // 加一行细项（name 空 = 自定义空白行）；其余与 addRow 完全同构，避免两条装配路径分叉
  addSubRow(kind, gidx, name) {
    const key = kind === 'income' ? 'incomeGroups' : 'expenseGroups';
    const groups = this.data[key].slice();
    const g = Object.assign({}, groups[Number(gidx)]);
    // custom:true = 「刚点添加、还没填」的空行，装配时要放行（否则点了没反应）
    g.rows = g.rows.concat([{ subItem: name || '', amountYuan: '', custom: !name }]);
    g.rows = this.decorateRows(g, g.rows);
    g.showRows = g.rows;
    groups[Number(gidx)] = g;
    this.setData({ [key]: groups });
    this.syncDineSum();
    if (kind === 'income' && g.category === 'takeaway') this.syncTakeoutSum();
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
    const out = g.category === 'dine_in' ? this.decorateDineRows(rows) : markFixedRows(rows, g.items);
    // round102（2026-09-22）· 顺带算两个**只读派生字段**（挂到 g 上；不入库、不影响 fixed）：
    //   · g.unused / g.unusedText —— 该类「还没用上的预设项」（供 WXML 底部提示行）
    //   · g.mkPlatAfterRi —— 「分平台佣金小计」块该渲染在哪一行**之后**（营销组专用）
    //   ⚠️ 放在这里是因为它正是所有 rows 变更路径的**唯一装配口**；散到各 setData 点必漏一处。
    //   ⚠️ 因此调用方传进来的 g **必须是可写的页面对象**，不能是 terms 单源数组的元素（会污染单源）。
    const used = out.map((r) => (r.subItem || '').trim()).filter(Boolean);
    const items = g.items || [];
    const unused = (g.category === 'dine_in' || !items.length)
      ? [] : items.filter((n) => used.indexOf(n) < 0);
    g.unused = unused;
    g.unusedText = unused.join(TERMS.ledger.presetHintSep || '');
    g.mkPlatAfterRi = this.calcMkPlatAfterRi(g, out);
    return out;
  },

  // round102：营销组「分平台佣金小计」块的渲染锚点（返回**行下标** —— WXML 在该行之后插块）
  //   · 佣金项名单源 = takeawayMode.reconcileRoles.commission（页面零硬编码）
  //   · 找不到（老板删了 / 从没加过）⇒ 退化为**末行之后** —— 块仍可见、功能不丢
  //   · 非营销组 ⇒ -1（WXML 里 ri 永不等于 -1，自然不渲染）
  calcMkPlatAfterRi(g, rows) {
    if (g.category !== 'marketing') return -1;
    const name = ((TERMS.ledger.takeawayMode || {}).reconcileRoles || {}).commission || '';
    const list = rows || [];
    if (name) {
      const ri = list.findIndex((r) => r.subItem === name);
      if (ri >= 0) return ri;
    }
    return list.length - 1;
  },

  // R85：费用侧营销行「取数路径」标注（按 terms.expenseItemNotes 预计算挂到行上；页面不写死项名）
  // ⚠️ 项名与顺序单源 = collections.js::SEED_EXPENSE_ITEMS(marketing)；terms 的 expense.marketing.items 已对齐。
  decorateExpenseNotes(groups) {
    const notes = TERMS.ledger.expenseItemNotes || {};
    const mkIdx = (groups || []).findIndex((x) => x.category === 'marketing');
    if (mkIdx < 0) return groups;
    const g = Object.assign({}, groups[mkIdx]);
    g.rows = (g.rows || []).map((r) => {
      const note = notes[r.subItem] || '';
      if (!note) return r;
      return Object.assign({}, r, {
        note,
        // 推广费单独高亮取数路径（项名走 terms 单源 promoItem；不用文案内容判断，避免改文案即失效）
        promo: r.subItem === (TERMS.ledger.takeawayMode && TERMS.ledger.takeawayMode.promoItem),
      });
    });
    const out = (groups || []).slice();
    out[mkIdx] = g;
    return out;
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

  // ===================== R85 · 外卖段（规范 §A.11，2026-09-22 锁定）=====================
  // ⚠️ 后端零改动：提交仍走现有契约（category='takeaway' → sub_items[].sub_item/amount_fen），
  //   分项三明细只在本页当场计算小计，不落库（留存走本地草稿，见 §2.6）。
  // ⚠️ 平台名与顺序严格取自 TERMS.ledger.income[takeaway].items（页面不写死平台名）。
  takeoutPlatforms() {
    const def = TERMS.ledger.income.find((g) => g.category === 'takeaway');
    return (def && def.items) || [];
  },

  takeoutModeKey() {
    const app = getApp();
    const shopId = (app && app.globalData && app.globalData.shop_id) || '';
    return TAKEOUT_MODE_KEY + shopId + '_' + this.data.month;
  },
  saveTakeoutMode(m) { try { wx.setStorageSync(this.takeoutModeKey(), m); } catch (e) { /* 存不了不影响填表 */ } },
  loadTakeoutMode() {
    try {
      const v = wx.getStorageSync(this.takeoutModeKey());
      if (v === 'fast' || v === 'detail') return v;
    } catch (e) { /* 读不到 → 由数据推断 */ }
    return null;
  },

  // 默认模式由数据推断：该组细项行 >1 ⇒ 分项（同堂食 pickDineMode 约定）
  pickTakeoutMode(incomeGroups) {
    const cached = this.loadTakeoutMode();
    if (cached === 'fast' || cached === 'detail') return cached;
    const g = (incomeGroups || []).find((x) => x.category === 'takeaway');
    return (g && g.rows && g.rows.length > 1) ? 'detail' : 'fast';
  },

  // 分项模式行：平台全集常驻（名称固定、不可删），三框 + 小计预计算
  buildTakeoutDetail() {
    const snap = this.data.takeoutDetailRows || [];
    const rows = restoreDetail(snap, this.takeoutPlatforms());
    this.setData({ takeoutDetailRows: rows });
    this.syncTakeoutSum();
  },

  // R119：快速 / 分项共用 —— 按当前模式取数算合计，并算「已填 N / M 个平台」。
  //   ⚠️ 两种模式的钱**不在同一处**：快速 = groups.rows[].amountYuan；分项 = takeoutDetailRows[].subtotal。
  //   合计只用于回显与自查，不写入任何金额（口径见规范 §A.11）。
  syncTakeoutSum() {
    const g = this.data.incomeGroups.find((x) => x.category === 'takeaway');
    const platforms = (g && g.rows) || [];
    const detail = this.data.takeoutDetailRows || [];
    const isFast = this.data.takeoutMode === 'fast';
    const sum = isFast
      ? platforms.reduce((s, r) => s + (Number(r.amountYuan) || 0), 0)
      : detail.reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
    // 已填平台数：快速看单值；分项看三项里填过任意一个
    const filled = isFast
      ? platforms.filter((r) => Number(r.amountYuan) > 0).length
      : detail.filter((r) => Number(r.goods) > 0 || Number(r.pack) > 0 || Number(r.subsidy) > 0).length;
    const t = TERMS.ledger.takeawayMode || {};
    this.setData({
      takeoutSumYuan: sum ? sum.toFixed(2) : '0.00',
      // 只有 1 个平台行（整类总额）时不给这句，避免噪音（见 filledLabel 注释）
      takeoutFilledText: filledLabel(t.filledTpl || '已填 {n} / {m} 个平台', filled, platforms.length),
    });
    this.syncSubsidyCarry();   // 带出联动：活动补贴合计 → 费用侧（仅分项模式生效）
    this.syncTakeoutSelfCheck();   // T3′：外卖收入变了 → 重算轻量自查提示
  },

  // ===== 模式切换（严格互斥；快照恢复防 round-trip 丢值）=====
  onPickTakeoutMode(e) {
    if (this.data.readOnly) {
      wx.showModal({ title: TERMS.inputPage.archiveReadonly, content: TERMS.inputPage.confirmLocked, showCancel: false });
      return;
    }
    const val = e.currentTarget.dataset.val === 'detail' ? 'detail' : 'fast';
    if (this.data.takeoutMode === val) return;
    const gi = this.data.incomeGroups.findIndex((g) => g.category === 'takeaway');
    if (gi < 0) return;

    if (val === 'detail') {
      // 快速 → 分项：把快速模式的各平台金额铺到分项「商品总价」行（单一数据源，不重铺、不丢数）
      const groups = this.data.incomeGroups.slice();
      const g = Object.assign({}, groups[gi]);
      const snap = (g.rows || []).map((r) => ({
        platform: r.subItem || '',
        goods: r.amountYuan || '',
        pack: '',
        subsidy: '',
      }));
      this.setData({ takeoutMode: val, takeoutDetailRows: restoreDetail(snap, this.takeoutPlatforms()) });
      this.saveTakeoutMode(val);
      this.syncTakeoutSum();
    } else {
      // 分项 → 快速：先快照（草稿留存），再按平台小计收拢为单行总额
      const snap = (this.data.takeoutDetailRows || []).map((r) => ({
        platform: r.platform || '', goods: r.goods || '', pack: r.pack || '', subsidy: r.subsidy || '',
      }));
      const groups = this.data.incomeGroups.slice();
      const g = Object.assign({}, groups[gi]);
      g.rows = this.decorateRows(g, snap.map((r) => ({ subItem: r.platform, amountYuan: subtotalOf(r.goods, r.pack, r.subsidy) })));
      groups[gi] = g;
      this.setData({ incomeGroups: groups, takeoutMode: val, takeoutDetailRows: snap });
      this.saveTakeoutMode(val);
      this.syncTakeoutSum();
    }
  },

  // ===== 分项三框输入 =====
  onTwDetail(e) {
    const field = e.currentTarget.dataset.field;     // 'goods'|'pack'|'subsidy'
    const idx = Number(e.currentTarget.dataset.idx);
    const rows = (this.data.takeoutDetailRows || []).slice();
    const r = Object.assign({}, rows[idx]);
    r[field] = e.detail.value;
    r.subtotal = subtotalOf(r.goods, r.pack, r.subsidy);
    rows[idx] = r;
    this.setData({ takeoutDetailRows: rows });
    this.syncTakeoutSum();
  },

  // ===== 粘贴（A.11.5：加速器，非唯一入口）=====
  openPaste(e) {
    // data-target: 'goods'|'pack'|'subsidy', data-idx: 平台行
    this.setData({
      twPasteFor: (e.currentTarget.dataset.target || 'goods') + ':' + String(e.currentTarget.dataset.idx),
      twPasteText: '',
      twPasteOpen: true,
    });
  },
  onPasteText(e) { this.setData({ twPasteText: e.detail.value }); },
  closePaste() { this.setData({ twPasteOpen: false, twPasteFor: '', twPasteText: '' }); },
  onPasteExtract() {
    const text = this.data.twPasteText;
    const res = extractPaste(text);
    const fill = pasteFillValue(res);
    // 🔴 R120：判据 = 「**最终**能不能填出值」，而不是「有没有明细数字」。
    //   旧判据 `res.numbers.length === 0` 会把「只复制了合计那一行」误判成没粘到东西 ⇒ 报「未提取到数字」；
    //   而同一份账单换成「合计⏎7140.00」的写法又会直接填 —— 同一语义两种结果。
    if (fill === '') {
      wx.showToast({ title: TERMS.ledger.takeawayMode.pasteEmpty, icon: 'none' });
      return;
    }
    // 本次填入来自「合计兜底」（无任何明细数字）⇒ 必须换一种提示，提醒可能与明细重复
    const fromTotal = pasteFilledFromTotal(res);
    const doFill = () => {
      const [field, idxStr] = (this.data.twPasteFor || 'goods:0').split(':');
      const idx = Number(idxStr) || 0;
      const rows = (this.data.takeoutDetailRows || []).slice();
      if (!rows[idx]) return;
      const r = Object.assign({}, rows[idx]);
      r[field] = fill;                  // R119：0 是合法金额，不能被当成空
      r.subtotal = subtotalOf(r.goods, r.pack, r.subsidy);
      rows[idx] = r;
      this.setData({ takeoutDetailRows: rows, twPasteOpen: false });
      // 原始粘贴内容留存可回溯（本地草稿，见 onHide）；fromTotal 标记本次为合计兜底填入
      this.setData({ twPasteRaw: (this.data.twPasteRaw || []).concat([{ at: Date.now(), field, idx, raw: res.raw, fromTotal }]) });
      this.syncTakeoutSum();
      wx.showToast({
        title: fromTotal ? TERMS.ledger.takeawayMode.pasteFromTotal : TERMS.ledger.takeawayMode.pasteDone,
        icon: fromTotal ? 'none' : 'success',
      });
    };
    // 只有「有明细 + 有合计」才需要确认明细口径；纯合计兜底场景没有明细可确认，直接填并提示
    if (res.hasTotal && !fromTotal) {
      wx.showModal({
        title: TERMS.ledger.takeawayMode.pasteConfirmTitle,
        content: TERMS.ledger.takeawayMode.pasteConfirmBody,
        confirmColor: '#1e3a5f',
        success: (r) => { if (r.confirm) doFill(); },
      });
    } else {
      doFill();
    }
  },

  // ===== 配平校验（A.11.4 · 只做软提示）=====
  onRecYuan(e) { this.setData({ twRecYuan: e.detail.value }); this.runReconcile(); },

  runReconcile() {
    const rows = this.data.takeoutDetailRows || [];
    // 外卖收入合计：分项 = Σ 小计；快速 = Σ 各平台行金额（回读 groups）
    let incomeTotal = rows.reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
    const g = this.data.incomeGroups.find((x) => x.category === 'takeaway');
    if (g && this.data.takeoutMode === 'fast') {
      incomeTotal = (g.rows || []).reduce((s, r) => s + (Number(r.amountYuan) || 0), 0);
    }
    // 费用侧读数（营销项按展示名找；⚠️ 项名**只**取自 terms 单源 reconcileRoles，页面不写死）
    const mk = (this.data.expenseGroups || []).find((x) => x.category === 'marketing');
    const roles = (TERMS.ledger.takeawayMode && TERMS.ledger.takeawayMode.reconcileRoles) || {};
    const mrow = (name) => { if (!name) return 0; const r = (mk && mk.rows || []).find((x) => x.subItem === name); return r ? (Number(r.amountYuan) || 0) : 0; };
    const subsidy = rows.reduce((s, r) => s + (Number(r.subsidy) || 0), 0);
    const packTotal = rows.reduce((s, r) => s + (Number(r.pack) || 0), 0);
    const rec = reconcile({
      incomeTotal,
      subsidy,
      commission: mrow(roles.commission),
      deliveryFee: mrow(roles.deliveryFee),
      deliverySubsidy: mrow(roles.deliverySubsidy),
      actualReceivable: Number(this.data.twRecYuan) || 0,
      packTotal,
    });
    if (!rec) { this.setData({ twRecText: '' }); return; }
    const t = TERMS.ledger.takeawayMode;
    let text;
    if (rec.status === 'pass') text = t.recPass;
    else if (rec.status === 'packaging') text = t.recPack;
    else if (rec.status === 'delivery') text = t.recDeliv;
    else text = t.recMiss.replace('{diff}', String(Math.abs(rec.diff)));
    this.setData({ twRecText: text });
  },

  // ===== 自动带出（A.11.3 sort 30：外卖活动补贴 = 收入侧补贴合计；手改后不覆盖）=====
  // ⚠️ 语义：仅当费用侧该行**为空**时带出；已有值且与合计不同 = 用户手改过 → 加锁不再覆盖
  //   （回读加载时若两边恰好一致也保持幂等不重写）。
  syncSubsidyCarry() {
    if (this.data.takeoutMode !== 'detail') return;   // 仅分项模式带出
    const rows = this.data.takeoutDetailRows || [];
    const total = subsidyTotal(rows);
    const groups = this.data.expenseGroups.slice();
    const mk = groups.findIndex((x) => x.category === 'marketing');
    if (mk < 0) return;
    const g = Object.assign({}, groups[mk]);
    const ri = g.rows.findIndex((r) => r.subItem === '外卖活动补贴');
    if (ri < 0) return;
    const cur = (g.rows[ri] && g.rows[ri].amountYuan) || '';
    const target = total ? total.toFixed(2) : '';
    if (g.rows[ri].twCarryLock) return;              // 仅「本会话手改过费用侧」→ 不覆盖
    // 🔴 R85 修复：**不得**把「回读旧值 ≠ 当前合计」判为用户手改 —— 那是**用户改了收入侧**的
    //    正常信号，判错会锁死旧值 ⇒ 费用侧不跟随、配平与利润都错（跨月二次录入必踩）。
    if (!cur && !target) return;                     // 两边都空，无事可做
    if (cur === target) return;                      // 已一致 → 幂等不重写（省一次 setData）
    const nr = Object.assign({}, g.rows[ri], { amountYuan: target, twCarryLock: false });
    const rows2 = g.rows.slice();
    rows2[ri] = nr;
    g.rows = rows2;
    groups[mk] = g;
    this.setData({ expenseGroups: groups });
  },

  // T3′（round97）：快速模式的轻量自查 —— 零依赖判据（**不读分项快照、不看补贴**）。
  //   判据：外卖收入合计 > 0 且营销段三个角色（佣金 / 配送服务费 / 配送补贴）全空
  //   ⇒ 提示「账单这两项记得记上」（直击「不要填少」这个诉求）。
  //   ⚠️ 角色名只取自 terms 单源 reconcileRoles（页面零硬编码）；幂等：值未变则不 setData。
  syncTakeoutSelfCheck() {
    const tw = TERMS.ledger.takeawayMode || {};
    const roles = tw.reconcileRoles || {};
    const mk = (this.data.expenseGroups || []).find((x) => x.category === 'marketing');
    const filled = (name) => {
      if (!name) return false;
      const r = ((mk && mk.rows) || []).find((x) => x.subItem === name);
      return !!r && String(r.amountYuan || '').trim() !== '';
    };
    const anyRole = filled(roles.commission) || filled(roles.deliveryFee) || filled(roles.deliverySubsidy);
    const income = Number(this.data.takeoutSumYuan) || 0;
    const next = (income > 0 && !anyRole) ? (tw.selfCheckMiss || '') : '';
    if ((this.data.twSelfCheck || '') === next) return;   // 幂等
    this.setData({ twSelfCheck: next });
  },

  // （营销「外卖活动补贴」手改加锁逻辑已并入 updateRow：expense+marketing+该行 → twCarryLock=true）
  // ===== T1（round97）· 营销段「分平台佣金小计」（只回显、不入库）=====
  // ⚠️ 语义：客户按各平台账单逐行填佣金 ⇒ 合计**自动汇成**营销段佣金总额那一行（该行随即转只读，
  //   避免「分平台」与「手填总额」两个来源打架）；**一行都不填则完全不碰那一行**（第一红线）。
  // ⚠️ 只回显不入库：本区状态不进 buildItems / saveLedger，只进本地草稿。
  // ⚠️ 平台名单源 = 收入侧外卖 items；佣金项名单源 = terms.reconcileRoles.commission ⇒ 页面零硬编码。
  buildMkByPlat(prev) {
    const map = {};
    (prev || []).forEach((p) => { if (p && p.platform) map[p.platform] = p.amountYuan || ''; });
    return this.takeoutPlatforms().map((p) => ({ platform: p, amountYuan: map[p] !== undefined ? map[p] : '' }));
  },
  onMkByPlat(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const list = (this.data.twMkByPlat || []).slice();
    if (!list[idx]) return;
    list[idx] = Object.assign({}, list[idx], { amountYuan: e.detail.value });
    this.setData({ twMkByPlat: list });
    this.syncMkByPlat();
  },
  clearMkByPlat() {
    this.setData({
      twMkByPlat: (this.data.twMkByPlat || []).map((p) => ({ platform: p.platform, amountYuan: '' })),
    });
    this.syncMkByPlat();
  },
  syncMkByPlat() {
    const list = this.data.twMkByPlat || [];
    const active = mkByPlatFilled(list);
    const total = mkByPlatTotal(list);
    const name = ((TERMS.ledger.takeawayMode && TERMS.ledger.takeawayMode.reconcileRoles) || {}).commission || '';
    const mk = (this.data.expenseGroups || []).findIndex((x) => x.category === 'marketing');
    const patch = { twMkByPlatActive: active, twMkByPlatSum: total ? total.toFixed(2) : '0.00' };
    if (!active || mk < 0 || !name) {   // 全空 / 无营销组 / 无项名单源 ⇒ 一律不碰那一行
      patch.twMkRowGi = -1;
      patch.twMkRowRi = -1;
      this.setData(patch);
      this.syncTakeoutSelfCheck();
      return;
    }
    const groups = this.data.expenseGroups.slice();
    const g = Object.assign({}, groups[mk]);
    const rows = (g.rows || []).slice();
    const ri = rows.findIndex((r) => r.subItem === name);
    const target = total.toFixed(2);
    const cur = ri < 0 ? '' : String(rows[ri].amountYuan === undefined || rows[ri].amountYuan === null ? '' : rows[ri].amountYuan);
    if (ri >= 0 && cur === target) {    // 已一致 ⇒ 幂等，不重铺、不 setData 业务面
      patch.twMkRowGi = mk;
      patch.twMkRowRi = ri;
      this.setData(patch);
      this.syncTakeoutSelfCheck();
      return;
    }
    if (ri < 0) rows.push({ subItem: name, amountYuan: target });
    else rows[ri] = Object.assign({}, rows[ri], { amountYuan: target });
    g.rows = this.decorateRows(g, rows);   // 走同一装配口：名字命中预设清单 ⇒ fixed、无删除键
    g.showRows = g.expanded ? g.rows : g.rows.slice(0, 1);
    groups[mk] = g;
    patch.expenseGroups = groups;
    patch.twMkRowGi = mk;
    patch.twMkRowRi = g.rows.findIndex((r) => r.subItem === name);
    this.setData(patch);
    this.syncTakeoutSelfCheck();
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
    // round107：本卡片只剩「食材消耗」一项（库存口径）。「一次性投入」的处置方式**不在店铺级开关里**，
    //   而是逐笔登记在台账行上（见「一次性投入」页）⇒ 此处不再有 amortize 分支。
    const val = String(e.currentTarget.dataset.val) === '1';   // dataset 一律字符串
    const key = 'inventoryOn';
    if (this.data[key] === val) return;                        // 已选中，不重复写库

    if (!this.data.shopBaseLoaded) await this.loadShopBase();
    const prev = this.data[key];
    this.setData({ [key]: val });                              // 乐观更新
    try {
      await api.call('saveShopSetting', {
        name: this.data.shopName,
        remark: this.data.shopRemark,
        switches: { inventory: val },
        client_request_id: 'cm_' + Date.now(),
      });
      wx.showToast({ title: TERMS.calcMethod.switchSaved, icon: 'success' });
      this.refreshCalcSummaries();   // 口径变了 ⇒ 摘要跟着变
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

  // round107：「一次性投入」两行摘要（纯提示位，失败不打断填表）
  //   ① 本月一次算清：笔数 + 金额（台账里 mode='lump' 且 start_month = 本月）
  //   ② 本月分月摊：项数 + 本月合计（摊销引擎对 mode='amort' 行的当月计提）
  //   ⚠️ 数据全来自 getAmortSchedule，前端只拼文案 —— 不在前端算钱（口径单源在服务端）。
  async loadAssetCount() {
    try {
      const d = await api.call('getAmortSchedule', { month: this.data.month });
      const lumps = d.lumps || [];
      const assets = d.assets || [];
      const lumpSum = lumps.reduce((s, x) => s + (x.amount_fen || 0), 0);
      this.setData({
        assetSummaryLump: lumps.length > 0
          ? TERMS.calcMethod.assetLumpSum(lumps.length, api.fenToYuan(lumpSum, 2)) : '',
        assetSummaryAmort: assets.length > 0
          ? TERMS.calcMethod.assetAmortSum(assets.length, api.fenToYuan(d.total_amount_fen || 0, 2)) : '',
      });
    } catch (e) {
      this.setData({ assetSummaryLump: '', assetSummaryAmort: '' });
    }
  },

  // round104：库存摘要的唯一算法 —— load() 与 refreshCalcSummaries() 共用，避免两处各写一份
  invSummaryOf(d) {
    const inv = (d && d.inventory) || {};
    return (inv.opening_fen || inv.purchase_fen || inv.closing_fen)
      ? TERMS.calcMethod.consumeInvSummary(
          api.fenToYuan(inv.opening_fen || 0, 2),
          api.fenToYuan(inv.purchase_fen || 0, 2),
          api.fenToYuan(inv.closing_fen || 0, 2))
      : '';
  },

  // round104：只刷新「库存摘要 / 摊销笔数」—— 这两项在子页（inventory / amortize）里改。
  //   **不重建 groups**：重建会用后端值覆盖本页还没保存的草稿（与 onShow 的草稿回填打架）。
  async refreshCalcSummaries() {
    try {
      const d = await api.call('getLedger', { month: this.data.month });
      const sw = d.switches || {};
      this.setData({
        inventoryOn: !!sw.inventorySwitchOn,
        invSummary: this.invSummaryOf(d),
      });
      this.loadAssetCount();   // round107：两行摘要无条件拉（内部已静默兜底）
    } catch (e) { /* 摘要刷新失败不打扰：本页主流程不受影响 */ }
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
    return groups.map((g) => {
      // R85：外卖组 —— 分项模式按平台小计提交（3 明细只参与当场小计，不落库）
      if (g.category === 'takeaway' && this.data.takeoutMode === 'detail') {
        const rows = this.data.takeoutDetailRows || [];
        return {
          category: g.category,
          name: g.label,
          sub_items: rows
            .filter((r) => String(r.subtotal === undefined || r.subtotal === null ? '' : r.subtotal).trim() !== '')
            .map((r) => ({ sub_item: (r.platform || '').trim(), amount_fen: api.yuanToFen(r.subtotal) })),
        };
      }
      return {
        category: g.category,
        name: g.label,
        // ⚠️ 堂食预设渠道是「全集常驻」，多数行是空的 ⇒ 只提交**填了金额**的行，
        //    否则每保存一次就往后端塞一堆空 sub_item（G10i 守）。
        //    注意：快速模式单行（无名、有金额）必须保留 ⇒ 判据看金额，不看名字。
        sub_items: g.rows
          .filter((r) => String(r.amountYuan === undefined || r.amountYuan === null ? '' : r.amountYuan).trim() !== '')
          .map((r) => ({ sub_item: (r.subItem || '').trim(), amount_fen: api.yuanToFen(r.amountYuan) })),
      };
    });
  },

  async save(archiveOverride) {
    try {
      ui.setTitle(TERMS.buttons.save);
      await api.call('saveLedger', {
        month: this.data.month,
        income_items: this.buildItems(this.data.incomeGroups),
        expense_items: this.buildItems(this.data.expenseGroups),
        direct_consume_fen: api.yuanToFen(this.data.directConsumeYuan),
        // round107：`lump_sum_fen` **入参已退休** —— 一次性投入改为服务端从台账（shop_amortize 里
        //   mode='lump' 的行）求和，前端不再传标量。少一个可变真相源 ⇒ 也就少一处静默清零的机会。
        // round103：库存不在这里提交（见上）；saveLedger 缺省即可保留库内现值。
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