// tokeninfo.js —— 点开「云开发资源及混元免费Token」的「去使用」，抓额度/有效期详情（含新开标签页）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9246', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const dumpPage = async (pg, name) => {
    try {
      const t = await pg.evaluate(() => document.body ? document.body.innerText : '');
      fs.writeFileSync(path.join(OUT, name + '_text.txt'), t);
      await pg.screenshot({ path: path.join(OUT, name + '.png') });
      console.log('  page ' + name + ' url=' + pg.url().slice(0, 110) + ' len=' + t.length);
      return t;
    } catch (e) { console.log('  dump_err ' + e.message.slice(0, 80)); return ''; }
  };

  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const token = (page.url().match(/token=(\d+)/) || [])[1] || '';
  console.log('TOKEN=' + token);
  await page.goto('https://mp.weixin.qq.com/wxamp/subApp/devplan/home?token=' + token + '&lang=zh_CN', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  const scan = (label) => page.mainFrame().evaluate((lb) => {
    const walk = (root, acc) => { root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) walk(el.shadowRoot, acc); if (el.tagName === 'BUTTON' && (el.innerText || '').trim() === lb) acc.push(el); }); return acc; };
    return walk(document, []).map((el, i) => { const r = el.getBoundingClientRect(); return { i, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), vis: r.width > 8 && r.height > 8 }; });
  }, label);

  const btns = (await scan('去使用')).filter(b => b.vis);
  console.log('USE_BTNS=' + JSON.stringify(btns));
  if (!btns.length) { console.log('NO_USE_BTN'); await ctx.close(); return; }

  const before = ctx.pages().length;
  await page.mouse.click(btns[0].cx, btns[0].cy);
  await page.waitForTimeout(8000);
  const after = ctx.pages();
  console.log('PAGES_BEFORE=' + before + ' AFTER=' + after.length);
  for (let i = 0; i < after.length; i++) {
    const pg = after[i];
    if (pg.url().includes('mp.weixin.qq.com/wxamp') && !pg.url().includes('devplan')) continue;
    await dumpPage(pg, 'use_' + i);
  }
  for (const pg of after) {
    if (pg === page) continue;
    const t = await pg.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    fs.writeFileSync(path.join(OUT, 'usetab_' + (pg.url().replace(/[^\w]/g, '_').slice(0, 40)) + '.txt'), t);
    console.log('TAB ' + pg.url().slice(0, 120) + ' len=' + t.length);
    await pg.screenshot({ path: path.join(OUT, 'usetab_' + pg.url().replace(/[^\w]/g, '_').slice(0, 40) + '.png') }).catch(() => { });
  }
  await ctx.close();
})().catch(e => { console.error('TI_ERR', e.message); process.exit(1); });
