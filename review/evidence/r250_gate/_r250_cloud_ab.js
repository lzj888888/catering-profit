// review/evidence/r250_gate/_r250_cloud_ab.js
// R250 **真云 A/B**（**零写入**）：用真文件走真云函数，只取**预览**回包（confirm:false ⇒ 不落库）。
//
// 🔴 为什么是「零写入」：`cloudfunctions/importSalesBill/index.js` 的 `if (!v.confirm) return ok({...preview})`
//   ⇒ 预览分支在**任何 db 写之前**返回 ⇒ 不加 confirm 就不会写 `external_sales_daily`。
//   这正好等价于用户在页面上「选完文件 → 看到预览」那一步：最贴近现场，且零副作用。
//
// 🔴 A/B 有分辨力的原因：修复前的旧写法在本样本上**平台判不出** ⇒ 云函数回
//   `无法识别账单平台…`；修复后应回到 `platform='jd_order'` + `grade.pass=true`。
//   差别落在**回包内容**上，而不是"跑没跑通"。
//
// 🔴 通道形态（R188 定式 + R249 实测订正）：automator 的**单次 evaluate 有内部超时**，
//   而 `wx.cloud.callFunction` **冷启**（首次 getShopContext）会超 ⇒ 必须「发出去不 await +
//   挂 globalThis + 分次新连接轮询」。本脚本三件事（取 shop / 上传 / 预览）都走这个定式。
//
// 跑法：NODE_PATH=<workspace>/node_modules node review/evidence/r250_gate/_r250_cloud_ab.js
const fs = require('fs');
const automator = require('miniprogram-automator');

const WS = process.env.WS || 'ws://127.0.0.1:9420';
const REPO = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';

const CASES = [
  {
    tag: 'jd_order',
    name: 'A · 真·京东订单级（117 行 × 82 列，两级表头）',
    fp: REPO + '/_probe_tmp/jd_order.xlsx',
    expect: "platform='jd_order' 且 grade.pass=true（旧写法会回「无法识别账单平台」）",
  },
  {
    tag: 'jd_sku',
    name: 'B · 真·京东 SKU 级（1 行 × 27 列 = 只有表头的空模板）',
    fp: REPO + '/_probe_tmp/jd_sku.xlsx',
    expect: "platform='jd_sku' 且 grade.pass=false、failures[0].code='CHANNEL_EMPTY'",
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 发出去不 await：把 promise 结果挂到 globalThis.__r250[K]，立刻返回
async function fire(mp, task, k, args) {
  return mp.evaluate((a) => {
    globalThis.__r250 = globalThis.__r250 || {};
    globalThis.__r250[a.k] = { done: false };
    const t0 = Date.now();
    const finish = (o) => { globalThis.__r250[a.k] = Object.assign({ done: true, ms: Date.now() - t0 }, o); };
    const tasks = {
      shop: async () => {
        const c = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
        return (c && c.result && c.result.data && c.result.data.shop_id) || '';
      },
      upload: async () => {
        const fsm = wx.getFileSystemManager();
        const p = wx.env.USER_DATA_PATH + '/r250_' + a.args.tag + '.xlsx';
        fsm.writeFileSync(p, a.args.b64, 'base64');
        const res = await wx.cloud.uploadFile({
          cloudPath: 'sales_bills/r250_' + a.args.tag + '_' + Date.now() + '.xlsx',
          filePath: p,
        });
        return { fileID: (res && res.fileID) || '', size: fsm.statSync(p).size };
      },
      preview: async () => {
        const res = await wx.cloud.callFunction({
          name: 'importSalesBill',
          data: {
            shop_id: a.args.sid,
            fileID: a.args.fileID,
            platform: '',          // ← 空 ⇒ 云函数**自动判定平台**（被验证的那条路）
            confirm: false,        // 🔴 false ⇒ 只回预览、**不落库**
            client_request_id: '',
          },
        });
        return (res && res.result) || null;
      },
    };
    tasks[a.task]()
      .then((r) => finish({ res: r }))
      .catch((e) => finish({ err: String((e && (e.errMsg || e.message)) || e) }));
    return true;
  }, { task, k, args });
}

// 分次新连接轮询（每次新连接，避开单连接超时）
async function poll(ws, k, tries, intervalMs) {
  for (let i = 0; i < tries; i++) {
    await sleep(intervalMs);
    let st = null;
    try {
      const mp2 = await automator.connect({ wsEndpoint: ws, timeout: 20000 });
      st = await mp2.evaluate((key) => (globalThis.__r250 || {})[key] || null, k);
      await mp2.disconnect();
    } catch (e) { console.log('    poll connect err:', (e && e.message) || e); }
    if (st && st.done) return st;
    if (i % 3 === 0) console.log('    poll', i + 1, JSON.stringify(st));
  }
  return null;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS, timeout: 30000 });
  console.log('[ok] connected', WS);

  await fire(mp, 'shop', 'shop', {});
  let shop = await poll(WS, 'shop', 20, 1500);
  console.log('shop 轮询结果 =', JSON.stringify(shop));
  if (!shop || shop.err || !shop.res) throw new Error('拿不到 shop_id：' + JSON.stringify(shop));
  const sid = shop.res;
  console.log('shop_id =', sid);
  await mp.disconnect();

  for (const c of CASES) {
    console.log('='.repeat(88));
    console.log('#', c.name);
    console.log('  预期：' + c.expect);
    if (!fs.existsSync(c.fp)) { console.log('  (文件不在，跳过)'); continue; }
    const b64 = fs.readFileSync(c.fp).toString('base64');
    console.log('  本地文件 %d B → base64 %d 字符', fs.statSync(c.fp).size, b64.length);

    let mp1 = await automator.connect({ wsEndpoint: WS, timeout: 30000 });
    await fire(mp1, 'upload', 'up_' + c.tag, { tag: c.tag, b64 });
    const up = await poll(WS, 'up_' + c.tag, 30, 1500);
    console.log('  上传轮询 =', JSON.stringify(up && { done: up.done, res: up.res, err: up.err }));
    if (!up || up.err || !up.res || !up.res.fileID) { console.log('  ❌ 上传失败'); continue; }
    console.log('  fileID =', up.res.fileID);

    await fire(mp1, 'preview', 'pv_' + c.tag, { sid, fileID: up.res.fileID });
    const pv = await poll(WS, 'pv_' + c.tag, 40, 1500);
    console.log('  预览轮询 done=%s ms=%s err=%s', pv && pv.done, pv && pv.ms, pv && pv.err);
    const R = pv && pv.res;
    const D = R && R.data;
    console.log('  回包 =', JSON.stringify(R));
    if (D) {
      console.log('  platform =', JSON.stringify(D.platform));
      console.log('  grade    =', JSON.stringify(D.grade));
      if (D.preview) {
        console.log('  preview  = rows %d · totals %s · excluded %s',
          (D.preview.rows || []).length, JSON.stringify(D.preview.totals), JSON.stringify(D.preview.excluded));
      }
    }
    try { await mp1.disconnect(); } catch (e) { /* ignore */ }
  }

  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
