'use strict';
// R291 · P1 批次模拟器走查（589aaae）
// 定式（R188）：一次连接内顺序跑完；导航只走逻辑层 wx.reLaunch；读 state 走 getCurrentPages()
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const OUT = process.argv[2] || '.';
const WS = process.argv[3] || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lines = [];
function log(s) { const t = String(s); lines.push(t); console.log(t); }

function lastPage() {
  const ps = getCurrentPages();
  return ps.length ? ps[ps.length - 1] : null;
}

async function qtext(mp, sel) {
  try {
    return await mp.evaluate(function (s) {
      return new Promise(function (res) {
        try {
          wx.createSelectorQuery().select(s).text(function (t) { res(t === undefined ? null : t); }).exec();
        } catch (e) { res('ERR:' + (e && e.message)); }
      });
    }, sel);
  } catch (e) { return 'EVAL_ERR:' + (e && e.message); }
}

async function snap(mp) {
  return mp.evaluate(function () {
    var ps = getCurrentPages();
    var p = ps.length ? ps[ps.length - 1] : null;
    if (!p) return { route: null };
    var t = p.data.t || {};
    var r = p.data.result;
    return {
      route: p.route,
      mode: p.data.mode,
      t_l1Title: t.l1Title,
      t_l1Guide: t.l1Guide,
      t_l1TitleRev: t.l1TitleRev,
      t_l1GuideRev: t.l1GuideRev,
      t_title: t.title,
      t_subtitle: t.subtitle,
      resultCount: r ? r.count : null,
      loading: p.data.loading,
    };
  });
}

async function nav(mp, url) {
  try {
    await mp.evaluate(function (u) { wx.reLaunch({ url: u, fail: function () {} }); return 1; }, url);
  } catch (e) { log('  nav throw (吞掉): ' + (e && e.message)); }
  var want = url.split('?')[0].replace(/^\//, '');
  for (var i = 0; i < 8; i++) {
    await sleep(1500);
    try {
      var r = await mp.evaluate(function () {
        var ps = getCurrentPages();
        return ps.length ? ps[ps.length - 1].route : '';
      });
      if (r === want) return r;
    } catch (e) { /* 轮询期抛错不算失败 */ }
  }
  return null;
}

async function shot(mp, name) {
  for (var i = 0; i < 3; i++) {
    try { await mp.screenshot({ path: path.join(OUT, name) }); return true; } catch (e) { await sleep(1200); }
  }
  return false;
}

(async function () {
  var mp = await automator.connect({ wsEndpoint: WS });
  log('connected: ' + WS);

  var probe = await mp.evaluate(function () { return 1 + 1; });
  log('probe 1+1 = ' + probe + '   (逻辑层活)');

  // ============ A1 首页（forward）渲染文案 ============
  var r1 = await nav(mp, '/pages/sandbox/index');
  log('A1 nav -> ' + r1);
  await sleep(7000);
  var s1 = await snap(mp);
  log('A1 state: ' + JSON.stringify(s1));
  log('A1 render #l1l2 .sec      = ' + JSON.stringify(await qtext(mp, '#l1l2 .sec')));
  log('A1 render #l1l2 .l1-guide = ' + JSON.stringify(await qtext(mp, '#l1l2 .l1-guide')));
  await shot(mp, '01_sandbox_forward.png');

  // ============ A2 点「找店」Tab（reverse）→ 观察跳转 ============
  try {
    await mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.onTab({ currentTarget: { dataset: { mode: 'reverse' } } });
      return 1;
    });
  } catch (e) { log('A2 onTab throw: ' + (e && e.message)); }
  await sleep(4000);
  var s2 = await snap(mp);
  log('A2 after onTab(reverse): ' + JSON.stringify(s2));
  await shot(mp, '02_after_reverse_tab.png');

  // ============ A3 强制 setData(mode:reverse) —— 验证文案本身可渲染 ============
  await nav(mp, '/pages/sandbox/index');
  await sleep(2500);
  try {
    await mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({ mode: 'reverse' });
      return 1;
    });
  } catch (e) { log('A3 setData throw: ' + (e && e.message)); }
  await sleep(1500);
  log('A3 render #l1l2 .sec      = ' + JSON.stringify(await qtext(mp, '#l1l2 .sec')));
  log('A3 render #l1l2 .l1-guide = ' + JSON.stringify(await qtext(mp, '#l1l2 .l1-guide')));
  await shot(mp, '03_sandbox_forced_reverse.png');
  try { await mp.evaluate(function () { var ps = getCurrentPages(); ps[ps.length - 1].setData({ mode: 'forward' }); return 1; }); } catch (e) {}

  // ============ A4 矩阵页 reverse 文案（真实入口）============
  var r4 = await nav(mp, '/pages/sandbox/matrix?mode=reverse');
  log('A4 nav -> ' + r4);
  await sleep(3500);
  var s4 = await snap(mp);
  log('A4 state: ' + JSON.stringify(s4));
  log('A4 render .head .title    = ' + JSON.stringify(await qtext(mp, '.head .title')));
  log('A4 render .head .subtitle = ' + JSON.stringify(await qtext(mp, '.head .subtitle')));
  await shot(mp, '04_matrix_reverse.png');

  // ============ A5 矩阵批量测算（P1-② 核心）============
  var inp = await mp.evaluate(function () {
    var ps = getCurrentPages(); var p = ps[ps.length - 1];
    return { dims: p.data.dims, area: p.data.global.area, buildTotalYuan: p.data.global.buildTotalYuan, presetIdx: p.data.presetIdx, cityIdx: p.data.cityIdx };
  });
  log('A5 inputs: ' + JSON.stringify(inp));
  try {
    await mp.evaluate(function () { var ps = getCurrentPages(); ps[ps.length - 1].onGenerate(); return 1; });
  } catch (e) { log('A5 onGenerate throw: ' + (e && e.message)); }

  var s5 = null;
  for (var k = 0; k < 12; k++) {
    await sleep(3000);
    s5 = await mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var r = p.data.result;
      if (!r) return { has: false, loading: p.data.loading };
      var rows = r.rows || [];
      var r0 = rows[0] || null;
      var bad = rows.filter(function (x) { return x.breakMonthly == null; }).length;
      return { has: true, count: r.count, loading: p.data.loading, nullBreak: bad, row0: r0, insight: r.insight };
    });
    log('  A5 poll#' + k + ': ' + JSON.stringify(s5));
    if (s5 && s5.has && !s5.loading) break;
  }
  await shot(mp, '05_matrix_result.png');

  fs.writeFileSync(path.join(OUT, 'walk_report.json'), JSON.stringify({ lines: lines, a1: s1, a2: s2, a4: s4, inputs: inp, a5: s5 }, null, 2));
  log('report written');
  try { await mp.disconnect(); } catch (e) {}
  process.exit(0);
})().catch(function (e) {
  console.log('FATAL: ' + (e && e.stack ? e.stack : e));
  try { fs.writeFileSync(path.join(OUT, 'walk_fatal.txt'), String(e && e.stack ? e.stack : e)); } catch (x) {}
  process.exit(1);
});
