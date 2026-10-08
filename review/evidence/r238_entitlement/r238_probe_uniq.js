// review/evidence/r238_entitlement/r238_probe_uniq.js
// 目的：机器化验证 `shop_entitlement.idx_ent_user` 的 unique 约束**是否真生效**。
//   背景：本仓 A6 悬案 —— 「索引存在 ≠ 生效」，此前只能靠控制台 GUI 手工插重复三元组验证
//   （smokeTest index.js:138-158 的注释与判读纪律均指向此）。本脚本用【客户端】通道做同一件事。
// 🔴 判读（勿反）：
//   第二条写入「成功」 ⇒ 唯一约束**未生效**（严重：可被自开权益）
//   第二条写入「被拒」 ⇒ 唯一约束**真生效**（预期）
// 🔴 零污染：全程使用【假 user_id】zz_probe_uniq_r238，跑完按 where 删除自建记录并把结果带回。
//   绝不触碰李老师那条 u_mu6j87t1a283。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';
const U = 'zz_probe_uniq_r238';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);

  const out = await mp.evaluate(async (u) => {
    const r = { probe_user: u };
    const db = wx.cloud.database();
    const mk = (id) => db.collection('shop_entitlement').add({
      data: { _id: id, user_id: u, expire_at: 1, source: 'probe', updated_at: Date.now() },
    });
    try { const a = await mk('zz_probe_uniq_r238_a'); r.first = { ok: true, _id: a._id }; }
    catch (e) { r.first = { ok: false, err: (e && (e.errMsg || e.message)) || String(e) }; }
    try { const b = await mk('zz_probe_uniq_r238_b'); r.second = { ok: true, _id: b._id }; }
    catch (e) { r.second = { ok: false, err: (e && (e.errMsg || e.message)) || String(e) }; }
    try {
      const rm = await db.collection('shop_entitlement').where({ user_id: u }).remove();
      r.cleanup = { ok: true, stats: (rm && rm.stats) || null };
    } catch (e) { r.cleanup = { ok: false, err: (e && (e.errMsg || e.message)) || String(e) }; }
    return r;
  }, U);

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
