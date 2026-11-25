// review/evidence/r757_device_probe/_cloud_probe.js —— T1 云存储链路验证（终版）
//
// 🔴 验的是**最有说服力的那条**：填数 → 确认上云 → **清空本地（模拟换设备）** → 从云端恢复。
//   这条通了，才算真的"换设备能读回"。
//
// 🔴 四个必须记住的坑（每个都花了半小时）：
//   ① `mp.reLaunch(url)` 必炸 `getPageMetaByWebviewId(...) as it is null`（技能 R188）
//      ⇒ 唯一通道是**逻辑层** `wx.reLaunch`（走 evaluate）。
//   ② `mp.evaluate(async () => {...})` **必 timeout**（automator 不等 async）
//      ⇒ 异步动作一律"发起即返回 + 结果写 storage + 轮询"。
//   ③ **同一连接连续 reLaunch 会把页面栈搞乱**（实例缺方法、months 为空）
//      ⇒ 一次连接只 reLaunch 一次。
//   ④ 改完代码必须 `cli close` + `cli open` 才会重新编译（`touch` 不触发）。
//      否则验的是旧代码 —— 会出现"文件里明明有、页面实例上没有"的鬼故事。
//
// 🔴 还有一个 API 事实（真机实测推翻假设）：
//   `wx.cloud.getTempFileURL` **不认 cloudPath，只认 fileID**（cloudPath 返回 status=1）。
//   fileID = `cloud://{env}.{bucket}/{path}`，故 consumeStore 用「上传 _ping.txt 学 env/bucket」。

const automator = require('C:/Users/lzj/WorkBuddy/Claw/catering-profit/node_modules/miniprogram-automator');

const WS = 'ws://127.0.0.1:9420';
const OUT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r757_device_probe/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  → ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('已连接模拟器逻辑层\n');

  // ===== ① reLaunch + 等 init =====
  await mp.evaluate(() => { wx.reLaunch({ url: '/subpkg/tools/recon/index' }); });
  let st = null;
  for (let i = 0; i < 6; i++) {
    await sleep(2500);
    st = await mp.evaluate(() => {
      const p = getCurrentPages().pop();
      const app = getApp();
      return {
        route: p ? p.route : '(none)',
        months: (p && p.data && p.data.months || []).length,
        curMonth: (p && p.data && p.data.curMonth) || '',
        ready: !!(p && typeof p.pushToCloud === 'function' && typeof p.syncFromCloud === 'function' && typeof p.loadNonsales === 'function'),
        shopId: (app && app.globalData && app.globalData.shop_id) || '',
      };
    });
    if (st.ready && st.months > 0) break;
  }
  check('对账页加载 + 新代码就位', st.route.indexOf('recon') >= 0 && st.ready, JSON.stringify(st));
  if (!st.ready) { await mp.disconnect().catch(() => {}); process.exit(1); }

  // ===== ② 清场：把本月本地数据清掉，保证测的是干净路径 =====
  await mp.evaluate((month) => {
    try {
      for (const k of wx.getStorageInfoSync().keys) {
        if (k.indexOf('nonsales') >= 0 && k.indexOf(month) >= 0) wx.removeStorageSync(k);
        if (k.indexOf('consume_sync_at') >= 0 && k.indexOf(month) >= 0) wx.removeStorageSync(k);
      }
      wx.removeStorageSync('consume_upload_err');
    } catch (e) {}
    return 'cleared';
  }, st.curMonth);

  // ===== ③ 填 80 元 → 等防抖 + 上传 =====
  await mp.evaluate(() => { getCurrentPages().pop().onNonsales({ detail: { value: '80' } }); return 'ok'; });
  await sleep(9000);
  const afterFill = await mp.evaluate((m) => {
    const p = getCurrentPages().pop();
    let upErr = '';
    try { upErr = wx.getStorageSync('consume_upload_err') || ''; } catch (e) {}
    return { local: p.loadNonsales(m), upErr };
  }, st.curMonth);
  check('填 80 元后本地写入 8000 分', afterFill.local === 8000, String(afterFill.local));
  check('上传无报错（consume_upload_err 为空）', !afterFill.upErr, afterFill.upErr || '空');

  // ===== ④ 清空本地 —— 模拟换设备 =====
  const cleared = await mp.evaluate((month) => {
    let n = 0;
    try {
      for (const k of wx.getStorageInfoSync().keys) {
        if ((k.indexOf('nonsales') >= 0 && k.indexOf(month) >= 0)
          || (k.indexOf('consume_sync_at') >= 0 && k.indexOf(month) >= 0)) { wx.removeStorageSync(k); n++; }
      }
    } catch (e) {}
    const p = getCurrentPages().pop();
    return { removed: n, localAfterClear: p.loadNonsales(month) };
  }, st.curMonth);
  check('本地已清空（模拟换设备/清缓存）',
    cleared.removed > 0 && cleared.localAfterClear === 0, JSON.stringify(cleared));

  // ===== ⑤ 调 syncFromCloud 从云端恢复 =====
  await mp.evaluate((month) => {
    try { getCurrentPages().pop().syncFromCloud(month); } catch (e) {}
    return 'started';
  }, st.curMonth);

  let restored = 0;
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    restored = await mp.evaluate((m) => {
      const p = getCurrentPages().pop();
      return p.loadNonsales(m);
    }, st.curMonth);
    if (restored === 8000) break;
  }
  check('🔴 从云端恢复成功：本地又变回 8000 分', restored === 8000, String(restored));

  // ===== ⑥ 界面也同步（nonsalesYuan 应该变回 "80.00"）=====
  const ui = await mp.evaluate(() => {
    const p = getCurrentPages().pop();
    return { nonsalesYuan: p.data.nonsalesYuan };
  });
  check('界面输入框同步回填 80.00', String(ui.nonsalesYuan) === '80.00', String(ui.nonsalesYuan));

  // ===== ⑦ 截图 =====
  try {
    await mp.screenshot({ path: OUT + 'recon_page.png' });
    console.log('⑦ 截图：' + OUT + 'recon_page.png');
  } catch (e) { console.log('⑦ 截图失败：' + e.message); }

  await mp.disconnect().catch(() => {});
  console.log('\n⚠️ 模拟器验的是「真实 handler + 上传 + 清本地后从云端恢复」，不替代真机渲染/手感。');
  console.log('==== T1 云存储链路：' + pass + ' 通过 / ' + failN + ' 失败 ====');
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => {
  console.error('探针异常：', e && (e.stack || e.message));
  process.exit(3);
});
