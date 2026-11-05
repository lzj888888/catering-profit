// R568b · 真机（模拟器）补证：列表 →「新建」→ 选品类 → 补单价 → 保存 → 回列表核对毛利 → 清理
// 运行：node walk_r568b_save.js <outDir> [wsEndpoint]
const a = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function chk(id, pass, expect, actual) {
  checks.push({ id, pass: !!pass, expect, actual: actual === undefined ? '' : actual });
  console.log((pass ? 'PASS ' : 'FAIL ') + id + ' | ' + expect + ' | ' + String(actual === undefined ? '' : actual).slice(0, 240));
}
function save() {
  fs.writeFileSync(path.join(OUT, 'report_save2.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
}

let mp = null;
async function ev(fn, arg, tries) {
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return await mp.evaluate(fn, arg); }
    catch (e) { if (i === n - 1) throw e; await sleep(1200); }
  }
}
async function route() {
  try { return await ev(() => { const s = getCurrentPages(); return s.length ? s[s.length - 1].route : ''; }, null, 2); }
  catch (e) { return ''; }
}
async function waitRoute(expect, tries, gap) {
  const n = tries || 20, g = gap || 1000;
  for (let i = 0; i < n; i++) { if ((await route()) === expect) return true; await sleep(g); }
  return false;
}

(async () => {
  try { mp = await a.connect({ wsEndpoint: WS }); }
  catch (e) { chk('A1_CONNECT', false, '自动化通道可连接', e && e.message); save(); process.exit(1); }
  chk('A1_CONNECT', true, '自动化通道可连接', WS);

  // 1. 确保在列表页
  let r = await route();
  if (r !== 'subpkg/biz/card/index') {
    try { await mp.navigateTo('/subpkg/biz/card/index'); } catch (e) {}
  }
  let ok = await waitRoute('subpkg/biz/card/index', 25, 1000);
  if (!ok) { try { await ev(() => { wx.reLaunch({ url: '/pages/index/index', fail: () => {} }); return 1; }); } catch (e) {} await sleep(4000); try { await mp.navigateTo('/subpkg/biz/card/index'); } catch (e) {} ok = await waitRoute('subpkg/biz/card/index', 25, 1000); }
  chk('A2_AT_LIST', ok, '在成本卡列表页', await route());

  let st = null;
  for (let i = 0; i < 20; i++) {
    try {
      st = await ev(() => {
        const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null; const app = getApp();
        return { shopId: (app && app.globalData && app.globalData.shop_id) || '',
          len: (p && p.data && p.data.list) ? p.data.list.length : -1 };
      });
    } catch (e) { st = null; }
    if (st && st.shopId && st.len >= 0) break;
    await sleep(1500);
  }
  const beforeLen = (st && st.len) || 0;
  chk('A3_SHOP_CTX', !!(st && st.shopId), '店铺上下文已加载', st && st.shopId);
  chk('A4_LIST_READY', !!(st && st.len >= 0), '列表数据已加载（建卡前 ' + beforeLen + ' 张）', st && st.len);

  // 2. 真实点击「新建成本卡」
  const p1 = await mp.currentPage();
  const addBtn = await p1.$('.top-add');
  chk('B1_ADD_BTN', !!addBtn, '列表页「新建成本卡」按钮可见', addBtn ? 'found' : 'null');
  await addBtn.tap();
  chk('B2_NAV_EDIT', await waitRoute('subpkg/biz/card/edit', 25, 1000), '进入编辑页（新建态）', await route());

  // 3. 选品类 0 = 热炒荤菜（真实 handler，等同 picker 选择）
  const DISH = '走查临时菜' + String(Date.now()).slice(-4);
  const picked = await ev((d) => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    if (!p || p.route !== 'subpkg/biz/card/edit') return { err: 'no edit' };
    p.onName({ detail: { value: d.name } });
    p.onPrice({ detail: { value: d.price } });
    p.onPickCategory({ detail: { value: 0 } });
    return {
      name: p.data.name, price: p.data.priceYuan, catLabel: p.data.catLabel,
      lossRate: p.data.lossRate, energyFen: p.data.energyFen,
      lines: p.data.lines.map((l) => ({ n: l.material_name, q: l.qty, u: l.qty_unit, p: l.unit_price_yuan, t: l.input_type, y: l.yield_rate })),
    };
  }, { name: DISH, price: '20' });
  chk('C1_PICK_CAT', !!(picked && picked.catLabel), '选品类后写入 catLabel', picked && picked.catLabel);
  chk('C2_LINES', !!(picked && picked.lines.length === 3), '预填 3 行（猪肉/青椒/调料）', picked && JSON.stringify(picked.lines));
  chk('C3_LINE_KIND2', !!(picked && picked.lines.every((l) => Number(l.t) === 2)), '三行都是手工行 input_type=2（可保存）', picked && picked.lines.map((l) => l.t).join(','));
  chk('C4_COND_PRICED', !!(picked && picked.lines.filter((l) => l.n === '调料(含油盐酱醋)').length === 1), '调料行已带价（品类默认）', picked && JSON.stringify(picked.lines.filter((l) => /调料/.test(l.n || ''))));

  // 4. 补齐示例主料单价（元/克，真实输入 handler）
  const filled = await ev(() => {
    const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
    const prices = [0.012, 0.008];
    const lines = p.data.lines;
    for (let i = 0; i < lines.length; i++) {
      const nm = lines[i].material_name || '';
      if (nm === '猪肉' || nm === '青椒') {
        const v = nm === '猪肉' ? prices[0] : prices[1];
        p.onManualPrice({ currentTarget: { dataset: { idx: i } }, detail: { value: String(v) } });
      }
    }
    return p.data.lines.map((l) => ({ n: l.material_name, p: l.unit_price_yuan, q: l.qty, y: l.yield_rate }));
  });
  chk('D1_MANUAL_PRICE', !!(filled && filled.some((l) => l.n === '猪肉' && String(l.p) === '0.012')), '猪肉单价已填 0.012 元/克', filled && JSON.stringify(filled));

  // 5. 等实时试算
  let calc = null;
  for (let i = 0; i < 22; i++) {
    await sleep(1200);
    try {
      calc = await ev(() => {
        const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
        return { costFen: p.data.previewCostFen, margin: p.data.stickyMargin || '', amountErr: p.data.amountErr || '', est: !!p.data.hasPreset };
      });
    } catch (e) { calc = null; }
    if (calc && Number(calc.costFen) > 0) break;
  }
  const costFen = calc ? Number(calc.costFen) : 0;
  chk('E1_COST', costFen > 0, '实时试算成本 > 0（引擎真回值）', 'costFen=' + costFen + ' margin=' + (calc && calc.margin) + ' err=' + (calc && calc.amountErr));
  const expectMargin = costFen > 0 ? Math.round(((2000 - costFen) / 2000) * 10000) / 100 : null;
  const shown = parseFloat(String((calc && calc.margin) || '').replace(/[^\d.\-]/g, ''));
  chk('E2_MARGIN', expectMargin !== null && Math.abs(shown - expectMargin) < 0.6, '毛利率与式 (20-成本)/20 一致 ≈ ' + expectMargin + '%', (calc && calc.margin) + ' → ' + shown);

  // 6. 保存
  const p2 = await mp.currentPage();
  const saveBtn = await p2.$('.sa-btn');
  chk('F1_SAVE_BTN', !!saveBtn, '吸底保存按钮存在', saveBtn ? 'found' : 'null');
  if (saveBtn) await saveBtn.tap();

  let saved = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1200);
    try {
      saved = await ev(() => {
        const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
        return { savedName: (p && p.data && p.data.savedName) || '', saving: !!(p && p.data && p.data.saving) };
      });
    } catch (e) { saved = null; }
    if (saved && saved.savedName) break;
  }
  chk('F2_SAVED', !!(saved && saved.savedName === DISH), '保存成功且横幅显示「' + DISH + '」', saved && JSON.stringify(saved));

  // 7. 返回列表核对
  const p3 = await mp.currentPage();
  const backBtn = await p3.$('.saved-go');
  if (backBtn) await backBtn.tap();
  chk('G1_BACK', await waitRoute('subpkg/biz/card/index', 25, 1000), '返回成本卡列表', await route());

  let after = null;
  for (let i = 0; i < 18; i++) {
    await sleep(1200);
    try {
      after = await ev(() => {
        const s = getCurrentPages(); const p = s.length ? s[s.length - 1] : null;
        const l = (p && p.data && p.data.list) || [];
        return { len: l.length, rows: l.map((x) => ({ code: x.card_code, name: x.dish_name, gm: x.gross_margin_pct, cost: x.total_cost_fen, price: x.price_fen, cat: x.category })) };
      });
    } catch (e) { after = null; }
    if (after && after.len > beforeLen) break;
  }
  chk('G2_GROW', !!(after && after.len === beforeLen + 1), '列表 ' + beforeLen + ' → ' + (beforeLen + 1) + ' 张', after && after.len);
  const row = after ? after.rows.filter((x) => x.name === DISH)[0] : null;
  chk('G3_ROW', !!row, '列表出现「' + DISH + '」', row && JSON.stringify(row));
  if (row) {
    const gm = Number(row.gm);
    chk('G4_GM', Math.abs(gm - expectMargin) < 0.6, '列表毛利 ≈ 试算毛利 ' + expectMargin + '%', gm + '%');
    chk('G5_PRICE', Number(row.price) === 2000, '列表售价 2000 分（20 元）', row.price);
    chk('G6_COST', Number(row.cost) === costFen, '列表成本 = 试算成本 ' + costFen + ' 分', row.cost);
  }

  // 8. 清理
  let del = null;
  try {
    del = await ev((cc) => wx.cloud.callFunction({ name: 'saveCostCard', data: { card: { _delete: true, card_code: cc }, client_request_id: 'ccd_' + Date.now() } })
      .then((x) => ({ ok: 1, r: JSON.stringify(x.result) })).catch((e) => ({ ok: 0, e: e && (e.errMsg || e.message) })), row && row.code, 2);
  } catch (e) { del = { ok: 0, e: e && e.message }; }
  chk('H1_CLEANUP', !!(del && del.ok && /"ok":true/.test(del.r || '')), '走查临时卡已删除（不留脏数据）', del ? (del.r || del.e) : 'null');

  const pass = checks.filter((c) => c.pass).length;
  console.log('\nSUMMARY ' + pass + '/' + checks.length);
  save();
  try { await mp.disconnect(); } catch (e) {}
  process.exit(pass === checks.length ? 0 : 1);
})().catch((e) => {
  console.log('FATAL ' + (e && e.stack));
  chk('Z_FATAL', false, '脚本异常', e && e.message);
  save(); process.exit(9);
});
