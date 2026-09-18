// 摊销页：注入两笔组 + 滚到底部（供 GUI 截图看「+ 追加采购」）
const automator = require('miniprogram-automator');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  log('connected');
  await mp.reLaunch('/pages/month/amortize');
  await sleep(3500);
  const p = await mp.currentPage();
  log('page', p && p.path);
  await p.setData({
    loading: false, totalYuan: '116.68',
    groups: [{
      key: 'amort_x', name: '装修', count: 2, valueFen: 38000000, monthFen: 11668,
      valueYuan: '380000.00', monthYuan: '116.68', multi: true, expanded: true,
      batches: [
        { asset_id: 'a1', name: '装修', value: '300000.00', value_fen: 30000000, start_month: '2026-01', total_months: 36, terminate_month: '', group_id: '', batch_seq: 1, amount_fen: 8334, amountYuan: '83.34' },
        { asset_id: 'a2', name: '装修', value: '80000.00', value_fen: 8000000, start_month: '2026-07', total_months: 24, terminate_month: '', group_id: 'amort_x', batch_seq: 2, amount_fen: 3334, amountYuan: '33.34' },
      ],
    }],
  });
  log('setData ok');
  await sleep(1200);
  try {
    await Promise.race([
      mp.evaluate(() => { wx.pageScrollTo({ scrollTop: 100000, duration: 0 }); return 'scrolled'; }),
      new Promise((_, rj) => setTimeout(() => rj(new Error('scroll timeout (忽略，滚动应已执行)')), 12000)),
    ]).then((r) => log('scroll ->', r)).catch((e) => log('scroll', e.message));
  } catch (e) { log('scroll err', e.message); }
  log('保持连接 120 秒（期间请 GUI 截图）');
  await sleep(120000);
  try { await mp.disconnect(); } catch (e) {}
  log('done');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
