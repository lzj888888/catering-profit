// pages/material/index.js —— 批次 P0（M3 v1.2）· 原料档案列表页
//
// 读：api.call('getMaterial', {}) 列表；写（删）：api.call('saveMaterial', { material:{ id, _delete:true } })。
// ⚠️ 虚拟原料（is_virtual=true）只读：不可手动编辑、不可手动删除（仅由半成品卡级联产生/删除）。
// ⚠️ 搜索 = 名称 or 别名（aliases 为 JSON 数组字符串，仅检索，绝不替换原料名）；分类按 category 过滤。
// ⚠️ 删除 = 软删除；被成本卡引用时提示但允许删（快照不受影响）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const units = require('../../utils/units.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

// category 枚举 → 展示名（单源映射：值域 meat/veg/dry/season/pack/other）
const CATEGORY_LABELS = {
  meat: TERMS.card.catMeat,
  veg: TERMS.card.catVeg,
  dry: TERMS.card.catDry,
  season: TERMS.card.catSeason,
  pack: TERMS.card.catPack,
  other: TERMS.card.catOther,
};

// 安全 parse aliases（JSON 数组字符串 → 字符串数组；容错返回 []）
function parseAliases(s) {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

Page({
  data: {
    t: {
      title: TERMS.card.materialListTitle,
      matName: TERMS.card.matName,
      matBrand: TERMS.card.matBrand,
      matUnit: TERMS.card.matUnit,
      matPrice: TERMS.card.matPrice,
      matNetCost: TERMS.card.matNetCost,
      matConvert: TERMS.card.matConvert,
      matUnitDefault: TERMS.card.matUnitDefault,
      matCategory: TERMS.card.matCategory,
      matSearchPh: TERMS.card.matSearchPh,
      matAdd: TERMS.card.matAdd,
      matEdit: TERMS.card.matEdit,
      matEmpty: TERMS.card.matEmpty,
      matDelete: TERMS.card.matDelete,
      matDeleteConfirm: TERMS.card.matDeleteConfirm,
      matVirtual: TERMS.card.matVirtual,
      filterCategory: TERMS.card.filterCategory,
      marginAll: TERMS.card.marginAll,
      cur: '¥',
      loading: TERMS.ui.loading,
      cancel: TERMS.buttons.cancel,
      // round156：列表排序/置顶
      pinOn: TERMS.card.pinOn,
      pinOff: TERMS.card.pinOff,
      pinTag: TERMS.card.pinTag,
      // M3.19（批次 E）影响面入口
      impactTitle: TERMS.card.impactTitle,
    },
    all: [],           // 全量列表（前端过滤）
    list: [],          // 过滤后展示
    // round156：置顶的原料 id（顺序 = 老板点选先后）。店铺级偏好，存 shop 文档 ⇒ 零新建集合。
    pinned: [],
    keyword: '',
    catFilter: '',     // '' = 全部
    catLabel: '',      // 当前选中分类展示名
    catOptions: [],    // [{ value, label }]
    loading: true,
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.materialListTitle);
      const d = await api.call('getMaterial', {});
      // round156：置顶（店铺级偏好）—— 读失败**不阻断列表**：它只是排序偏好，不是数据。
      let pinned = [];
      try {
        const sc = await api.call('getShopContext', {});
        pinned = Array.isArray(sc.pinned_materials) ? sc.pinned_materials : [];
      } catch (err) { pinned = []; }
      const all = (d.list || []).map((m) => ({
        id: m.id,
        // round156：排序键（「最近编辑在前」）。存量原料没有 updated_at ⇒ 0（排最后）
        updated_at: Number(m.updated_at) || 0,
        name: m.name || '',
        brand_spec: m.brand_spec || '',
        purchase_unit: m.purchase_unit || '',
        purchase_price: m.purchase_price_fen > 0 ? api.fenToYuan(m.purchase_price_fen, 2) : '—',
        // round149：把「买→用」的换算关系摆出来（同一原料可以有不同规格/单位，
        //   列表里一眼看清"这价是按什么单位报的"，而不是只看到一个裸数字）
        convert_factor: m.convert_factor || 0,
        yield_rate: m.yield_rate || 0,
        // round151：基准单位词随计量族走（重量→克 / 体积→毫升 / 计数→个）—— 由 units.baseWordOf 单源给出。
        //   改前写死「克」⇒ 按「箱/个」采购的原料会显示成「1 箱 = 24 克」，纯误导。
        spec_line: '1 ' + (m.purchase_unit || TERMS.card.matUnitDefault) + ' = ' + (m.convert_factor || 0) + ' ' + units.baseWordOf(m.purchase_unit || TERMS.card.matUnitDefault)
          + (m.yield_rate ? ' · ' + TERMS.card.matYield.replace(/（%）$/, '') + ' ' + m.yield_rate + '%' : ''),
        net_cost: m.net_unit_cost > 0 ? (m.net_unit_cost / 10000).toFixed(4) : '0.0000',
        is_virtual: !!m.is_virtual,
        category: m.category || 'other',
        category_label: CATEGORY_LABELS[m.category] || CATEGORY_LABELS.other,
        aliases: parseAliases(m.aliases),
      }));
      // 分类选项：仅从实际数据中出现的 category 去重（前端过滤即可，不新增集合/索引）
      const seen = new Set();
      const catOptions = [{ value: '', label: TERMS.card.marginAll }];
      for (const m of all) {
        if (m.category && !seen.has(m.category)) { seen.add(m.category); catOptions.push({ value: m.category, label: m.category_label }); }
      }
      this.setData({ all, catOptions, pinned, loading: false });
      this.applyFilter();
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onKeyword(e) { this.setData({ keyword: e.detail.value }); this.applyFilter(); },
  onCatFilter(e) {
    const opt = this.data.catOptions[Number(e.detail.value)];
    this.setData({ catFilter: opt ? opt.value : '', catLabel: opt ? opt.label : '' });
    this.applyFilter();
  },

  // 名称 or 别名 合并检索 + 分类过滤（纯前端，原料量级小）
  applyFilter() {
    const kw = this.data.keyword.trim().toLowerCase();
    const cat = this.data.catFilter;
    const list = this.data.all.filter((m) => {
      if (cat && m.category !== cat) return false;
      if (!kw) return true;
      if (m.name.toLowerCase().includes(kw)) return true;
      return m.aliases.some((a) => a.toLowerCase().includes(kw));
    });
    // round156：过滤完再排序（置顶在前 + 最近编辑在前），并给每条打 `pinned` 标记
    //   ⚠️ 标记必须在这里打：WXML 表达式**不支持方法调用**（写 `pinned.indexOf(...)` 是无效的）。
    const pins = this.data.pinned || [];
    const marked = list.map((m) => Object.assign({}, m, { pinned: pins.indexOf(m.id) >= 0 }));
    this.setData({ list: this.sortList(marked) });
  },

  // round156：列表排序 —— ① 置顶的在前（顺序 = 老板点选先后）② 其余「最近编辑在前」。
  //   ⚠️ 为什么在**前端**排、不做服务端 orderBy：本页本就持有**全量**列表做搜索/筛选（`all`），
  //     排序只是把已到手的数据再排一次 —— 不新增查询、不改 DataAdapter、不动 42 份派生副本。
  sortList(list) {
    const pins = this.data.pinned || [];
    const rank = (m) => {
      const i = pins.indexOf(m.id);
      return i < 0 ? pins.length + 1 : i;
    };
    return list.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0);
    });
  },

  // round156：置顶 / 取消置顶（店铺级偏好，复用 saveShopSetting ⇒ 零新建集合、零新云函数）。
  //   为什么不存在原料记录上：置顶是**这家店的偏好**，跟着店铺走才在换手机后还在；
  //   写进原料记录则要把「偏好」混进「档案」，且删档就丢置顶。
  //   乐观更新：点击立刻有反馈；**失败必须回滚** —— 界面不能停在"看起来成功"的状态。
  async onPin(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const backup = (this.data.pinned || []).slice();
    const pins = backup.slice();
    const i = pins.indexOf(id);
    const wasPinned = i >= 0;
    if (wasPinned) pins.splice(i, 1);
    else pins.unshift(id);        // 新置顶的排最前（刚点的就是最想要的）
    this.setData({ pinned: pins });
    this.applyFilter();
    try {
      await api.call('saveShopSetting', { pinned_materials: pins, client_request_id: 'pm_' + Date.now() });
      wx.showToast({ title: wasPinned ? TERMS.card.unpinnedDone : TERMS.card.pinnedDone, icon: 'none' });
    } catch (err) {
      this.setData({ pinned: backup });
      this.applyFilter();
      api.toastError(err);
    }
  },

  goAdd() { wx.navigateTo({ url: '/pages/material/edit?id=' }); },

  // ===== R191：操作收纳（与成本卡列表**同构**）=====
  // 4 个平铺按钮 → 1 个「⋯」。🔴 同成本卡那条理由：按钮尺寸不能缩（88rpx 触控红线），只能减数量。
  // 🔴 虚拟原料**只给「置顶」**：编辑 / 删除 / 影响面本就不可做（只读），列出来点了会报错。
  onMore(e) {
    const m = e.currentTarget.dataset.m;
    if (!m) return;
    const T = TERMS.card;
    // onPin 读 dataset.id、其余读 dataset.m ⇒ 这里一次把两个都带上，避免各函数签名分叉
    const ev = { currentTarget: { dataset: { id: m.id, m } } };
    const pinLabel = m.pinned ? T.pinOff : T.pinOn;
    if (m.is_virtual) {
      wx.showActionSheet({
        itemList: [pinLabel],
        success: () => this.onPin(ev),
        fail: () => { /* 取消 */ },
      });
      return;
    }
    wx.showActionSheet({
      itemList: [pinLabel, T.impactTitle, T.matEdit, T.matDelete],
      success: (r) => {
        const i = r.tapIndex;
        if (i === 0) this.onPin(ev);
        else if (i === 1) this.goImpact(ev);
        else if (i === 2) this.goEdit(ev);
        else if (i === 3) this.onDelete(ev);
      },
      fail: () => { /* 取消 */ },
    });
  },
  // M3.19（批次 E）：看影响面（只读预览，绝不自动改卡）
  goImpact(e) {
    const m = e.currentTarget.dataset.m;
    if (!m || !m.id) return;
    wx.navigateTo({ url: '/pages/metrics/impact?material_id=' + m.id + '&name=' + encodeURIComponent(m.name || '') });
  },
  goEdit(e) {
    const m = e.currentTarget.dataset.m;
    if (m.is_virtual) { wx.showToast({ title: TERMS.card.matVirtual, icon: 'none' }); return; } // 虚拟只读
    wx.navigateTo({ url: '/pages/material/edit?id=' + (m.id || '') });
  },

  // 删除 = 软删除（二次确认；虚拟原料不给删）
  onDelete(e) {
    const m = e.currentTarget.dataset.m;
    if (m.is_virtual) { wx.showToast({ title: TERMS.card.matVirtual, icon: 'none' }); return; }
    wx.showModal({
      title: TERMS.card.matDelete,
      content: TERMS.card.matDeleteConfirm,
      confirmColor: '#e74c3c',
      cancelText: TERMS.buttons.cancel,
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.call('saveMaterial', { material: { id: m.id, _delete: true }, client_request_id: 'md_' + Date.now() });
          wx.showToast({ title: TERMS.card.matDelete, icon: 'success' });
          this.load();
        } catch (err) { api.toastError(err); }
      },
    });
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});
