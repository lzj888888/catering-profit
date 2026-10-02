// R192 自查：驱动模拟器截三张图 —— M3 枢纽页 / 成本卡列表 / 版本历史（趋势图）
// 🔴 通道纪律照抄 R188：① 一次连接内顺序跑完 ② 导航用逻辑层 wx.reLaunch（mp.reLaunch 恒 null）
//    ③ 读 state 用 getCurrentPages().at(-1).data ④ 截图用 mp.screenshot
const automator = require('miniprogram-automator');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const out = process.argv[2];
  const ws = process.argv[3] || 'ws://127.0.0.1:9420';
  const mp = await automator.connect({ wsEndpoint: ws });
  console.log('connected', ws);

  const nav = async (url, wait) => {
    await mp.evaluate((u) => { wx.reLaunch({ url: u, fail: () => {} }); return 1; }, url);
    await sleep(wait || 3500);
  };
  const dump = async (label) => {
    try {
      const d = await mp.evaluate(() => {
        const p = getCurrentPages().at(-1);
        return { route: p.route, keys: Object.keys(p.data) };
      });
      console.log(label, '=>', JSON.stringify(d));
    } catch (e) { console.log(label, 'dump fail:', e.message); }
  };
  const shot = async (name) => {
    await mp.screenshot({ path: out + '/' + name + '.png' });
    console.log('shot', name);
  };

  await nav('/pages/m3/hub', 4000);
  await dump('hub');
  await shot('hub');

  await nav('/pages/card/index', 9000);   // 列表要等云数据回来（5s 时截到的是「加载中…」旧帧）
  await dump('card');
  await shot('card');

  // 版本页要 card_code：从列表页 state 里取第一张（取不到就跳过，不硬造参数）
  let cc = '';
  try {
    cc = await mp.evaluate(() => {
      const p = getCurrentPages().at(-1);
      const l = (p.data && p.data.list) || [];
      return l.length ? l[0].card_code : '';
    });
  } catch (e) { cc = ''; }
  console.log('card_code =', JSON.stringify(cc));
  if (cc) {
    await nav('/pages/card/version?card_code=' + cc, 5000);
    await dump('version');
    await shot('version');
  }

  await nav('/pages/material/index', 4500);
  await dump('material');
  await shot('material');

  await mp.disconnect();
  console.log('done');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
