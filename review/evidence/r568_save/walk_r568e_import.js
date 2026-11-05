// R568e · 全链：列表→导入页(粘贴解析+选品类)→去补价→编辑页补价→保存→回列表核对→清理
const a = require('miniprogram-automator');
const fs = require('fs');
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const OUT = process.argv[2] || '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function chk(id, pass, expect, actual) {
  checks.push({ id, pass: !!pass, expect, actual: actual === undefined ? '' : actual });
  console.log((pass ? 'PASS ' : 'FAIL ') + id + ' | ' + expect + ' | ' + String(actual === undefined ? '' : actual).slice(0, 240));
}
let mp;
async function ev(fn, arg, tries) {
  const n = tries || 3;
  for (let i = 0; i < n; i++) { try { return await mp.evaluate(fn, arg); } catch (e) { if (i === n - 1) throw e; await sleep(1500); } }
}
const route = async () => { try { return await ev(() => { const s = getCurrentPages(); return s.length ? s[s.length - 1].route : ''; }, null, 2); } catch (e) { return ''; } };
async function waitRoute(x, n, g) { for (let i = 0; i < (n || 20); i++) { if ((await route()) === x) return true; await sleep(g || 1000); } return false; }

(async () => {
  mp = await a.connect({ wsEndpoint: WS });
  if (!(await route())) {
    try { await ev(() => { wx.reLaunch({ url: '/pages/index/index', fail: () => {} }); return 1; }); } catch (e) {}
    await sleep(5000);
  }
  if ((await route()) !== 'subpkg/biz/card/index') { try { await mp.navigateTo('/subpkg/biz/card/index'); } catch (e) {} }
  chk('A1_AT_LIST', await waitRoute('subpkg/biz/card/index', 25, 1000), '进入成本卡列表', await route());

  // 列表页的「批量导入」入口是否真的渲染出来（不是只看代码里有）
  const entry = await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    return { impEntry: (p.data.t && p.data.t.impEntry) || '', hasGoImport: typeof p.goImport === 'function' };
  }).catch(() => null);
  chk('A2_ENTRY', !!(entry && entry.hasGoImport && entry.impEntry), '列表页存在批量导入入口', entry && JSON.stringify(entry));

  // 进导入页
  if ((await route()) !== 'subpkg/biz/card/import') {
    try { await ev(() => { const p = getCurrentPages().slice(-1)[0]; p.goImport(); return 1; }); } catch (e) { try { await mp.navigateTo('/subpkg/biz/card/import'); } catch (e2) {} }
  }
  chk('B1_AT_IMPORT', await waitRoute('subpkg/biz/card/import', 20, 1000), '进入批量导入页', await route());

  const DISH = '走查导入菜' + String(Date.now()).slice(-4);
  const txt = DISH + ' 28\n走查导入菜二 18';
  await ev((t) => { const p = getCurrentPages().slice(-1)[0]; p.onInput({ detail: { value: t } }); return 1; }, txt);
  await ev(() => { const p = getCurrentPages().slice(-1)[0]; p.onParse(); return 1; });
  await sleep(1500);

  const parsed = await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    return { n: p.data.rows.length, summary: p.data.summaryText || p.data.summary || '',
      rows: p.data.rows.map((r) => ({ name: r.name, price: r.price, status: r.status, cat: r.catLabel || '' })) };
  });
  chk('C1_PARSE', !!(parsed && parsed.n === 2), '粘贴两行解析出 2 条', parsed && parsed.n);
  chk('C2_PRICE', !!(parsed && Math.abs(Number(parsed.rows[0].price) - 28) < 0.001), '售价 28 已解析', parsed && JSON.stringify(parsed.rows[0]));
  chk('C3_SUMMARY', !!(parsed && parsed.summary), '汇总文案已生成：' + (parsed && parsed.summary), parsed && parsed.summary);

  // 选品类（第 1 项 = 热炒荤菜）
  await ev(() => { const p = getCurrentPages().slice(-1)[0]; p.onPickCat({ currentTarget: { dataset: { idx: 0 } }, detail: { value: 1 } }); return 1; });
  await sleep(1000);
  const picked = await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    const r = p.data.rows[0];
    return { cat: r.catLabel, status: r.status, draftPrice: r.draft && r.draft.priceYuan,
      lines: (r.draft && r.draft.lines || []).map((l) => l.material_name + '/' + (l.unit_price_yuan || '')) };
  });
  chk('C4_CAT', !!(picked && picked.cat === '热炒荤菜'), '行内选品类生效', picked && picked.cat);
  chk('C5_DRAFT', !!(picked && picked.draftPrice === 28), '草稿带售价 28', picked && picked.draftPrice);
  chk('C6_STATUS', !!(picked && picked.status && picked.status !== 'ready'), '仍为「待补价」（示例主料无价）', picked && picked.status + ' lines=' + JSON.stringify(picked.lines));

  // 去补价
  await ev(() => { const p = getCurrentPages().slice(-1)[0]; p.onGoFill({ currentTarget: { dataset: { idx: 0 } } }); return 1; });
  chk('D1_AT_EDIT', await waitRoute('subpkg/biz/card/edit', 20, 1000), '跳转编辑页（from_draft）', await route());

  // ⚠️ 路由一变就读 = 页面还没 load 完（上一轮误判的根源）：等 loading 结束且表单有值再读
  let pre = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    pre = await ev(() => {
      const p = getCurrentPages().slice(-1)[0];
      if (!p || p.route !== 'subpkg/biz/card/edit') return null;
      return { name: p.data.name, price: p.data.priceYuan, cat: p.data.catLabel, catPicked: p.data.catPicked,
        loading: !!p.data.loading, loadMissing: !!p.data.loadMissing,
        lines: (p.data.lines || []).map((l) => l.material_name + '|' + (l.unit_price_yuan || '') + '|' + l.qty) };
    }).catch(() => null);
    if (pre && (!pre.loading) && (pre.name || (pre.lines && pre.lines.length))) break;
  }
  console.log('PRE ' + JSON.stringify(pre));
  chk('E1_PREFILL_NAME', !!(pre && pre.name === DISH), '编辑页预填菜名 ' + DISH, pre && pre.name);
  chk('E2_PREFILL_PRICE', !!(pre && String(pre.price) === '28'), '编辑页预填售价 28', pre && pre.price);
  chk('E3_PREFILL_CAT', !!(pre && pre.cat === '热炒荤菜'), '编辑页预填品类', pre && pre.cat);
  chk('E4_PREFILL_LINES', !!(pre && pre.lines.length >= 2), '编辑页预填明细行', pre && JSON.stringify(pre.lines));

  // 补价（猪肉 0.01、青椒 0.01 元/克）
  await ev(() => {
    const p = getCurrentPages().slice(-1)[0];
    const ls = p.data.lines;
    for (let i = 0; i < ls.length; i++) {
      const nm = ls[i].material_name || '';
      if (nm === '猪肉' || nm === '青椒') p.onManualPrice({ currentTarget: { dataset: { idx: i } }, detail: { value: '0.01' } });
    }
    return 1;
  });
  const filled = await ev(() => { const p = getCurrentPages().slice(-1)[0]; return p.data.lines.map((l) => l.material_name + '|' + (l.unit_price_yuan || '')); });
  chk('F1_FILLED', !!(filled && filled.filter((x) => /0\.01/.test(x)).length === 2), '两个示例主料补上单价', JSON.stringify(filled));

  // 保存
  const p2 = await mp.currentPage();
  const sb = await p2.$('.sa-btn');
  chk('G1_SAVE_BTN', !!sb, '吸底保存按钮存在', !!sb);
  if (sb) await sb.tap();

  let saved = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1200);
    saved = await ev(() => { const p = getCurrentPages().slice(-1)[0]; return { savedName: p.data.savedName || '', saving: !!p.data.saving }; }).catch(() => null);
    if (saved && saved.savedName) break;
  }
  chk('G2_SAVED', !!(saved && saved.savedName === DISH), '保存成功（' + DISH + '）', saved && JSON.stringify(saved));

  // 回列表
  const backBtn = await (await mp.currentPage()).$('.saved-go').catch(() => null);
  if (backBtn) await backBtn.tap();
  chk('H1_BACK', await waitRoute('subpkg/biz/card/index', 20, 1000), '返回列表', await route());

  let list = null;
  for (let i = 0; i < 15; i++) {
    await sleep(1200);
    list = await ev(() => { const p = getCurrentPages().slice(-1)[0]; const l = p.data.list || []; return { len: l.length, rows: l.map((x) => ({ code: x.card_code, name: x.name, gm: x.margin, cost: x.total_cost, price: x.price_fen })) }; }).catch(() => null);
    if (list && list.len > 0) break;
  }
  const row = list && list.rows.filter((x) => x.name === DISH)[0];
  chk('H2_ROW', !!row, '列表出现导入并保存的卡', row && JSON.stringify(row));
  if (row) {
    // 成本 = 猪肉150g*0.01/0.85 + 青椒100g*0.01/0.85 + 调料0.5/份(85%?) ⇒ 由云端定，页面须与列表一致
    const expect = row.gm;
    chk('H3_SANE', Number(expect) > 0 && Number(expect) < 100, '毛利率在 (0,100) 区间（不是假数）', expect + '%, 成本 ' + row.cost);
    chk('H4_PRICE', Number(row.price) === 2800, '列表售价 2800 分（28 元）', row.price);
  }

  // 清理
  let del = null;
  try {
    del = await ev((cc) => wx.cloud.callFunction({ name: 'saveCostCard', data: { shop_id: getApp().globalData.shop_id, card: { _delete: true, card_code: cc }, client_request_id: 'ccd_' + Date.now() } })
      .then((x) => ({ ok: 1, r: JSON.stringify(x.result) })).catch((e) => ({ ok: 0, e: e && (e.errMsg || e.message) })), row && row.code, 2);
  } catch (e) { del = { ok: 0, e: e && e.message }; }
  chk('I1_CLEANUP', !!(del && /"deleted":true/.test(del.r || '')), '走查临时卡已删除', del && (del.r || del.e));

  const pass = checks.filter((c) => c.pass).length;
  console.log('\nSUMMARY ' + pass + '/' + checks.length);
  fs.writeFileSync(OUT + '/report_import_save.json', JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  try { await mp.disconnect(); } catch (e) {}
  process.exit(pass === checks.length ? 0 : 1);
})().catch((e) => { console.log('FATAL ' + (e && e.stack)); process.exit(9); });
