// R354 · 活动卡逐档点测（含越界输入必须明说，不许静默回落）
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
  rec('到达已有店铺页', await go(mp, '/pages/sandbox/index'));
  for (let i = 0; i < 8; i++) { await sleep(1500); if (await mp.evaluate(() => getCurrentPages().at(-1).data.loading) === false) break; }

  const r = await mp.evaluate(async () => {
    const p = getCurrentPages().at(-1);
    p.onArea({ detail: { value: '60' } });
    p.onRent({ detail: { value: '5000' } });
    p.onHeadcount({ detail: { value: '3' } });
    p.onTarget({ detail: { value: '20000' } });
    await p.onCalc(false);

    const tick = () => new Promise((r) => setTimeout(r, 450));
    const snap = () => {
      const q = p.data.promoRes || {};
      return { bad: !!q.bad, ga: q.gaText || '', be: q.beText || '', tr: q.trafficText || '',
        same: q.sameRevText || '', text: q.text || '' };
    };
    const chips = [];
    for (let i = 0; i < 4; i++) {
      p.onPromoD({ currentTarget: { dataset: { idx: i } } });
      await tick();
      chips.push(snap());
    }
    // 参与率：3 成 → 全部
    p.onPromoW({ currentTarget: { dataset: { idx: 1 } } });
    await tick();
    const w1 = snap();
    p.onPromoW({ currentTarget: { dataset: { idx: 4 } } });
    await tick();
    const w4 = snap();
    // 越界实收率
    p.onPromoRealInput({ detail: { value: '150' } });
    await tick();
    const over = snap();
    p.onPromoRealInput({ detail: { value: '0' } });
    await tick();
    const zero = snap();
    p.onPromoRealInput({ detail: { value: '85' } });
    await tick();
    const ok85 = snap();
    p.onPromoRealInput({ detail: { value: '' } });
    await tick();
    const cleared = snap();
    return { chips, w1, w4, over, zero, ok85, cleared };
  });

  console.log(JSON.stringify(r, null, 2));

  const allFull = r.chips.every((c) => !c.bad && c.ga && c.be && c.tr && c.same);
  rec('四个折扣档都出齐四项文案（含同营收对比）', allFull,
    r.chips.map((c) => c.ga + '/' + c.tr).join(' | '));
  rec('折扣越狠，打平所需客流越大', (function () {
    const nums = r.chips.map((c) => parseFloat(c.tr) || 0);
    for (let i = 1; i < nums.length; i++) if (!(nums[i] >= nums[i - 1])) return false;
    return true;
  })(), r.chips.map((c) => c.tr).join(' < '));
  rec('参与率 3成 → 全部，打平客流明显变大',
    (parseFloat(r.w4.tr) || 0) > (parseFloat(r.w1.tr) || 0), r.w1.tr + ' → ' + r.w4.tr);
  rec('🔴 实收率 150 必须明说（不许静默回落）', r.over.bad === true && /1-100/.test(r.over.text), r.over.text);
  rec('🔴 实收率 0 必须明说', r.zero.bad === true && /1-100/.test(r.zero.text), r.zero.text);
  rec('实收率 85 正常出数', r.ok85.bad === false && !!r.ok85.ga, r.ok85.ga + ' | ' + r.ok85.tr);
  rec('清空实收率 ⇒ 回到折扣档', r.cleared.bad === false && !!r.cleared.tr, r.cleared.tr);

  require('fs').writeFileSync(process.argv[3] || 'r354_promo.json', JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1); });
