// _r181n_diag.js —— 通道诊断：分辨「reLaunch 专属故障」还是「全部页面 API 故障」
const automator = require('miniprogram-automator');
const WS = process.argv[2] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const MAXA = Number(process.env.DIAG_ATTEMPTS || 5);
  for (let attempt = 1; attempt <= MAXA; attempt++) {
    console.log('===== attempt ' + attempt + ' =====');
    let mp = null;
    try {
      mp = await automator.connect({ wsEndpoint: WS });
      console.log('  connect: ok');
    } catch (e) {
      console.log('  connect: FAIL ' + (e && e.message)); await sleep(15000); continue;
    }
    try {
      const info = await mp.systemInfo();
      console.log('  systemInfo: ok platform=' + info.platform);
    } catch (e) { console.log('  systemInfo: FAIL ' + (e && e.message)); }
    try {
      const t = await mp.evaluate(() => 1 + 1);
      console.log('  evaluate(1+1): ' + t);
    } catch (e) { console.log('  evaluate: FAIL ' + (e && e.message)); }
    try {
      const n = await mp.evaluate(() => getCurrentPages().length);
      console.log('  getCurrentPages().length: ' + n);
    } catch (e) { console.log('  getCurrentPages: FAIL ' + (e && e.message)); }
    try {
      const p = await mp.currentPage();
      console.log('  currentPage: ok path=' + p.path);
    } catch (e) { console.log('  currentPage: FAIL ' + (e && e.message)); }
    try {
      await mp.reLaunch('/pages/index/index');
      console.log('  reLaunch: ok');
      const p2 = await mp.currentPage();
      console.log('  after reLaunch currentPage=' + p2.path);
      try { await mp.disconnect(); } catch (e) {}
      console.log('  => CHANNEL_OK');
      process.exit(0);
    } catch (e) { console.log('  reLaunch: FAIL ' + (e && e.message)); }
    try { await mp.disconnect(); } catch (e) {}
    await sleep(18000);
  }
  console.log('=> CHANNEL_BAD (' + MAXA + ' attempts)');
  process.exit(1);
})();
