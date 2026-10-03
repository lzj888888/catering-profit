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
      moreHint: TERMS.exp.moreHint,
      renameShop: TERMS.exp.renameShop,
      namePh: TERMS.settings.shopNamePh,
      createOk: TERMS.exp.createOk,
      save: TERMS.buttons.save,
      cancel: TERMS.buttons.cancel,
      loading: TERMS.ui.loading,
    },
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

  // ===== R194：每行的「⋯」= 重命名 / 删除店铺（低频 + 破坏性 ⇒ 收纳，R192 分级口径）=====
  onMore(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const item = (this.data.list || []).filter((x) => x.shop_id === id)[0] || {};
    wx.showActionSheet({
      // ⚠️ 删除项**总是**出现：不藏功能（R192 红线「藏起来的功能等于没有」）。
      //    最后一家店点删除时，给**明确原因**而不是静默少一项。
      itemList: [TERMS.exp.renameShop, TERMS.exp.deleteShop],
      success: (r) => {
        if (r.tapIndex === 0) this.onRenameOpen(id, item.name || '');
        else if (r.tapIndex === 1) this.onDeleteAsk(id, item.name || '');
      },
      fail: () => { /* 用户取消：不做任何事 */ },
    });
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

  onDeleteAsk(id, name) {
    // 边界：最后一家不给删（与后端 decideDelete 同判据；前端先说清原因，不靠报错）
    if ((this.data.list || []).length < 2) {
      wx.showModal({
        title: TERMS.exp.deleteShop,
        content: TERMS.exp.lastOneWarn,
        showCancel: false,
        // 🔴 R194 走查修正：这里**不能**复用 exp.createOk（「创建」）——本弹窗不创建任何东西，
        //    点它只关窗；按钮却写「创建」= 明确误导（桌面截屏实测抓到，见
        //    review/evidence/r194_shots/05_desktop_lastOne.png）。
        //    无动作信息弹窗的唯一按钮一律用 buttons.gotIt（「知道了」，R45 既有口径，3 字 ≤4 ✓）。
        confirmText: TERMS.buttons.gotIt,
        confirmColor: '#1e3a5f',
      });
      return;
    }
    wx.showModal({
      title: TERMS.exp.deleteShop + ' · ' + name,
      content: TERMS.exp.deleteConfirm,
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
      // 🔴 删掉的正是**当前店** ⇒ 必须先把当前店切到剩下任意一家：
      //   否则后续所有请求继续带已软删的 shop_id（服务端一律 RESOURCE_NOT_FOUND，页面集体报错）。
      if (id === this.data.currentShopId) {
        const rest = (this.data.list || []).filter((x) => x.shop_id !== id);
        if (rest.length) sw.switchShop(rest[0].shop_id);
      }
      this.setData({ mode: '', editingId: '', editName: '' });
      await this.load();
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
