// r731_shot_probe.js —— 截沙盘「开店投入（一次性）」输入行的真实渲染，为宽度问题取客观依据。
// automator 截图不含系统导航栏，但输入行在页面内容区，能截到。
const a = require('miniprogram-automator');
const fs = require('fs');
const OUT = process.argv[2] || 'review/evidence/r731_shots';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mp;

async function ev(fn, arg, tries) {
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return await mp.evaluate(fn, arg); } catch (e) { if (i === n - 1) throw e; await sleep(1200); }
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  mp = await a.connect({ wsEndpoint: WS });

  await ev(() => { wx.reLaunch({ url: '/subpkg/tools/sandbox/index', fail: () => {} }); return 1; }).catch(() => {});
  await sleep(5000);

  const page = await mp.currentPage();
  console.log('route = ' + page.path);

  // 找「开店投入（一次性）」区块位置：按 sec 文案定位
  const box = await ev(() => {
    const q = (sel) => {
      try { return wx.createSelectorQuery().select(sel); } catch (e) { return null; }
    };
    return new Promise((resolve) => {
      const r = wx.createSelectorQuery();
      r.selectAll('.card2').boundingClientRect();
      r.selectViewport().scrollOffset();
      r.exec((res) => {
        const cards = (res && res[0]) || [];
        const sc = (res && res[1]) || { scrollTop: 0 };
        resolve({ count: cards.length, rects: cards.map((c) => ({ top: c.top, h: c.height })), scrollTop: sc.scrollTop });
      });
    });
  }).catch((e) => { console.log('query fail ' + e.message); return null; });
  console.log('card2 blocks = ' + JSON.stringify(box));

  // 「开店投入」是第 5 张卡（索引 4，前面还有业态/面积等）——逐张滚动截图，回来人工挑
  const shots = [];
  for (let i = 0; i < 6; i++) {
    await ev((y) => { wx.pageScrollTo({ scrollTop: y, duration: 0 }); return 1; }, i * 600).catch(() => {});
    await sleep(700);
    const p = OUT + '/sandbox_' + i + '.png';
    try { await mp.screenshot({ path: p }); shots.push(p); } catch (e) { console.log('shot ' + i + ' fail ' + e.message); }
  }
  console.log('SHOTS ' + JSON.stringify(shots));
  await mp.disconnect().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('SHOT_ERROR ' + e.message); process.exit(2); });
