// R568c · 带钩子走完整保存链（抓真实云调用返回）
const a = require('miniprogram-automator');
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mp;
async function ev(fn, arg, tries) {
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return await mp.evaluate(fn, arg); } catch (e) { if (i === n - 1) throw e; await sleep(1500); }
  }
}
const route = async () => { try { return await ev(() => { const s = getCurrentPages(); return s.length ? s[s.length - 1].route : ''; }, null, 2); } catch (e) { return ''; } };
async function waitRoute(x, n, g) { for (let i = 0; i < (n || 20); i++) { if ((await route()) === x) return true; await sleep(g || 1000); } return false; }

(async () => {
  mp = await a.connect({ wsEndpoint: WS });
  console.log('ROUTE0 ' + JSON.stringify(await route()));
  // 栈为空 ⇒ 先回首页把 appservice 拉起来，再直接进列表页
  if (!(await route())) {
    try { await ev(() => { wx.reLaunch({ url: '/pages/index/index', fail: () => {} }); return 1; }); } catch (e) { console.log('RELAUNCH_ERR ' + e.message); }
    await sleep(6000);
    console.log('ROUTE1 ' + JSON.stringify(await route()));
  }
  if ((await route()) !== 'subpkg/biz/card/index') { try { await mp.navigateTo('/subpkg/biz/card/index'); } catch (e) { console.log('NAV_ERR ' + e.message); } }
  console.log('AT_LIST ' + await waitRoute('subpkg/biz/card/index', 25, 1000) + ' route=' + JSON.stringify(await route()));

  // 等列表 + shop
  for (let i = 0; i < 15; i++) {
    const ok = await ev(() => { const app = getApp(); return !!(app && app.globalData && app.globalData.shop_id); }).catch(() => false);
    if (ok) break; await sleep(1200);
  }

  const p1 = await mp.currentPage();
  const add = await p1.$('.top-add');
  console.log('ADD_BTN ' + !!add);
  await add.tap();
  console.log('AT_EDIT ' + await waitRoute('subpkg/biz/card/edit', 25, 1000));

  const DISH = '走查临时菜' + String(Date.now()).slice(-4);
  const r1 = await ev((d) => {
    const p = getCurrentPages().slice(-1)[0];
    p.onName({ detail: { value: d.name } });
    p.onPrice({ detail: { value: '20' } });
    p.onPickCategory({ detail: { value: 0 } });
    const ls = p.data.lines;
    for (let i = 0; i < ls.length; i++) {
      const nm = ls[i].material_name || '';
      if (nm === '猪肉') p.onManualPrice({ currentTarget: { dataset: { idx: i } }, detail: { value: '0.012' } });
      if (nm === '青椒') p.onManualPrice({ currentTarget: { dataset: { idx: i } }, detail: { value: '0.008' } });
    }
    return { name: p.data.name, price: p.data.priceYuan, hasPreset: !!p.data.hasPreset,
      amountErr: p.data.amountErr || '', badCount: p.data.badAmountCount,
      lines: p.data.lines.map((l) => l.material_name + '|' + l.unit_price_yuan + '|' + l.qty + '|' + l.qty_unit + '|' + l.yield_rate + '|t' + l.input_type) };
  }, { name: DISH });
  console.log('FILLED ' + JSON.stringify(r1));

  // 装钩子
  await ev(() => {
    const w = wx; const g = (w.__diag = { calls: [], toasts: [], modals: [] });
    if (!w.__hooked) {
      w.__hooked = 1;
      const oc = w.cloud.callFunction.bind(w.cloud);
      w.cloud.callFunction = function (o) {
        const rec = { name: o && o.name, req: o && o.data ? JSON.stringify(o.data).slice(0, 500) : '' };
        g.calls.push(rec);
        return oc(o).then((r) => { rec.result = JSON.stringify(r && r.result).slice(0, 500); return r; },
          (e) => { rec.err = (e && (e.errMsg || e.message)) || String(e); throw e; });
      };
      const ot = w.showToast.bind(w); w.showToast = function (o) { g.toasts.push(o && o.title); return ot(o); };
      const om = w.showModal.bind(w); w.showModal = function (o) { g.modals.push(((o && o.title) || '') + ' | ' + ((o && o.content) || '')); return om(o); };
    }
    return 1;
  });

  // 调 onSave（不加 await 包裹，避免 evaluate 长时间挂）
  await ev(() => { const p = getCurrentPages().slice(-1)[0]; p.onSave(); return 1; });
  await sleep(9000);

  const out = await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    return { route: p.route, savedName: p.data.savedName || '', saving: !!p.data.saving, isEdit: !!p.data.isEdit,
      calls: wx.__diag.calls, toasts: wx.__diag.toasts, modals: wx.__diag.modals };
  });
  console.log('ROUTE_AFTER ' + out.route + ' savedName=' + JSON.stringify(out.savedName) + ' saving=' + out.saving);
  console.log('CALLS ' + JSON.stringify(out.calls, null, 1));
  console.log('TOASTS ' + JSON.stringify(out.toasts));
  console.log('MODALS ' + JSON.stringify(out.modals));
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('FATAL ' + (e && e.stack)); process.exit(1); });
