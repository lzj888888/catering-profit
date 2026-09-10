const app = getApp();

Page({
  data: {
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
    if (!name) { wx.showToast({ title: '请输入菜品名称', icon: 'none' }); return; }
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
