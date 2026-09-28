// url.js "/path1,/path2" —— 单进程：确保登录 → 依次访问（自带 token）→ 抓全部 frame 正文 + 截图
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';
const paths = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9232', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  const allText = async () => {
    const all = [];
    for (const f of page.frames()) {
      try {
        const t = await f.evaluate(() => document.body ? document.body.innerText : '');
        if (t && t.trim()) all.push('---- frame: ' + (f.url() || 'about:blank').slice(0, 140) + ' ----\n' + t);
      } catch (e) { /* ignore */ }
    }
    return all.join('\n');
  };

  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  let token = (page.url().match(/token=(\d+)/) || [])[1] || '';
  if (!token) {
    const loc = page.locator('img[src*=qrcode]').first();
    if (await loc.count()) {
      const b = await loc.boundingBox();
      if (b) await page.screenshot({ path: OUT + '/qr_now.png', clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10), width: Math.min(400, b.width + 20), height: Math.min(400, b.height + 20) } });
    }
    console.log('NEED_SCAN');
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < 120000) {
      await page.waitForTimeout(2500);
      const tk = (page.url().match(/token=(\d+)/) || [])[1];
      if (tk) { token = tk; ok = true; break; }
    }
    if (!ok) { console.log('LOGIN_FAIL'); await ctx.close(); process.exit(2); }
  }
  console.log('TOKEN=' + token);

  let i = 0;
  for (const p of paths) {
    i++;
    const url = 'https://mp.weixin.qq.com' + p + (p.includes('?') ? '&' : '?') + 'lang=zh_CN&token=' + token;
    const name = 'u' + i + '_' + p.replace(/[^\w]/g, '_');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(6500);
      const txt = await allText();
      fs.writeFileSync(path.join(OUT, name + '_text.txt'), txt);
      await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false });
      console.log('[' + i + '] ' + p);
      console.log('    url=' + page.url());
      console.log('    len=' + txt.length + ' dead=' + /登录超时|请重新登录/.test(txt));
      console.log('    body=' + JSON.stringify(txt.replace(/---- frame[^\n]*\n/g, '\n').slice(0, 800)));
    } catch (e) {
      console.log('[' + i + '] ' + p + ' ERR ' + e.message.slice(0, 120));
    }
  }
  await ctx.close();
})().catch(e => { console.error('URL_ERR', e.message); process.exit(1); });
