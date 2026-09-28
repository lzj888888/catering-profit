// R169 全流程（单进程前台）：开持久化 Chromium -> 进 mp -> 抓二维码 -> 轮询等扫码 -> 判定 -> 截图
// 用法: node flow.js [waitSec]
const { chromium } = require('playwright');
const fs = require('fs');

const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';
const PROFILE = OUT + '/profile';
const WAIT = parseInt(process.argv[2] || '150', 10) * 1000;
const TICKET = ['slave_sid', 'slave_user', 'data_ticket', 'data_bizuin', 'bizuin', 'sessionid'];

const log = (...a) => console.log('[flow]', ...a);

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9223', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  log('browser ready');
  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const probe = async () => {
    const ck = (await ctx.cookies()).filter(c => c.domain.includes('weixin.qq.com'));
    const txt = await page.evaluate(() => document.body ? document.body.innerText : '');
    return {
      url: page.url(),
      cookies: ck.map(c => c.name),
      ticket: TICKET.some(t => ck.some(c => c.name.includes(t))),
      body: txt,
      timeout: /登录超时|请重新登录/.test(txt),
      loggingIn: /扫码登录/.test(txt)
    };
  };

  const grabQR = async () => {
    const loc = page.locator('img[src*=qrcode]').first();
    if (await loc.count() === 0) return false;
    const box = await loc.boundingBox();
    if (!box) return false;
    const pad = 10;
    const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
    const w = Math.min(400, box.width + pad * 2), h = Math.min(400, box.height + pad * 2);
    await page.screenshot({ path: OUT + '/qr_now.png', clip: { x, y, width: w, height: h } });
    fs.writeFileSync(OUT + '/qr meta.json', JSON.stringify({ x, y, w, h, t: Date.now() }));
    return true;
  };

  let st = await probe();
  log('url=' + st.url, 'timeout=' + st.timeout, 'ticket=' + st.ticket);
  if (st.ticket) { log('ALREADY_LOGGED_IN'); await page.screenshot({ path: OUT + '/already.png', fullPage: false }); await ctx.close(); return; }
  await grabQR();
  await page.screenshot({ path: OUT + '/login_now.png' });
  log('QR captured, polling ' + Math.round(WAIT / 1000) + 's');

  const t0 = Date.now();
  while (Date.now() - t0 < WAIT) {
    await page.waitForTimeout(3000);
    st = await probe();
    if (st.ticket && !st.timeout) {
      log('LOGIN_OK url=' + st.url);
      await page.screenshot({ path: OUT + '/login_ok.png' });
      fs.writeFileSync(OUT + '/login_ok.json', JSON.stringify({ ok: true, t: new Date().toISOString(), url: st.url }, null, 2));
      await ctx.close();
      return;
    }
    if (st.loggingIn) { /* 还在登录页 */ }
    else if (!st.timeout) { /* 已离开登录页（可能跳转） */ }
  }
  st = await probe();
  log('TIMEOUT url=' + st.url, 'ticket=' + st.ticket, 'timeout=' + st.timeout);
  log('bodyHead=' + JSON.stringify(st.body.slice(0, 120)));
  await page.screenshot({ path: OUT + '/login_after.png' });
  await ctx.close();
})().catch(e => { console.error('FLOW_ERR', e.message); process.exit(1); });
