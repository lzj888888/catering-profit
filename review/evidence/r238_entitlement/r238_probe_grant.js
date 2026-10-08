// review/evidence/r238_entitlement/r238_probe_grant.js
// 目的：把李老师账号的权益设为生效 —— 同时用 updated 计数区分两种解释：
//   · updated = 1 ⇒ ① 权益开好了（任务完成）
//                  ② 🔴 客户端能改**任意**用户的权益 ⇒ 付费墙可被绕过（上线级安全洞，必须立报立修）
//   · updated = 0 ⇒ 安全规则按 `_openid` 过滤（云函数写的记录 _openid 为空 ⇒ 客户端改不到）
//                  ⇒ 【安全设计成立】，而权益**仍需**经控制台/admin 通道开通
//
// 目标值（已机器验算）：1830268799000 = 2027-12-31 23:59:59 GMT+8
// 🔴 只动这一个 user_id；不新增记录（idx_ent_user 为 unique，add 同 user_id 会被索引拒）。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';
const TARGET_USER = 'u_mu6j87t1a283';
const EXPIRE_MS = 1830268799000;

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);

  const out = await mp.evaluate(async (uid, expMs) => {
    const r = { target: uid, expire_ms: expMs };
    const db = wx.cloud.database();
    // ① 先试读（判「能不能看见云函数建的记录」）
    try {
      const g = await db.collection('shop_entitlement').where({ user_id: uid }).get();
      r.read = { n: g.data.length, rows: g.data.map((x) => ({ _id: x._id, user_id: x.user_id, expire_at: x.expire_at, source: x.source })) };
    } catch (e) { r.read = { err: (e && (e.errMsg || e.message)) || String(e) }; }
    // ② 再试写
    try {
      const up = await db.collection('shop_entitlement').where({ user_id: uid }).update({ data: { expire_at: expMs, source: 'manual', updated_at: Date.now() } });
      r.update = { ok: true, stats: (up && up.stats) || null };
    } catch (e) { r.update = { ok: false, err: (e && (e.errMsg || e.message)) || String(e) }; }
    return r;
  }, TARGET_USER, EXPIRE_MS);

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
