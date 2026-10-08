// review/evidence/r238_entitlement/r238_probe_update.js
// 目的：测【客户端 where+update 能否写 shop_entitlement】—— 这是决定性的问题：
//   · 若被放行 ⇒ ① 我能直接给李老师开权益（代做成立）
//              ② 🔴 但 ANY 登录用户都能给自己开权益 ⇒ 付费墙可被绕过（上线级安全洞）
//   · 若被拒   ⇒ 权限设计成立（add 能过、update 不能过，是微信默认规则的正常表现）
//
// 🔴 零污染设计：对【假 user_id】发 where+update —— 该记录已在上一个探针里删除，
//   所以匹配 0 条、不会改动任何真实数据；我们要读的是「**抛不抛权限异常**」。
//   判读（技能 §5.4 同源）：
//     返回 { stats: { updated: 0 } } 且【不抛异常】 ⇒ 权限**放行**（只是没匹配到）
//     抛 permission denied / -502001      ⇒ 权限**拒绝**
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';
const PROBE_USER = 'zz_probe_r238';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);

  const out = await mp.evaluate(async (probeUser) => {
    const r = {};
    const db = wx.cloud.database();
    // ① where + update（批量形态，不需要 _id）
    try {
      const up = await db.collection('shop_entitlement').where({ user_id: probeUser }).update({ data: { expire_at: 2 } });
      r.whereUpdate = { ok: true, stats: (up && up.stats) || null };
    } catch (e) { r.whereUpdate = { ok: false, err: (e && (e.errMsg || e.message)) || String(e) }; }
    // ② 对照：doc + update（单文档形态，_id 不存在）
    try {
      const du = await db.collection('shop_entitlement').doc('zz_probe_r238_never_exists').update({ data: { expire_at: 3 } });
      r.docUpdate = { ok: true, stats: (du && du.stats) || null };
    } catch (e) { r.docUpdate = { ok: false, err: (e && (e.errMsg || e.message)) || String(e) }; }
    return r;
  }, PROBE_USER);

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
