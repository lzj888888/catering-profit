// fill.js [--submit] —— 打开参与计划弹窗；填两个字段 + 勾同意；--submit 才点确定
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r169';
const SUBMIT = process.argv.includes('--submit');

const INTRO = '餐饮店算——帮餐厅老板算清每月盈利的记账工具：录入收入和成本，自动算出月度利润、菜品毛利与成本红线，让开店的人一眼看清每月到底剩多少钱。';
const CHANNEL = '微信公众平台小程序后台的官方公告（小程序成长计划页面）';

(async () => {
  const ctx = await chromium.launchPersistentContext(OUT + '/profile', {
    headless: false, viewport: null,
    args: ['--remote-debugging-port=9236', '--start-maximized', '--no-first-run', '--no-default-browser-check']
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
    console.log('  dumped ' + name);
    return txt;
  };

  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const token = (page.url().match(/token=(\d+)/) || [])[1] || '';
  console.log('TOKEN=' + token);
  await page.goto('https://mp.weixin.qq.com/wxamp/subApp/devplan/?lang=zh_CN&token=' + token, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  let biz = page.frames().find(f => f.url().includes('xframe/devplan'));
  if (!biz) { console.log('NO_BIZ_FRAME'); await ctx.close(); return; }

  // 打开弹窗
  await biz.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '参与计划');
    if (b) b.click();
  });
  await page.waitForTimeout(3500);

  // 表单结构
  const form = await biz.evaluate(() => {
    const areas = [...document.querySelectorAll('textarea,input[type=text]')].map((el, i) => ({
      i, tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), ph: el.placeholder || '', maxlen: el.maxLength,
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()
    }));
    const boxes = [...document.querySelectorAll('input[type=checkbox],i,span')].filter(el => /checkbox|agree|check/i.test((el.className || '').toString())).map(el => ({
      tag: el.tagName, cls: (el.className || '').toString().slice(0, 60)
    }));
    return { areas, boxes, taCount: document.querySelectorAll('textarea').length };
  });
  console.log('FORM=' + JSON.stringify(form, null, 1));

  // 填值（native setter + input/change 事件，兼容 Vue/React）
  const fillRes = await biz.evaluate(({ intro, channel }) => {
    const setV = (el, v) => {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const tas = [...document.querySelectorAll('textarea,input.weui-desktop-form__input')];
    const res = { count: tas.length, done: [] };
    if (tas[0]) { tas[0].focus(); setV(tas[0], intro); res.done.push('f0=' + tas[0].value.length); }
    if (tas[1]) { tas[1].focus(); setV(tas[1], channel); res.done.push('f1=' + tas[1].value.length); }
    res.vals = tas.map(t => t.value.slice(0, 20));
    return res;
  }, { intro: INTRO, channel: CHANNEL });
  console.log('FILL=' + JSON.stringify(fillRes));

  // 勾选同意
  const chk = await biz.evaluate(() => {
    // 找含《使用须知》的文本节点，定位其附近的 checkbox 图标
    const all = [...document.querySelectorAll('*')];
    let target = null;
    for (const el of all) {
      if ((el.innerText || '').trim().startsWith('我已阅读并同意')) { target = el; break; }
    }
    if (!target) return 'NO_AGREE_TEXT';
    const cb = target.parentElement.querySelector('input[type=checkbox]') || target.querySelector('input[type=checkbox]');
    if (cb) { if (!cb.checked) cb.click(); return 'CHECKBOX checked=' + cb.checked; }
    // 没有原生 checkbox：点它前面的图标
    const icon = target.parentElement.firstElementChild;
    if (icon) { icon.click(); return 'ICON clicked ' + (icon.className || '').toString().slice(0, 50); }
    return 'NO_CHECKBOX';
  });
  console.log('CHECK=' + chk);
  await page.waitForTimeout(1500);

  const txt = await dumpAll(SUBMIT ? 'dp_filled_pre' : 'dp_filled');
  console.log('TAIL=' + JSON.stringify(txt.slice(-700)));

  if (SUBMIT) {
    const r = await biz.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '确定');
      if (!b) return 'NO_CONFIRM';
      b.click(); return 'CONFIRMED';
    });
    console.log('SUBMIT=' + r);
    await page.waitForTimeout(9000);
    const t2 = await dumpAll('dp_submitted');
    console.log('FINAL_URL=' + page.url());
    console.log('FINAL_TAIL=' + JSON.stringify(t2.slice(-1500)));
  }
  await ctx.close();
})().catch(e => { console.error('FILL_ERR', e.message); process.exit(1); });
