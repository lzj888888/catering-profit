// review/evidence/shot_m3_hub_r758.js —— M3 枢纽页图标改版截图（R758）
// 通道：R188 逻辑层 wx.reLaunch（mp.reLaunch 本机 pageMeta 恒 null 全死）
const automator = require('C:/Users/lzj/.workbuddy/binaries/node/mpauto/node_modules/miniprogram-automator');
const path = require('path');

const OUT = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
    console.log('connected');

    // 第 1 跳就是目标页（R193：连接后第 1 跳最可靠）
    await mp.evaluate(() => {
      wx.reLaunch({ url: '/pages/m3/hub', fail: () => {} });
      return 1;
    });
    await sleep(3500); // 静态页 3.5s；hub 有 loadCount 云读，给足

    // 逻辑层读 state —— 确认 8 图标路径 + 5 徽标都在视图模型里
    const st = await mp.evaluate(() => {
      const p = getCurrentPages().at(-1);
      return { route: p.route, t: p.data.t, cardCount: p.data.cardCount, stepFlags: p.data.stepFlags };
    });
    console.log('route =', st.route);
    console.log('cardCount =', st.cardCount, 'stepFlags =', JSON.stringify(st.stepFlags));
    const icoKeys = ['icoCard', 'icoMaterial', 'icoTakeaway', 'icoGroupon', 'icoReview', 'icoRevenue', 'icoRecon', 'icoPromo'];
    const badgeKeys = ['badgeDone', 'badgeTodo', 'badgeBuilt', 'badgeTool', 'badgeData'];
    icoKeys.forEach((k) => console.log('  ' + k + ' = ' + JSON.stringify(st.t[k])));
    badgeKeys.forEach((k) => console.log('  ' + k + ' = ' + JSON.stringify(st.t[k])));

    // 截图（重试 3 次，mp.screenshot 偶发 timeout）
    let shot = false;
    for (let i = 0; i < 3 && !shot; i++) {
      try {
        await mp.screenshot({ path: path.join(OUT, 'r758_m3_hub_icons.png') });
        shot = true;
        console.log('screenshot OK (try ' + (i + 1) + ')');
      } catch (e) { console.log('screenshot retry ' + (i + 1) + ': ' + e.message); await sleep(1500); }
    }

    // 机器断言：8 图标 + 5 徽标都在视图模型里、路径都是 /images/hub/
    const icoOk = icoKeys.every((k) => typeof st.t[k] === 'string' && st.t[k].indexOf('/images/hub/') === 0);
    const badgeOk = badgeKeys.every((k) => typeof st.t[k] === 'string' && st.t[k].length > 0);
    console.log('ASSERT icons-in-viewmodel:', icoOk ? 'PASS' : 'FAIL');
    console.log('ASSERT badges-in-viewmodel:', badgeOk ? 'PASS' : 'FAIL');
    console.log('ASSERT screenshot:', shot ? 'PASS' : 'FAIL');

    require('fs').writeFileSync(path.join(OUT, 'r758_m3_hub_report.json'), JSON.stringify({
      route: st.route, cardCount: st.cardCount, stepFlags: st.stepFlags,
      icons: icoKeys.map((k) => ({ key: k, value: st.t[k] })),
      badges: badgeKeys.map((k) => ({ key: k, value: st.t[k] })),
      assertions: { icons: icoOk, badges: badgeOk, screenshot: shot },
    }, null, 2));
  } catch (e) {
    console.error('FATAL', e && e.message);
    process.exitCode = 1;
  } finally {
    // R181n④：显式退出，automator 连接句柄会挂住事件循环
    process.exit(process.exitCode || 0);
  }
})();
