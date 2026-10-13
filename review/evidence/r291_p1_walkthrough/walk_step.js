'use strict';
// R291 · P1 批次模拟器走查（589aaae）· 每步独立连接版
// 依据：本机实测同一连接约 3~4 次 evaluate 后即 timeout（R188「第2跳起易撞」）
//      ⇒ 每个 case 都用新连接、且把目标页当作该连接的「第 1 跳」
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

// 软超时：超时/被拒不抛，返回标记串，脚本继续
function T(p, ms, tag) {
  return Promise.race([
    Promise.resolve(p).catch((e) => 'REJ:' + (e && e.message)),
    new Promise((r) => setTimeout(() => r('TIMEOUT:' + tag), ms)),
  ]);
}
function ev(mp, fn, arg, ms, tag) {
  const p = arg === undefined ? mp.evaluate(fn) : mp.evaluate(fn, arg);
  return T(p, ms || 15000, tag || 'eval');
}
function snap(mp) {
  return ev(mp, function () {
    var ps = getCurrentPages();
    var p = ps.length ? ps[ps.length - 1] : null;
    if (!p) return { route: null };
    var t = p.data.t || {};
    var r = p.data.result;
    return {
      route: p.route,
      dataMode: p.data.mode,
      t_l1Title: t.l1Title,
      t_l1Guide: t.l1Guide,
      t_l1TitleRev: t.l1TitleRev,
      t_l1GuideRev: t.l1GuideRev,
      t_title: t.title,
      t_subtitle: t.subtitle,
      resultCount: r ? r.count : null,
      loading: p.data.loading,
    };
  }, undefined, 10000, 'snap');
}
// 一次 evaluate 读多个选择器的渲染文本
function textsOf(mp, sels) {
  return ev(mp, function (list) {
    return new Promise(function (res) {
      var out = {}, left = list.length;
      if (!left) return res({});
      var q = wx.createSelectorQuery();
      list.forEach(function (s) {
        q.select(s).fields({ text: true }, function (r) {
          out[s] = r && r.text !== undefined ? r.text : null;
          if (--left === 0) res(out);
        });
      });
      q.exec();
    });
  }, sels, 12000, 'texts');
}
async function shot(mp, name) {
  for (var i = 0; i < 3; i++) {
    const r = await T(mp.screenshot({ path: path.join(OUT, name) }), 15000, 'shot');
    if (r !== 'TIMEOUT:shot' && String(r).indexOf('REJ:') !== 0) return true;
  }
  return false;
}
async function reLaunch(mp, url) {
  await ev(mp, function (u) { wx.reLaunch({ url: u, fail: function () {} }); return 1; }, url, 10000, 'reLaunch');
}

// ============ 各步定义 ============
const STEPS = {
  a1: async (mp) => {           // 首页 forward 渲染
    await reLaunch(mp, '/pages/sandbox/index');
    await sleep(7000);
    const st = await snap(mp);
    const tx = await textsOf(mp, ['#l1l2 .sec', '#l1l2 .l1-guide']);
    await shot(mp, '01_sandbox_forward.png');
    return { st, tx };
  },
  a2: async (mp) => {           // 首页点「找店」Tab（reverse）→ 落到哪一页
    await reLaunch(mp, '/pages/sandbox/index');
    await sleep(6000);
    const before = await snap(mp);
    await ev(mp, function () {
      var ps = getCurrentPages(); ps[ps.length - 1].onTab({ currentTarget: { dataset: { mode: 'reverse' } } }); return 1;
    }, undefined, 8000, 'onTab');
    await sleep(4000);
    const after = await snap(mp);
    await shot(mp, '02_after_reverse_tab.png');
    return { before, after };
  },
  a3: async (mp) => {           // 首页强制 setData(mode:reverse) → 验证 reverse 文案本身可渲染
    await reLaunch(mp, '/pages/sandbox/index');
    await sleep(6000);
    await ev(mp, function () { var ps = getCurrentPages(); ps[ps.length - 1].setData({ mode: 'reverse' }); return 1; }, undefined, 8000, 'setData');
    await sleep(2000);
    const tx = await textsOf(mp, ['#l1l2 .sec', '#l1l2 .l1-guide']);
    await shot(mp, '03_sandbox_forced_reverse.png');
    return { tx };
  },
  a4: async (mp) => {           // 矩阵页 reverse（真实入口）渲染
    await reLaunch(mp, '/pages/sandbox/matrix?mode=reverse');
    await sleep(6000);
    const st = await snap(mp);
    const tx = await textsOf(mp, ['.head .title', '.head .subtitle']);
    await shot(mp, '04_matrix_reverse.png');
    return { st, tx };
  },
  a5: async (mp) => {           // 矩阵页 forward 渲染（对照）
    await reLaunch(mp, '/pages/sandbox/matrix?mode=forward');
    await sleep(6000);
    const st = await snap(mp);
    const tx = await textsOf(mp, ['.head .title', '.head .subtitle']);
    await shot(mp, '05_matrix_forward.png');
    return { st, tx };
  },
  a6: async (mp) => {           // 矩阵批量测算（reverse 场景）出数
    await reLaunch(mp, '/pages/sandbox/matrix?mode=reverse');
    await sleep(6000);
    const inp = await ev(mp, function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      return { dims: p.data.dims, area: p.data.global.area, buildTotalYuan: p.data.global.buildTotalYuan, presetIdx: p.data.presetIdx, cityIdx: p.data.cityIdx, presetName: (p.data.presets || [])[p.data.presetIdx] };
    }, undefined, 8000, 'inputs');
    await ev(mp, function () { var ps = getCurrentPages(); ps[ps.length - 1].onGenerate(); return 1; }, undefined, 8000, 'onGenerate');
    await sleep(20000);
    const res = await ev(mp, function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var r = p.data.result;
      if (!r) return { has: false, loading: p.data.loading };
      var rows = r.rows || [];
      return {
        has: true, count: r.count, loading: p.data.loading,
        nullBreak: rows.filter(function (x) { return x.breakMonthly == null; }).length,
        row0: rows[0] || null,
        insight: r.insight,
      };
    }, undefined, 12000, 'result');
    await shot(mp, '06_matrix_generate_reverse.png');
    return { inp, res };
  },
  a7: async (mp) => {           // 首页 forward 用预设业态单次测算（P1-② 原本被 INVALID_PARAM 拒的那条链）
    await reLaunch(mp, '/pages/sandbox/index');
    await sleep(7000);
    const pre = await ev(mp, function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      return { presetIdx: p.data.presetIdx, presetKey: p.data.presetKey, presetOptions: p.data.presetOptions, calcError: p.data.calcError, result: p.data.result };
    }, undefined, 8000, 'pre');
    const post = await ev(mp, function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var r = p.data.result;
      return {
        presetIdx: p.data.presetIdx, presetKey: p.data.presetKey, calcError: p.data.calcError,
        result: r ? { break_even_monthly: r.break_even_monthly, red_alert: r.red_alert } : null,
        indicatorCount: (p.data.indicators || []).length,
        indicators: (p.data.indicators || []).slice(0, 12).map(function (x) { return { name: x.name, val: x.val, valText: x.valText }; }),
      };
    }, undefined, 10000, 'post');
    await shot(mp, '07_index_preset_calc.png');
    return { pre, post };
  },
};

(async function () {
  const names = ONLY.length ? ONLY : Object.keys(STEPS);
  for (const name of names) {
    if (!STEPS[name]) { log('STEP ' + name + ' SKIP (unknown)'); continue; }
    let mp = null;
    try {
      mp = await automator.connect({ wsEndpoint: WS });
      const res = await STEPS[name](mp);
      results[name] = { ok: true, res };
      log('=== STEP ' + name + ' OK ===\n' + JSON.stringify(res, null, 1));
    } catch (e) {
      results[name] = { ok: false, err: String((e && e.stack) || e) };
      log('=== STEP ' + name + ' FAIL === ' + (e && e.message));
    } finally {
      try { if (mp) await T(mp.disconnect(), 5000, 'disconnect'); } catch (e) {}
    }
    await sleep(1500);
  }
  fs.writeFileSync(path.join(OUT, 'walk_report.json'), JSON.stringify(results, null, 2));
  log('report written: walk_report.json');
  process.exit(0);
})();
