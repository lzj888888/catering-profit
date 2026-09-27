// pages/material/pick.js —— round156 · 原料选择页（**独立页，不是弹层**）
//
// 由来（李老师原话）：「新增菜品一定需要在这个窗口加吗？如果有 100 道菜品，来回查找会很麻烦」
//   —— 真正的痛点在**选原料**这一格：改前用原生 `<picker mode="selector" range="{{materials}}">`，
//   100 个原料只能靠手指滚，没有搜索、没有分组。
//
// 🔴 为什么独立成页而不是「弹层 + 搜索框」：弹层 × 键盘是本仓实测的死结
//   （PITFALLS §6/§8：遮罩 inset 简写 ⇒ 透明窗口 / 输入被挡）。独立页是已验证的解法，
//   与 `pages/material/edit`「独立成页，不用弹层」同一纪律。
//
// 回传：**不做 eventChannel**（本仓无先例），走 `getApp().globalData.pickMaterial`
//   + 调用方 `onShow` 消费；带 `at` 时间戳做哨兵，避免"进页没选就返回"被误当成选中。
const api = require('../../utils/api.js');
const ui = require('../../utils/ui.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

// category 枚举 → 展示名（单源 = TERMS.card.cat*，本处只做键→词的映射，不另立枚举）
const CATEGORY_LABELS = {
  meat: TERMS.card.catMeat,
  veg: TERMS.card.catVeg,
  dry: TERMS.card.catDry,
  season: TERMS.card.catSeason,
  pack: TERMS.card.catPack,
  other: TERMS.card.catOther,
};
// 分组展示顺序（固定：按采购动线，肉→菜→干货→调料→包材→其他）
const CATEGORY_ORDER = ['meat', 'veg', 'dry', 'season', 'pack', 'other'];
const PIN_GROUP = '__pin__';   // 「常用（置顶）」组的哨兵键

Page({
  data: {
    t: {
      title: TERMS.card.matPickTitle,
      searchPh: TERMS.card.matPickSearchPh,
      empty: TERMS.card.matPickEmpty,
      emptyHint: TERMS.card.matPickEmptyHint,
      matUnit: TERMS.card.matUnit,
      matPrice: TERMS.card.matPrice,
      matNetCost: TERMS.card.matNetCost,
      matVirtual: TERMS.card.matVirtual,
      pinTag: TERMS.card.pinTag,
      cur: '¥',
      loading: TERMS.ui.loading,
    },
    all: [],        // 全量（前端过滤）
    pinned: [],     // 置顶的原料 id（顺序 = 老板点选先后）
    groups: [],     // [{ key, label, items: [] }]
    keyword: '',
    loading: true,
  },

  onLoad(q) {
    // 调用方传来的明细行下标（原样带回，调用方据此知道往哪一行填）
    this.idx = (q && q.idx != null) ? String(q.idx) : '';
    this.load();
  },

  async load() {
    try {
      await api.ensureShop();
      ui.setTitle(TERMS.card.matPickTitle);
      const d = await api.call('getMaterial', {});
      const all = (d.list || []).map((m) => ({
        id: m.id,
        name: m.name || '',
        is_virtual: !!m.is_virtual,
        category: m.category || 'other',
        category_label: CATEGORY_LABELS[m.category] || CATEGORY_LABELS.other,
        purchase_unit: m.purchase_unit || TERMS.card.matUnitDefault,
        purchase_price: m.purchase_price_fen > 0 ? api.fenToYuan(m.purchase_price_fen, 2) : '—',
        net_cost: m.net_unit_cost > 0 ? (m.net_unit_cost / 10000).toFixed(4) : '0.0000',
        aliases: parseAliases(m.aliases),
      }));
      // 置顶（店铺级偏好）：读失败**不阻断**选原料 —— 它只是排序偏好，不是数据。
      let pinned = [];
      try {
        const sc = await api.call('getShopContext', {});
        pinned = Array.isArray(sc.pinned_materials) ? sc.pinned_materials : [];
      } catch (e) { pinned = []; }
      this.setData({ all, pinned, loading: false });
      this.buildGroups();
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onKeyword(e) { this.setData({ keyword: e.detail.value }); this.buildGroups(); },

  // 搜索（名称 or 别名）+ 分组：置顶的独立成「常用」组排最前，其余按分类顺序
  buildGroups() {
    const kw = this.data.keyword.trim().toLowerCase();
    const matched = this.data.all.filter((m) => {
      if (!kw) return true;
      if (m.name.toLowerCase().includes(kw)) return true;
      return m.aliases.some((a) => a.toLowerCase().includes(kw));
    });
    const pinnedIds = this.data.pinned || [];
    const isPinned = (id) => pinnedIds.indexOf(id) >= 0;
    const groups = [];
    // ① 常用（置顶）—— 顺序严格按 pinnedIds（= 老板点选先后），不重排
    const pinItems = [];
    for (const id of pinnedIds) {
      const hit = matched.find((x) => x.id === id);
      if (hit) pinItems.push(hit);
    }
    if (pinItems.length) groups.push({ key: PIN_GROUP, label: TERMS.card.pinTag, items: pinItems });
    // ② 按分类（置顶项不重复出现）
    for (const c of CATEGORY_ORDER) {
      const items = matched.filter((m) => m.category === c && !isPinned(m.id));
      if (items.length) groups.push({ key: c, label: CATEGORY_LABELS[c], items });
    }
    this.setData({ groups });
  },

  // 选中 → 写全局暂存 → 返回（调用方 onShow 消费）
  onPick(e) {
    const m = e.currentTarget.dataset.m;
    if (!m) return;
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.pickMaterial = { id: m.id, name: m.name, idx: this.idx, at: Date.now() };
    }
    wx.navigateBack();
  },

  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
});

// aliases 是 JSON 数组字符串（仅检索用）—— 容错解析
function parseAliases(s) {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
