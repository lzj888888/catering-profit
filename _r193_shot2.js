// R193 第二轮自查：只截 沙盘（上一轮 reLaunch 到 sandbox 后被弹回 index，需要单独定位）
const automator = require('miniprogram-automator');
const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  try { await mp.evaluate(() => { wx.reLaunch({ url: '/pages/index/index' }); }); } catch (e) { }
  await sleep(3000);

  // 用 navigateTo（保留首页在栈里）而不是 reLaunch —— 便于判断"是页面崩了还是导航没生效"
  try { await mp.evaluate(() => { wx.navigateTo({ url: '/pages/sandbox/index' }); }); } catch (e) { console.log('nav err', e && e.message); }
  await sleep(10000);

  for (let i = 0; i < 3; i++) {
    try {
      const d = await mp.evaluate(() => {
        const p = getCurrentPages().slice(-1)[0];
        return { route: p.route, restored: p.data && p.data.draftRestored, hasResult: !!(p.data && p.data.result) };
      });
      console.log('state', JSON.stringify(d));
      if (d.route === 'pages/sandbox/index') {
        await mp.screenshot({ path: `${OUT}/sandbox.png` });
        console.log('shot sandbox');
        break;
      }
    } catch (e) { console.log('probe retry', i, e && e.message); }
    await sleep(3000);
  }
  await mp.disconnect();
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
