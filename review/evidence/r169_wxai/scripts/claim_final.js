// claim_final.js —— 主 frame 上操作：开弹窗 → 物理点击弹窗内「领取」→ 抓结果
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9244', '--start-maximized', '--no-first-run', '--no-default-browser-check']
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

  // 找「领取」按钮（含 shadow DOM 穿透），返回 rect + 是否在可见弹窗内
  const scan = () => page.mainFrame().evaluate(() => {
    const walk = (root, acc) => {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) walk(el.shadowRoot, acc);
        if (el.tagName === 'BUTTON' && (el.innerText || '').trim() === '领取') acc.push(el);
      });
      return acc;
    };
    const btns = walk(document, []);
    return btns.map((el, i) => {
      const r = el.getBoundingClientRect();
      let inDlg = false, p = el.parentElement;
      while (p) {
        const c = (p.className || '').toString();
        if (/dialog|modal|popup/i.test(c) && p.getBoundingClientRect().width > 100 && p.getBoundingClientRect().height > 50) { inDlg = true; break; }
        p = p.parentElement;
      }
      return { i, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), vis: r.width > 8 && r.height > 8, inDlg };
    });
  });

  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const token = (page.url().match(/token=(\d+)/) || [])[1] || '';
  console.log('TOKEN=' + token);
  await page.goto('https://mp.weixin.qq.com/wxamp/subApp/devplan/home?token=' + token + '&lang=zh_CN', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);

  let s = await scan();
  console.log('SCAN0=' + JSON.stringify(s));
  const card = s.find(b => b.vis && !b.inDlg);
  if (!card) { console.log('NO_CARD_BTN'); await shot('cf_fail1'); await ctx.close(); return; }
  console.log('CLICK_CARD @' + card.cx + ',' + card.cy);
  await page.mouse.click(card.cx, card.cy);
  await page.waitForTimeout(5000);
  await shot('cf_opened');

  s = await scan();
  console.log('SCAN1=' + JSON.stringify(s));
  const dlg = s.find(b => b.vis && b.inDlg);
  if (!dlg) { console.log('NO_DLG_BTN'); await ctx.close(); return; }
  console.log('CLICK_DLG @' + dlg.cx + ',' + dlg.cy);
  await page.mouse.move(dlg.cx, dlg.cy);
  await page.waitForTimeout(300);
  await page.mouse.click(dlg.cx, dlg.cy);
  await page.waitForTimeout(12000);
  await shot('cf_done');

  const t = await dumpAll('cf_result');
  console.log('DONE_URL=' + page.url());
  console.log('DONE_TAIL=' + JSON.stringify(t.slice(-1600)));
  await ctx.close();
})().catch(e => { console.error('CF_ERR', e.message); process.exit(1); });
