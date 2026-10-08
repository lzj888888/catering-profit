// review/evidence/r239_takeaway_modes/r239_probe_switch.js
// 目的：只读拿「导入摘要」——导入成功后云函数写了 shop_switch.m3_review_last
//   （含 biz_date / row_count / unmatched_count / platform）。这是唯一能确认"导入的东西在不在"的只读口子。
//   顺带查 audit 集合里有没有 IMPORT_DISH_SALES 记录。全程只读。
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
      const s = await db.collection('shop_switch').limit(20).get();
      r.switch = {
        n: s.data.length,
        keys: s.data.map((x) => x.key || x.switch_key || '(无key字段)'),
        reviewLast: s.data
          .filter((x) => (x.key || x.switch_key) === 'm3_review_last')
          .map((x) => ({ key: x.key || x.switch_key, value: x.value, updated_at: x.updated_at })),
      };
    } catch (e) { r.switchErr = (e && (e.errMsg || e.message)) || String(e); }
    try {
      const a = await db.collection('audit').limit(5).get();
      r.audit = { n: a.data.length, actions: a.data.map((x) => x.action || '(无)') };
    } catch (e) { r.auditErr = (e && (e.errMsg || e.message)) || String(e); }
    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
