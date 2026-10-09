// review/evidence/r249_import/r249_b_read.js
// 目的：R249 修复后的【真云 A/B 复验 · B 侧】—— 走**生产读路径** `getDishReview` 回读，
//       判「单品毛利复盘 → 外卖」是否终于有数据。
// 判据：takeaway 非 null；by_platform 的 key 含 'taobao'；外卖合计对得上独立复算的 Σqty=118 / Σamt=¥1823.08。
//       （独立复算见 review/evidence/r249_import/analyze.py：354 数据行 / 唯一商品 51 / 日期 7 天）
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/dishreview' }); });
  await new Promise((r) => setTimeout(r, 4000));

  const sid = await mp.evaluate(async () => {
    const g = (getApp() && getApp().globalData) || {};
    if (g.shop_id) return g.shop_id;
    try {
      const c = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
      return (c && c.result && c.result.data && c.result.data.shop_id) || '';
    } catch (e) { return ''; }
  });
  console.log('shop_id =', sid);

  const res = await mp.evaluate(async (s) => {
    try {
      const r = await wx.cloud.callFunction({ name: 'getDishReview', data: { shop_id: s } });
      return { ok: true, result: (r && r.result) || null };
    } catch (e) {
      return { ok: false, err: (e && (e.errMsg || e.message)) || String(e) };
    }
  }, sid);

  if (!res.ok) { console.log('READ ERR =', JSON.stringify(res)); }
  else {
    const d = (res.result && res.result.data) || {};
    const tk = d.takeaway || null;
    const summary = {
      code: res.result && res.result.code,
      has_data: res.result && res.result.data !== undefined,
      dineInLen: (d.dine_in && d.dine_in.rows && d.dine_in.rows.length) || 0,
      takeaway: tk === null ? 'null(空态)' : 'OBJECT',
      takeaway_platforms: tk ? Object.keys(tk.by_platform || {}) : null,
      takeaway_totals: tk ? (tk.totals || tk.summary || null) : null,
      unmatchedLen: (tk && tk.unmatched && tk.unmatched.length) || 0,
      truncated: d.truncated === true,
    };
    console.log('SUMMARY =', JSON.stringify(summary, null, 2));
    console.log('--- takeaway 原文（截断 4000 字）---');
    console.log(JSON.stringify(tk, null, 2).slice(0, 4000));
  }
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
