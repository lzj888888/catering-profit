const automator = require('miniprogram-automator');
const ws = process.argv[2] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const mp = await automator.connect({ wsEndpoint: ws });
  await mp.evaluate((u) => { wx.reLaunch({ url: u, fail: () => {} }); return 1; }, '/pages/sandbox/matrix');
  await sleep(3000);
  const r = await mp.evaluate(async (d) => {
    const p = getCurrentPages().at(-1);
    const wait = (n) => new Promise((x) => setTimeout(x, n));
    const toasts = [];
    const origToast = wx.showToast;
    wx.showToast = function (o) { toasts.push(JSON.stringify(o)); return origToast.call(wx, o); };
    const origCall = wx.cloud.callFunction;
    let errMsg = null, sentBytes = 0, t0 = 0, ms = 0, calls = 0;
    wx.cloud.callFunction = async function (opt) {
      if (opt && opt.name === 'calcSandbox') {
        calls += 1;
        sentBytes += JSON.stringify(opt.data).length;
        t0 = Date.now();
        try { const rr = await origCall.call(wx.cloud, opt); ms = Date.now() - t0; return rr; }
        catch (e) { ms = Date.now() - t0; errMsg = (e && (e.errMsg || e.message)) || String(e); throw e; }
      }
      return origCall.call(wx.cloud, opt);
    };
    p.setData({ advOpen: true, dims: d });
    const t1 = Date.now();
    await p.onGenerate();
    const total = Date.now() - t1;
    await wait(400);
    wx.cloud.callFunction = origCall; wx.showToast = origToast;
    return { total, ms, sentBytes, calls, errMsg, toasts, rows: ((p.data.result || {}).rows || []).length, rejected: ((p.data.result || {}).rejected || []).length };
  }, { rent: [3000,4000,5000,6000,7000,8000,9000,10000], labor: [2,3,4,5], margin: [40,45,50,55,60], target: [0,5000,10000,15000,20000,30000] });
  console.log(JSON.stringify(r, null, 2));
  await mp.disconnect(); process.exit(0);
})().catch(e => { console.error('FATAL:', e && e.message); process.exit(1); });
