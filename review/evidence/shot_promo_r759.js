// R759 活动测算重构实拍：验证「折扣换算独立于毛利率」
// 通道：R188 逻辑层 wx.reLaunch（mp.reLaunch 本机 pageMeta 恒 null 全死）
const automator = require('C:/Users/lzj/.workbuddy/binaries/node/mpauto/node_modules/miniprogram-automator');
const path = require('path');
const OUT = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TARGET = 'subpkg/tools/promo/index';

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
    console.log('connected');

    // reLaunch 到目标页，直到 route 命中（最多 4 次）
    let route = '';
    for (let i = 0; i < 4 && route !== TARGET; i++) {
      await mp.evaluate((u) => { wx.reLaunch({ url: u, fail: () => {} }); return 1; }, '/' + TARGET);
      await sleep(3500);
      try {
        route = await mp.evaluate(() => { const ps = getCurrentPages(); return ps.length ? ps[ps.length - 1].route : ''; });
      } catch (e) { route = ''; }
      console.log('nav try ' + (i + 1) + ' → ' + route);
    }
    if (route !== TARGET) throw new Error('无法导航到 promo 页，当前=' + route);

    // 步骤 1：只填活动规则（买2送1），不填毛利率 → 换算区出「6.67 折」+ 推导式，回本区必须空
    const st1 = await mp.evaluate(() => {
      const p = getCurrentPages().at(-1);
      p.setData({ kind: 'bogo', show: { buy: true, free: true },
        rule: { buy: '2', free: '1' }, marginPct: '', revenueYuan: '', avgPriceYuan: '' });
      p.recalc();
      return { conv: p.data.conv, back: p.data.back };
    });
    await sleep(300);
    console.log('step1 conv =', JSON.stringify(st1.conv));
    console.log('step1 back =', JSON.stringify(st1.back));
    const pass1 = !!(st1.conv && st1.conv.ok && String(st1.conv.discountText).indexOf('6.67') >= 0
      && st1.conv.formula === '2÷(2+1)' && st1.back === null);

    // 步骤 2：填 50%/8000/200 → 买2送1=6.67折 ⇒ 毛利25%/流水16000/单量40→120/客流+199.94%
    //   ⚠️ recalc 内部是 setData({conv}, ()=>setData({back})) 嵌套回调，
    //   evaluate 同步读 back 会读到 null —— 分两次 evaluate，中间等回调落地。
    await mp.evaluate(() => {
      const p = getCurrentPages().at(-1);
      p.setData({ marginPct: '50', revenueYuan: '8000', avgPriceYuan: '200' });
      p.recalc();
      return 1;
    });
    await sleep(600);
    const st2 = await mp.evaluate(() => {
      const p = getCurrentPages().at(-1);
      const b = p.data.back;
      return { back: b && { ok: b.ok, newMarginPct: b.newMarginPct, revenueNeededYuan: b.revenueNeededYuan,
        ordersNeeded: b.ordersNeeded, ordersNow: b.ordersNow, trafficUpliftPct: b.trafficUpliftPct } };
    });
    await sleep(300);
    console.log('step2 back =', JSON.stringify(st2.back));
    const b = st2.back || {};
    const pass2 = !!(b.ok && b.newMarginPct === 25 && b.revenueNeededYuan === 16000
      && b.ordersNeeded === 120 && b.ordersNow === 40 && Math.abs(b.trafficUpliftPct - 199.94) < 0.01);

    // 截图（重试 3 次）
    let shot = false;
    for (let i = 0; i < 3 && !shot; i++) {
      try { await mp.screenshot({ path: path.join(OUT, 'r759_promo_page.png') }); shot = true;
        console.log('screenshot OK (try ' + (i + 1) + ')'); }
      catch (e) { console.log('screenshot retry ' + (i + 1) + ': ' + e.message); await sleep(1500); }
    }

    const report = {
      route, step1: st1, step2: st2,
      assertions: { convIndependentOfMargin: pass1, breakevenNumbers: pass2, screenshot: shot },
      allPass: pass1 && pass2 && shot,
    };
    require('fs').writeFileSync(path.join(OUT, 'r759_promo_report.json'), JSON.stringify(report, null, 2));
    console.log('ASSERT 换算独立于毛利率:', pass1 ? 'PASS' : 'FAIL');
    console.log('ASSERT 回本数字对拍:', pass2 ? 'PASS' : 'FAIL');
    console.log('ASSERT 截图:', shot ? 'PASS' : 'FAIL');
    process.exitCode = report.allPass ? 0 : 1;
  } catch (e) {
    console.error('FATAL', e && e.message);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
})();
