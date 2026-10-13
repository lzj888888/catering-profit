'use strict';
// R291 · P1 走查 · 纯逻辑层版（2~3 次 evaluate/步；禁用 selectorQuery —— 实测在 eval 上下文挂死）
// 渲染层证据另走「截图 + OCR」
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const ONLY = (process.argv[4] || '').split(',').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = {};
function log(s) {
  const t = String(s);
  console.log(t);
  try { fs.appendFileSync(path.join(OUT, 'walk_log.txt'), t + '\n'); } catch (e) {}
}
process.on('unhandledRejection', (e) => log('[unhandledRejection] ' + (e && e.message ? e.message : e)));
process.on('uncaughtException', (e) => log('[uncaughtException] ' + (e && e.message ? e.message : e)));

function T(p, ms, tag) {
  return Promise.race([
    Promise.resolve(p).catch((e) => 'REJ:' + (e && e.message)),
    new Promise((r) => setTimeout(() => r('TIMEOUT:' + tag), ms)),
  ]);
}
async function shot(mp, name) {
  for (var i = 0; i < 3; i++) {
    const r = await T(mp.screenshot({ path: path.join(OUT, name) }), 20000, 'shot');
    if (typeof r === 'string' && (r.indexOf('REJ:') === 0 || r === 'TIMEOUT:shot')) { await sleep(1500); continue; }
    return true;
  }
  return false;
}
const NAV = function (url) { wx.reLaunch({ url: url, fail: function () {} }); return 1; };
const SNAP = function () {
  var ps = getCurrentPages();
  var p = ps.length ? ps[ps.length - 1] : null;
  if (!p) return { err: 'EMPTY_PAGE_STACK' };
  var t = p.data.t || {};
  var r = p.data.result;
  var rr = p.data.reverseResult;
  return {
    route: p.route,
    dataMode: p.data.mode,
    l1Title: t.l1Title, l1Guide: t.l1Guide,
    l1TitleRev: t.l1TitleRev, l1GuideRev: t.l1GuideRev,
    title: t.title, subtitle: t.subtitle,
    loading: p.data.loading,
    calcError: p.data.calcError,
    resultCount: r ? r.count : null,
    resultBrief: r ? {
      count: r.count,
      nullBreak: (r.rows || []).filter(function (x) { return x.breakMonthly == null; }).length,
      row0: (r.rows || [])[0] || null,
      insight: r.insight,
      view: r.view,
    } : null,
    reverseBrief: rr ? { rent_cap: rr.rent_cap, red_alert: rr.red_alert } : null,
    stackDepth: ps.length,
  };
};

const STEPS = {
  a1: async (mp) => {                          // 首页 forward
    await T(mp.evaluate(NAV, '/pages/sandbox/index'), 10000, 'nav');
    await sleep(8000);
    const s = await T(mp.evaluate(SNAP), 12000, 'snap');
    await shot(mp, '01_sandbox_forward.png');
    return s;
  },
  a2: async (mp) => {                          // 首页点「找店」（reverse）
    await T(mp.evaluate(NAV, '/pages/sandbox/index'), 10000, 'nav');
    await sleep(7000);
    const before = await T(mp.evaluate(SNAP), 12000, 'snap-before');
    await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.onTab({ currentTarget: { dataset: { mode: 'reverse' } } }); return 1;
    }), 10000, 'onTab');
    await sleep(4500);
    const after = await T(mp.evaluate(SNAP), 12000, 'snap-after');
    await shot(mp, '02_after_reverse_tab.png');
    return { before, after };
  },
  a3: async (mp) => {                          // 强制 setData(reverse)：验证 data.t 白名单是否含 Rev 键
    await T(mp.evaluate(NAV, '/pages/sandbox/index'), 10000, 'nav');
    await sleep(7000);
    const probe = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({ mode: 'reverse' });
      var t = p.data.t || {};
      return {
        modeAfter: p.data.mode,
        hasL1TitleRev: Object.prototype.hasOwnProperty.call(t, 'l1TitleRev'),
        hasL1GuideRev: Object.prototype.hasOwnProperty.call(t, 'l1GuideRev'),
        l1TitleRev: t.l1TitleRev === undefined ? '<undefined>' : t.l1TitleRev,
        l1GuideRev: t.l1GuideRev === undefined ? '<undefined>' : t.l1GuideRev,
        l1Title: t.l1Title,
        tKeysL1: Object.keys(t).filter(function (k) { return k.indexOf('l1') === 0; }),
      };
    }), 12000, 'setDataProbe');
    await sleep(2800);
    await shot(mp, '03_sandbox_forced_reverse.png');
    return probe;
  },
  a4: async (mp) => {                          // 矩阵页 reverse
    await T(mp.evaluate(NAV, '/pages/sandbox/matrix?mode=reverse'), 12000, 'nav');
    await sleep(8000);
    const s = await T(mp.evaluate(SNAP), 12000, 'snap');
    await shot(mp, '04_matrix_reverse.png');
    return s;
  },
  a5: async (mp) => {                          // 矩阵页 forward
    await T(mp.evaluate(NAV, '/pages/sandbox/matrix?mode=forward'), 12000, 'nav');
    await sleep(8000);
    const s = await T(mp.evaluate(SNAP), 12000, 'snap');
    await shot(mp, '05_matrix_forward.png');
    return s;
  },
  a6: async (mp) => {                          // 矩阵批量测算（reverse 场景）
    await T(mp.evaluate(NAV, '/pages/sandbox/matrix?mode=reverse'), 12000, 'nav');
    await sleep(8000);
    const inp = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var o = {
        route: p.route, mode: p.data.mode,
        dims: p.data.dims, area: p.data.global.area,
        buildTotalYuan: p.data.global.buildTotalYuan,
        presetIdx: p.data.presetIdx, cityIdx: p.data.cityIdx,
        presetName: (p.data.presets || [])[p.data.presetIdx] || null,
      };
      try { p.onGenerate(); o.genCalled = true; } catch (e) { o.genThrow = String(e && e.message); }
      return o;
    }), 15000, 'inputs+gen');
    await sleep(30000);
    const s = await T(mp.evaluate(SNAP), 15000, 'snap');
    await shot(mp, '06_matrix_gen_reverse.png');
    return { inp, after: s };
  },
  a7: async (mp) => {                          // 首页 forward 预设测算（P1-② 原被 INVALID_PARAM 拒的链）
    await T(mp.evaluate(NAV, '/pages/sandbox/index'), 12000, 'nav');
    await sleep(11000);
    const s = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var t = p.data.t || {};
      var r = p.data.result;
      return {
        route: p.route, dataMode: p.data.mode, calcError: p.data.calcError,
        presetIdx: p.data.presetIdx, presetKey: p.data.presetKey,
        presetOptions: (p.data.presetOptions || []).map(function (x) { return x.name || x; }),
        resultBrief: r ? { break_even_monthly: r.break_even_monthly, red_alert: r.red_alert, target_monthly: r.target_monthly } : null,
        indicatorCount: (p.data.indicators || []).length,
        indicators: (p.data.indicators || []).slice(0, 14).map(function (x) { return { name: x.name, val: x.val, valText: x.valText, band: x.band }; }),
        loading: p.data.loading,
      };
    }), 15000, 'snap');
    await shot(mp, '07_index_calc_state.png');
    return s;
  },
};

(async function () {
  const names = ONLY.length ? ONLY : Object.keys(STEPS);
  for (const name of names) {
    if (!STEPS[name]) { log('STEP ' + name + ' SKIP'); continue; }
    let mp = null;
    try {
      mp = await automator.connect({ wsEndpoint: WS });
      const res = await STEPS[name](mp);
      results[name] = { ok: true, res: res };
      log('=== STEP ' + name + ' OK ===\n' + JSON.stringify(res));
    } catch (e) {
      results[name] = { ok: false, err: String((e && e.stack) || e) };
      log('=== STEP ' + name + ' FAIL === ' + (e && e.message));
    } finally {
      try { if (mp) await T(mp.disconnect(), 5000, 'disconnect'); } catch (e) {}
    }
    await sleep(1200);
  }
  fs.writeFileSync(path.join(OUT, 'walk_report.json'), JSON.stringify(results, null, 2));
  log('report written: walk_report.json');
  process.exit(0);
})();
