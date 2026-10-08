// review/evidence/r238_entitlement/r238_probe_db.js
// 目的：在【真实小程序上下文】里【只读】探云数据库 —— 回答两件事：
//   ① user 集合里有几条、user_id 是什么（代替李老师手抄）
//   ② shop_entitlement 现状（expire_at / source）
//   ③ 客户端读权限到底开到哪一档（这决定「我能不能代写」）
// 🔴 本脚本【绝不写】任何数据。写入动作另行单独取证。
// 通道：R188 定式 —— 逻辑层 wx.reLaunch（page.* 全死）；一个连接只跑一次 evaluate。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/hub' }); });
  await new Promise((r) => setTimeout(r, 3500));

  const out = await mp.evaluate(async () => {
    const r = {};
    try {
      const db = wx.cloud.database();
      r.dbEnv = (wx.cloud && wx.cloud.DYNAMIC_CURRENT_ENV) ? 'dynamic' : 'unknown';
      try {
        const u = await db.collection('user').limit(20).get();
        r.user = {
          n: u.data.length,
          rows: u.data.map((x) => ({ _id: x._id, user_id: x.user_id, openid: x.openid, nickname: x.nickname || '', created_at: x.created_at })),
        };
      } catch (e) { r.user = { err: (e && (e.errMsg || e.message)) || String(e) }; }
      try {
        const s = await db.collection('shop_entitlement').limit(20).get();
        r.ent = {
          n: s.data.length,
          rows: s.data.map((x) => ({ _id: x._id, user_id: x.user_id, expire_at: x.expire_at, source: x.source })),
        };
      } catch (e) { r.ent = { err: (e && (e.errMsg || e.message)) || String(e) }; }
    } catch (e) { r.FATAL = (e && e.message) || String(e); }
    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
