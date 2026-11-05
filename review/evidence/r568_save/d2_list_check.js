// R568d · 核对列表出现新卡 + 毛利/售价/成本一致，然后删掉走查临时卡
const a = require('miniprogram-automator');
const fs = require('fs');
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const CODE = process.argv[4] || '';
const NAME = process.argv[5] || '';
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

  let list = null;
  for (let i = 0; i < 15; i++) {
    await sleep(1200);
    list = await ev(() => {
      const p = getCurrentPages().slice(-1)[0];
      const l = (p && p.data && p.data.list) || [];
      return { len: l.length, rows: l.map((x) => ({ code: x.card_code, name: x.name, gm: x.margin, cost: x.total_cost, price: x.price_fen, cat: x.category || '' })) };
    }).catch(() => null);
    if (list && list.len > 0) break;
  }
  chk('A2_LIST_NONEMPTY', !!(list && list.len > 0), '列表已加载出成本卡', list && list.len);
  const row = (list && list.rows || []).filter((x) => (CODE && x.code === CODE) || (NAME && x.name === NAME))[0];
  chk('A3_ROW', !!row, '列表出现刚保存的卡 ' + (CODE || NAME), row && JSON.stringify(row));
  if (row) {
    chk('A4_NAME', String(row.name || '').indexOf('走查临时菜') === 0, '列表菜名 = 刚保存的名字', row.name);
    chk('A4_MARGIN', Number(row.gm) > 0 && Number(row.gm) < 100, '列表毛利率在 (0,100)', row.gm);
    chk('A5_COST', Number(row.cost) > 0, '列表成本 > 0', row.cost);
    chk('A6_PRICE', Number(row.price) === 2800, '列表售价 = 2800 分（28 元）', row.price);
  }

  // 列表页的「亏本」提示条：这张卡不亏本 ⇒ 不应出现
  const lose = await ev(() => { const p = getCurrentPages().slice(-1)[0]; return { loseWarn: p.data.loseWarn || '', loseCount: p.data.loseCount, lossOnly: !!p.data.lossOnly }; }).catch(() => null);
  chk('A7_NO_LOSS_WARN', !!(lose && !lose.loseWarn && !Number(lose.loseCount)), '81.85% 的卡不触发亏本提示条', lose && JSON.stringify(lose));

  // 清理：删掉这张卡
  let del = null;
  try {
    del = await ev((cc) => wx.cloud.callFunction({ name: 'saveCostCard', data: { shop_id: getApp().globalData.shop_id, card: { _delete: true, card_code: cc }, client_request_id: 'ccd_' + Date.now() } })
      .then((x) => ({ ok: 1, r: JSON.stringify(x.result) })).catch((e) => ({ ok: 0, e: e && (e.errMsg || e.message) })), (row && row.code) || CODE, 2);
  } catch (e) { del = { ok: 0, e: e && e.message }; }
  chk('B1_DELETE', !!(del && /"deleted":true/.test(del.r || '')), '走查临时卡已软删', del && (del.r || del.e));

  // 重新加载列表确认清零
  try { await ev(() => { const p = getCurrentPages().slice(-1)[0]; if (p && p.load) p.load(); return 1; }); } catch (e) {}
  await sleep(5000);
  const after = await ev(() => { const p = getCurrentPages().slice(-1)[0]; const l = (p && p.data && p.data.list) || []; return { len: l.length, codes: l.map((x) => x.card_code) }; }).catch(() => null);
  chk('B2_CLEAN', !!(after && after.codes.indexOf(CODE) < 0), '列表里已无该卡（不留脏数据）', after && JSON.stringify(after));

  const pass = checks.filter((c) => c.pass).length;
  console.log('\nSUMMARY ' + pass + '/' + checks.length);
  fs.writeFileSync(OUT + '/report_list.json', JSON.stringify({ at: new Date().toISOString(), code: CODE, checks }, null, 2));
  try { await mp.disconnect(); } catch (e) {}
  process.exit(pass === checks.length ? 0 : 1);
})().catch((e) => { console.log('FATAL ' + (e && e.stack)); process.exit(9); });
