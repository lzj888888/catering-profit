// review/evidence/r254_cloud_probe/probe_cloud_r254.js
// 目的：在【真实小程序上下文】里【只读】调云函数，回答 R252/R253 到底有没有真生效：
//   ① getSalesBills —— 真云上「我导过什么」：active_bills / row_count / platforms / amount_fen
//      ⇒ 顺带证伪/证实 R249「导入了却读不出来」（若这里能读到行，说明 is_deleted 修复在真云生效）
//   ② getDishReview —— 真云复盘是否真的出数据（R249 主诉「落库 354 行却全程空态」）
// 🔴 本脚本【绝不写】任何数据：只调两个读侧函数 + getShopContext（读）。
// 通道：R188 定式 —— 逻辑层 wx.reLaunch（mp.reLaunch/page.* 因 pageMeta 恒 null 全死）；
//       一条连接内跑完，evaluate 内一次性链式 await（避免多次 evaluate 握手）。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9420';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[ok] connected', WS);

  // 第 1 跳最可靠：直接进复盘页（不要先绕首页预热，R193 实测 warmup 反而更容易撞超时）
  await mp.evaluate(() => { wx.reLaunch({ url: '/pages/m3/dishreview', fail: () => { } }); return 1; });
  await sleep(6000); // 列表页等云数据：给足 6s（R192：5s 会读到旧帧）

  const out = await mp.evaluate(async () => {
    const r = {};

    // 统一调用器：返回原始 result，不做任何解释（解释在仓外做）
    const call = async (n, d) => {
      try {
        const res = await wx.cloud.callFunction({ name: n, data: d || {} });
        return { raw: res && res.result };
      } catch (e) {
        return { callErr: (e && (e.errMsg || e.message)) || String(e) };
      }
    };

    // 形态判据（技能 miniprogram-page-review）：
    //   BIZ   = 结果里含 "code":  ⇒ 我们自己的 ok()/fail() 结构
    //   SHELL = 含 tcbContext     ⇒ 空壳（入参+context 回显，代码没上去）
    const shape = (raw) => {
      if (!raw || typeof raw !== 'object') return typeof raw;
      const s = JSON.stringify(raw);
      if (/"code"\s*:/.test(s)) return 'BIZ';
      if (/tcbContext/.test(s)) return 'SHELL';
      return 'OTHER';
    };

    // ① 当前店铺（getSalesBills 的 shop_id 是必填，先验必填面）
    r.shopCtx = await call('getShopContext', {});
    r.shopCtxShape = shape(r.shopCtx.raw);
    let shopId = '';
    try { shopId = (r.shopCtx.raw && r.shopCtx.raw.data && r.shopCtx.raw.data.shop_id) || ''; } catch (e) { }
    r.shopId = shopId;

    // ② 已导入账单（读侧）
    if (shopId) {
      const sb = await call('getSalesBills', { shop_id: shopId });
      r.salesBills = {
        shape: shape(sb.raw),
        code: sb.raw && sb.raw.code,
        msg: sb.raw && sb.raw.msg,
        summary: sb.raw && sb.raw.data && sb.raw.data.summary,
        listN: sb.raw && sb.raw.data && sb.raw.data.list ? sb.raw.data.list.length : null,
        list: sb.raw && sb.raw.data && sb.raw.data.list ? sb.raw.data.list.slice(0, 20) : null,
        truncated: sb.raw && sb.raw.data && sb.raw.data.truncated,
        rawHead: sb.raw ? JSON.stringify(sb.raw).slice(0, 600) : null,
      };
      const sba = await call('getSalesBills', { shop_id: shopId, include_cleared: true });
      r.salesBillsInclCleared = {
        shape: shape(sba.raw),
        code: sba.raw && sba.raw.code,
        summary: sba.raw && sba.raw.data && sba.raw.data.summary,
        listN: sba.raw && sba.raw.data && sba.raw.data.list ? sba.raw.data.list.length : null,
      };
    } else {
      r.salesBills = { skipped: 'no shop_id (getShopContext 未返回 shop_id)' };
    }

    // ③ 复盘（R249 主诉）
    // 🔴 入参必须带 shop_id：前端 api.call 会自动注入（utils/api.js::call ⇒
    //    Object.assign({shop_id: globalData.shop_id}, payload)），裸调 callFunction 不会注入
    //    ⇒ 第一版探针传 {} ⇒ INVALID_PARAM，是探针入参错，不是产品缺陷（R242e）。
    const dr = await call('getDishReview', { shop_id: shopId });
    const d = dr.raw && dr.raw.data;
    r.dishReview = {
      shape: shape(dr.raw),
      code: dr.raw && dr.raw.code,
      msg: dr.raw && dr.raw.msg,
      keys: d ? Object.keys(d) : null,
      totals: d && d.totals,
      truncated: d && d.truncated,
      dineInN: d && d.dine_in ? d.dine_in.length : null,
      // 只摘关键计数，避免返回体撑爆 evaluate 通道
      // 🔴 结构：takeaway.by_platform[平台] = { ranked:[], unmatched:[] }
      byPlatform: (() => {
        const bp = d && d.takeaway && d.takeaway.by_platform;
        if (!bp) return null;
        const o = {};
        for (const k of Object.keys(bp)) {
          const g = bp[k] || {};
          o[k] = {
            ranked_n: (g.ranked || []).length,
            unmatched_n: (g.unmatched || []).length,
            unmatched_sample: (g.unmatched || []).slice(0, 8).map((x) => ({ key: x.dish_key || x.name, qty: x.qty, fen: x.amountFen || x.amount_fen })),
          };
        }
        return o;
      })(),
    };

    // ③-bis 直读集合（只读取数，验证「落库行数」与「映射表是否已有记录」）
    try {
      const db = wx.cloud.database();
      const m = await db.collection('shop_dish_mapping').limit(20).get();
      r.mapping = { n: m.data.length, sample: m.data.slice(0, 5) };
    } catch (e) { r.mapping = { err: (e && (e.errMsg || e.message)) || String(e) }; }
    try {
      const db2 = wx.cloud.database();
      const s = await db2.collection('external_sales_daily').limit(3).get();
      r.salesSample = { n: s.data.length, sample: s.data.slice(0, 2) };
    } catch (e) { r.salesSample = { err: (e && (e.errMsg || e.message)) || String(e) }; }

    // ④ 页面自身状态（判「页面读到了什么」而不是只信云返回）
    try {
      const p = getCurrentPages().at(-1);
      r.page = { route: p.route, dataKeys: Object.keys(p.data || {}), billsN: (p.data && p.data.bills) ? p.data.bills.length : null };
    } catch (e) { r.page = { err: String(e) }; }

    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  await mp.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', (e && e.message) || e); process.exit(1); });
