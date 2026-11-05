// 分步取证：每步之后回读页面 data，定位是哪一步没生效
const a = require('miniprogram-automator');
const fs = require('fs');
const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mp;
async function ev(fn, arg, tries) { const n = tries || 3; for (let i = 0; i < n; i++) { try { return await mp.evaluate(fn, arg); } catch (e) { if (i === n - 1) throw e; await sleep(1500); } } }
const route = async () => { try { return await ev(() => { const s = getCurrentPages(); return s.length ? s[s.length - 1].route : ''; }, null, 2); } catch (e) { return ''; } };
async function waitRoute(x, n, g) { for (let i = 0; i < (n || 20); i++) { if ((await route()) === x) return true; await sleep(g || 1000); } return false; }
const snap = () => ev(() => { const p = getCurrentPages().slice(-1)[0]; return { route: p.route, loading: !!p.data.loading,
  name: p.data.name, price: p.data.priceYuan, cat: p.data.catLabel, loadMissing: !!p.data.loadMissing,
  lines: (p.data.lines || []).map((l) => (l.material_name || '') + '|' + (l.unit_price_yuan || '') + '|' + l.qty + '|t' + l.input_type) }; });

(async () => {
  mp = await a.connect({ wsEndpoint: WS });
  if (!(await route())) { try { await ev(() => { wx.reLaunch({ url: '/pages/index/index', fail: () => {} }); return 1; }); } catch (e) {} await sleep(5000); }
  if ((await route()) !== 'subpkg/biz/card/index') { try { await mp.navigateTo('/subpkg/biz/card/index'); } catch (e) {} }
  console.log('AT_LIST ' + await waitRoute('subpkg/biz/card/index', 25, 1000));
  const add = await (await mp.currentPage()).$('.top-add');
  await add.tap();
  console.log('AT_EDIT ' + await waitRoute('subpkg/biz/card/edit', 25, 1000));

  let s = null;
  for (let i = 0; i < 20; i++) { await sleep(1000); s = await snap().catch(() => null); if (s && !s.loading) break; }
  console.log('S1_LOADED ' + JSON.stringify(s));

  const DISH = '走查截图菜' + String(Date.now()).slice(-4);
  await ev((d) => { const p = getCurrentPages().slice(-1)[0]; p.onName({ detail: { value: d } }); p.onPrice({ detail: { value: '38' } }); return 1; }, DISH);
  await sleep(600);
  console.log('S2_NAME_PRICE ' + JSON.stringify(await snap()));

  await ev(() => { const p = getCurrentPages().slice(-1)[0]; p.onPickCategory({ detail: { value: 0 } }); return 1; });
  await sleep(1200);
  console.log('S3_CAT ' + JSON.stringify(await snap()));

  await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    const ls = p.data.lines;
    for (let i = 0; i < ls.length; i++) {
      const nm = ls[i].material_name || '';
      if (nm === '猪肉') p.onManualPrice({ currentTarget: { dataset: { idx: i } }, detail: { value: '0.012' } });
      if (nm === '青椒') p.onManualPrice({ currentTarget: { dataset: { idx: i } }, detail: { value: '0.008' } });
    }
    return 1;
  });
  await sleep(1000);
  console.log('S4_PRICES ' + JSON.stringify(await snap()));

  const sb = await (await mp.currentPage()).$('.sa-btn');
  console.log('S5_SAVE_BTN ' + !!sb);
  let saved = '';
  if (sb) {
    await sb.tap();
    for (let i = 0; i < 15; i++) { await sleep(1000); saved = await ev(() => getCurrentPages().slice(-1)[0].data.savedName || '').catch(() => ''); if (saved) break; }
  }
  if (!saved) {
    console.log('S6_TAP_NO_EFFECT');
    await ev(() => { getCurrentPages().slice(-1)[0].onSave(); return 1; });
    for (let i = 0; i < 18; i++) { await sleep(1200); saved = await ev(() => getCurrentPages().slice(-1)[0].data.savedName || '').catch(() => ''); if (saved) break; }
  }
  console.log('S7_SAVED ' + JSON.stringify(saved));
  fs.writeFileSync(OUT + '/_created.json', JSON.stringify({ name: DISH, saved }));
  try { await mp.disconnect(); } catch (e) {}
  process.exit(saved ? 0 : 1);
})().catch((e) => { console.log('FATAL ' + (e && e.stack)); process.exit(9); });
