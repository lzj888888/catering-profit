/* R760：换暖米黄底色后，拍首页 + M3 两页对比
 * 稳定通道（R188/R759 踩坑固化）：
 *   - 用 mp.evaluate(() => wx.reLaunch(...))，不用 mp.reLaunch
 *   - evaluate 内不写 async（会超时）
 *   - 首跳后轮询 route 到位再截图，避免截到空白页 */
const automator = require('C:/Users/lzj/.workbuddy/binaries/node/mpauto/node_modules/miniprogram-automator');
const fs = require('fs');
const OUT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function goto(mp, url, wantRoute) {
  // 🔴 R759 踩坑：mp.evaluate 第二参数在部分版本传不进闭包 ⇒ URL 写死进函数体
  const navFn = new Function('wx.reLaunch({url:"' + url + '",fail:function(){}}); return 1;');
  await mp.evaluate(navFn);
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    try {
      const routes = await mp.evaluate(() => getCurrentPages().map((p) => p.route).join(','));
      if (routes.indexOf(wantRoute) >= 0) return wantRoute;
    } catch (e) {}
  }
  return null;
}

(async () => {
  let mp = null;
  const report = { time: new Date().toISOString(), shots: [], errors: [] };
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
    console.log('connected');
    console.log('probe=', await mp.evaluate(() => 1 + 1));

    for (const item of [
      { url: '/pages/index/index', route: 'pages/index/index', name: 'r760_home.png' },
      { url: '/pages/m3/hub', route: 'pages/m3/hub', name: 'r760_m3_hub.png' },
    ]) {
      const route = await goto(mp, item.url, item.route);
      if (!route) { report.errors.push('导航失败: ' + item.route); console.log('  NAV FAIL', item.route); continue; }
      await sleep(1200);
      const path = OUT + '/' + item.name;
      await mp.screenshot({ path });
      report.shots.push({ route, path });
      console.log('  shot', route, '->', path);
    }
  } catch (e) {
    report.errors.push(String(e && e.message || e));
    console.error('FATAL', e && e.message || e);
  } finally {
    if (mp) { try { await mp.disconnect(); } catch (e) {} }
    fs.writeFileSync(OUT + '/r760_theme_report.json', JSON.stringify(report, null, 2));
  }
  console.log('DONE shots=%d errors=%d', report.shots.length, report.errors.length);
  process.exit(report.errors.length || report.shots.length < 2 ? 1 : 0);
})();
