// r169run.js —— 单进程跑完：确保登录 → 取 token → 依次访问带 token 的后台页 → 落正文+截图
// 用法: node r169run.js "<path1>,<path2>,..."   例: "/wxamp/settings/basic,/wxamp/settings/dev"
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';
const paths = (process.argv[2] || '/wxamp/settings/basic').split(',').map(s => s.trim()).filter(Boolean);
const TICKET = ['slave_sid', 'data_ticket', 'data_bizuin', 'bizuin'];

const dump = async (page, name) => {
  const txt = await page.evaluate(() => document.body ? document.body.innerText : '');
  fs.writeFileSync(path.join(OUT, name + '_text.txt'), txt);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  return txt;
};

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9227', '--start-maximized', '--no-first-run', '--no-default-browser-check']
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  const goRoot = async () => {
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    return page.url();
  };
  const isDead = async () => /登录超时|请重新登录/.test(await page.evaluate(() => document.body ? document.body.innerText : ''));

  let u = await goRoot();
  console.log('root -> ' + u);
  // 会话可能活着：根页会自己跳到 guide?token=
  let token = (u.match(/token=(\d+)/) || [])[1] || '';
  if (!token || await isDead()) {
    // 需要扫码
    const loc = page.locator('img[src*=qrcode]').first();
    if (await loc.count()) {
      const b = await loc.boundingBox();
      if (b) await page.screenshot({ path: OUT + '/qr_now.png', clip: { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10), width: Math.min(400, b.width + 20), height: Math.min(400, b.height + 20) } });
    }
    await page.screenshot({ path: OUT + '/login_now.png' });
    console.log('NEED_SCAN');
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < 120000) {
      await page.waitForTimeout(2500);
      u = page.url();
      const tk = (u.match(/token=(\d+)/) || [])[1];
      if (tk && !(await isDead())) { token = tk; ok = true; break; }
    }
    if (!ok) { console.log('LOGIN_FAIL'); await ctx.close(); process.exit(2); }
    console.log('LOGIN_OK token=' + token);
  } else {
    console.log('SESSION_ALIVE token=' + token);
  }

  // 逐页访问（必须带 token）
  let i = 0;
  for (const p of paths) {
    i++;
    const url = 'https://mp.weixin.qq.com' + p + (p.includes('?') ? '&' : '?') + 'lang=zh_CN&token=' + token;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      const name = 'p' + i + '_' + p.replace(/[^\w]/g, '_');
      const txt = await dump(page, name);
      console.log('[' + i + '] ' + p + ' url=' + page.url() + ' len=' + txt.length + ' dead=' + /登录超时/.test(txt));
      console.log('    head=' + JSON.stringify(txt.slice(0, 300)));
    } catch (e) {
      console.log('[' + i + '] ' + p + ' ERR ' + e.message.slice(0, 120));
    }
  }
  await ctx.close();
})().catch(e => { console.error('RUN_ERR', e.message); process.exit(1); });
