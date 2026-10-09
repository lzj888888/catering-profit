// review/evidence/r249_import/r249_d_pagedata.js —— 读单品毛利复盘页实例 data（判「用户到底看见什么」）
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);

  // ① 先看当前栈顶是哪一页
  const cur = await mp.evaluate(() => {
    const ps = getCurrentPages();
    return ps.map((p) => p.route);
  });
  console.log('pages stack =', JSON.stringify(cur));

  // ② 确保在 dishreview
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/dishreview' }); });
  await new Promise((r) => setTimeout(r, 6000));

  const dump = await mp.evaluate(() => {
    const ps = getCurrentPages();
    const p = ps[ps.length - 1];
    if (!p) return { err: 'no page' };
    const d = p.data || {};
    const slim = {};
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (Array.isArray(v)) slim[k] = { __arr: v.length, head: v.slice(0, 2) };
      else if (v && typeof v === 'object') slim[k] = { __obj: Object.keys(v).slice(0, 20) };
      else slim[k] = v;
    }
    return { route: p.route, data: slim };
  });
  console.log('PAGE DATA =', JSON.stringify(dump, null, 2).slice(0, 6000));

  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
