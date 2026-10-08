// R242 · 端到端验证：权益开通后，服务端付费墙（getDishReview）是否放行（只读）
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/hub' }); });
  await new Promise((r) => setTimeout(r, 3500));

  const out = await mp.evaluate(async () => {
    const r = {};
    const g = (getApp() && getApp().globalData) || {};
    let sid = g.shop_id || '';
    if (!sid) {
      try { const c = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
            sid = (c.result && c.result.data && c.result.data.shop_id) || ''; } catch (e) {}
    }
    r.shop_id = sid;
    try {
      const res = await wx.cloud.callFunction({ name: 'getDishReview', data: { shop_id: sid, month: '2026-08' } });
      r.dishreview = res.result;
    } catch (e) { r.dishreviewErr = (e && (e.errMsg || e.message)) || String(e); }
    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
