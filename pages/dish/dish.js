// pages/dish/dish.js —— 历史遗留菜品 demo 页（本地存储，未接入云；无入口引用，仅兜底显示）
// ⚠️ 已从 app.json 移除注册（批次 4 起由 M3 成本卡替代）；保留仅防旧链接/旧缓存。文案走 i18n。
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const app = getApp();

Page({
  data: {
    t: {
      title: TERMS.dish.title,
      name: TERMS.dish.name,
      price: TERMS.dish.price,
      unitCost: TERMS.dish.unitCost,
      qty: TERMS.dish.qty,
      save: TERMS.dish.save,
      namePh: TERMS.dish.namePh,
      nameRequired: TERMS.dish.nameRequired,
    },
    name: '', sellPrice: '', unitCost: '', soldQty: '1', id: ''
  },

  onLoad(q) {
    if (q && q.id) {
      const d = app.globalData.dishes.find(x => x.id === q.id);
      if (d) {
        this.setData({
          name: d.name, sellPrice: String(d.sellPrice),
          unitCost: String(d.unitCost), soldQty: String(d.soldQty), id: d.id
        });
      }
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  save() {
    const name = this.data.name.trim();
    if (!name) { wx.showToast({ title: this.data.t.nameRequired, icon: 'none' }); return; }
    const dish = {
      id: this.data.id || ('d' + Date.now()),
      name,
      sellPrice: Number(this.data.sellPrice) || 0,
      unitCost: Number(this.data.unitCost) || 0,
      soldQty: Number(this.data.soldQty) || 0
    };
    const dishes = app.globalData.dishes.slice();
    const idx = dishes.findIndex(x => x.id === dish.id);
    if (idx >= 0) dishes[idx] = dish; else dishes.push(dish);
    app.globalData.dishes = dishes;
    wx.setStorageSync('dishes', dishes);
    wx.navigateBack();
  }
});