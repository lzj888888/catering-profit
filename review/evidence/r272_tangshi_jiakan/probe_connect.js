/**
 * automator 通道探活：先试 connect（限时），失败再试 launch（cliPath + projectPath）。
 * 目的：判明 9420 握手后挂住是「小程序没跑起来」还是「通道不可用」。
 */
const automator = require('miniprogram-automator');
const fs = require('fs');

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420';
const CLI = 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat';
const PROJ = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const OUT = process.env.MP_OUT || 'C:/Users/lzj/AppData/Local/Temp/probe_connect.json';

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const withTimeout = (p, ms, label) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_' + label + '_' + ms + 'ms')), ms)),
]);

const r = { ws: WS, steps: [] };

(async () => {
  // a) 直接 connect
  log('A. connect ...');
  let mp = null;
  try {
    mp = await withTimeout(automator.connect({ wsEndpoint: WS }), 30000, 'connect');
    log('A. connect OK');
    r.steps.push(['connect', 'OK']);
  } catch (e) {
    log('A. connect FAIL:', e && e.message);
    r.steps.push(['connect', 'FAIL', e && e.message]);
  }

  // b) launch
  if (!mp) {
    log('B. launch ...');
    try {
      mp = await withTimeout(
        automator.launch({ cliPath: CLI, projectPath: PROJ, timeout: 90000 }), 120000, 'launch');
      log('B. launch OK');
      r.steps.push(['launch', 'OK']);
    } catch (e) {
      log('B. launch FAIL:', e && e.message);
      r.steps.push(['launch', 'FAIL', e && e.message]);
    }
  }

  if (!mp) {
    log('CONCLUSION: 通道不通（connect 与 launch 都失败）');
    r.ok = false;
    fs.writeFileSync(OUT, JSON.stringify(r, null, 2), 'utf8');
    process.exit(2);
  }

  // c) 拿页面 + 拿 shop_id
  try {
    const p = await mp.currentPage();
    log('page:', p && p.path);
    r.steps.push(['currentPage', p && p.path]);
  } catch (e) {
    log('currentPage FAIL:', e && e.message);
    r.steps.push(['currentPage', 'FAIL', e && e.message]);
  }

  try {
    const res = await mp.evaluate(() => new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'getShopList', data: {},
        success: (x) => resolve({ ok: true, result: x.result }),
        fail: (e) => resolve({ ok: false, err: (e && (e.errMsg || e.message)) || String(e) }),
      });
    }));
    log('getShopList:', JSON.stringify(res).slice(0, 400));
    r.steps.push(['getShopList', res]);
    r.ok = true;
  } catch (e) {
    log('getShopList FAIL:', e && e.message);
    r.steps.push(['getShopList', 'FAIL', e && e.message]);
  }

  try { await mp.disconnect(); } catch (e) {}
  fs.writeFileSync(OUT, JSON.stringify(r, null, 2), 'utf8');
  log('DONE ->', OUT);
  process.exit(r.ok ? 0 : 1);
})().catch((e) => {
  log('FATAL:', e && e.message);
  r.steps.push(['FATAL', e && e.message]);
  try { fs.writeFileSync(OUT, JSON.stringify(r, null, 2), 'utf8'); } catch (_) {}
  process.exit(9);
});
