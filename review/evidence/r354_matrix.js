// R354 · 矩阵页生成验收（含「无可行组合」修复）
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
  const ok = await go(mp, '/pages/sandbox/matrix');
  rec('到达矩阵页', ok);

  const r = await mp.evaluate(async () => {
    const p = getCurrentPages().at(-1);
    await p.onGenerate();
    const res = p.data.result || {};
    const rows = res.rows || [];
    const sample = rows.slice(0, 3).map((x) => ({
      rent: x.rent, labor: x.labor, laborYuan: x.laborYuan, margin: x.marginPct,
      be: x.breakMonthly, beCash: x.beCashMonthly, invalid: !!x.invalid, red: !!x.red,
    }));
    return {
      count: rows.length,
      insight: res.insight,
      rejected: (res.rejected || []).length,
      advOpen: p.data.advOpen,
      fixedBreakLen: (p.data.fixedBreak || []).length,
      sample,
      hasNullBe: rows.filter((x) => x.breakMonthly == null).length,
      hasInvalid: rows.filter((x) => x.invalid).length,
      laborYuanNull: rows.filter((x) => x.laborYuan == null).length,
    };
  });
  console.log(JSON.stringify(r, null, 2));

  rec('生成了行', r.count > 0, 'count=' + r.count);
  rec('🔴 有可行行时结论必须出（不再「无可行组合」）', r.insight && r.insight.has === true,
    r.insight ? ('has=' + r.insight.has + ' | ' + (r.insight.bestText || '')) : 'null');
  rec('结论带房租杠杆', !!(r.insight && r.insight.leverText), r.insight && r.insight.leverText);
  rec('人工/月 列有值（不因人数无效而为空）', r.laborYuanNull === 0, 'null=' + r.laborYuanNull);
  rec('固定费用构成已出现', r.fixedBreakLen > 0, 'n=' + r.fixedBreakLen);
  rec('无解析失败（rejected=0）', r.rejected === 0, 'rejected=' + r.rejected);

  require('fs').writeFileSync(process.argv[3] || 'r354_matrix.json', JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1); });
