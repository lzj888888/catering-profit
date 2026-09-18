// R81 真云复验：页面上下文调 saveCostCard / calcBom，验证 mode 白名单在**真云**生效
// 判据：mode='b' / 2 / 'C' / '' ⇒ INVALID_PARAM（不得静默当 A 返回 SUCCESS）
//       反向：mode='A' 必须 SUCCESS（证明不是"一律拒绝"）
const automator = require('miniprogram-automator');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const race = (p, ms, tag) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout ' + tag)), ms))]);
const OUT = process.env.OUT || 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r81_probe_result.json';

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  log('connected');
  await mp.reLaunch('/pages/card/index');
  await sleep(4000);
  const p = await mp.currentPage();
  log('page', p && p.path);

  const out = await race(mp.evaluate(async () => {
    const app = getApp();
    let shopId = (app && app.globalData && app.globalData.shop_id) || '';
    const rec = { shop_id: shopId, steps: [] };
    const call = async (name, data) => {
      try {
        const res = await wx.cloud.callFunction({ name, data });
        return { name, raw: res && res.result };
      } catch (e) { return { name, err: (e && e.errMsg) || String(e) }; }
    };
    if (!shopId) {
      const c = await call('getShopContext', {});
      const d = (c.raw && c.raw.data) || {};
      shopId = d.shop_id || (d.shop && d.shop.shop_id) || '';
      if (shopId && app && app.globalData) app.globalData.shop_id = shopId;
      rec.shop_id = shopId;
      rec.steps.push({ step: 'getShopContext', code: c.raw && c.raw.code });
    }
    // 取一个真实存在的原料（saveCostCard 严格校验原料存在）
    const m = await call('getMaterial', { shop_id: shopId });
    const list = (m.raw && m.raw.data && m.raw.data.list) || [];
    rec.materialCount = list.length;
    const matId = list.length ? (list[0].id || list[0].material_id) : '';
    rec.materialId = matId;
    if (!matId) return rec;

    const card = (mode) => ({
      shop_id: shopId,
      card: {
        name: 'R81白名单验证',
        mode,
        lines: [{ material_id: matId, qty: 100 }],
        loss_pct: 0, auxYuan: 0, priceYuan: 0,
        ...(mode === 'B' ? { batch_output: 10 } : {}),
      },
      client_request_id: 'r81_' + String(mode) + '_' + Date.now(),
    });
    for (const mode of ['b', 2, 'C', '', 'A']) {
      const r = await call('saveCostCard', card(mode));
      rec.steps.push({ fn: 'saveCostCard', mode, code: r.raw && r.raw.code, msg: r.raw && r.raw.msg, err: r.err });
    }
    // calcBom（预览路径）同样验证
    for (const mode of ['b', 'A']) {
      const r = await call('calcBom', {
        shop_id: shopId,
        lines: [{ quantity: 100, net_unit_cost: 333 }],
        mode,
      });
      rec.steps.push({ fn: 'calcBom', mode, code: r.raw && r.raw.code, msg: r.raw && r.raw.msg, err: r.err });
    }
    return rec;
  }), 60000, 'evaluate');

  log('RESULT ' + JSON.stringify(out).slice(0, 2000));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  log('written -> ' + OUT);
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', typeof e === 'object' ? JSON.stringify(e) : e); process.exit(2); });
