// review/evidence/r251_dishreview/_r251_cards.js
// R251 真云只读探针（第二支）：把该店**成本卡名单**取回来。
// 目的：判「taobao 51 个外卖菜全部未匹配」是 (a) 根本没建卡，还是 (b) 建了卡但菜名对不上。
// 零写入：只调 getCostCard（纯读）。
const fs = require('fs');
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fire(mp, k, args) {
  return mp.evaluate((a) => {
    globalThis.__r251c = globalThis.__r251c || {};
    globalThis.__r251c[a.k] = { done: false };
    const t0 = Date.now();
    const finish = (o) => { globalThis.__r251c[a.k] = Object.assign({ done: true, ms: Date.now() - t0 }, o); };
    (async () => {
      const c = await wx.cloud.callFunction({ name: 'getCostCard', data: { shop_id: a.args.sid } });
      return (c && c.result) || null;
    })().then((r) => finish({ res: r })).catch((e) => finish({ err: String((e && (e.errMsg || e.message)) || e) }));
    return true;
  }, { k, args });
}

async function poll(k, tries, iv) {
  for (let i = 0; i < tries; i++) {
    await sleep(iv);
    let st = null;
    try {
      const mp2 = await automator.connect({ wsEndpoint: WS, timeout: 20000 });
      st = await mp2.evaluate((key) => (globalThis.__r251c || {})[key] || null, k);
      await mp2.disconnect();
    } catch (e) { /* ignore */ }
    if (st && st.done) return st;
    if (i % 4 === 0) console.log('    poll', i + 1, JSON.stringify(st));
  }
  return null;
}

(async () => {
  const sid = process.argv[2];
  if (!sid) { console.log('用法: node _r251_cards.js <shop_id>'); process.exit(1); }
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 });
  await fire(mp, 'cards', { sid });
  const st = await poll('cards', 30, 1500);
  try { await mp.disconnect(); } catch (e) { /* ignore */ }
  const R = st && st.res;
  const out = { at: new Date().toISOString(), shop_id: sid, raw: R };
  console.log('done=%s ms=%s err=%s', st && st.done, st && st.ms, st && st.err);
  if (R && R.data) {
    const list = R.data.list || [];
    console.log('code =', R.code, ' 成本卡数 =', list.length);
    out.cards = list.map((c) => ({
      card_code: c.card_code, name: c.name, version: c.version,
      total_cost: c.total_cost, lines: (c.lines || []).length,
    }));
    out.cards.forEach((c) => console.log('   -', JSON.stringify(c)));
  } else {
    console.log('回包 =', JSON.stringify(R));
  }
  fs.writeFileSync(__dirname + '/probe_r251_cards.txt',
    'R251 真云探针（成本卡名单）\n' + JSON.stringify(out, null, 2) + '\n');
  console.log('已落档 probe_r251_cards.txt');
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
