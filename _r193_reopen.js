// R193 第四轮(c)：草稿「重进恢复」**严格判定**
// 🔴 上一版测法的漏洞：只轮询 route ⇒ 页面本来就是 sandbox 时**立刻误判为已到位**，
//    读到的其实是**同一个旧实例**（draftRestored=false 却带着刚 setData 的值）⇒ 结论不可信。
// 本版：给旧实例打**哨兵标记**（__r193mark），轮询到标记**消失**才算真的重建了页面。
const automator = require('miniprogram-automator');
const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  const evalIn = (fn, arg) => mp.evaluate(fn, arg);

  async function nav(url) {
    try { await evalIn((u) => { wx.reLaunch({ url: u }); }, url); }
    catch (e) { console.log('  (nav eval timeout，按已生效继续)'); }
  }
  async function state() {
    try {
      return await evalIn(() => {
        const p = getCurrentPages().slice(-1)[0];
        return {
          route: p.route,
          mark: p.__r193mark === undefined ? null : p.__r193mark,
          draftRestored: p.data.draftRestored,
          firstYuan: (p.data.buildRows[0] || {}).yuan,
          targetYuan: p.data.targetYuan,
        };
      });
    } catch (e) { return { err: String(e && e.message) }; }
  }
  async function waitFresh(timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await state();
      if (s.route === 'pages/sandbox/index' && s.mark === null) return { ok: true, s };
      await sleep(1500);
    }
    return { ok: false, s: await state() };
  }

  console.log('start:', JSON.stringify(await state()));

  // ① 首跳 sandbox（实测：连接后第 1 跳最可靠）
  await nav('/pages/sandbox/index');
  await sleep(12000);
  let s = await state();
  console.log('hop1:', JSON.stringify(s));
  if (s.route !== 'pages/sandbox/index') { console.log('✗ 首跳未到 sandbox'); await mp.disconnect(); process.exit(2); }

  // ② 清干净 → 打哨兵 → 写草稿
  const wrote = await evalIn(() => {
    const p = getCurrentPages().slice(-1)[0];
    try { wx.removeStorageSync('sandbox_draft_v1'); } catch (e) { }
    p.data.draftRestored = false;
    const rows = p.data.buildRows.slice();
    rows[0].yuan = '12345';
    p.setData({ buildRows: rows, targetYuan: '8888', draftRestored: false });
    p.__r193mark = 'OLD';
    p.saveDraft();
    return { firstKey: rows[0].key, saved: !!wx.getStorageSync('sandbox_draft_v1') };
  });
  console.log('write draft:', JSON.stringify(wrote));
  await sleep(1200);

  // ③ 重进（reLaunch 同路由）—— 哨兵消失 = 真的换了新实例
  await nav('/pages/sandbox/index');
  const fresh = await waitFresh(30000);
  console.log('fresh instance?', fresh.ok, JSON.stringify(fresh.s));
  if (!fresh.ok) { console.log('✗ 拿不到新实例（reLaunch 同路由未重建）⇒ 本测法不成立'); await mp.disconnect(); process.exit(3); }

  let shotOk = false;
  for (let i = 0; i < 4 && !shotOk; i++) {
    try { await mp.screenshot({ path: `${OUT}/sandbox.png` }); shotOk = true; console.log('shot sandbox'); }
    catch (e) { console.log('shot retry', i + 1, e && e.message); await sleep(3000); }
  }
  console.log('shot ok:', shotOk);

  // ④ 清理
  const cleaned = await evalIn(() => { try { wx.removeStorageSync('sandbox_draft_v1'); } catch (e) { } return !wx.getStorageSync('sandbox_draft_v1'); });
  console.log('draft cleaned:', cleaned);
  await mp.disconnect();
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
