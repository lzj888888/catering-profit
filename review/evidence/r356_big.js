// R356 · 大样本：144 / 288 行 生成 + 导出请求体
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

async function run(mp, dims) {
  return mp.evaluate(async (d) => {
    const p = getCurrentPages().at(-1);
    const tick = (ms) => new Promise((x) => setTimeout(x, ms || 300));
    p.setData({ advOpen: true, dims: d });
    const t0 = Date.now();
    await p.onGenerate();
    const genMs = Date.now() - t0;
    await tick(300);
    const rows = (p.data.result || {}).rows || [];

    const orig = wx.cloud.callFunction;
    let cap = null;
    wx.cloud.callFunction = async function (opt) {
      if (opt && opt.name === 'exportData') { cap = opt.data; return { result: { code: 'PROBE_STOP' } }; }
      return orig.call(wx.cloud, opt);
    };
    try { await p.onExport(); } catch (e) {}
    await tick(200);
    wx.cloud.callFunction = orig;

    const table = (cap && cap.table) || null;
    return {
      rows: rows.length,
      genMs,
      header: table ? table.header.length : null,
      exported: table ? table.rows.length : null,
      colLens: table ? Array.from(new Set(table.rows.map((x) => x.length))) : null,
      bytes: table ? encodeURIComponent(JSON.stringify(cap)).replace(/%[0-9A-F]{2}/g, 'x').length : 0,
      invalid: rows.filter((r) => r.invalid).length,
    };
  }, dims);
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: ws });
  rec('到达矩阵页', await go(mp, '/pages/sandbox/matrix'));

  const D1 = { rent: [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000], labor: [2, 3], margin: [45, 55, 65], target: [0, 10000, 15000] };
  const a = await run(mp, D1);
  console.log('144:', JSON.stringify(a));
  rec('144 行：生成行数正确', a.rows === 144, 'rows=' + a.rows);
  rec('144 行：导出行数 = 页面行数', a.exported === a.rows, a.exported + ' vs ' + a.rows);
  rec('144 行：每行列数 14', a.colLens && a.colLens.length === 1 && a.colLens[0] === 14, String(a.colLens));
  rec('144 行：请求体 < 1MB', a.bytes < 1024 * 1024, (a.bytes / 1024).toFixed(1) + ' KB');
  rec('144 行：无失败行', a.invalid === 0, 'invalid=' + a.invalid);

  const D2 = { rent: [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000], labor: [2, 3, 4], margin: [40, 50, 60], target: [0, 10000, 15000, 20000] };
  const b = await run(mp, D2);
  console.log('288:', JSON.stringify(b));
  rec('288 行：生成行数正确', b.rows === 288, 'rows=' + b.rows);
  rec('288 行：导出行数 = 页面行数', b.exported === b.rows, b.exported + ' vs ' + b.rows);
  rec('288 行：请求体 < 1MB', b.bytes < 1024 * 1024, (b.bytes / 1024).toFixed(1) + ' KB');
  rec('288 行：生成耗时 < 30s', b.genMs < 30000, b.genMs + ' ms');

  require('fs').writeFileSync(process.argv[3] || 'r356_big.json', JSON.stringify({ out, a, b }, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1); });
