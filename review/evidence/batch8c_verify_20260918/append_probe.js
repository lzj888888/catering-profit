// 摊销页：注入两笔组 → 调用 onAppend（追加采购）→ 保持连接供 GUI 截图
const automator = require('miniprogram-automator');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const race = (p, ms, tag) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout ' + tag)), ms))]);
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
  await sleep(1000);
  try {
    const r = await race(p.callMethod('onAppend', { currentTarget: { dataset: { group: 'amort_x' } } }), 12000, 'onAppend');
    log('callMethod onAppend ->', JSON.stringify(r).slice(0, 120));
  } catch (e) { log('onAppend', e.message, '（动作可能已执行）'); }
  await sleep(800);
  try {
    const st = await race(mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; return { path: pg.route, showForm: pg.data.showForm, appendGroup: pg.data.appendGroup, appendSeq: pg.data.appendSeq, formName: pg.data.formName }; }), 12000, 'state');
    log('STATE', JSON.stringify(st));
  } catch (e) { log('state 读取失败', e.message); }
  log('保持连接 100 秒（期间请 GUI 截图）');
  await sleep(100000);
  try { await mp.disconnect(); } catch (e) {}
  log('done');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
