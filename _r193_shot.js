// R193：站级入口补全自查 —— 模拟器逐页截图（先自己跑，再给李老师看）
// 通道纪律照抄 R188：一次连接内顺序跑完 · 导航用逻辑层 wx.reLaunch（mp.reLaunch 恒 rawPath null）
const automator = require('miniprogram-automator');

const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  // 握手：第一次 reLaunch 常报 timeout（已知，非缺陷）
  try { await mp.reLaunch({ url: '/pages/index/index' }); } catch (e) { /* warmup */ }
  await sleep(3000);

  // 🔴 R188 已知：automator 的 mp.reLaunch 恒 rawPath null（导航不生效）
  //   ⇒ 必须走**逻辑层** wx.reLaunch（在页面上下文里 evaluate 调用）
  async function nav(url, waitMs) {
    try { await mp.evaluate((u) => { wx.reLaunch({ url: u }); }, url); } catch (e) { /* 握手重试 */ }
    await sleep(waitMs || 6000);
  }
  // ⚠️ 首次截图常 timeout（握手现象，R188 同族）⇒ 失败重试一次
  async function shot(name) {
    for (let i = 0; i < 3; i++) {
      try { await mp.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); return; }
      catch (e) { console.log('shot retry', name, i + 1, e && e.message); await sleep(2500); }
    }
  }
  // 读当前页 data（验证草稿恢复 / 新入口是否真的渲染）
  async function dump(name) {
    try {
      const d = await mp.evaluate(() => {
        const p = getCurrentPages().slice(-1)[0];
        return { route: p.route, keys: Object.keys(p.data || {}).slice(0, 40) };
      });
      console.log('state', name, JSON.stringify(d).slice(0, 300));
    } catch (e) { console.log('state', name, 'n/a'); }
  }

  await nav('/pages/mine/index', 7000);
  await dump('mine');
  await shot('mine');

  await nav('/pages/sandbox/index', 8000);
  await dump('sandbox');
  await shot('sandbox');

  await mp.disconnect();
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
