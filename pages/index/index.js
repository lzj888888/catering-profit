const calc = require('../../utils/calc.js');
const app = getApp();

Page({
  data: {
    dishes: [],
    fixedCosts: { rent: 0, labor: 0, utility: 0 },
    summary: {
      totalRevenue: '0.00', totalCost: '0.00', grossProfit: '0.00',
      grossRate: '0.0', fixedTotal: '0.00', netProfit: '0.00'
    }
  },

  onShow() { this.refresh(); },

  refresh() {
    const dishes = app.globalData.dishes;
    const fixedCosts = app.globalData.fixedCosts;
    const s = calc.calcSummary(dishes, fixedCosts);
    const view = dishes.map(d => {
      const r = calc.calcDish(d);
      return Object.assign({}, d, {
        revenue: r.revenue.toFixed(2),
        profit: r.profit.toFixed(2),
        rate: r.rate.toFixed(1)
      });
    });
    this.setData({
      dishes: view,
      fixedCosts,
      summary: {
        totalRevenue: s.totalRevenue.toFixed(2),
        totalCost: s.totalCost.toFixed(2),
        grossProfit: s.grossProfit.toFixed(2),
        grossRate: s.grossRate.toFixed(1),
        fixedTotal: s.fixedTotal.toFixed(2),
        netProfit: s.netProfit.toFixed(2)
      }
    });
  },

  onFixedInput(e) {
    const field = e.currentTarget.dataset.field;
    const val = Number(e.detail.value) || 0;
    const fixedCosts = Object.assign({}, this.data.fixedCosts, { [field]: val });
    app.globalData.fixedCosts = fixedCosts;
    wx.setStorageSync('fixedCosts', fixedCosts);
    this.refresh();
  },

  goAdd() { wx.navigateTo({ url: '/pages/dish/dish' }); },

  editDish(e) { wx.navigateTo({ url: '/pages/dish/dish?id=' + e.currentTarget.dataset.id }); },

  delDish(e) {
    const id = e.currentTarget.dataset.id;
    const dishes = app.globalData.dishes.filter(d => d.id !== id);
    app.globalData.dishes = dishes;
    wx.setStorageSync('dishes', dishes);
    this.refresh();
  }
});
