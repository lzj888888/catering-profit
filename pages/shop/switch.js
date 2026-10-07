// pages/shop/switch.js —— 批次 7 · 店铺切换页
//
// ⚠️ 店铺切换器（§2.3/§2.7）：
//   · 列表仅含 is_deleted=false（getShopList 后端过滤）；
//   · 选中 shop_id 持久化本地缓存，下次进入默认打开上次店铺；
//   · **切换永不触发付费弹窗**；仅「新增店铺保存」超限时（getShopList.hit_free_limit）由保存动作触发。
// ⚠️ 多店铺数据隔离：切换即写 app.globalData.shop_id（api.js 自动带新 shop_id），所有查询强制带。
//
// 🔴 R194（2026-10-03）店铺管理三件事补齐 —— 此前三个动作**全都不成立**：
//   ① 「新增店铺」跳到 `shop/setting`，而设置页走 `saveShopSetting`（只更新**当前**店）
//      ⇒ 用户以为在建店，实际在给当前店改名；
//   ② 重命名只能改当前店，且要先进设置页（列表里没入口）；
//   ③ 删除店铺**全站不存在**（`cloudfunctions/` 无任何删除路径）⇒ 免费档只给 1 家店，
//      误建第 2 家就永久占额度，连新建都做不了。
//   ⇒ 现在三个动作都走 `manageShop`（op = create / rename / delete），在列表内**就地**完成（不跳页）。
//   ⚠️ 目标店字段必须叫 `target_shop_id`：api.js 会无条件注入**当前店**的 shop_id。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const sw = require('../../utils/shopSwitcher.js');
const { openPaywall } = require('../../utils/paywall.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();

const NAME_MAX = 20;

Page({
  data: {
    t: {
      title: TERMS.exp.switchTitle,
      currentShop: TERMS.exp.currentShop,
      noShop: TERMS.exp.noShop,
      addShop: TERMS.exp.addShop,
      switchHint: TERMS.exp.switchHint,
      moreHint: TERMS.exp.shopManageHint,
      noShopHint: TERMS.exp.noShopHint,
      renameShop: TERMS.exp.renameShop,
      renameShort: TERMS.exp.renameShort,
      deleteShop: TERMS.exp.deleteShop,
      deleteShort: TERMS.exp.deleteShort,
      deleteAsk: TERMS.exp.deleteAsk,
      resetShort: TERMS.exp.resetShort,
      resetShop: TERMS.exp.resetShop,
      resetOk: TERMS.exp.resetOk,
      resetAsk: TERMS.exp.resetAsk,
      resetDone: TERMS.exp.resetDone,
      resetNoData: TERMS.exp.resetNoData,
      checkingImpact: TERMS.exp.checkingImpact,
      namePh: TERMS.settings.shopNamePh,
      createOk: TERMS.exp.createOk,
      save: TERMS.buttons.save,
      cancel: TERMS.buttons.cancel,
      deleteLastHint: TERMS.exp.deleteLastHint,
      noShopHint: TERMS.exp.noShopHint,
      loading: TERMS.ui.loading,
      // ── R234/J4e 行内长提示折叠（本页 1 处）──
      // 🔴 三处登记的第二处：漏映射 ⇒ 页面渲染成**空白**且零报错（R124 同族）
      // ⚠️ 引导语在 `TERMS.ledger` 组（跨页复用的通用模式引导语）。
      hintFoldShow: TERMS.ledger.hintFoldShow,
      hintFoldHide: TERMS.ledger.hintFoldHide,
    },
    // R234/J4e：行内长提示折叠（本页 1 处，默认收起）。仓内统一实现。
    hintFold: {},
    list: [],
    currentShopId: '',
    used: 0,
    freeLimit: 1,
    hitFreeLimit: false,
    // 达上限时按钮改文案（点它仍弹付费墙，但用户先看懂为什么）
    addShopLabel: TERMS.exp.addShop,
    // R194：就地编辑态（'create' 新建 / 'rename' 重命名；空串 = 都没在编辑）
    mode: '',
    editingId: '',
    editName: '',
    nameMax: NAME_MAX,
    busy: false,
    loading: true,
  },

  // R234/J4e：行内提示折叠开关（仓内统一形态 —— 多页同一实现，不各写一套）。
  onToggleHintFold(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '';
    if (!key) return;                       // 无 key ⇒ 静默返回（不误翻别人的状态）
    const cur = this.data.hintFold || {};
    const next = Object.assign({}, cur);
    next[key] = !cur[key];
    this.setData({ hintFold: next });
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.exp.switchTitle);
      const d = await sw.fetchShopList();
      const currentShopId = app.globalData.shop_id || '';
      // 持久化恢复：上次店铺存在 → 切回（若当前为空）
      if (!currentShopId && d.list.length > 0) {
        const restored = await sw.restoreLastShop(d.list);
        if (!restored) sw.switchShop(d.list[0].shop_id);
      }
      this.setData({
        list: d.list,
        currentShopId: app.globalData.shop_id || '',
        used: d.used,
        freeLimit: d.free_limit,
        hitFreeLimit: d.hit_free_limit,
        addShopLabel: d.hit_free_limit ? TERMS.exp.addShopLimited : TERMS.exp.addShop,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onSelect(e) {
    const shopId = e.currentTarget.dataset.id;
    if (!shopId || shopId === this.data.currentShopId) return;
    // ⚠️ 切换永不触发付费弹窗（交互边界）
    sw.switchShop(shopId);
    this.setData({ currentShopId: shopId });
    wx.showToast({ title: TERMS.exp.switchTitle, icon: 'success' });
    setTimeout(() => wx.navigateBack(), 400);
  },

  // ===== R208：每行右侧两个**显式按钮**（改名 / 删除）=====
  //   旧实现把这两个动作塞进行尾「⋯」的 actionSheet ⇒ **李老师（产品主人）都没找到删除**，
  //   还以为「店铺只能改名」。低频 ≠ 可藏（R192 红线：藏起来的功能等于没有），
  //   故直接摊到行内；店铺列表本身很短（免费 1 家 / 付费也就几家），摊开并不吵。
  onRenameTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const item = (this.data.list || []).filter((x) => x.shop_id === id)[0] || {};
    this.onRenameOpen(id, item.name || '');
  },

  onDeleteTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const item = (this.data.list || []).filter((x) => x.shop_id === id)[0] || {};
    this.askDelete(id, item.name || '');
  },

  // ===== R210：清空这家店的月度账（店铺 / 菜品成本卡 / 原料档案**全保留**）=====
  //   只有一家店的老板点「删除」，九成要的是「把账重做一遍」，而不是「店消失」。
  //   ⇒ 给一条破坏力小得多的出口；三个动作同行平铺（改名 / 清空 / 删除），**都不藏进二级菜单**。
  onResetTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const item = (this.data.list || []).filter((x) => x.shop_id === id)[0] || {};
    this.askReset(id, item.name || '');
  },

  // 🔴 后果量级必须**真去查**（op=stats），不能拿「数据将永久丢失」这类万能恐吓句糊弄。
  //   查不到（-1）⇒ **不许往下走**（fail-closed）：宁可不给这个口子，也不让用户盲确认。
  async fetchImpact(id) {
    wx.showLoading({ title: this.data.t.checkingImpact, mask: true });
    try {
      const d = await api.call('manageShop', {
        op: 'stats', target_shop_id: id, client_request_id: 'ss_' + Date.now(),
      });
      return (d && Number(d.months)) || 0;
    } catch (e) {
      api.toastError(e);
      return -1;
    } finally {
      wx.hideLoading();
    }
  },

  async askReset(id, name) {
    if (this.data.busy) return;
    const months = await this.fetchImpact(id);
    if (months < 0) return;
    if (months === 0) { wx.showToast({ title: this.data.t.resetNoData, icon: 'none' }); return; }
    wx.showModal({
      title: this.data.t.resetShop + ' · ' + name,
      content: this.data.t.resetAsk(months),
      cancelText: TERMS.buttons.thinkAgain,
      confirmText: TERMS.exp.resetOk,
      confirmColor: '#e74c3c',
      success: (r) => { if (r.confirm) this.doReset(id); },
    });
  },

  async doReset(id) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const d = await api.call('manageShop', {
        op: 'reset', target_shop_id: id, client_request_id: 'srz_' + Date.now(),
      });
      wx.showToast({ title: this.data.t.resetDone((d && Number(d.months)) || 0), icon: 'success' });
      await this.load();
    } catch (e) { api.toastError(e); }
    this.setData({ busy: false });
  },

  onRenameOpen(id, name) {
    this.setData({ mode: 'rename', editingId: id, editName: name || '' });
  },

  onEditName(e) { this.setData({ editName: e.detail.value }); },

  onEditCancel() { this.setData({ mode: '', editingId: '', editName: '' }); },

  async onRenameSave() {
    const name = (this.data.editName || '').trim();
    if (!name) { wx.showToast({ title: TERMS.exp.nameRequired, icon: 'none' }); return; }
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.call('manageShop', {
        op: 'rename', name,
        target_shop_id: this.data.editingId,
        client_request_id: 'sr_' + Date.now(),
      });
      wx.showToast({ title: TERMS.exp.renamed, icon: 'success' });
      this.setData({ mode: '', editingId: '', editName: '' });
      await this.load();
    } catch (e) { api.toastError(e); }
    this.setData({ busy: false });
  },

  async askDelete(id, name) {
    if (this.data.busy) return;
    // 🔴 R210：先报**后果量级**再让用户拍板 —— 真查到几个月就写几个月；
    //   清点失败（-1）直接不开这个窗（不拿「数据可能丢失」这种万能恐吓句糊弄过去）。
    const months = await this.fetchImpact(id);
    if (months < 0) return;
    // 🔴 R208：**不再禁止删除最后一家**。旧实现在这里直接 return 一个「至少要保留一家」弹窗，
    //   与 `exp.deleteConfirm` 承诺的「不再占用店铺额度」自相矛盾 —— 免费档（限 1 家）
    //   永远删不掉 ⇒ 额度永远腾不出来，想换店只能付费。改为**分级告知后果**：
    //      · 删完还剩店 ⇒ 常规确认；
    //      · 删的是最后一家 ⇒ 明说列表会清空、额度会释放、还能再建 1 家。
    const willBeEmpty = (this.data.list || []).length <= 1;
    wx.showModal({
      title: TERMS.exp.deleteShop + ' · ' + name,
      content: this.data.t.deleteAsk(months) + (willBeEmpty ? '\n' + this.data.t.deleteLastHint : ''),
      cancelText: TERMS.buttons.thinkAgain,
      // ⚠️ showModal 按钮文案 ≤4 字（超了整窗 fail 且静默）。
      // 🔴 本行**不得写行内注释**：`tools/check_modal_button_len.js` 的解析器按整行取值，
      //    行内注释会被并进键路径 ⇒ 判「键不存在」（本轮实测踩到，白红一轮）。
      confirmText: TERMS.exp.deleteOk,
      confirmColor: '#e74c3c',           // 危险操作：红色确认键
      success: (r) => { if (r.confirm) this.doDelete(id); },
    });
  },

  async doDelete(id) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.call('manageShop', {
        op: 'delete', target_shop_id: id, client_request_id: 'sd_' + Date.now(),
      });
      wx.showToast({ title: TERMS.exp.deleted, icon: 'success' });
      // 🔴 删掉的正是**当前店** ⇒ 必须立刻改指向：
      //   否则后续所有请求继续带已软删的 shop_id（服务端一律 RESOURCE_NOT_FOUND，页面集体报错）。
      if (id === (this.data.currentShopId || app.globalData.shop_id)) {
        const rest = (this.data.list || []).filter((x) => x.shop_id !== id);
        // ⚠️ R208：删到一家不剩时 rest 为空 ⇒ 必须切到**空串**显式清空（旧实现此分支什么都不做，
        //   留着失效 id），由 mode='create' 引导用户马上建店回填额度。
        sw.switchShop(rest.length ? rest[0].shop_id : '');
      }
      this.setData({ mode: '', editingId: '', editName: '' });
      await this.load();
      // 🔴 删空后的**强引导**：既然列表已经空了，就地展开新建输入 ——
      //   一是避免用户停在「零店铺」状态不知所措，二是**抢在 getShopContext 之前**让用户建好店
      //   （此刻 used=0，免费额度还剩 1 家 ⇒ 新建不会被付费墙拦）。
      if ((this.data.list || []).length === 0) {
        this.setData({ mode: 'create', editingId: '', editName: '' });
      }
    } catch (e) { api.toastError(e); }
    this.setData({ busy: false });
  },

  // 新增店铺（保存动作才可能触发付费墙；本页切换列表不弹）
  onAdd() {
    // 若已达免费上限（1 家），新增即保存超限 → 触发付费墙；否则就地展开新建输入
    if (this.data.hitFreeLimit) {
      openPaywall('saveLimit', { shopId: this.data.currentShopId || '' });
      return;
    }
    this.setData({ mode: 'create', editingId: '', editName: '' });
  },

  async onCreate() {
    const name = (this.data.editName || '').trim();
    if (!name) { wx.showToast({ title: TERMS.exp.nameRequired, icon: 'none' }); return; }
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const d = await api.call('manageShop', {
        op: 'create', name, client_request_id: 'sc_' + Date.now(),
      });
      // 建完直接切到新店（用户意图就是"去这家新店"；否则建完还停在老店，会以为没建成）
      if (d && d.shop_id) sw.switchShop(d.shop_id);
      wx.showToast({ title: TERMS.exp.created, icon: 'success' });
      this.setData({ mode: '', editingId: '', editName: '' });
      await this.load();
    } catch (e) { api.toastError(e); }
    this.setData({ busy: false });
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
