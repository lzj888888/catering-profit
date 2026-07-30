App({
  globalData: {
    dishes: [],
    fixedCosts: { rent: 0, labor: 0, utility: 0 }
  },
  onLaunch() {
    this.globalData.dishes = wx.getStorageSync('dishes') || [];
    this.globalData.fixedCosts = wx.getStorageSync('fixedCosts') || { rent: 0, labor: 0, utility: 0 };
  }
});
