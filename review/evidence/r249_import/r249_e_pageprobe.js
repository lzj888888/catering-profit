// review/evidence/r249_import/r249_e_pageprobe.js —— 页面级取证：外卖未匹配是否真的进了 unmatched 列表
// 通道：miniprogram-automator 的 miniProgram.currentPage()（比 getCurrentPages() 在模拟器里更可靠）
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);

  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/dishreview' }); });
  await new Promise((r) => setTimeout(r, 7000));

  let page = null;
  try { page = await mp.currentPage(); } catch (e) { console.log('currentPage ERR', (e && e.message) || e); }
  console.log('currentPage route =', page ? page.path : '(null)');

  if (page) {
    try {
      const d = await page.data();
      const takeaway = d.takeaway;
      const unmatched = d.unmatched || [];
      const out = {
        route: page.path,
        loading: d.loading,
        locked: d.locked,
        empty: d.empty,
        dineIn_len: (d.dineIn || []).length,
        takeaway_is_null: takeaway === null,
        takeaway_len: Array.isArray(takeaway) ? takeaway.length : null,
        takeaway_platforms: Array.isArray(takeaway) ? takeaway.map((x) => ({ p: x.platform, name: x.platformName, ranked: (x.ranked || []).length })) : null,
        unmatched_len: unmatched.length,
        unmatched_head: unmatched.slice(0, 5),
      };
      console.log('PAGE =', JSON.stringify(out, null, 2));
      console.log('期望：unmatched_len > 0（外卖 51 个未匹配菜品应并入）；takeaway 非 null 且 ranked 为空');
    } catch (e) {
      console.log('read data ERR', (e && e.message) || e);
    }
  }

  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
