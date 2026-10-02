// R193 第四轮(b)：沙盘草稿**往返实测**（写 → 重进 → 是否恢复 → 清空）+ 截图
// ⚠️ 实测：同一连接里「先导航到 A 再导航到 B」的第 2 跳会 timeout（R193 实证）⇒ 本脚本
//    连接后**第一跳就去 sandbox**，不先绕路；每跳都带 success/fail 回执 + 轮询真到没到。
const automator = require('miniprogram-automator');
const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  const evalIn = (fn, arg) => mp.evaluate(fn, arg);

  async function cur() {
    try { return (await evalIn(() => { const p = getCurrentPages(); return p.length ? p[p.length - 1].route : null; })); }
    catch (e) { return 'ERR:' + (e && e.message); }
  }
  // 导航：发指令（吞掉 timeout，因为指令其实已生效）+ 轮询确认真的到了
  async function goto(url, want, maxMs) {
    try { await evalIn((u) => { wx.reLaunch({ url: u }); }, url); } catch (e) { console.log('  (nav eval timeout，按已生效继续)'); }
    const t0 = Date.now();
    while (Date.now() - t0 < (maxMs || 20000)) {
      await sleep(1500);
      const r = await cur();
      if (r === want) return true;
    }
    console.log('  ✗ 未到达', want, '当前', await cur());
    return false;
  }
  async function shot(name) {
    for (let i = 0; i < 3; i++) {
      try { await mp.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); return true; }
      catch (e) { await sleep(2500); }
    }
    return false;
  }

  console.log('start at:', await cur());

  // ① 首跳到 sandbox
  const ok1 = await goto('/pages/sandbox/index', 'pages/sandbox/index', 30000);
  console.log('step1 reach sandbox:', ok1);
  if (!ok1) { await mp.disconnect(); process.exit(2); }

  // ② 清干净（避免上次残留影响判断）
  const cleared = await evalIn(() => {
    try { wx.removeStorageSync('sandbox_draft_v1'); } catch (e) { }
    return !wx.getStorageSync('sandbox_draft_v1');
  });
  console.log('pre-clean:', cleared);

  // ③ 写草稿（走页面自己的 saveDraft，别手搓 key）
  const wrote = await evalIn(() => {
    const p = getCurrentPages().slice(-1)[0];
    if (p.route !== 'pages/sandbox/index') return { ok: false, route: p.route };
    const rows = p.data.buildRows.slice();
    rows[0].yuan = '12345';
    p.setData({ buildRows: rows, targetYuan: '8888' });
    p.saveDraft();
    return { ok: true, firstKey: rows[0].key, savedToStorage: !!wx.getStorageSync('sandbox_draft_v1') };
  });
  console.log('write draft:', JSON.stringify(wrote));
  await sleep(1500);

  // ④ 重进（真·reLaunch，等同"退出再进来"）
  const ok2 = await goto('/pages/sandbox/index', 'pages/sandbox/index', 20000);
  console.log('step4 re-enter:', ok2);
  const after = await evalIn(() => {
    const p = getCurrentPages().slice(-1)[0];
    return {
      route: p.route,
      draftRestored: p.data.draftRestored,
      firstYuan: (p.data.buildRows[0] || {}).yuan,
      targetYuan: p.data.targetYuan,
    };
  });
  console.log('after reopen:', JSON.stringify(after));
  await shot('sandbox');

  // ⑤ 清理测试草稿，别污染真机
  const cleaned = await evalIn(() => {
    try { wx.removeStorageSync('sandbox_draft_v1'); } catch (e) { }
    return !wx.getStorageSync('sandbox_draft_v1');
  });
  console.log('draft cleaned:', cleaned);

  await mp.disconnect();
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
