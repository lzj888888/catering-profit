// review/evidence/r238_entitlement/r238_probe_ent.js
// 目的：在【真实小程序上下文】里查当前账号的权益状态 —— 直接回答「手机 A 到底开没开」。
// ① getShopContext → 拿真实 shop_id
// ② payQueryEntitlement → 拿 { expire_at, is_active, source, days_left }
// 🔴 全程【只读】：两个都是查询类云函数，不写任何数据。
// 通道：R188 定式（逻辑层 wx.reLaunch + 一个连接一次 evaluate；云函数调用 ≤2 个/次）。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/hub' }); });
  await new Promise((r) => setTimeout(r, 3500));

  const out = await mp.evaluate(async () => {
    const r = {};
    const app = getApp();
    const g = (app && app.globalData) || {};
    r.before = { shop_id: g.shop_id || '', shop_name: g.shop_name || '', shopLoaded: !!g.shopLoaded };

    // ① 店铺上下文
    try {
      const ctx = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
      r.shopCtx = (ctx && ctx.result) || null;
    } catch (e) { r.shopCtxErr = (e && (e.errMsg || e.message)) || String(e); }

    const sid = r.before.shop_id || (r.shopCtx && r.shopCtx.data && r.shopCtx.data.shop_id) || '';
    r.shopIdUsed = sid;

    // ② 权益（只读）
    try {
      const ent = await wx.cloud.callFunction({ name: 'payQueryEntitlement', data: { shop_id: sid } });
      r.ent = (ent && ent.result) || null;
    } catch (e) { r.entErr = (e && (e.errMsg || e.message)) || String(e); }

    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
