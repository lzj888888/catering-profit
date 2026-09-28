// we.js —— 领 We分析专业版：点卡片「领取」→ 弹窗内点「确定」→ 抓结果
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9245', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const dumpAll = async (name) => {
    const parts = [];
    for (const f of page.frames()) {
      try { const t = await f.evaluate(() => document.body ? document.body.innerText : ''); if (t && t.trim()) parts.push('---- frame: ' + f.url().slice(0, 140) + ' ----\n' + t); } catch (e) { }
    }
    const txt = parts.join('\n');
    fs.writeFileSync(path.join(OUT, name + '_text.txt'), txt);
    return txt;
  };
  const scan = (label) => page.mainFrame().evaluate((lb) => {
    const walk = (root, acc) => { root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) walk(el.shadowRoot, acc); if (el.tagName === 'BUTTON' && (el.innerText || '').trim() === lb) acc.push(el); }); return acc; };
    return walk(document, []).map((el, i) => {
      const r = el.getBoundingClientRect();
      let inDlg = false, p = el.parentElement;
      while (p) { const c = (p.className || '').toString(); if (/dialog|modal|popup/i.test(c) && p.getBoundingClientRect().width > 100 && p.getBoundingClientRect().height > 50) { inDlg = true; break; } p = p.parentElement; }
      return { i, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), vis: r.width > 8 && r.height > 8, inDlg };
    });
  }, label);

  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const token = (page.url().match(/token=(\d+)/) || [])[1] || '';
  console.log('TOKEN=' + token);
  await page.goto('https://mp.weixin.qq.com/wxamp/subApp/devplan/home?token=' + token + '&lang=zh_CN', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  const cards = (await scan('领取')).filter(b => b.vis && !b.inDlg);
  console.log('CARD=' + JSON.stringify(cards));
  if (!cards.length) { console.log('NO_CARD'); await ctx.close(); return; }
  await page.mouse.click(cards[0].cx, cards[0].cy);
  await page.waitForTimeout(4500);

  const conf = (await scan('确定')).filter(b => b.vis && b.inDlg);
  console.log('CONFIRM=' + JSON.stringify(conf));
  if (!conf.length) { console.log('NO_CONFIRM_BTN'); await shot('we_noconfirm'); await ctx.close(); return; }
  await page.mouse.move(conf[0].cx, conf[0].cy);
  await page.waitForTimeout(300);
  await page.mouse.click(conf[0].cx, conf[0].cy);
  await page.waitForTimeout(12000);
  await shot('we_done');

  const t = await dumpAll('we_result');
  console.log('DONE_URL=' + page.url());
  console.log('TAIL=' + JSON.stringify(t.replace(/---- frame[^\n]*\n/g, '\n').slice(-1200)));
  console.log('HAS_领取=' + /运营增长[\s\S]*?领取/.test(t));
  await ctx.close();
})().catch(e => { console.error('WE_ERR', e.message); process.exit(1); });
