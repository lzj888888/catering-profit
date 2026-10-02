// R193 第三轮：① 重截「我的」（客服行满宽修复后）② 沙盘草稿**往返实测**（写 → 重进 → 是否恢复）
const automator = require('miniprogram-automator');
const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  const evalIn = (fn, arg) => mp.evaluate(fn, arg);

  async function goto(url, ms) {
    try { await evalIn((u) => { wx.reLaunch({ url: u }); }, url); } catch (e) { }
    await sleep(ms);
  }
  async function shot(name) {
    for (let i = 0; i < 3; i++) {
      try { await mp.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); return true; }
      catch (e) { await sleep(2500); }
    }
    return false;
  }

  // ① 我的页（客服行样式修复后）
  await goto('/pages/mine/index', 7000);
  await shot('mine');

  // ② 沙盘草稿往返：先写一个值并保存 → 重进 → 看是否恢复
  await goto('/pages/sandbox/index', 9000);
  const wrote = await evalIn(() => {
    const p = getCurrentPages().slice(-1)[0];
    if (p.route !== 'pages/sandbox/index') return { ok: false, route: p.route };
    const rows = p.data.buildRows.slice();
    rows[0].yuan = '12345';
    p.setData({ buildRows: rows, targetYuan: '8888' });
    p.saveDraft();
    return { ok: true, first: rows[0].key };
  });
  console.log('write draft:', JSON.stringify(wrote));
  await sleep(1500);

  // 重进（模拟"退出再进来"）
  await goto('/pages/sandbox/index', 9000);
  const after = await evalIn(() => {
    const p = getCurrentPages().slice(-1)[0];
    return {
      route: p.route,
      restoredFlag: p.data.draftRestored,
      firstYuan: (p.data.buildRows[0] || {}).yuan,
      targetYuan: p.data.targetYuan,
      draftBarShown: !!(p.data.draftRestored || p.data.dirty),
    };
  });
  console.log('after reopen:', JSON.stringify(after));
  await shot('sandbox');

  // 清理：把刚才写进 Storage 的测试草稿删掉，别污染真机
  const cleaned = await evalIn(() => {
    try { wx.removeStorageSync('sandbox_draft_v1'); } catch (e) { }
    return !wx.getStorageSync('sandbox_draft_v1');
  });
  console.log('draft cleaned:', cleaned);

  await mp.disconnect();
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
