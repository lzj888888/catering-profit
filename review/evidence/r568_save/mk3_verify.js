// R568 修复验证：新建→选品类必须带出示例主料；未补价保存必须被拦；补价后保存→列表成本/毛利正确；清理
const a = require('miniprogram-automator');
const fs = require('fs');
const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function chk(id, pass, expect, actual) { checks.push({ id, pass: !!pass, expect, actual: actual === undefined ? '' : actual }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' | ' + expect + ' | ' + String(actual === undefined ? '' : actual).slice(0, 200)); }
let mp;
async function ev(fn, arg, tries) { const n = tries || 3; for (let i = 0; i < n; i++) { try { return await mp.evaluate(fn, arg); } catch (e) { if (i === n - 1) throw e; await sleep(1500); } } }
const route = async () => { try { return await ev(() => { const s = getCurrentPages(); return s.length ? s[s.length - 1].route : ''; }, null, 2); } catch (e) { return ''; } };
async function waitRoute(x, n, g) { for (let i = 0; i < (n || 20); i++) { if ((await route()) === x) return true; await sleep(g || 1000); } return false; }
const snap = () => ev(() => { const p = getCurrentPages().slice(-1)[0]; return { loading: !!p.data.loading, name: p.data.name, price: p.data.priceYuan, cat: p.data.catLabel,
  lines: (p.data.lines || []).map((l) => (l.material_name || '·') + '|' + (l.unit_price_yuan || '') + '|' + (l.qty || '') + '|t' + l.input_type) }; });

(async () => {
  mp = await a.connect({ wsEndpoint: WS });
  if (!(await route())) { try { await ev(() => { wx.reLaunch({ url: '/pages/index/index', fail: () => {} }); return 1; }); } catch (e) {} await sleep(5000); }
  if ((await route()) !== 'subpkg/biz/card/index') { try { await mp.navigateTo('/subpkg/biz/card/index'); } catch (e) {} }
  chk('A1_LIST', await waitRoute('subpkg/biz/card/index', 25, 1000), '在列表页', await route());

  await (await mp.currentPage()).$('.top-add').then((b) => b.tap());
  chk('A2_EDIT', await waitRoute('subpkg/biz/card/edit', 25, 1000), '进入新建编辑页', await route());
  for (let i = 0; i < 20; i++) { const s = await snap().catch(() => null); if (s && !s.loading) break; await sleep(1000); }

  const DISH = '走查修复验证' + String(Date.now()).slice(-4);
  await ev((d) => { const p = getCurrentPages().slice(-1)[0]; p.onName({ detail: { value: d } }); p.onPrice({ detail: { value: '38' } }); p.onPickCategory({ detail: { value: 0 } }); return 1; }, DISH);
  await sleep(1200);
  const s3 = await snap();
  console.log('AFTER_PICK ' + JSON.stringify(s3));
  chk('B1_SAMPLE_LINES', s3.lines.length === 3, '选「热炒荤菜」应带出 3 行（调料+猪肉+青椒）', s3.lines.length + ' 行: ' + JSON.stringify(s3.lines));
  chk('B2_NO_BLANK', !s3.lines.some((x) => x.indexOf('·|') === 0), '不再残留出厂空行', JSON.stringify(s3.lines));
  chk('B3_HAS_PORK', s3.lines.some((x) => x.indexOf('猪肉') === 0) && s3.lines.some((x) => x.indexOf('青椒') === 0), '示例主料 猪肉/青椒 都在', JSON.stringify(s3.lines));

  // 未补价保存 ⇒ 必须被「单价」拦住（fail-closed，绝不落一张只有调料的卡）
  await ev(() => { const w = wx; if (!w.__t) { w.__t = { toasts: [] }; const o = w.showToast.bind(w); w.showToast = function (x) { w.__t.toasts.push(x && x.title); return o(x); }; } return 1; });
  await ev(() => { getCurrentPages().slice(-1)[0].onSave(); return 1; });
  await sleep(4000);
  const r1 = await ev(() => ({ saved: getCurrentPages().slice(-1)[0].data.savedName || '', toasts: (wx.__t && wx.__t.toasts) || [] }));
  chk('C1_BLOCKED', !r1.saved && r1.toasts.indexOf('单价') >= 0, '示例主料未补价 ⇒ 保存被「单价」拦住', JSON.stringify(r1));

  // 补价后保存
  await ev(() => {
    const p = getCurrentPages().slice(-1)[0]; const ls = p.data.lines;
    for (let i = 0; i < ls.length; i++) {
      const nm = ls[i].material_name || '';
      if (nm === '猪肉') p.onManualPrice({ currentTarget: { dataset: { idx: i } }, detail: { value: '0.012' } });
      if (nm === '青椒') p.onManualPrice({ currentTarget: { dataset: { idx: i } }, detail: { value: '0.008' } });
    } return 1;
  });
  await sleep(1500);
  let saved = '';
  const sb = await (await mp.currentPage()).$('.sa-btn');
  if (sb) await sb.tap();
  for (let i = 0; i < 20; i++) { await sleep(1000); saved = await ev(() => getCurrentPages().slice(-1)[0].data.savedName || '').catch(() => ''); if (saved) break; }
  chk('D1_SAVED', saved === DISH, '补价后保存成功', JSON.stringify(saved));

  // 回列表核对成本/毛利
  for (let i = 0; i < 6; i++) { if ((await route()) === 'subpkg/biz/card/index') break; try { await ev(() => { wx.navigateBack({ delta: 1 }); return 1; }); } catch (e) {} await sleep(1500); }
  await sleep(3000);
  let row = null;
  for (let i = 0; i < 12; i++) {
    const l = await ev(() => { const p = getCurrentPages().slice(-1)[0]; return { route: p.route, rows: ((p.data && p.data.list) || []).map((x) => ({ code: x.card_code, name: x.name, gm: x.margin, cost: x.total_cost, price: x.price_fen })) }; }).catch(() => null);
    if (l && l.route === 'subpkg/biz/card/index') { row = l.rows.filter((x) => x.name === DISH)[0]; if (row) break; }
    await sleep(1500);
  }
  chk('E1_ROW', !!row, '列表出现新卡', row && JSON.stringify(row));
  if (row) {
    // 期望成本 ≈ (150*0.012/0.85 + 100*0.008/0.85 + 0.5) * 1.02 ≈ 3.63 元
    chk('E2_COST', Math.abs(Number(row.cost) - 3.63) < 0.15, '成本 ≈ 3.63 元（示例主料真的进了卡）', row.cost);
    chk('E3_GM', Math.abs(Number(row.gm) - 90.44) < 1.5, '毛利率回落到 ~90%（不再是 98.66% 的假数）', row.gm);
  }
  // 清理
  if (row) {
    const del = await ev((cc) => wx.cloud.callFunction({ name: 'saveCostCard', data: { shop_id: getApp().globalData.shop_id, card: { _delete: true, card_code: cc }, client_request_id: 'ccd_' + Date.now() } }).then((x) => JSON.stringify(x.result && x.result.data)).catch((e) => 'ERR ' + (e.errMsg || e.message)), row.code);
    chk('F1_CLEAN', /"deleted":true/.test(del), '测试卡已删除', del);
  }

  const pass = checks.filter((c) => c.pass).length;
  console.log('\nSUMMARY ' + pass + '/' + checks.length);
  fs.writeFileSync(OUT + '/report_fix.json', JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  try { await mp.disconnect(); } catch (e) {}
  process.exit(pass === checks.length ? 0 : 1);
})().catch((e) => { console.log('FATAL ' + (e && e.stack)); process.exit(9); });
