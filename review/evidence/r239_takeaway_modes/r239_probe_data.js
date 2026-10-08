// review/evidence/r239_takeaway_modes/r239_probe_data.js
// 目的：在真实小程序上下文里【只读】回答 —— 你现在导入的账单，到底能不能出复盘？
//   ① 菜品卡有几张（复盘的唯一成本来源）
//   ② 导入的销量行有几条、平台是什么
//   ③ getDishReview 现在返回什么（是不是被 FEATURE_LOCKED 拦住）
//   ④ 菜品卡里有多少张 total_cost=0（建了卡但没填原料价 ⇒ 复盘会显示虚高毛利）
// 🔴 全程只读，不写任何数据。通道：R188 定式（一个连接一次 evaluate）。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/hub' }); });
  await new Promise((r) => setTimeout(r, 3500));

  const out = await mp.evaluate(async () => {
    const r = {};
    const db = wx.cloud.database();
    const cnt = async (name, proj) => {
      try {
        const q = proj ? db.collection(name).field(proj).limit(100) : db.collection(name).limit(100);
        const s = await q.get();
        return { n: s.data.length, rows: s.data };
      } catch (e) { return { err: (e && (e.errMsg || e.message)) || String(e) }; }
    };

    const cards = await cnt('shop_cost_card', { card_code: true, version: true, name: true, total_cost: true });
    r.cards = { n: (cards.rows || []).length, err: cards.err };
    if (cards.rows) {
      r.cards.list = cards.rows.map((x) => ({ code: x.card_code, v: x.version, name: x.name, cost_yuan: (Number(x.total_cost) || 0) / 100 }));
      r.cards.zeroCost = cards.rows.filter((x) => !(Number(x.total_cost) > 0)).length;
    }

    const sales = await cnt('external_sales_daily',
      { dish_key: true, qty: true, amount: true, platform: true, biz_date: true });
    r.sales = { n: (sales.rows || []).length, err: sales.err };
    if (sales.rows) {
      r.sales.sample = sales.rows.slice(0, 12).map((x) => ({ k: x.dish_key, q: x.qty, amt: x.amount, p: x.platform, d: x.biz_date }));
      const byp = {};
      sales.rows.forEach((x) => { byp[x.platform || '(空)'] = (byp[x.platform || '(空)'] || 0) + 1; });
      r.sales.byPlatform = byp;
    }

    // 直接问云函数要复盘（当前无权益，看它返回什么）
    try {
      const d = await wx.cloud.callFunction({ name: 'getDishReview', data: {} });
      const res = (d && d.result) || {};
      r.review = { code: res.code, msg: res.msg, errCode: res.errCode, hasData: !!(res.data) };
    } catch (e) { r.reviewErr = (e && (e.errMsg || e.message)) || String(e); }

    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
