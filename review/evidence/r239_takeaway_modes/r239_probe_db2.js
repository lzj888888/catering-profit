// review/evidence/r239_takeaway_modes/r239_probe_db2.js
// 目的：只读探两项 —— 菜品卡数量 / 导入销量行数（去掉一切云函数调用，避免超时）。
// 通道：R188 定式（一个连接一次 evaluate）。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/hub' }); });
  await new Promise((r) => setTimeout(r, 3000));

  const out = await mp.evaluate(async () => {
    const r = {};
    const db = wx.cloud.database();
    try {
      const s = await db.collection('shop_cost_card').field({ card_code: true, version: true, name: true, total_cost: true }).limit(50).get();
      r.cards = { n: s.data.length, list: s.data.map((x) => ({ name: x.name, v: x.version, cost_yuan: (Number(x.total_cost) || 0) / 100 })), zeroCost: s.data.filter((x) => !(Number(x.total_cost) > 0)).length };
    } catch (e) { r.cardsErr = (e && (e.errMsg || e.message)) || String(e); }
    try {
      const s = await db.collection('external_sales_daily').field({ dish_key: true, qty: true, amount: true, platform: true }).limit(50).get();
      const byp = {};
      s.data.forEach((x) => { byp[x.platform || '(空)'] = (byp[x.platform || '(空)'] || 0) + 1; });
      r.sales = { n: s.data.length, byPlatform: byp, sample: s.data.slice(0, 8).map((x) => ({ k: x.dish_key, q: x.qty, amt: x.amount, p: x.platform })) };
    } catch (e) { r.salesErr = (e && (e.errMsg || e.message)) || String(e); }
    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
