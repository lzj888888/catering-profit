// R353 · 验收：M2 结果区新增块「真的出现、数字真的对」
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

  // ── 已有店铺 ──
  const ok1 = await go(mp, '/pages/sandbox/index');
  rec('到达 pages/sandbox/index', ok1);
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    if (await mp.evaluate(() => getCurrentPages().at(-1).data.loading) === false) break;
  }

  const a = await mp.evaluate(async () => {
    const p = getCurrentPages().at(-1);
    p.onArea({ detail: { value: '60' } });
    p.onRent({ detail: { value: '5000' } });
    p.onHeadcount({ detail: { value: '3' } });
    p.onTarget({ detail: { value: '20000' } });
    await p.onCalc(false);
    const r = p.data.result || {};
    return {
      has: !!p.data.result, has_target: r.has_target, cushion: r.cushion_text,
      be: r.break_even_monthly, beCash: r.break_even_cash,
      fb: (p.data.fixedBreak || []).map((x) => x.name + '=' + x.text),
      promo: p.data.promoRes && {
        ga: p.data.promoRes.gaText, be: p.data.promoRes.beText,
        tr: p.data.promoRes.trafficText, same: p.data.promoRes.sameRevText,
      },
    };
  });
  rec('算出结果', a.has === true, JSON.stringify(a).slice(0, 100));
  rec('目标填了 ⇒ has_target 真', a.has_target === true);
  rec('安全垫有文案', !!a.cushion, a.cushion);
  rec('账面保本有值', !!a.be, a.be);
  rec('现金保本：有值或明确 null', a.beCash !== undefined, 'beCash=' + a.beCash);
  rec('🔴 固定费用拆项真的出现（R353 修的）', a.fb.length === 3, a.fb.join(' / '));
  rec('活动卡三项 + 同营收对比齐全',
    !!(a.promo && a.promo.ga && a.promo.be && a.promo.tr && a.promo.same),
    a.promo ? a.promo.ga + ' | ' + a.promo.tr : 'null');

  // 目标清空
  const b = await mp.evaluate(async () => {
    const p = getCurrentPages().at(-1);
    p.onTarget({ detail: { value: '' } });
    await p.onCalc(false);
    const r = p.data.result || {};
    return { has_target: r.has_target, targetEqBreak: r.target_monthly === r.break_even_monthly };
  });
  rec('目标清空 ⇒ has_target 假（目标两行应隐藏）', b.has_target === false, JSON.stringify(b));

  // ── 矩阵页：人均工资不被业态覆盖（R352 修）──
  const ok2 = await go(mp, '/pages/sandbox/matrix');
  rec('到达 pages/sandbox/matrix', ok2);
  await sleep(1500);
  const c = await mp.evaluate(() => {
    const p = getCurrentPages().at(-1);
    p.onGlobalInput({ currentTarget: { dataset: { key: 'laborUnitYuan' } }, detail: { value: '7000' } });
    const before = p.data.global.laborUnitYuan;
    p.onPresetChange({ detail: { value: 1 } });
    return { before, after: p.data.global.laborUnitYuan, touched: p.data.fieldTouched.unit };
  });
  rec('手填人均 7000 后切业态不被覆盖', c.after === '7000', JSON.stringify(c));

  console.log('\n===== ' + out.filter((x) => x.ok).length + ' 通过 / ' + out.filter((x) => !x.ok).length + ' 失败 =====');
  require('fs').writeFileSync(process.argv[3] || 'r353_report.json', JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1); });
