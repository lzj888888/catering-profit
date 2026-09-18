// 8c 取证 · 保持连接 + 执行动作，供并行 GUI 截图
// 用法: node hold_action.js <mode> <holdSec>
//   mode = tap-guide  : reLaunch 录入页 → 点开「填写口径」→ 保持
//   mode = inject-2batches : reLaunch 摊销页 → 注入两笔采购组 → 保持
//   mode = amortize-real   : 仅 reLaunch 摊销页 → 保持
const automator = require('miniprogram-automator');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const mode = process.argv[2];
const holdSec = Number(process.argv[3] || 60);

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  log('connected');
  if (mode === 'tap-guide') {
    await mp.reLaunch('/pages/month/input');
    await sleep(3500);
    const p = await mp.currentPage();
    log('page', p && p.path);
    const heads = await p.$$('.fill-guide-head');
    log('heads', (heads || []).length);
    if (heads && heads.length) { await heads[0].tap(); log('TAPPED 填写口径'); }
  } else if (mode === 'inject-2batches') {
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
    log('SETDATA 两笔采购组已注入（装修 30万/36月 + 追加 8万/24月）');
  } else if (mode === 'amortize-real') {
    await mp.reLaunch('/pages/month/amortize');
    await sleep(3500);
    const p = await mp.currentPage();
    log('page', p && p.path);
  } else { log('未知 mode'); process.exit(1); }
  log('保持连接', holdSec, '秒（期间请 GUI 截图）');
  await sleep(holdSec * 1000);
  try { await mp.disconnect(); } catch (e) {}
  log('done');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
