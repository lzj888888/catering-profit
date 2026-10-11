// R272 只读核验：调 getCostCard 数该店成本卡（按 card_code 去重），确认 20 张真落库。
// 用法（PowerShell，带 NODE_PATH=mpauto/node_modules）：
//   node verify_cards.js [shop_id]
const automator = require('miniprogram-automator');
const WS = process.env.MP_WS || 'ws://127.0.0.1:9420';
const SHOP = process.argv[2] || 'shop_mu6j87v1itrs';

function callFn(mp, name, data) {
  return mp.evaluate((n, d) => new Promise((res) => {
    wx.cloud.callFunction({
      name: n, data: d,
      success: (r) => res(r.result),
      fail: (e) => res({ __fail: (e && (e.errMsg || e.message)) || String(e) }),
    });
  }), name, data);
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  const r = await callFn(mp, 'getCostCard', { shop_id: SHOP });
  if (r && r.__fail) { console.log('CALL_FAIL=' + r.__fail); process.exit(2); }
  const list = (r && r.data && r.data.list) || [];
  console.log('COUNT=' + list.length);
  list.forEach((c, i) => {
    console.log((i + 1) + '. ' + (c.name || '?') +
      ' | code=' + (c.card_code || '?') +
      ' | cost=' + ((c.total_cost_fen || 0) / 100).toFixed(2) + '元' +
      ' | margin=' + (c.gross_margin_pct || 0) + '%');
  });
  if (mp && typeof mp.disconnect === 'function') { try { await mp.disconnect(); } catch (e) {} }
  process.exit(0);
})().catch((e) => { console.log('FATAL=' + ((e && e.message) || e)); process.exit(9); });
