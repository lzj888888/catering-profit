// R568 探针：通道是否活着 + 当前页面栈 + shop_id 是否就绪
const a = require('miniprogram-automator');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let mp;
  try {
    mp = await a.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  } catch (e) {
    console.log('CONNECT_FAIL', e && e.message);
    process.exit(1);
  }
  try {
    const r = await mp.evaluate(() => {
      const s = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
      const app = (typeof getApp === 'function') ? getApp() : null;
      return {
        n: s.length,
        route: s.length ? s[s.length - 1].route : null,
        shopId: (app && app.globalData && app.globalData.shop_id) || '',
        cloudReady: !!(wx.cloud && wx.cloud.callFunction),
      };
    });
    console.log('STATE ' + JSON.stringify(r));
  } catch (e) {
    console.log('EVAL_FAIL', e && e.message);
  }
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})();
