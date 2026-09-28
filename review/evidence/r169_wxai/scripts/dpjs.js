// dpjs.js "<按钮文本>" —— 在成长计划 iframe 内用 JS 直接 el.click()，并报告按钮属性
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';
const label = process.argv[2] || '参与计划';

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9235', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();

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
    console.log('  dumped ' + name + ' len=' + txt.length);
    return txt;
  };

  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const token = (page.url().match(/token=(\d+)/) || [])[1] || '';
  console.log('TOKEN=' + token);

  await page.goto('https://mp.weixin.qq.com/wxamp/subApp/devplan/?lang=zh_CN&token=' + token, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  const biz = page.frames().find(f => f.url().includes('xframe/devplan'));
  if (!biz) { console.log('NO_BIZ_FRAME'); await ctx.close(); return; }

  // 报告按钮详情
  const meta = await biz.evaluate((lb) => {
    const btns = [...document.querySelectorAll('button')].filter(b => (b.innerText || '').trim() === lb);
    const out = btns.map(b => {
      const r = b.getBoundingClientRect();
      return { cls: b.className, disabled: b.disabled, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), html: b.outerHTML.slice(0, 300) };
    });
    // 也看看有没有遮罩
    const masks = [...document.querySelectorAll('div')].filter(d => {
      const c = (d.className || '').toString();
      const r = d.getBoundingClientRect();
      return (c.includes('mask') || c.includes('overlay') || c.includes('dialog')) && r.width > 200 && r.height > 200;
    }).map(d => ({ cls: (d.className || '').toString().slice(0, 80), w: Math.round(d.getBoundingClientRect().width) }));
    return { btns: out, masks, docH: document.documentElement.scrollHeight, viewH: window.innerHeight };
  }, label);
  console.log('META=' + JSON.stringify(meta, null, 1));
  await dumpAll('dp_before');

  const r = await biz.evaluate((lb) => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === lb);
    if (!b) return 'NOT_FOUND';
    try { b.scrollIntoView({ block: 'center' }); } catch (e) { }
    b.click();
    return 'CLICKED';
  }, label);
  console.log('JS_CLICK=' + r);
  await page.waitForTimeout(9000);

  const txt = await dumpAll('dp_after_js');
  console.log('AFTER_URL=' + page.url());
  console.log('AFTER_FRAMES=' + JSON.stringify(page.frames().map(f => f.url()).filter(Boolean), null, 1));
  console.log('AFTER_TAIL=' + JSON.stringify(txt.slice(-1200)));
  await ctx.close();
})().catch(e => { console.error('DPJS_ERR', e.message); process.exit(1); });
