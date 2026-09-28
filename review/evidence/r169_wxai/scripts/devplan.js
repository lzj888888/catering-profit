// devplan.js [clickLabel] —— 进成长计划子应用，可选点击某按钮，抓全部 frame 正文 + 截图
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';
const clickLabel = process.argv[2] || '';

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9233', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  const listFrames = async () => page.frames().map(f => f.url()).filter(Boolean);
  const dumpAll = async (name) => {
    const parts = [];
    for (const f of page.frames()) {
      try {
        const t = await f.evaluate(() => document.body ? document.body.innerText : '');
        if (t && t.trim()) parts.push('---- frame: ' + f.url().slice(0, 140) + ' ----\n' + t);
      } catch (e) { }
    }
    const txt = parts.join('\n');
    fs.writeFileSync(path.join(OUT, name + '_text.txt'), txt);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    return txt;
  };

  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  let token = (page.url().match(/token=(\d+)/) || [])[1] || '';
  console.log('TOKEN=' + token);

  await page.goto('https://mp.weixin.qq.com/wxamp/subApp/devplan/?lang=zh_CN&token=' + token, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  console.log('FRAMES=' + JSON.stringify(await listFrames(), null, 1));

  // 找 devplan 业务 frame
  const biz = page.frames().find(f => f.url().includes('xframe/devplan'));
  if (!biz) { console.log('NO_BIZ_FRAME'); await dumpAll('dp_err'); await ctx.close(); return; }

  // 滚动到底，看有没有「参与计划」按钮
  await biz.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await page.waitForTimeout(1500);

  const btns = await biz.evaluate(() => {
    const out = [];
    document.querySelectorAll('button,a,div[class*=btn],span[class*=btn]').forEach(el => {
      const t = (el.innerText || '').trim();
      if (t && t.length < 20) {
        const r = el.getBoundingClientRect();
        if (r.width > 10 && r.height > 10) out.push({ t, tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    return out;
  });
  console.log('BIZ_BUTTONS=' + JSON.stringify(btns, null, 1));

  const txt = await dumpAll('dp0');
  console.log('DP0_LEN=' + txt.length);

  if (clickLabel) {
    const target = page.frames().find(f => f.url().includes('xframe/devplan'));
    const loc = target.locator('text=' + clickLabel).first();
    try {
      await loc.scrollIntoViewIfNeeded();
      await loc.click({ timeout: 10000 });
      console.log('CLICKED ' + clickLabel);
    } catch (e) {
      console.log('CLICK_FAIL ' + e.message.slice(0, 120));
    }
    await page.waitForTimeout(7000);
    const t2 = await dumpAll('dp1');
    console.log('FRAMES2=' + JSON.stringify(await listFrames(), null, 1));
    console.log('DP1_LEN=' + t2.length);
    console.log('DP1_TAIL=' + JSON.stringify(t2.slice(-1200)));
  }
  await ctx.close();
})().catch(e => { console.error('DP_ERR', e.message); process.exit(1); });
