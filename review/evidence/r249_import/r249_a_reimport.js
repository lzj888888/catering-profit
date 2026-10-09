// review/evidence/r249_import/r249_a_reimport.js
// 目的：R249 修复后的【真云 A/B 复验 · A 侧】—— 重导同一份淘宝闪购《商品销量》表。
// 🔴 为什么必须「重导」而不是「直接读」：修复只对**新写入**生效 ——
//   此前那 354 行是**缺 is_deleted 的旧文档**，读侧仍然过滤掉它们；
//   而 `.doc(_id).set()` 是 upsert + **整文档替换** ⇒ 重导会把同一批 _id 逐条覆盖成带 is_deleted 的新文档
//   （`_id = SALE_<shop>_<platform>_<bizDate>_<seq>` 是确定性主键 ⇒ 幂等、不会翻倍）。
// 🔴 关键：`client_request_id` 必须是**新值**，否则命中 idempotency.findPriorResult 直接返回首次结果、不重写。
//
// 通道：R188 定式（逻辑层 wx.reLaunch + 一次连接一至两次 evaluate）；
//      落库 354 行耗时 ~15s > App.callFunction 内部超时 ⇒ 必须「发出去不 await + 分次重连轮询 globalThis」。
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const WS = process.env.WS || 'ws://127.0.0.1:9420';
const B64 = fs.readFileSync(path.join(__dirname, 'taobao_goods.b64'), 'utf8').trim();

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/hub' }); });
  await new Promise((r) => setTimeout(r, 3500));

  // ---------- 0) 取真实 shop_id ----------
  const sid = await mp.evaluate(async () => {
    const g = (getApp() && getApp().globalData) || {};
    if (g.shop_id) return g.shop_id;
    try {
      const c = await wx.cloud.callFunction({ name: 'getShopContext', data: {} });
      return (c && c.result && c.result.data && c.result.data.shop_id) || '';
    } catch (e) { return ''; }
  });
  console.log('shop_id =', sid);
  if (!sid) throw new Error('拿不到 shop_id');

  // ---------- 1) 写入模拟器虚拟 FS + 上传云存储 ----------
  const up = await mp.evaluate(async (b64) => {
    const out = {};
    const fsm = wx.getFileSystemManager();
    const p = wx.env.USER_DATA_PATH + '/r249_taobao_goods.xlsx';
    fsm.writeFileSync(p, b64, 'base64');
    out.localPath = p;
    out.size = fsm.statSync(p).size;
    const res = await wx.cloud.uploadFile({
      cloudPath: 'sales_bills/r249_re_' + Date.now() + '_taobao_goods.xlsx',
      filePath: p,
    });
    out.fileID = (res && res.fileID) || '';
    return out;
  }, B64);
  console.log('UPLOAD =', JSON.stringify(up));
  if (!up.fileID) throw new Error('上传失败');

  // ---------- 2) confirm=true 落库（不 await，挂 globalThis 供轮询） ----------
  const crid = 'r249_re_' + Date.now();
  await mp.evaluate((args) => {
    globalThis.__r249 = { done: false };
    const t0 = Date.now();
    wx.cloud.callFunction({
      name: 'importSalesBill',
      data: { shop_id: args.sid, fileID: args.fileID, platform: 'taobao', confirm: true, client_request_id: args.crid },
    }).then((r) => {
      globalThis.__r249 = { done: true, res: (r && r.result) || null, ms: Date.now() - t0 };
    }).catch((e) => {
      globalThis.__r249 = { done: true, err: (e && (e.errMsg || e.message)) || String(e), ms: Date.now() - t0 };
    });
    return true;
  }, { sid, fileID: up.fileID, crid });

  // ---------- 3) 分次重连轮询（每次新连接，避开单连接超时） ----------
  let done = null;
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    let st = null;
    try {
      const mp2 = await automator.connect({ wsEndpoint: WS });
      st = await mp2.evaluate(() => globalThis.__r249 || null);
      await mp2.disconnect();
    } catch (e) { console.log('  poll connect err:', (e && e.message) || e); }
    if (st && st.done) { done = st; console.log('CONFIRM =', JSON.stringify(st)); break; }
    console.log('  poll', i + 1, JSON.stringify(st));
  }
  console.log('client_request_id =', crid);
  if (!done) console.log('!! 轮询超时，未取得落库回执');
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
