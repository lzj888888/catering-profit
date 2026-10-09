// review/evidence/r251_dishreview/_r251_probe.js
// R251 真云只读探针：把「单品毛利复盘」页面的**数据真相**取回来。
//
// 回答三件事（全部**零写入** —— 只调 getDishReview + 只读 client db）：
//   ① getDishReview 的真实回包 ⇒ `dine_in` / `takeaway.by_platform` / `unmatched` / `totals`
//      （这就是页面看到的一切，判「京东到底进没进」以它为准）
//   ② `external_sales_daily` 里**按 platform 分组**的行数（含 dish_key 为空的行数）
//      ⇒ 账单级导入（dish_key=''）与形态 C（dish_key=菜名）在库里的真实占比
//   ③ client 侧读库是否被权限挡（挡了就说明 raw 只能走云函数侧，属**已知**而非缺陷）
//
// 跑法：NODE_PATH=<workspace>/node_modules node review/evidence/r251_dishreview/_r251_probe.js
const fs = require('fs');
const automator = require('miniprogram-automator');

const WS = process.env.WS || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 发出去不 await（automator 单次 evaluate 有内部超时；冷启必超）⇒ 挂 globalThis 分次轮询
async function fire(mp, task, k, args) {
  return mp.evaluate((a) => {
    globalThis.__r251 = globalThis.__r251 || {};
    globalThis.__r251[a.k] = { done: false };
    const t0 = Date.now();
    const finish = (o) => { globalThis.__r251[a.k] = Object.assign({ done: true, ms: Date.now() - t0 }, o); };
    const tasks = {
      shop: async () => {
        const c = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
        return (c && c.result && c.result.data && c.result.data.shop_id) || '';
      },
      // ① 页面数据真相
      review: async () => {
        const c = await wx.cloud.callFunction({ name: 'getDishReview', data: { shop_id: a.args.sid } });
        return (c && c.result) || null;
      },
      // ② 库里原始行（client 读，可能被权限挡 ⇒ 如实记录）
      raw: async () => {
        const out = {};
        const db = wx.cloud.database();
        try { const c = await db.collection('external_sales_daily').count(); out.count = c.total; }
        catch (e) { out.countErr = String((e && (e.errMsg || e.message)) || e); }
        try {
          const ag = await db.collection('external_sales_daily')
            .aggregate()
            .group({ _id: { p: '$platform', empty: db.command.eq('$dish_key', '') }, n: db.command.aggregate.sum(1) })
            .end();
          out.byPlatformEmpty = (ag && ag.list) || [];
        } catch (e) { out.aggErr = String((e && (e.errMsg || e.message)) || e); }
        try {
          const r = await db.collection('external_sales_daily').limit(12).get();
          out.sample = (r.data || []).map((x) => ({
            _id: x._id, platform: x.platform, biz_date: x.biz_date,
            dish_key: x.dish_key, qty: x.qty, amount: x.amount, is_deleted: x.is_deleted,
          }));
        } catch (e) { out.sampleErr = String((e && (e.errMsg || e.message)) || e); }
        return out;
      },
    };
    tasks[a.task]()
      .then((r) => finish({ res: r }))
      .catch((e) => finish({ err: String((e && (e.errMsg || e.message)) || e) }));
    return true;
  }, { task, k, args });
}

async function poll(k, tries, intervalMs) {
  for (let i = 0; i < tries; i++) {
    await sleep(intervalMs);
    let st = null;
    try {
      const mp2 = await automator.connect({ wsEndpoint: WS, timeout: 20000 });
      st = await mp2.evaluate((key) => (globalThis.__r251 || {})[key] || null, k);
      await mp2.disconnect();
    } catch (e) { console.log('    poll connect err:', (e && e.message) || e); }
    if (st && st.done) return st;
    if (i % 4 === 0) console.log('    poll', i + 1, JSON.stringify(st));
  }
  return null;
}

async function runOne(task, key, args, tries, iv) {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 });
  await fire(mp, task, key, args);
  const st = await poll(key, tries, iv);
  try { await mp.disconnect(); } catch (e) { /* ignore */ }
  return st;
}

(async () => {
  const out = { at: new Date().toISOString(), ws: WS };
  console.log('[ok] connected', WS);

  // ---- 1. shop ----
  const shop = await runOne('shop', 'shop', {}, 20, 1500);
  console.log('shop 轮询 =', JSON.stringify(shop));
  if (!shop || shop.err || !shop.res) { console.log('❌ 拿不到 shop_id'); console.log(JSON.stringify(out, null, 2)); process.exit(1); }
  out.shop_id = shop.res;
  console.log('shop_id =', out.shop_id);

  // ---- 2. getDishReview（页面数据真相）----
  console.log('='.repeat(88));
  const rv = await runOne('review', 'review', { sid: out.shop_id }, 40, 1500);
  console.log('getDishReview done=%s ms=%s err=%s', rv && rv.done, rv && rv.ms, rv && rv.err);
  const R = rv && rv.res;
  out.review_raw = R;
  if (R && R.data) {
    const D = R.data;
    console.log('  code =', R.code);
    console.log('  dine_in  行数 =', (D.dine_in || []).length);
    console.log('  unmatched 行数 =', (D.unmatched || []).length);
    console.log('  totals =', JSON.stringify(D.totals));
    const bp = (D.takeaway && D.takeaway.by_platform) || null;
    console.log('  takeaway =', bp ? Object.keys(bp).join(', ') : 'null（空态）');
    if (bp) {
      for (const p of Object.keys(bp)) {
        const b = bp[p];
        console.log('    [%s] ranked=%d unmatched=%d totals=%s',
          p, (b.ranked || []).length, (b.unmatched || []).length, JSON.stringify(b.totals));
        (b.unmatched || []).slice(0, 5).forEach((u) => console.log('        unmatched:', u.name, u.qty, u.amountFen));
      }
    }
    (D.unmatched || []).slice(0, 8).forEach((u) => console.log('  顶层unmatched:', u.name, u.qty, u.amountFen));
  } else {
    console.log('  回包 =', JSON.stringify(R));
  }

  // ---- 3. 库里原始行 ----
  console.log('='.repeat(88));
  const raw = await runOne('raw', 'raw', {}, 30, 1500);
  console.log('raw done=%s err=%s', raw && raw.done, raw && raw.err);
  out.raw = raw && raw.res;
  console.log(JSON.stringify(raw && raw.res, null, 2));

  fs.writeFileSync(__dirname + '/probe_r251.txt',
    'R251 真云只读探针原始回包\n生成时间 = ' + out.at + '\n\n' + JSON.stringify(out, null, 2) + '\n');
  console.log('\n已落档 probe_r251.txt');
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
