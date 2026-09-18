// 8c 核验 · 触发即断开（automator 写操作后立即 disconnect，改由真实窗口截图取证）
// 背景：本机 IDE 自动化通道在 tap/setData 之后的下一次调用必超时（read 操作则稳定）
// 用法：node inject_probe.js <mode>   mode = tap-guide | inject-amortize
const automator = require('miniprogram-automator');
const WS = 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const mode = process.argv[2];

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  if (mode === 'tap-guide') {
    await mp.reLaunch('/pages/month/input');
    await sleep(3500);
    const p = await mp.currentPage();
    log('page', p && p.path);
    const heads = await p.$$('.fill-guide-head');
    log('heads', (heads || []).length);
    if (heads && heads.length) { await heads[0].tap(); log('TAPPED 填写口径'); }
    await sleep(600);
  } else if (mode === 'inject-amortize') {
    await mp.reLaunch('/pages/month/amortize');
    await sleep(3500);
    const p = await mp.currentPage();
    log('page', p && p.path);
    // 先注入「两笔采购」的组，验证分组渲染路径
    await p.setData({
      loading: false,
      totalYuan: '116.68',
      groups: [{
        key: 'amort_x', name: '装修', count: 2, valueFen: 38000000, monthFen: 11668,
        valueYuan: '380000.00', monthYuan: '116.68', multi: true, expanded: true,
        batches: [
          { asset_id: 'a1', name: '装修', value: '300000.00', value_fen: 30000000, start_month: '2026-01', total_months: 36, terminate_month: '', group_id: '', batch_seq: 1, amount_fen: 8334, amountYuan: '83.34' },
          { asset_id: 'a2', name: '装修', value: '80000.00', value_fen: 8000000, start_month: '2026-07', total_months: 24, terminate_month: '', group_id: 'amort_x', batch_seq: 2, amount_fen: 3334, amountYuan: '33.34' },
        ],
      }],
    });
    log('SETDATA 两笔采购组已注入');
    await sleep(600);
  } else {
    log('未知 mode'); process.exit(1);
  }
  try { await mp.disconnect(); log('disconnected（页面保留在模拟器上）'); } catch (e) { log('disconnect err', e.message); }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
