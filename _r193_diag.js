// R193 诊断：reLaunch 到 sandbox 到底成不成（带 success/fail 回执）
const automator = require('miniprogram-automator');
const WS = process.argv[2] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  const evalIn = (fn, arg) => mp.evaluate(fn, arg);

  const cur = await evalIn(() => {
    const ps = getCurrentPages();
    return { n: ps.length, routes: ps.map((p) => p.route) };
  });
  console.log('current pages:', JSON.stringify(cur));

  const r1 = await evalIn(() => {
    globalThis.__nav = 'pending';
    wx.reLaunch({
      url: '/pages/sandbox/index',
      success: () => { globalThis.__nav = 'ok'; },
      fail: (e) => { globalThis.__nav = 'fail:' + (e && e.errMsg); },
    });
    return globalThis.__nav;
  });
  console.log('reLaunch call returned:', r1);
  await sleep(9000);
  const r2 = await evalIn(() => {
    const ps = getCurrentPages();
    return { nav: globalThis.__nav, n: ps.length, last: ps.length ? ps[ps.length - 1].route : null };
  });
  console.log('after 9s:', JSON.stringify(r2));
  await mp.disconnect();
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
