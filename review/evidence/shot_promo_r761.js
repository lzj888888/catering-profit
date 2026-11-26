// shot_promo_r761.js —— R761 活动测算三段实拍（代金券口径 + 限用提示 + 填毛利率反算）
const automator = require('C:/Users/lzj/.workbuddy/binaries/node/mpauto/node_modules/miniprogram-automator');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r761_promo_page.png';
const REPORT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r761_promo_report.json';

(async () => {
  let mp;
  const report = { ok: false, steps: [] };
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
    console.log('connected');
    // 稳导航：函数体内写死 URL（R760 踩过 evaluate 传参坑）
    await mp.evaluate(function () { wx.reLaunch({ url: '/subpkg/tools/promo/index', fail: function () {} }); return 1; });
    let route = '';
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      route = await mp.evaluate(function () { return (getCurrentPages().slice(-1)[0] || {}).route || ''; });
      if (route.indexOf('promo') >= 0) { console.log('route ok after', i); break; }
    }
    if (route.indexOf('promo') < 0) throw new Error('NAV FAIL route=' + route);
    await sleep(800);

    // 步骤1：代金券 80代100 限2张 ⇒ 8折 + 满200提示（不填毛利率）
    const st1 = await mp.evaluate(function () {
      var p = getCurrentPages().slice(-1)[0];
      p.setData({ kind: 'voucher', rule: { face: '80', threshold: '100', limit: '2' }, show: p.showOf('voucher') });
      p.recalc();
      var c = p.data.conv;
      return { ok: c.ok, text: c.discountText, formula: c.formula, limit: c.limitInfo, back: p.data.back, reverse: p.data.reverse };
    });
    report.steps.push({ name: 'voucher80代100限2', data: st1 });
    console.log('step1 =', JSON.stringify(st1));
    const pass1 = st1.ok && st1.text === '8折' && st1.formula === '80÷100'
      && st1.limit && st1.limit.count === 2 && st1.limit.maxSpend === 200
      && st1.back === null && st1.reverse === null;

    // 步骤2：填第三段 现毛利50 / 目标20 / 流水8000 / 客单200 ⇒ 6.25折 流水20000 单量40→160
    const st2 = await mp.evaluate(function () {
      var p = getCurrentPages().slice(-1)[0];
      p.setData({ marginPct: '50', targetMarginPct: '20', revenueYuan: '8000', avgPriceYuan: '200' });
      p.recalc();
      var r = p.data.reverse;
      return r && { ok: r.ok, text: r.discountText, newMargin: r.newMarginPct,
        rev: r.revenueNeededYuan, now: r.ordersNow, need: r.ordersNeeded,
        traffic: r.trafficUpliftPct, revMul: r.revenueMultiple, traMul: r.trafficMultiple };
    });
    report.steps.push({ name: 'reverse50to20', data: st2 });
    console.log('step2 =', JSON.stringify(st2));
    const pass2 = st2 && st2.ok && st2.text === '6.25折' && st2.newMargin === 20
      && Math.abs(st2.rev - 20000) < 0.01 && st2.now === 40 && st2.need === 160
      && Math.abs(st2.revMul - 2.5) < 0.01 && Math.abs(st2.traMul - 4) < 0.01;

    await sleep(600);
    await mp.screenshot({ path: OUT });
    console.log('shot saved');
    report.ok = pass1 && pass2;
    report.pass1 = pass1; report.pass2 = pass2;
  } catch (e) {
    report.error = (e && e.message) || String(e);
    console.error('FATAL', report.error);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    if (mp) { try { await mp.disconnect(); } catch (e) {} }
  }
  console.log('RESULT', report.ok ? 'PASS' : 'FAIL', JSON.stringify({ pass1: report.pass1, pass2: report.pass2, error: report.error }));
  process.exit(report.ok ? 0 : 1);
})();
