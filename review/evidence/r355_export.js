// R355 · 导出与页面一致性：拦 exportData 请求，比对表头/行数/0 值
const automator = require('miniprogram-automator');
const ws = process.argv[2] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? '✅ ' : '❌ ') + n + (d ? '  [' + d + ']' : '')); };

async function go(mp, url) {
  for (let k = 0; k < 3; k++) {
    await mp.evaluate((u) => { wx.reLaunch({ url: u, fail: () => {} }); return 1; }, url);
    await sleep(2500);
    const r = await mp.evaluate(() => { const p = getCurrentPages().at(-1); return p && p.route; });
    if (r === url.replace(/^\//, '')) return true;
  }
  return false;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: ws });
  rec('到达矩阵页', await go(mp, '/pages/sandbox/matrix'));

  const r = await mp.evaluate(async () => {
    const p = getCurrentPages().at(-1);
    const tick = (ms) => new Promise((x) => setTimeout(x, ms || 400));
    p.setData({ dims: { rent: [3000, 5000], labor: [2, 3], margin: [45], target: [0, 10000] } });
    await p.onGenerate();
    await tick(500);

    const orig = wx.cloud.callFunction;
    let cap = null;
    wx.cloud.callFunction = async function (opt) {
      if (opt && opt.name === 'exportData') { cap = opt.data; return { result: { code: 'PROBE_STOP' } }; }
      return orig.call(wx.cloud, opt);
    };
    try { await p.onExport(); } catch (e) { /* 假失败会被 onExport 的 catch 吃掉 */ }
    await tick(300);
    wx.cloud.callFunction = orig;

    const rows = (p.data.result || {}).rows || [];
    const table = (cap && cap.table) || null;
    const zeroTarget = rows.filter((x) => x.targetYuan === 0);
    const exportedZero = table && zeroTarget.length ? table.rows[rows.indexOf(zeroTarget[0])] : null;
    return {
      captured: !!cap,
      exportType: cap && cap.export_type,
      headerLen: table ? table.header.length : null,
      rowCount: table ? table.rows.length : null,
      pageRowCount: rows.length,
      colLens: table ? Array.from(new Set(table.rows.map((x) => x.length))) : null,
      zeroTargetIdx: zeroTarget.length ? rows.indexOf(zeroTarget[0]) : -1,
      exportedZeroRow: exportedZero,
      exportHasDashInRent: table ? table.rows.filter((x) => x[0] === '—').length : null,
    };
  });
  console.log(JSON.stringify(r, null, 2));

  rec('拦截到导出请求', r.captured === true, 'type=' + r.exportType);
  rec('导出类型正确', r.exportType === 'm2_matrix', r.exportType);
  rec('导出列数 = 14（与页面表头一致）', r.headerLen === 14, 'header=' + r.headerLen);
  rec('导出行数 = 页面行数', r.rowCount === r.pageRowCount, r.rowCount + ' vs ' + r.pageRowCount);
  rec('每行列数都等于表头', r.colLens && r.colLens.length === 1 && r.colLens[0] === r.headerLen, String(r.colLens));
  rec('目标利润=0 的行导出仍是 0（不是「—」）',
    !!(r.exportedZeroRow && r.exportedZeroRow[4] === 0), JSON.stringify(r.exportedZeroRow));
  rec('房租列没有把数字导成「—」', r.exportHasDashInRent === 0, 'dash=' + r.exportHasDashInRent);

  require('fs').writeFileSync(process.argv[3] || 'r355_export.json', JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1); });
