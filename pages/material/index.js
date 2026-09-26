// pages/material/index.js —— 批次 P0（M3 v1.2）· 原料档案列表页
//
// 读：api.call('getMaterial', {}) 列表；写（删）：api.call('saveMaterial', { material:{ id, _delete:true } })。
// ⚠️ 虚拟原料（is_virtual=true）只读：不可手动编辑、不可手动删除（仅由半成品卡级联产生/删除）。
// ⚠️ 搜索 = 名称 or 别名（aliases 为 JSON 数组字符串，仅检索，绝不替换原料名）；分类按 category 过滤。
// ⚠️ 删除 = 软删除；被成本卡引用时提示但允许删（快照不受影响）。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
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
    },
    all: [],           // 全量列表（前端过滤）
    list: [],          // 过滤后展示
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
      const all = (d.list || []).map((m) => ({
        id: m.id,
        name: m.name || '',
        brand_spec: m.brand_spec || '',
        purchase_unit: m.purchase_unit || '',
        purchase_price: m.purchase_price_fen > 0 ? api.fenToYuan(m.purchase_price_fen, 2) : '—',
        // round149：把「买→用」的换算关系摆出来（同一原料可以有不同规格/单位，
        //   列表里一眼看清"这价是按什么单位报的"，而不是只看到一个裸数字）
        convert_factor: m.convert_factor || 0,
        yield_rate: m.yield_rate || 0,
        spec_line: '1 ' + (m.purchase_unit || TERMS.card.matUnitDefault) + ' = ' + (m.convert_factor || 0) + ' 克'
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
      this.setData({ all, catOptions, loading: false });
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
    this.setData({ list });
  },

  goAdd() { wx.navigateTo({ url: '/pages/material/edit?id=' }); },
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
