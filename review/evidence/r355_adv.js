// R355 · 补测：矩阵高级维度 + 活动卡负毛利率分支
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

  // ══ A. 矩阵展开高级维度：多毛利率 × 多人数 × 多租金 × 3 目标 ══
  rec('到达矩阵页', await go(mp, '/pages/sandbox/matrix'));
  const a = await mp.evaluate(async () => {
    const p = getCurrentPages().at(-1);
    p.setData({ advOpen: true, dims: { rent: [3000, 5000], labor: [2, 3], margin: [45, 60], target: [0, 10000] } });
    await p.onGenerate();
    const rows = (p.data.result || {}).rows || [];
    const uniq = (fn) => Array.from(new Set(rows.map(fn))).sort((x, y) => x - y);
    return {
      count: rows.length,
      margins: uniq((r) => r.marginPct),
      labors: uniq((r) => r.labor),
      rents: uniq((r) => r.rent),
      targets: uniq((r) => r.targetYuan),
      invalid: rows.filter((r) => r.invalid).length,
      nullBe: rows.filter((r) => r.breakMonthly == null).length,
      insightHas: !!(p.data.result || {}).insight && p.data.result.insight.has,
      laborYuanSet: Array.from(new Set(rows.map((r) => r.laborYuan))).sort(),
    };
  });
  console.log('A:', JSON.stringify(a));
  rec('展开后行数 = 2×2×2×2 = 16', a.count === 16, 'count=' + a.count);
  rec('毛利率两档都出现', a.margins.length === 2, a.margins.join('/'));
  rec('人数两档都出现', a.labors.length === 2, a.labors.join('/'));
  rec('不同人数对应不同人工/月', a.laborYuanSet.length === 2, a.laborYuanSet.join(' / '));
  rec('无失败行', a.invalid === 0 && a.nullBe === 0, 'invalid=' + a.invalid + ' nullBe=' + a.nullBe);
  rec('结论仍正常', a.insightHas === true);

  // ══ B. 活动卡：负毛利率分支 ══
  rec('到达已有店铺页', await go(mp, '/pages/sandbox/index'));
  for (let i = 0; i < 8; i++) { await sleep(1500); if (await mp.evaluate(() => getCurrentPages().at(-1).data.loading) === false) break; }

  const b = await mp.evaluate(async () => {
    const p = getCurrentPages().at(-1);
    const tick = (ms) => new Promise((x) => setTimeout(x, ms || 450));
    p.onArea({ detail: { value: '60' } });
    p.onRent({ detail: { value: '5000' } });
    p.onHeadcount({ detail: { value: '3' } });
    p.onTarget({ detail: { value: '20000' } });
    // 毛利率压到 40%（让价 60% ⇒ 必然超过毛利率）
    p.setData({ marginPct: 40, 'fieldTouched.margin': true });
    await p.onCalc(false);
    await tick(600);
    // 全员参与 + 实收率 40（等于打 4 折）
    p.onPromoW({ currentTarget: { dataset: { idx: 4 } } });
    await tick();
    p.onPromoRealInput({ detail: { value: '40' } });
    await tick(800);
    const q = p.data.promoRes || {};
    return { marginPct: p.data.marginPct, bad: !!q.bad, text: q.text || '', ga: q.gaText || '', tr: q.trafficText || '' };
  });
  console.log('B:', JSON.stringify(b));
  rec('负毛利率 ⇒ 卡片进入 bad 态并说明', b.bad === true && /超过毛利率/.test(b.text), b.text);
  rec('bad 态不再输出保本/客流（不编数）', !b.ga && !b.tr, 'ga=' + b.ga + ' tr=' + b.tr);

  require('fs').writeFileSync(process.argv[3] || 'r355_report.json', JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1); });
