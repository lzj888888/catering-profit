// review/evidence/r238_entitlement/r238_probe_write.js
// 目的：实测【客户端能否写 shop_entitlement】—— 一次探针回答两件事：
//   ① 我能不能代李老师开权益（能写 ⇒ 能代做）
//   ② 🔴 付费墙有没有被绕过的安全洞（云函数侧只按 user_id 读，不看 _openid
//      ⇒ 若客户端能 add 一条 {user_id: 别人的/自己的, expire_at: 未来}，则付费墙形同虚设）
//
// 🔴 安全纪律（探针自带清理）：
//   - 用**假 user_id**（zz_probe_r238 / zz_probe_r238b），绝不碰李老师那条 u_mu6j87t1a283；
//   - 写完立刻按显式 _id 删除，并把删除结果一并带回；
//   - 如果写成功 ⇒ 这是【发现漏洞】而不是【利用漏洞】：立即报告 + 立修，不做第二次。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';
const PROBE_USER = 'zz_probe_r238';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);

  const out = await mp.evaluate(async (probeUser) => {
    const r = {};
    const db = wx.cloud.database();
    try {
      const add = await db.collection('shop_entitlement').add({
        data: { user_id: probeUser, expire_at: 1, source: 'probe', updated_at: Date.now() },
      });
      r.write = { ok: true, _id: add._id };
      try {
        const rm = await db.collection('shop_entitlement').doc(add._id).remove();
        r.cleanup = { ok: true, removed: (rm && rm.stats && rm.stats.removed) || null };
      } catch (e2) { r.cleanup = { ok: false, err: (e2 && (e2.errMsg || e2.message)) || String(e2) }; }
    } catch (e) {
      r.write = { ok: false, err: (e && (e.errMsg || e.message)) || String(e) };
    }
    return r;
  }, PROBE_USER);

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
