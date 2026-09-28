// click_dlg2.js —— 用 frame locator 点击（自动换算坐标）：开弹窗 → 点弹窗内「领取」→ 抓结果
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9243', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n + '.png') }); };
  const dumpAll = async (name) => {
    const parts = [];
    for (const f of page.frames()) {
      try { const t = await f.evaluate(() => document.body ? document.body.innerText : ''); if (t && t.trim()) parts.push('---- frame: ' + f.url().slice(0, 140) + ' ----\n' + t); } catch (e) { }
    }
    const txt = parts.join('\n');
    fs.writeFileSync(path.join(OUT, name + '_text.txt'), txt);
    return txt;
  };
  const report = async (tag) => {
    for (const f of page.frames()) {
      try {
        const n = await f.locator('button:has-text("领取")').count();
        if (n) console.log('  [' + f.url().slice(0, 60) + '] 领取按钮数=' + n);
      } catch (e) { }
    }
  };

  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const token = (page.url().match(/token=(\d+)/) || [])[1] || '';
  console.log('TOKEN=' + token);
  await page.goto('https://mp.weixin.qq.com/wxamp/subApp/devplan/home?token=' + token + '&lang=zh_CN', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  const biz = page.frames().find(f => f.url().includes('xframe/devplan/home'));
  console.log('BIZ=' + (biz ? biz.url().slice(0, 70) : 'none'));
  console.log('BEFORE:'); await report('before');

  const cardBtns = biz.locator('button:has-text("领取")');
  console.log('CARD_COUNT=' + await cardBtns.count());
  await cardBtns.nth(0).click({ timeout: 15000 });
  console.log('clicked card 领取');
  await page.waitForTimeout(4000);
  await shot('cd2_opened');
  console.log('AFTER_OPEN:'); await report('opened');

  // 弹窗内的领取：在出现的 frame 里取最后一个
  let done = false;
  for (const f of page.frames()) {
    try {
      const bs = f.locator('button:has-text("领取")');
      const n = await bs.count();
      if (!n) continue;
      for (let i = n - 1; i >= 0; i--) {
        const el = bs.nth(i);
        if (!(await el.isVisible())) continue;
        const inDlg = await el.evaluate(e => {
          let p = e.parentElement;
          while (p && p !== document.body) { const c = (p.className || '').toString(); if (/dialog|modal|popup/i.test(c) && p.getBoundingClientRect().width > 100) return true; p = p.parentElement; }
          return false;
        });
        if (!inDlg) continue;
        console.log('CLICK_DLG_BTN frame=' + f.url().slice(0, 60) + ' idx=' + i);
        await el.click({ timeout: 15000 });
        done = true; break;
      }
    } catch (e) { }
    if (done) break;
  }
  console.log('DLG_CLICKED=' + done);
  await page.waitForTimeout(12000);
  await shot('cd2_done');
  const t = await dumpAll('cd2_result');
  console.log('DONE_URL=' + page.url());
  console.log('DONE_TAIL=' + JSON.stringify(t.slice(-1500)));
  await ctx.close();
})().catch(e => { console.error('CD2_ERR', e.message); process.exit(1); });
