// review/evidence/r239_takeaway_modes/r239_probe_cards.js
// 目的：用【云函数】口径复核菜品卡数量（客户端直读受安全规则限制，n=0 可能是权限过滤而非真 0）。
//   ① getShopContext → 拿 shop_id  ② getCostCard({shop_id}) → 拿真实卡片列表
// 通道：R188 定式（一个连接一次 evaluate，云函数调用 2 个）。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/hub' }); });
  await new Promise((r) => setTimeout(r, 3000));

  const out = await mp.evaluate(async () => {
    const r = {};
    let sid = '';
    try {
      const ctx = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
      sid = ((ctx && ctx.result && ctx.result.data) || {}).shop_id || '';
      r.shop = { shop_id: sid, shop_name: ((ctx.result.data || {}).shop_name) || '' };
    } catch (e) { r.shopErr = (e && (e.errMsg || e.message)) || String(e); }

    try {
      const c = await wx.cloud.callFunction({ name: 'getCostCard', data: { shop_id: sid } });
      const res = (c && c.result) || {};
      const d = res.data || {};
      const list = Array.isArray(d.list) ? d.list : [];
      r.costCard = {
        code: res.code, msg: res.msg,
        dataKeys: Object.keys(d),
        n: list.length,
        truncated: !!d.truncated,
        sample: list.slice(0, 6).map((x) => ({
          code: x.card_code, name: x.name, type: x.card_type,
          cost_yuan: (Number(x.total_cost_fen) || 0) / 100,   // ← 正确字段名是 total_cost_fen
          price_yuan: (Number(x.price_fen) || 0) / 100,
          lines: Array.isArray(x.lines) ? x.lines.length : -1,
        })),
        zeroCost: list.filter((x) => !(Number(x.total_cost_fen) > 0)).length,
      };
    } catch (e) { r.costCardErr = (e && (e.errMsg || e.message)) || String(e); }
    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
