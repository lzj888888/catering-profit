#!/usr/bin/env node
// tools/probe_l3_interaction.js —— L3 模拟器交互链路探针（**可复现，留仓库，用完不删**）
//
// 为什么固化：R724d/R724h/R724i 每轮都写一次性 _xxx.js 走查脚本，用完删掉 ⇒
//   下次想复现「改店名回首页 / 切店重拉」得从头再写一遍，且口径每次不同
//   （与 R724l 抓到的「零桩名单不可复现」是同型病）。本文件把三条链路固定下来。
//
// 射程（L3 模拟器 + 真云）：
//   A 改店名 → 回首页 → 是否看到新名        （R724d F-③ 只验到 onShow 被调用，没真验）
//   B 前端切店 → 各页是否重新加载          （R724i 边界里明确「未逐页验」）
//   C 切店前后时间轴采样：首屏有无旧店残留  （R719「渲染层老板眼睛看见几秒」未验）
// ⚠️ 不替代真机：触控手感 / 键盘顶起 / 字号对比度仍需李老师扫码。
//
// 通道纪律（R724h 实测，别重蹈）：
//   ① 一条连接内**多次短 evaluate**（单次 20+ 云调用必超时）；
//   ② wx.reLaunch 到分包页会**静默失败** ⇒ 每次导航后校验 route，不匹配重试；
//   ③ 云请求比 5s 慢 ⇒ 导航后等 ~9s；④ 不反复 connect（会把通道弄坏）。
//
// 🔴 安全（R724m 事故后重写，别再简化）：改店名走**真云**，会污染 dev。
//   首版事故：只备份「当前店名」+ finally 没切回原店 + 还原校验只看首页店名
//     ⇒ B 链路切到对照店后，还原把**对照店**改成了原店名，首页读到这个名字 = 假成功，
//       原店却留着探针名；连跑两次污染了两家店（Abc / 999 都变成 __L3探针_*）。
//   现在三重保险：
//     ① 备份**全量店名快照**（所有店 id+name），不只当前店；
//     ② finally 先切回原店，再按快照**逐店**写回（saveShopSetting 支持显式 shop_id）；
//     ③ 用 getShopList 全量逐条比对，任何一家不一致都判 red、保留备份文件。
//   若进程被强杀没还原，跑 `node tools/probe_l3_interaction.js --restore` 逐店恢复。
//   ⚠️ 绝不把「还原校验」退化成「读首页店名」—— 那正是假成功的来源。
//
// 前置：开发者工具已登录、自动化通道在 9420（cli.bat auto --auto-port 9420）。
// 运行：node tools/probe_l3_interaction.js            （跑三条链路）
//       node tools/probe_l3_interaction.js --restore （只做还原，用于异常兜底）
// 退出码：0 = 三条链路全部按预期；1 = 有链路不符合预期（详见输出）；2 = 通道/脚本 FATAL。

'use strict';
const fs = require('fs');
const path = require('path');
const automator = require('C:/Users/lzj/.workbuddy/binaries/node/mpauto/node_modules/miniprogram-automator');

const ROOT = path.resolve(__dirname, '..');
const EVID = path.join(ROOT, 'review/evidence/r724m_l3_probe');
const BACKUP = path.join(EVID, '_original_shop.json');
const WS = 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESTORE_ONLY = process.argv.indexOf('--restore') >= 0;

if (!fs.existsSync(EVID)) fs.mkdirSync(EVID, { recursive: true });

// ---------- 通道辅助 ----------
async function evalRetry(mp, label, fn, arg) {
  let last = null;
  for (let i = 0; i < 3; i++) {
    try { return await mp.evaluate(fn, arg); }
    catch (e) { last = e; console.log('  [eval:' + label + '] retry ' + (i + 1) + ' ' + (e && e.message)); await sleep(2000); }
  }
  throw new Error('eval failed: ' + label + ' — ' + (last && last.message));
}

/** 导航 + route 校验（分包页 reLaunch 会静默失败，必须校验）+ 云请求等待 */
async function goto(mp, url, expectRoute, waitMs) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await evalRetry(mp, 'goto:' + expectRoute, (u) => {
      wx.reLaunch({ url: u, fail: () => {} });
      return 1;
    }, url);
    await sleep(waitMs || 9000);
    const st = await evalRetry(mp, 'route:' + expectRoute, () => {
      const ps = getCurrentPages();
      return ps.length ? ps[ps.length - 1].route : '';
    });
    if (st === expectRoute) return st;
    console.log('  [goto] ' + expectRoute + ' 第 ' + attempt + ' 次未到位，实为 ' + st + '，重试');
    await sleep(2500);
  }
  throw new Error('导航失败（route 校验不通过）：' + expectRoute);
}

/** 读当前页 data 的指定字段 */
async function pageData(mp, label, keys) {
  return evalRetry(mp, label, (ks) => {
    const ps = getCurrentPages();
    const p = ps[ps.length - 1];
    const d = p.data || {};
    const o = { route: p.route };
    ks.forEach((k) => { o[k] = d[k]; });
    return o;
  }, keys);
}

// ---------- 页面真跑片段（在小程序上下文里执行）----------
/** 读设置页当前店名/备注 */
const READ_SETTING = () => {
  const ps = getCurrentPages();
  const p = ps[ps.length - 1];
  return { route: p.route, name: p.data.shopName, remark: p.data.remark,
    shopId: (getApp().globalData || {}).shop_id || '' };
};
/** 调页面自己的 onSave（真跑产品代码，含「不传 switches」+「保存后重拉上下文」） */
const SAVE_NAME = (v) => {
  const ps = getCurrentPages();
  const p = ps[ps.length - 1];
  p.data.shopName = v.name;
  p.data.remark = v.remark;
  return p.onSave().then(() => ({ saved: v.name }));
};
/** 真切店：等价于 utils/shopSwitcher.js::switchShop（置 shop_id + shopLoaded=false + 持久化） */
const SWITCH_SHOP = (sid) => {
  const app = getApp();
  app.globalData.shop_id = sid;
  app.globalData.shopLoaded = false;
  try { wx.setStorageSync('shop_switcher_shop_id', sid); } catch (e) {}
  return { shop_id: app.globalData.shop_id, shopLoaded: app.globalData.shopLoaded };
};
/** 列店铺（用于挑对照店，不硬编码 id）*/
const LIST_SHOPS = async () => {
  const r = await wx.cloud.callFunction({ name: 'getShopList', data: {} });
  const list = (r.result && (r.result.list || r.result.data && r.result.data.list)) || [];
  return list.map((s) => ({ shop_id: s.shop_id || s._id, name: s.name || s.shop_name || '' }));
};
/** 全量店名快照（还原校验用 —— 只看当前页店名会假成功，见 R724m 事故）*/
const SNAP_SHOPS = async () => {
  const r = await wx.cloud.callFunction({ name: 'getShopList', data: {} });
  const list = (r.result && (r.result.list || r.result.data && r.result.data.list)) || [];
  return list.map((s) => ({ id: s.shop_id || s._id, name: s.name || s.shop_name || '' }));
};
/** 按快照逐店恢复店名（saveShopSetting 支持显式 shop_id；不传 remark = 不动库）*/
const RESTORE_ALL = async (snap) => {
  const out = [];
  for (const s of snap) {
    const r = await wx.cloud.callFunction({ name: 'saveShopSetting',
      data: { shop_id: s.id, name: s.name, client_request_id: 'l3restore_' + Date.now() + '_' + s.id.slice(-4) } });
    out.push({ id: s.id, name: s.name, code: r.result && r.result.code });
  }
  return out;
};

// ---------- 主流程 ----------
(async () => {
  const report = { at: new Date().toISOString(), layer: 'L3 模拟器 + 真 dev 云', chains: {}, verdict: {} };
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[L3] 已连接 9420；层：模拟器 + 真云（非真机）');

  // ===== 0. 备份：当前店 + **全量店名快照**（供 finally 还原与校验）=====
  // 🔴 R724m 事故：首版只备份「当前店名」，且 finally 没切回原店 ⇒
  //    B 链路切到对照店后，还原操作作用在**对照店**上（把 999 改名成 Abc），
  //    首页读到 Abc 只是因为当时停在对照店 ⇒ **假成功**，原店却留着探针名。
  //    ⇒ 现在备份全量快照；还原按 shop_id 逐店写；校验按全量逐条比对。
  let original = null;
  if (fs.existsSync(BACKUP)) {
    original = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
    console.log('[L3] 发现备份文件，沿用：' + original.name + '（快照 ' + (original.snapshot || []).length + ' 家）');
  } else {
    await goto(mp, '/subpkg/tools/shop/setting', 'subpkg/tools/shop/setting');
    original = await evalRetry(mp, 'readSetting', READ_SETTING);
    original.snapshot = await evalRetry(mp, 'snapShops', SNAP_SHOPS);
    fs.writeFileSync(BACKUP, JSON.stringify(original, null, 2), 'utf8');
    console.log('[L3] 已备份：当前店 ' + original.shopId + ' = ' + original.name
      + '；全量快照 ' + original.snapshot.length + ' 家：' + original.snapshot.map((s) => s.name).join('/'));
  }

  if (RESTORE_ONLY) {
    await evalRetry(mp, 'switchBack', SWITCH_SHOP, original.shopId);
    const calls = await evalRetry(mp, 'restoreAll', RESTORE_ALL, original.snapshot);
    const now = await evalRetry(mp, 'verifySnap', SNAP_SHOPS);
    const bad = now.filter((s) => {
      const want = (original.snapshot || []).find((x) => x.id === s.id);
      return !want || want.name !== s.name;
    });
    console.log('[L3] --restore 逐店写回 ' + calls.length + ' 家；全量比对'
      + (bad.length ? '❌ 仍有 ' + bad.length + ' 家不对：' + JSON.stringify(bad) : '✅ 全部一致'));
    fs.writeFileSync(path.join(EVID, 'restore.json'), JSON.stringify({ at: new Date().toISOString(), calls, bad }, null, 2), 'utf8');
    await mp.disconnect();
    process.exit(bad.length ? 1 : 0);
  }

  const probeName = '__L3探针_' + Date.now().toString().slice(-6);
  const chains = report.chains;

  try {
    // =====================================================
    // A · 改店名 → 回首页 → 是否看到新名（R724d F-③）
    // =====================================================
    console.log('\n===== A · 改店名 → 回首页 → 新名 =====');
    await goto(mp, '/subpkg/tools/shop/setting', 'subpkg/tools/shop/setting');
    const before = await evalRetry(mp, 'A-before', READ_SETTING);
    chains.A = { baselineName: before.name, probeName: probeName };
    await evalRetry(mp, 'A-save', SAVE_NAME, { name: probeName, remark: before.remark });
    // 回首页：reLaunch 触发 onLoad+onShow，首页 onShow 每次直拉 getShopContext
    await goto(mp, '/pages/index/index', 'pages/index/index', 9000);
    const homeAfter = await pageData(mp, 'A-home', ['shopName', 'loading']);
    chains.A.homeShopName = homeAfter.shopName;
    chains.A.pass = homeAfter.shopName === probeName;
    console.log('  ' + (chains.A.pass ? '✅' : '❌') + ' 首页读到：' + homeAfter.shopName
      + '（期望 ' + probeName + '，基线 ' + before.name + '）');

    // =====================================================
    // B · 前端切店 → 各页是否重新加载（R724i 边界）
    // =====================================================
    console.log('\n===== B · 前端切店 → 各页重拉 =====');
    const shops = await evalRetry(mp, 'B-listShops', LIST_SHOPS);
    const curId = before.shopId;
    const other = shops.find((s) => s.shop_id && s.shop_id !== curId);
    chains.B = { shops: shops.length, from: curId, other: other || null };
    if (!other) {
      chains.B.pass = false;
      chains.B.note = '只有一家店，无法做切店对照（不编造结果）';
      console.log('  ⚠️ ' + chains.B.note);
    } else {
      const sw = await evalRetry(mp, 'B-switch', SWITCH_SHOP, other.shop_id);
      chains.B.switched = sw;
      // 时间轴采样：切店后立刻读，看首屏是否先显示旧店名（R719 渲染层）
      chains.C = { samples: [] };
      for (const t of [0, 400, 1000, 2000]) {
        if (t) await sleep(t - (chains.C.samples.length ? chains.C.samples[chains.C.samples.length - 1].t : 0));
        const d = await pageData(mp, 'C-t' + t, ['shopName', 'loading', 'hasProfit']);
        chains.C.samples.push({ t: t, shopName: d.shopName, loading: d.loading, hasProfit: d.hasProfit });
      }
      // 回首页触发 onShow 重拉
      await goto(mp, '/pages/index/index', 'pages/index/index', 9000);
      const homeB = await pageData(mp, 'B-home', ['shopName', 'loading']);
      chains.B.homeShopName = homeB.shopName;
      // 再进原料库（高频页），看是否拿到的是新店数据
      await goto(mp, '/subpkg/biz/material/index', 'subpkg/biz/material/index', 9000);
      const matB = await pageData(mp, 'B-material', ['all', 'list', 'loading']);
      chains.B.material = { all: (matB.all || []).length, list: (matB.list || []).length, loading: matB.loading };
      chains.B.materialDiscriminating = false;
      chains.B.materialNote = '两家店原料库当前都是空的（R724i 测试数据已清理），all=0 无法区分'
        + '「切店后正确读到空库」与「根本没重拉」⇒ 此观察不作证据，B 的判据只看首页店名';
      // 判据：切店后首页店名必须变成另一家（不能仍是基线名）
      chains.B.pass = homeB.shopName !== before.name && !!homeB.shopName;
      chains.B.otherName = other.name;
      console.log('  切到 ' + other.name + '（' + other.shop_id + '）');
      console.log('  首页店名：' + homeB.shopName + ' | 基线：' + before.name);
      console.log('  原料库：all=' + chains.B.material.all + ' list=' + chains.B.material.list + '（两店皆空，不作证据）');
      console.log('  ' + (chains.B.pass ? '✅' : '❌') + ' 切店后首页店名已变');

      // 🔴 C 判据（R724m 自我证伪后重写）：
      //   首版拿 before.name（原始店名 Abc）去比，可页面上显示的其实是 A 链路改过的探针名
      //   ⇒ 永远不匹配 ⇒ pass=true 恒真。而且采样期间**没有重新导航**，页面 data 按小程序
      //   生命周期本来就不会变，四个采样点全同值是必然、零信息量。
      //   更该警惕的是：这恰恰说明「切店后当前页仍显示上一家店名」这个窗口真实存在
      //   （R719 说的首屏串店），但本探针**没资格**给它下通过/不通过的结论。
      const displayBeforeSwitch = chains.A.homeShopName;
      const detector = (samples, oldName) => samples.filter((s) => s.shopName && s.shopName === oldName).length;
      const stale = detector(chains.C.samples, displayBeforeSwitch);
      // 反恒真：喂一个确实含旧名的构造样本，检测函数必须抓到（证明判据本身不是恒真）
      const synthetic = [{ shopName: displayBeforeSwitch }, { shopName: other.name },
        { shopName: displayBeforeSwitch }, { shopName: other.name }];
      chains.C.detectorSane = detector(synthetic, displayBeforeSwitch) === 2;
      chains.C.oldNameUsed = displayBeforeSwitch;
      chains.C.staleSamples = stale;
      chains.C.pass = null;   // null = 本轮未验成，绝不写 true 冒充通过
      chains.C.reason = '采样发生在「切店后、重新导航前」，页面实例未重建、data 不会变，'
        + '4 点同值属必然、无信息量；首版判据还拿错基线（Abc vs 探针名）导致恒真假绿。'
        + '首屏缓存串店需另做「切店后重新进页 + 短等待连续采样」的专门探针，本轮如实标未验。';
      console.log('  C 时间轴：' + chains.C.samples.map((s) => s.t + 'ms=' + (s.shopName || '(空)')).join(' → '));
      console.log('  ⚠️ C 未验成：' + chains.C.reason);
      console.log('  ' + (chains.C.detectorSane ? '✅' : '❌') + ' 检测函数反恒真自检通过（喂旧名样本能抓到）');
    }

    // =====================================================
    // 判定汇总
    // =====================================================
    report.verdict = {
      A: chains.A.pass,
      B: chains.B.pass,
      C: chains.C ? chains.C.pass : null,
      cUnverifiedReason: chains.C ? chains.C.reason : '只有一家店，无法做切店对照',
      note: 'C=null 一律表示「未验成」，不是通过；A/B 才是本轮坐实的两条链路',
    };
  } finally {
    // 🔴 R724m 事故后重写：三步缺一不可
    //   ① 先切回原店（否则还原会作用在 B 链路切过去的对照店上 —— 首版就是这么污染的）；
    //   ② 按全量快照**逐店**写回店名，不只改当前店；
    //   ③ 用 getShopList 全量逐条比对，别只看首页店名（首版「首页读到 Abc」是假成功）。
    console.log('\n===== 还原（切回原店 + 逐店写回 + 全量比对）=====');
    try {
      const sw = await evalRetry(mp, 'finally-switchBack', SWITCH_SHOP, original.shopId);
      const calls = await evalRetry(mp, 'finally-restoreAll', RESTORE_ALL, original.snapshot || []);
      const now = await evalRetry(mp, 'finally-snap', SNAP_SHOPS);
      const snap = original.snapshot || [];
      const bad = now.filter((s) => {
        const want = snap.find((x) => x.id === s.id);
        return !want || want.name !== s.name;
      }).map((s) => ({ id: s.id, now: s.name,
        want: (snap.find((x) => x.id === s.id) || {}).name || '(快照无此店)' }));
      await goto(mp, '/pages/index/index', 'pages/index/index', 7000);
      const back = await pageData(mp, 'finally-check', ['shopName']);
      report.restore = {
        switchedBackTo: sw.shop_id, wrote: calls.length,
        homeReads: back.shopName, mismatch: bad,
        ok: bad.length === 0 && back.shopName === original.name,
      };
      console.log('  切回原店：' + sw.shop_id + '；逐店写回 ' + calls.length + ' 家；首页读到：' + back.shopName);
      console.log('  ' + (report.restore.ok ? '✅ 全量 ' + now.length + ' 家店名与快照一致'
        : '❌ 有 ' + bad.length + ' 家不一致：' + JSON.stringify(bad) + '（请跑 --restore）'));
    } catch (e) {
      report.restore = { ok: false, err: (e && e.message) || String(e) };
      console.log('  ❌ 还原失败，请立刻跑 --restore：' + (e && e.message));
    }
  }

  fs.writeFileSync(path.join(EVID, 'l3_report.json'), JSON.stringify(report, null, 2), 'utf8');
  // 备份文件在成功还原后删除；未还原则保留，供 --restore 使用
  if (report.restore && report.restore.ok && fs.existsSync(BACKUP)) fs.unlinkSync(BACKUP);

  console.log('\n===== L3 结论 =====');
  console.log(JSON.stringify(report.verdict));
  const abOk = report.verdict.A === true && report.verdict.B === true;
  const allPass = abOk && report.restore && report.restore.ok;
  console.log((abOk ? '✅ A/B 两条链路坐实' : '❌ A/B 有不符合预期')
    + '；C 未验成（判据恒真已自我证伪并撤回，另开台账票）'
    + '；数据' + (report.restore && report.restore.ok ? '已还原' : '还原失败，速跑 --restore'));
  await mp.disconnect();
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.log('FATAL ' + (e && (e.stack || e.message)));
  console.log('⚠️ 若 dev 店名被改成探针名，请立刻跑：node tools/probe_l3_interaction.js --restore');
  process.exit(2);
});
