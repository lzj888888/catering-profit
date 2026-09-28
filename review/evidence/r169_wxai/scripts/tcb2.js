// tcb2.js —— 再抓一次云开发 AI 页（等更久，找 Token/额度字样）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';
const ENV = 'cloud1-d4gphpoxy337f2a25';

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9248', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  await page.goto('https://tcb.cloud.tencent.com/dev?envId=' + ENV + '#/ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(8000);
    const t = await page.evaluate(() => document.body ? document.body.innerText : '');
    console.log('t=' + (i + 1) * 8 + 's len=' + t.length + ' loading=' + /正在加载/.test(t));
    if (t.length > 300 && !/正在加载/.test(t)) {
      fs.writeFileSync(path.join(OUT, 'tcb_ai2_text.txt'), t);
      await page.screenshot({ path: path.join(OUT, 'tcb_ai2.png') });
      console.log('TEXT=' + JSON.stringify(t.slice(0, 1500)));
      break;
    }
    if (i === 4) {
      fs.writeFileSync(path.join(OUT, 'tcb_ai2_text.txt'), t);
      await page.screenshot({ path: path.join(OUT, 'tcb_ai2.png') });
      console.log('STILL_LOADING len=' + t.length);
    }
  }
  await ctx.close();
})().catch(e => { console.error('TCB2_ERR', e.message); process.exit(1); });
