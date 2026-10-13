'use strict';
// R294 · M2 真机（模拟器自动化通道）两轮走查
//   轮次 1 = 正向「已有铺面」：老板填一套真参数 → 逐业态预设切换 → 边界
//   轮次 2 = 反向「寻找铺面」：首页 reverse 文案回归 → 矩阵页批量测算 → 极端档位
// 🔴 通道定式（R188）：逻辑层 wx.reLaunch + mp.evaluate；禁用 selectorQuery（会挂死）
// 🔴 每步独立 connect（R291 实证可行），失败重试 1 次
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
const READY = function () {
  var ps = getCurrentPages();
  var p = ps.length ? ps[ps.length - 1] : null;
  if (!p) return { err: 'EMPTY_PAGE_STACK' };
  return {
    route: p.route, loading: !!p.data.loading,
    presetOptions: (p.data.presetOptions || []).length,
    presetKey: p.data.presetKey || '',
    result: !!p.data.result,
    calcError: p.data.calcError || '',
  };
};
// 导航：连上后先缓 1.2s 再发第一跳；空栈则补发（R188：第一跳最可靠，但太快会丢）
async function navTo(mp, url) {
  await sleep(1200);
  await T(mp.evaluate(NAV, url), 10000, 'nav');
  await sleep(2500);
  let s = await T(mp.evaluate(READY), 10000, 'navcheck');
  if (!s || s.err) {
    await T(mp.evaluate(NAV, url), 10000, 'nav2');
    await sleep(4000);
    s = await T(mp.evaluate(READY), 10000, 'navcheck2');
  }
  return s;
}

// 轮询到「页面不再 loading」为止，返回时间线（区分「慢」与「卡死」）
async function waitReady(mp, maxMs, step) {
  step = step || 3000;
  const tl = [];
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await T(mp.evaluate(READY), 12000, 'ready');
    tl.push({ dt: Date.now() - t0, s: s });
    if (s && !s.err && !s.loading) break;
    await sleep(step);
  }
  return tl;
}

// ===== 通用快照：把「餐饮老板会在屏幕上看到的数」全抓出来 =====
const SNAP = function () {
  var ps = getCurrentPages();
  var p = ps.length ? ps[ps.length - 1] : null;
  if (!p) return { err: 'EMPTY_PAGE_STACK' };
  var d = p.data;
  var t = d.t || {};
  var r = d.result;
  var brief = function (x) {
    if (!x) return null;
    return {
      red_alert: x.red_alert,
      break_even_monthly: x.break_even_monthly,
      break_even_daily: x.break_even_daily,
      target_monthly: x.target_monthly,
      target_daily: x.target_daily,
      fixed_total: x.fixed_total,
      build_total: x.build_total,
      build_amort: x.build_amort,
      payback_months: x.payback_months,
      margin_rate: x.margin_rate,
      platform_pct: x.platform_pct,
      valid_days: x.valid_days,
    };
  };
  return {
    route: p.route,
    mode: d.mode,
    loading: d.loading,
    calcError: d.calcError,
    l1Title: t.l1Title, l1Guide: t.l1Guide,
    l1TitleRev: t.l1TitleRev, l1GuideRev: t.l1GuideRev,
    title: t.title, subtitle: t.subtitle,
    presetKey: d.presetKey, presetName: d.presetName,
    bizIdx: d.bizIdx, bizName: d.bizName,
    cityIdx: d.cityIdx,
    // 输入（老板填的）
    inputs: {
      areaNum: d.areaNum, rentYuan: d.rentYuan, headcountNum: d.headcountNum,
      laborUnitYuan: d.laborUnitYuan, targetYuan: d.targetYuan, expectYuan: d.expectYuan,
      avgPriceYuan: d.avgPriceYuan, marginPct: d.marginPct,
      tablesNum: d.tablesNum, seatsPerTableNum: d.seatsPerTableNum,
      initialInvestYuan: d.initialInvestYuan,
    },
    // 固定支出行（含「参考金额」placeholder —— R293 后应由 BANDS 派生）
    fixedRows: (d.fixedRows || []).map(function (x) { return { key: x.key, yuan: x.yuan, ph: x.ph }; }),
    // 指标对照（mine=我的占比 / band=健康带 / levelName=评级）
    indicators: (d.indicators || []).map(function (x) {
      return { name: x.name, mine: x.mine, band: x.band, level: x.level, levelName: x.levelName, redline: x.redline, hit: x.hit };
    }),
    // 参考带（BANDS 原值）
    bands: (d.bands || []).map(function (x) { return { key: x.key, name: x.name, band: x.band, amt: x.amt }; }),
    marginBand: d.marginBand,
    verdict: d.verdict,
    crowd: d.crowd,
    eff: d.eff,
    payback: d.payback,
    // 口径来源（R293 落点：src=B 表示取自库指数 BANDS）
    assumptions: (d.presetAssumptions || []).map(function (x) { return { label: x.label, val: x.val, src: x.src }; }),
    result: brief(r),
    reverseResult: d.reverseResult,
    stackDepth: ps.length,
  };
};

// ===== 轮次 1 · 正向 =====
const STEPS = {
  // f1：进页初始态（空态提示 / 文案 / 预设清单）
  f1: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    const tl = await waitReady(mp, 36000, 3000);   // 首屏到底多久出？时间线取证
    const s = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var d = p.data; var t = d.t || {};
      return {
        route: p.route, mode: d.mode, loading: d.loading, calcError: d.calcError,
        l1Title: t.l1Title, l1Guide: t.l1Guide,
        presetOptions: (d.presetOptions || []).map(function (x) { return (x.name || x) + '#' + (x.key || ''); }),
        bizTypes: (t.bizTypes || []).map(function (x) { return x.name + '#' + x.key; }),
        cityOptions: (t.cityTiers || t.cities || []).map(function (x) { return x.name || x; }),
        fixedRows: (d.fixedRows || []).map(function (x) { return { key: x.key, yuan: x.yuan, ph: x.ph }; }),
      };
    }), 12000, 'snap');
    await shot(mp, '01_index_initial.png');
    return { timeline: tl, snap: s };
  },

  // f2：老板 A（县城小面馆）真参数填进去 → 等云算 → 抓全套
  f2: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    const before = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({
        areaNum: '60', rentYuan: '3000', headcountNum: '2', laborUnitYuan: '3200',
        targetYuan: '8000', expectYuan: '60000', avgPriceYuan: '12',
        tablesNum: '8', initialInvestYuan: '120000',
      });
      p.scheduleCalc();
      return { set: true };
    }), 12000, 'fill');
    const tl2 = await waitReady(mp, 22000, 2500);
    const s = await T(mp.evaluate(SNAP), 14000, 'snap');
    await shot(mp, '02_A_县城小面馆.png');
    return { before, timeline: tl2, after: s };
  },

  // f2b：装配器对照探针（纯逻辑层，不等云）—— 用户在不同输入框填的钱，到底进没进引擎
  f2b: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    await waitReady(mp, 24000, 3000);
    const probe = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var setFixed = function (kv) {
        var rows = p.data.fixedRows.map(function (r) {
          return Object.assign({}, r, { yuan: (kv && kv[r.key] != null) ? kv[r.key] : '' });
        });
        p.setData({ fixedRows: rows });
      };
      var grab = function () {
        var pp = p.buildPresetParam('forward');
        return {
          fixed_items: pp.fixed_items.map(function (x) { return x.key + '=' + Math.round(x.fen / 100); }),
          var_items: pp.var_items.map(function (x) { return x.key + '=' + x.pct + '%'; }),
          build_items: pp.build_items.map(function (x) { return x.key + '=' + Math.round(x.fen / 100) + '/' + x.years + 'y'; }),
        };
      };
      var out = {};
      // 组 1：只填 L1 房租（rentYuan），L2 表留空
      p.setData({ areaNum: '60', rentYuan: '3000', headcountNum: '2', laborUnitYuan: '3200', fixedRows: p.data.fixedRows.map(function (r) { return Object.assign({}, r, { yuan: '' }); }) });
      out.g1_L1rentOnly = grab();
      // 组 2：L1 房租留空，只在 L2 明细表填（房租 3000 / 人工 6400 / 水电 800 / 管理费 900）
      p.setData({ rentYuan: '', headcountNum: '', laborUnitYuan: '' });
      setFixed({ rent: '3000', labor: '6400', utility: '800', manage: '900' });
      out.g2_L2rowsOnly = grab();
      out.g2_fixedRowsUi = p.data.fixedRows.map(function (r) { return r.key + '=' + r.yuan; });
      // 组 3：两边都填（L1 房租 3000 + L2 水电 800）⇒ 看 L2 的 800 是否被采纳
      p.setData({ rentYuan: '3000', headcountNum: '2', laborUnitYuan: '3200' });
      setFixed({ rent: '', labor: '', utility: '800', manage: '' });
      out.g3_both = grab();
      return out;
    }), 20000, 'probe');
    return probe;
  },

  // f3：同一套参数下逐业态预设切换（验 R293：占比/参考值按库指数走）
  f3: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    await waitReady(mp, 24000, 3000);
    const base = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({
        areaNum: '60', rentYuan: '3000', headcountNum: '2', laborUnitYuan: '3200',
        targetYuan: '8000', expectYuan: '60000', avgPriceYuan: '12', tablesNum: '8',
      });
      p.scheduleCalc();
      return { n: (p.data.presetOptions || []).length };
    }), 12000, 'base');
    await waitReady(mp, 15000, 2500);
    const n = base.n || 0;
    const per = [];
    for (let i = 0; i < n; i++) {
      const one = await T(mp.evaluate(function (idx) {
        var ps = getCurrentPages(); var p = ps[ps.length - 1];
        p.onPreset({ detail: { value: idx } });
        return { idx: idx };
      }, i), 12000, 'onPreset');
      await waitReady(mp, 14000, 2500);
      const s = await T(mp.evaluate(SNAP), 14000, 'snap');
      per.push({ i: i, ok: one, snap: s });
      log('   [f3] preset#' + i + ' → ' + JSON.stringify({
        key: s && s.presetKey, biz: s && s.bizName,
        be: s && s.result && s.result.break_even_monthly,
        ind: (s && s.indicators ? s.indicators : []).map(function (x) { return x.name + ' ' + x.mine + '/' + x.band + '=' + x.levelName; }),
        fixed: (s && s.fixedRows ? s.fixedRows : []).map(function (x) { return x.key + ':' + (x.yuan || '') + '(ref' + (x.ph || '') + ')'; }),
      }));
      if (i === 0 || i === 4 || i === n - 1) await shot(mp, '03_preset_' + i + '.png');
    }
    return { count: n, per: per };
  },

  // f3b：补跑未覆盖的预设（0 通用 / 5~9 湘菜·粤菜·家常菜·茶饮·其他）
  //      并打印 inputs，用来坐实「切预设会不会把用户已填的数字冲掉」
  f3b: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    await waitReady(mp, 24000, 3000);
    const base = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({
        areaNum: '60', rentYuan: '3000', headcountNum: '2', laborUnitYuan: '3200',
        targetYuan: '8000', expectYuan: '60000', avgPriceYuan: '12', tablesNum: '8',
      });
      p.scheduleCalc();
      return { n: (p.data.presetOptions || []).length };
    }), 12000, 'base');
    await waitReady(mp, 15000, 2500);
    const idxs = [0, 5, 6, 7, 8, 9];
    const per = [];
    for (const i of idxs) {
      await T(mp.evaluate(function (idx) {
        var ps = getCurrentPages(); var p = ps[ps.length - 1];
        p.onPreset({ detail: { value: idx } });
        return 1;
      }, i), 12000, 'onPreset');
      await waitReady(mp, 14000, 2500);
      const s = await T(mp.evaluate(SNAP), 14000, 'snap');
      per.push({ i: i, snap: s });
      log('   [f3b] preset#' + i + ' → ' + JSON.stringify({
        key: s && s.presetKey, biz: s && s.bizName,
        be: s && s.result && s.result.break_even_monthly,
        inputs: s && s.inputs,
        ind: (s && s.indicators ? s.indicators : []).map(function (x) { return x.name + ' ' + x.mine + '/' + x.band + '=' + x.levelName; }),
        assumptions: (s && s.assumptions ? s.assumptions : []).map(function (x) { return x.label + '=' + x.val + '(src' + x.src + ')'; }),
      }));
    }
    return { count: base.n, per: per };
  },

  // f3c：决定性取证 —— 同一套输入下，前端「装配器产物」与「云返回结果」逐项对账
  //      目的：区分「前端没送」还是「云没算」（other 业态房租/人工疑似不进引擎）
  f3c: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    await waitReady(mp, 24000, 3000);
    const out = {};
    for (const idx of [1, 0]) {
      await T(mp.evaluate(function (i) {
        var ps = getCurrentPages(); var p = ps[ps.length - 1];
        p.setData({ areaNum: '60', rentYuan: '3000', headcountNum: '2', laborUnitYuan: '3200', targetYuan: '8000', avgPriceYuan: '12', tablesNum: '8' });
        p.onPreset({ detail: { value: i } });
        return 1;
      }, idx), 12000, 'preset');
      await waitReady(mp, 16000, 2500);
      const one = await T(mp.evaluate(function () {
        var ps = getCurrentPages(); var p = ps[ps.length - 1];
        var pp = p.buildPresetParam('forward');
        return {
          presetKey: p.data.presetKey,
          bizName: p.data.bizName,
          rentYuanInData: p.data.rentYuan,
          headcountInData: p.data.headcountNum,
          laborUnitInData: p.data.laborUnitYuan,
          asmFixed: pp.fixed_items.map(function (x) { return x.key + '=' + Math.round(x.fen / 100) + (x.derivedFrom ? '(derived:' + x.derivedFrom + ')' : ''); }),
          asmVar: pp.var_items.map(function (x) { return x.key + '=' + x.pct + '%'; }),
          asmBuild: pp.build_items.map(function (x) { return x.key + '=' + Math.round(x.fen / 100) + '/' + x.years + 'y'; }),
          cloudFixedTotal: p.data.result ? p.data.result.fixed_total : null,
          cloudBreakEven: p.data.result ? p.data.result.break_even_monthly : null,
          verdictSummary: p.data.verdict ? p.data.verdict.summary.map(function (x) { return x.key + '=' + x.pct + '(' + x.level + ')'; }) : null,
          verdictNote: p.data.verdict ? p.data.verdict.note : null,
          verdictMine: p.data.verdict ? p.data.verdict.mine : null,
          verdictBand: p.data.verdict ? p.data.verdict.band : null,
          calcError: p.data.calcError,
        };
      }), 16000, 'probe');
      out['preset' + idx] = one;
      log('   [f3c] preset#' + idx + ' → ' + JSON.stringify(one));
    }
    return out;
  },

  // f3d：**同步**取证 —— await 页面自己的测算方法（不走防抖），杜绝「读到上一次的结果」
  //      同时把「前端装配合计」与「云返回固定成本合计」对账
  f3d: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    await waitReady(mp, 24000, 3000);
    const out = {};
    for (const idx of [1, 0, 4]) {
      const one = await T(mp.evaluate(async function (i) {
        var ps = getCurrentPages(); var p = ps[ps.length - 1];
        p.setData({ areaNum: '60', rentYuan: '3000', headcountNum: '2', laborUnitYuan: '3200', targetYuan: '8000', avgPriceYuan: '12', tablesNum: '8' });
        p.onPreset({ detail: { value: i } });
        await p.onCalcPresetFwd();                 // ← 等这一次真的算完
        var pp = p.buildPresetParam('forward');
        var sumAsm = pp.fixed_items.reduce(function (a, x) { return a + x.fen; }, 0) / 100;
        var v = p.data.verdict || {};
        return {
          presetKey: p.data.presetKey, bizName: p.data.bizName,
          laborUnitInData: p.data.laborUnitYuan,     // 用户填 3200，看是否被预设冲掉
          asmFixed: pp.fixed_items.map(function (x) { return x.key + '=' + Math.round(x.fen / 100); }),
          asmFixedSum: sumAsm,
          cloudFixedTotal: p.data.result ? p.data.result.fixed_total : null,
          cloudBreakEven: p.data.result ? p.data.result.break_even_monthly : null,
          cloudTarget: p.data.result ? p.data.result.target_monthly : null,
          verdictSummary: (v.summary || []).map(function (x) { return x.key + '=' + x.pct + '(' + x.level + ')'; }),
          verdictNote: v.note, verdictMine: v.mine, verdictBand: v.band, verdictLevel: v.levelName,
          rentPctShown: ((v.summary || []).filter(function (x) { return x.key === 'rent'; })[0] || {}).pct,
          calcError: p.data.calcError,
        };
      }, idx), 30000, 'awaitCalc');
      out['preset' + idx] = one;
      log('   [f3d] preset#' + idx + ' → ' + JSON.stringify(one));
    }
    return out;
  },

  // f4：边界 —— 房租空 / 人数 0 / 天价房租
  f4: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    const empty = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({ rentYuan: '', headcountNum: '', laborUnitYuan: '' });
      p.scheduleCalc();
      return 1;
    }), 12000, 'clear');
    await sleep(8000);
    const sEmpty = await T(mp.evaluate(SNAP), 14000, 'snap-empty');
    await shot(mp, '04_empty_fixed.png');

    const huge = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({ rentYuan: '200000', headcountNum: '2', laborUnitYuan: '3200', targetYuan: '8000' });
      p.scheduleCalc();
      return 1;
    }), 12000, 'huge');
    await sleep(9000);
    const sHuge = await T(mp.evaluate(SNAP), 14000, 'snap-huge');
    await shot(mp, '05_huge_rent.png');
    return { empty: sEmpty, huge: sHuge };
  },
};

// ===== 轮次 2 · 反向 + 矩阵 =====
const STEPS2 = {
  // r1：首页强制 reverse —— 回归 R291 修的 l1TitleRev / l1GuideRev（不得空白）
  r1: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    const probe = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({ mode: 'reverse' });
      var t = p.data.t || {};
      return {
        modeAfter: p.data.mode,
        l1TitleRev: t.l1TitleRev === undefined ? '<undefined>' : t.l1TitleRev,
        l1GuideRev: t.l1GuideRev === undefined ? '<undefined>' : t.l1GuideRev,
        l1Title: t.l1Title,
        tKeysL1: Object.keys(t).filter(function (k) { return k.indexOf('l1') === 0; }),
      };
    }), 12000, 'revProbe');
    await sleep(3000);
    await shot(mp, '11_forced_reverse.png');
    return probe;
  },

  // r2：真实点「找店」→ 跳矩阵页（R290 v5 定案），读标题/副标题
  r2: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    const before = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      return { route: p.route, mode: p.data.mode };
    }), 12000, 'before');
    await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.onTab({ currentTarget: { dataset: { mode: 'reverse' } } });
      return 1;
    }), 12000, 'onTab');
    await sleep(9000);
    const after = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var d = p.data;
      return {
        route: p.route, mode: d.mode, title: d.t.title, subtitle: d.t.subtitle,
        presetIdx: d.presetIdx, cityIdx: d.cityIdx,
        presets: d.presets, dims: d.dims, global: d.global,
        pivotFix: d.pivotFix, pivotRowDim: d.pivotRowDim,
        resultCount: d.result ? d.result.count : null,
        stackDepth: ps.length,
      };
    }), 14000, 'after');
    await shot(mp, '12_matrix_reverse.png');
    return { before, after };
  },

  // r3：矩阵页 —— 选火锅预设（验 R292 年限拆分后 buildRef 带出）+ 生成矩阵
  r3: async (mp) => {
    await navTo(mp, '/pages/sandbox/matrix?mode=reverse');
    const setup = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var names = p.data.presets || [];
      var hot = -1;
      for (var i = 0; i < names.length; i++) {
        var s = String(names[i]);
        if (s.indexOf('火锅') >= 0 || s.indexOf('烧烤') >= 0) { hot = i; break; }
      }
      var out = { presets: names, picked: hot, cityIdx: p.data.cityIdx };
      if (hot >= 0) p.onPresetChange({ detail: { value: hot } });
      p.onCityChange({ detail: { value: 1 } });   // 二线
      return out;
    }), 14000, 'setup');
    await sleep(4000);
    const afterPick = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      return { presetIdx: p.data.presetIdx, cityIdx: p.data.cityIdx, global: p.data.global, dims: p.data.dims };
    }), 12000, 'afterPick');
    await shot(mp, '13_matrix_hotpot.png');

    const gen = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      try { p.onGenerate(); return { called: true }; } catch (e) { return { called: false, err: String(e && e.message) }; }
    }), 15000, 'gen');
    await sleep(40000);
    const res = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var r = p.data.result;
      if (!r) return { loading: p.data.loading, result: null };
      var rows = (r.rows || []).slice(0, 6).map(function (x) {
        return {
          rent: x.rent, labor: x.labor, marginPct: x.marginPct, targetYuan: x.targetYuan,
          breakMonthly: x.breakMonthly, targetMonthly: x.targetMonthly,
          rentPct: x.rentPct, payback: x.payback, red: x.red,
        };
      });
      return {
        loading: p.data.loading, count: r.count, view: r.view,
        insight: r.insight,
        pivotHead: r.pivot ? Object.keys(r.pivot) : null,
        rows: rows,
        nullBreak: (r.rows || []).filter(function (x) { return x.breakMonthly == null; }).length,
      };
    }), 16000, 'res');
    await shot(mp, '14_matrix_generated.png');
    return { setup, afterPick, gen, res };
  },

  // r4：极端房租档（天价）→ 看红警/租金占比与洞察
  r4: async (mp) => {
    await navTo(mp, '/pages/sandbox/matrix?mode=reverse');
    const set = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({ dims: { rent: ['3000', '20000', '100000'], labor: ['2'], margin: ['55'], target: ['8000'] } });
      return { dims: p.data.dims };
    }), 12000, 'dims');
    await sleep(2500);
    await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      try { p.onGenerate(); return 1; } catch (e) { return 0; }
    }), 15000, 'gen');
    await sleep(40000);
    const res = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var r = p.data.result;
      if (!r) return { loading: p.data.loading, result: null };
      return {
        loading: p.data.loading, count: r.count,
        rows: (r.rows || []).map(function (x) {
          return { rent: x.rent, breakMonthly: x.breakMonthly, targetMonthly: x.targetMonthly, rentPct: x.rentPct, red: x.red, payback: x.payback };
        }),
        insight: r.insight,
      };
    }), 16000, 'res');
    await shot(mp, '15_matrix_extreme.png');
    return { set, res };
  },

  // r5：首页真实反推（填桌数 → rent_cap / 翻台难度）
  r5: async (mp) => {
    await navTo(mp, '/pages/sandbox/index');
    const fill = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      p.setData({
        mode: 'reverse', tablesNum: '8', seatsPerTableNum: '4',
        avgPriceYuan: '12', targetYuan: '8000', rentYuan: '',
        headcountNum: '2', laborUnitYuan: '3200', areaNum: '60',
      });
      p.scheduleCalc();
      return { mode: p.data.mode, seats: p.data.tablesNum };
    }), 12000, 'fill');
    await sleep(12000);
    const s = await T(mp.evaluate(function () {
      var ps = getCurrentPages(); var p = ps[ps.length - 1];
      var d = p.data; var rr = d.reverseResult;
      return {
        route: p.route, mode: d.mode, calcError: d.calcError, loading: d.loading,
        reverseResult: rr,
        crowd: d.crowd, eff: d.eff, verdict: d.verdict,
        l1TitleRev: d.t.l1TitleRev, l1GuideRev: d.t.l1GuideRev,
      };
    }), 14000, 'snap');
    await shot(mp, '16_index_reverse_calc.png');
    return { fill, s };
  },
};

// ===== 轮次 2 合并版：一条连接内顺序跑完（R188 定式，比多次 connect 稳）=====
STEPS2.r2all = async (mp) => {
  const out = {};
  await navTo(mp, '/pages/sandbox/index');
  await waitReady(mp, 24000, 3000);

  // ① 首页 reverse 文案回归（R291 修复）
  out.revText = await T(mp.evaluate(function () {
    var ps = getCurrentPages(); var p = ps[ps.length - 1];
    p.setData({ mode: 'reverse' });
    var t = p.data.t || {};
    return {
      route: p.route, mode: p.data.mode,
      l1TitleRev: t.l1TitleRev === undefined ? '<undefined>' : t.l1TitleRev,
      l1GuideRev: t.l1GuideRev === undefined ? '<undefined>' : t.l1GuideRev,
    };
  }), 14000, 'revText');

  // ② 真实点「找店」→ 跳矩阵页
  out.toMatrix = await T(mp.evaluate(async function () {
    var ps = getCurrentPages(); var p = ps[ps.length - 1];
    p.setData({ mode: 'forward' });
    p.onTab({ currentTarget: { dataset: { mode: 'reverse' } } });
    await new Promise(function (r) { setTimeout(r, 6000); });
    var q = getCurrentPages();
    var m = q[q.length - 1];
    return {
      stack: q.map(function (x) { return x.route; }),
      route: m.route, mode: m.data.mode,
      title: m.data.t.title, subtitle: m.data.t.subtitle,
      presetIdx: m.data.presetIdx, cityIdx: m.data.cityIdx,
      presets: m.data.presets, dims: m.data.dims, global: m.data.global,
    };
  }), 20000, 'toMatrix');
  await shot(mp, '12_matrix_reverse.png');

  // ③ 矩阵：选火锅预设（验 R292 年限拆分后带出的建店投入）+ 二线 + 生成
  out.genHotpot = await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var m = q[q.length - 1];
    var names = m.data.presets || [];
    var hot = -1;
    for (var i = 0; i < names.length; i++) {
      if (String(names[i]).indexOf('火锅') >= 0) { hot = i; break; }
    }
    var picked = { hot: hot, name: hot >= 0 ? String(names[hot]) : null };
    if (hot >= 0) m.onPresetChange({ detail: { value: hot } });
    m.onCityChange({ detail: { value: 1 } });
    await new Promise(function (r) { setTimeout(r, 2500); });
    picked.globalAfter = m.data.global;
    await m.onGenerate();
    await new Promise(function (r) { setTimeout(r, 2500); });
    var rr = m.data.result;
    picked.loading = m.data.loading;
    picked.count = rr ? rr.count : null;
    picked.insight = rr ? rr.insight : null;
    picked.rows = rr ? (rr.rows || []).slice(0, 8).map(function (x) {
      return { rent: x.rent, labor: x.labor, margin: x.marginPct, target: x.targetYuan,
        breakMonthly: x.breakMonthly, targetMonthly: x.targetMonthly, rentPct: x.rentPct, red: x.red };
    }) : null;
    picked.nullBreak = rr ? (rr.rows || []).filter(function (x) { return x.breakMonthly == null; }).length : null;
    return picked;
  }), 90000, 'genHotpot');
  await shot(mp, '14_matrix_generated.png');

  // ④ 极端房租档（3000 / 20000 / 100000）
  out.extreme = await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var m = q[q.length - 1];
    m.setData({ dims: { rent: ['3000', '20000', '100000'], labor: ['2'], margin: ['55'], target: ['8000'] } });
    await new Promise(function (r) { setTimeout(r, 1500); });
    await m.onGenerate();
    await new Promise(function (r) { setTimeout(r, 2500); });
    var rr = m.data.result;
    return {
      count: rr ? rr.count : null,
      rows: rr ? (rr.rows || []).map(function (x) {
        return { rent: x.rent, breakMonthly: x.breakMonthly, targetMonthly: x.targetMonthly, rentPct: x.rentPct, red: x.red };
      }) : null,
      insight: rr ? rr.insight : null,
    };
  }), 90000, 'extreme');
  await shot(mp, '15_matrix_extreme.png');

  // ⑤ 回首页做一次真实反推（rent_cap / 客流 / 翻台）
  out.revCalc = await T(mp.evaluate(async function () {
    wx.reLaunch({ url: '/pages/sandbox/index', fail: function () {} });
    await new Promise(function (r) { setTimeout(r, 6000); });
    var q = getCurrentPages(); var p = q[q.length - 1];
    p.setData({
      mode: 'reverse', tablesNum: '8', seatsPerTableNum: '4',
      avgPriceYuan: '12', targetYuan: '8000', rentYuan: '',
      headcountNum: '2', laborUnitYuan: '3200', areaNum: '60',
    });
    var err = null;
    try { await p.onCalcPresetRev(); } catch (e) { err = String(e && e.message); }
    return {
      route: p.route, mode: p.data.mode, err: err,
      calcError: p.data.calcError,
      reverseResult: p.data.reverseResult,
      crowd: p.data.crowd, verdict: p.data.verdict ? p.data.verdict.levelName : null,
    };
  }), 60000, 'revCalc');
  await shot(mp, '16_index_reverse_calc.png');
  return out;
};

// ===== 轮次 2 · 矩阵规模对照（小矩阵 vs 默认大矩阵，各计时）=====
STEPS2.r3b = async (mp) => {
  const out = {};
  await navTo(mp, '/pages/sandbox/matrix?mode=reverse');
  await waitReady(mp, 20000, 3000);
  // ① 小矩阵（2 组合）
  out.small = await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var m = q[q.length - 1];
    m.setData({ dims: { rent: ['3000', '5000'], labor: ['2'], margin: ['55'], target: ['8000'] } });
    await new Promise(function (r) { setTimeout(r, 1200); });
    var t0 = Date.now();
    await m.onGenerate();
    var ms = Date.now() - t0;
    var rr = m.data.result;
    return {
      ms: ms, combos: 2, loading: m.data.loading,
      count: rr ? rr.count : null,
      insight: rr ? rr.insight : null,
      rows: rr ? (rr.rows || []).map(function (x) {
        return { rent: x.rent, breakMonthly: x.breakMonthly, targetMonthly: x.targetMonthly, rentPct: x.rentPct, red: x.red };
      }) : null,
    };
  }), 120000, 'small');
  await shot(mp, '17_matrix_small.png');

  // ② 默认大矩阵（页面默认档位组合数）
  out.large = await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var m = q[q.length - 1];
    var d = m.data.dims;
    var combos = d.rent.length * d.labor.length * d.margin.length * d.target.length;
    var t0 = Date.now();
    var err = null;
    try { await m.onGenerate(); } catch (e) { err = String(e && e.message); }
    var ms = Date.now() - t0;
    var rr = m.data.result;
    return {
      ms: ms, combos: combos, err: err, loading: m.data.loading,
      count: rr ? rr.count : null,
      nullBreak: rr ? (rr.rows || []).filter(function (x) { return x.breakMonthly == null; }).length : null,
      insight: rr ? rr.insight : null,
      first3: rr ? (rr.rows || []).slice(0, 3).map(function (x) {
        return { rent: x.rent, labor: x.labor, margin: x.marginPct, target: x.targetYuan, breakMonthly: x.breakMonthly, rentPct: x.rentPct };
      }) : null,
    };
  }), 240000, 'large');
  await shot(mp, '18_matrix_large.png');
  return out;
};

// ===== 轮次 2 · 默认档位（192 组合）计时 + 首页真实反推 =====
STEPS2.r3c = async (mp) => {
  await navTo(mp, '/pages/sandbox/matrix?mode=reverse');
  await waitReady(mp, 20000, 3000);
  const large = await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var m = q[q.length - 1];
    m.setData({ dims: { rent: ['3000', '4000', '5000', '6000', '7000', '8000', '9000', '10000'],
      labor: ['2', '3'], margin: ['45', '55', '60', '65'], target: ['0', '10000', '15000'] } });
    await new Promise(function (r) { setTimeout(r, 1500); });
    var d = m.data.dims;
    var combos = d.rent.length * d.labor.length * d.margin.length * d.target.length;
    var t0 = Date.now(); var err = null;
    try { await m.onGenerate(); } catch (e) { err = String(e && e.message); }
    var ms = Date.now() - t0;
    var rr = m.data.result;
    return {
      ms: ms, combos: combos, err: err, loading: m.data.loading,
      count: rr ? rr.count : null,
      nullBreak: rr ? (rr.rows || []).filter(function (x) { return x.breakMonthly == null; }).length : null,
      redCount: rr ? (rr.rows || []).filter(function (x) { return x.red; }).length : null,
      insight: rr ? rr.insight : null,
      first3: rr ? (rr.rows || []).slice(0, 3).map(function (x) {
        return { rent: x.rent, labor: x.labor, margin: x.marginPct, target: x.targetYuan, breakMonthly: x.breakMonthly, rentPct: x.rentPct };
      }) : null,
    };
  }), 300000, 'large192');
  await shot(mp, '19_matrix_192.png');

  // 首页真实反推（await 页面方法，杜绝旧结果）
  const rev = await T(mp.evaluate(async function () {
    wx.reLaunch({ url: '/pages/sandbox/index', fail: function () {} });
    await new Promise(function (r) { setTimeout(r, 7000); });
    var q = getCurrentPages(); var p = q[q.length - 1];
    p.setData({
      mode: 'reverse', tablesNum: '8', seatsPerTableNum: '4',
      avgPriceYuan: '12', targetYuan: '8000', rentYuan: '',
      headcountNum: '2', laborUnitYuan: '3200', areaNum: '60',
    });
    var err = null;
    try { await p.onCalcPresetRev(); } catch (e) { err = String(e && e.message); }
    return {
      route: p.route, mode: p.data.mode, err: err,
      calcError: p.data.calcError,
      reverseResult: p.data.reverseResult,
      crowd: p.data.crowd,
      verdict: p.data.verdict ? { level: p.data.verdict.level, name: p.data.verdict.levelName, note: p.data.verdict.note } : null,
    };
  }), 90000, 'rev');
  await shot(mp, '20_index_reverse_await.png');
  return { large192: large, rev: rev };
};

// ===== 轮次 2 · 反推被拒时到底缺哪一项（把送上去的字段全打印出来）=====
STEPS2.r5b = async (mp) => {
  await navTo(mp, '/pages/sandbox/index');
  await waitReady(mp, 24000, 3000);
  return await T(mp.evaluate(function () {
    var q = getCurrentPages(); var p = q[q.length - 1];
    p.setData({
      mode: 'reverse', tablesNum: '8', seatsPerTableNum: '4',
      avgPriceYuan: '12', targetYuan: '8000', rentYuan: '',
      headcountNum: '2', laborUnitYuan: '3200', areaNum: '60',
    });
    var pp = null, err = null;
    try { pp = p.buildPresetParam('reverse'); } catch (e) { err = String(e && e.message); }
    if (!pp) return { err: err };
    return {
      err: err,
      mode: pp.mode, city_tier: pp.city_tier, biz_type: pp.biz_type,
      fixed_items: pp.fixed_items.map(function (x) { return x.key + '=' + Math.round(x.fen / 100); }),
      var_items: pp.var_items.map(function (x) { return x.key + '=' + x.pct; }),
      build_items: pp.build_items.map(function (x) { return x.key + '=' + Math.round(x.fen / 100) + '/' + x.years + 'y'; }),
      gross_margin_pct: pp.gross_margin_pct,
      target_profit_fen: pp.target_profit_fen,
      expected_revenue_fen: pp.expected_revenue_fen,
      rev_price_fen: pp.rev_price_fen,
      seats: pp.seats, open_days: pp.open_days, valid_days: pp.valid_days,
      target_rent_rate: pp.target_rent_rate,
      seatsNow: p.seatsNow ? p.seatsNow() : null,
      validDaysNow: p.validDaysNow ? p.validDaysNow() : null,
      presetKey: p.data.presetKey,
    };
  }), 25000, 'probeRev');
};

// ===== 轮次 2 · 云端真实返回（拿后端原始 code/msg，绕开前端 msgOf 覆盖）=====
STEPS2.r5c = async (mp) => {
  await navTo(mp, '/pages/sandbox/index');
  await waitReady(mp, 24000, 3000);
  return await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var p = q[q.length - 1];
    p.setData({
      mode: 'reverse', tablesNum: '8', seatsPerTableNum: '4',
      avgPriceYuan: '12', targetYuan: '8000', rentYuan: '',
      headcountNum: '2', laborUnitYuan: '3200', areaNum: '60',
    });
    var pp = p.buildPresetParam('reverse');
    var payload = {
      mode: pp.mode, city_tier: pp.city_tier, biz_type: pp.biz_type,
      build_items: pp.build_items, fixed_items: pp.fixed_items, var_items: pp.var_items,
      gross_margin_pct: pp.gross_margin_pct, target_profit_fen: pp.target_profit_fen,
      expected_revenue_fen: pp.expected_revenue_fen,
      rev_price_fen: pp.rev_price_fen, seats: pp.seats, open_days: pp.open_days,
      target_rent_rate: pp.target_rent_rate, pixel_eff_fen: pp.pixel_eff_fen,
      valid_days: pp.valid_days,
      client_request_id: 'sb_r294_' + Date.now(),
    };
    var raw = null, err = null;
    try {
      var r = await wx.cloud.callFunction({ name: 'calcSandbox', data: payload });
      raw = JSON.stringify(r && r.result).slice(0, 800);
    } catch (e) { err = String(e && e.message); }
    return { payload: JSON.stringify(payload).slice(0, 700), raw: raw, err: err };
  }), 60000, 'cloudCall');
};

// ===== 轮次 2 · 云端二分：同一 payload 改一个字段再问一次，定位云端究竟卡在哪一项 =====
STEPS2.r5d = async (mp) => {
  await navTo(mp, '/pages/sandbox/index');
  await waitReady(mp, 24000, 3000);
  return await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var p = q[q.length - 1];
    p.setData({
      mode: 'reverse', tablesNum: '8', seatsPerTableNum: '4',
      avgPriceYuan: '12', targetYuan: '8000', rentYuan: '',
      headcountNum: '2', laborUnitYuan: '3200', areaNum: '60',
    });
    var pp = p.buildPresetParam('reverse');
    var base = {
      mode: pp.mode, city_tier: pp.city_tier, biz_type: pp.biz_type,
      build_items: pp.build_items, fixed_items: pp.fixed_items, var_items: pp.var_items,
      gross_margin_pct: pp.gross_margin_pct, target_profit_fen: pp.target_profit_fen,
      expected_revenue_fen: pp.expected_revenue_fen,
      rev_price_fen: pp.rev_price_fen, seats: pp.seats, open_days: pp.open_days,
      target_rent_rate: pp.target_rent_rate, pixel_eff_fen: pp.pixel_eff_fen,
    };
    var variants = [
      ['A 原样（含 valid_days）', { valid_days: pp.valid_days }],
      ['B 去掉 valid_days', {}],
      ['C expected_revenue_fen 给 60000 元', { expected_revenue_fen: 6000000 }],
      ['D gross_margin_pct=55', { gross_margin_pct: 55 }],
      ['E seats=20 / 客单 30 元', { seats: 20, rev_price_fen: 3000 }],
    ];
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      var label = variants[i][0];
      var payload = Object.assign({}, base, variants[i][1], { client_request_id: 'sb_r294_' + Date.now() + '_' + i });
      try {
        var r = await wx.cloud.callFunction({ name: 'calcSandbox', data: payload });
        var res = r && r.result;
        out.push({ label: label, code: res && res.code, msg: res && res.msg,
          rent_cap: res && res.data ? res.data.rent_cap_fen : null });
      } catch (e) {
        out.push({ label: label, err: String(e && e.message) });
      }
    }
    return out;
  }), 120000, 'cloudBisect');
};

// ===== 轮次 2 · 对照组：同一批入参改回 forward，证明「云端只拒 reverse」=====
STEPS2.r5e = async (mp) => {
  await navTo(mp, '/pages/sandbox/index');
  await waitReady(mp, 24000, 3000);
  return await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var p = q[q.length - 1];
    p.setData({ mode: 'forward', areaNum: '60', rentYuan: '3000', headcountNum: '2',
      laborUnitYuan: '3200', targetYuan: '8000', avgPriceYuan: '12', tablesNum: '8' });
    var pp = p.buildPresetParam('forward');
    var out = [];
    var mk = function (label, patch) {
      return Object.assign({
        city_tier: pp.city_tier, biz_type: pp.biz_type,
        build_items: pp.build_items, fixed_items: pp.fixed_items, var_items: pp.var_items,
        gross_margin_pct: pp.gross_margin_pct, target_profit_fen: pp.target_profit_fen,
        expected_revenue_fen: pp.expected_revenue_fen,
        rev_price_fen: pp.rev_price_fen, seats: pp.seats, open_days: pp.open_days,
        target_rent_rate: pp.target_rent_rate, pixel_eff_fen: pp.pixel_eff_fen,
        valid_days: pp.valid_days,
      }, patch, { client_request_id: 'sb_r294_' + Date.now() + '_' + label });
    };
    var cases = [
      ['F1 forward 显式', mk('F1', { mode: 'forward' })],
      ['F2 不带 mode（引擎默认 forward）', mk('F2', {})],
      ['G  reverse（对照：预期仍拒）', mk('G', { mode: 'reverse' })],
    ];
    for (var i = 0; i < cases.length; i++) {
      try {
        var r = await wx.cloud.callFunction({ name: 'calcSandbox', data: cases[i][1] });
        var res = r && r.result;
        out.push({ label: cases[i][0], code: res && res.code, msg: res && res.msg,
          breakEven: res && res.data ? res.data.break_even_monthly_fen : null,
          rentCap: res && res.data ? res.data.rent_cap_fen : null });
      } catch (e) { out.push({ label: cases[i][0], err: String(e && e.message) }); }
    }
    return out;
  }), 120000, 'cloudFwdCtrl');
};

// ===== 轮次 2 · 最后一刀：去掉我探针多加的 valid_days，看云端到底认不认 =====
STEPS2.r5f = async (mp) => {
  await navTo(mp, '/pages/sandbox/index');
  await waitReady(mp, 24000, 3000);
  return await T(mp.evaluate(async function () {
    var q = getCurrentPages(); var p = q[q.length - 1];
    p.setData({ areaNum: '60', rentYuan: '3000', headcountNum: '2',
      laborUnitYuan: '3200', targetYuan: '8000', avgPriceYuan: '12', tablesNum: '8' });
    var pp = p.buildPresetParam('forward');
    var core = {
      city_tier: pp.city_tier, biz_type: pp.biz_type,
      build_items: pp.build_items, fixed_items: pp.fixed_items, var_items: pp.var_items,
      gross_margin_pct: pp.gross_margin_pct, target_profit_fen: pp.target_profit_fen,
      expected_revenue_fen: pp.expected_revenue_fen,
      rev_price_fen: pp.rev_price_fen, seats: pp.seats, open_days: pp.open_days,
      target_rent_rate: pp.target_rent_rate, pixel_eff_fen: pp.pixel_eff_fen,
    };
    var cases = [
      ['H1 forward · 无 valid_days', Object.assign({}, core, { mode: 'forward' })],
      ['H2 forward · 带 valid_days', Object.assign({}, core, { mode: 'forward', valid_days: pp.valid_days })],
      ['H3 reverse · 无 valid_days', Object.assign({}, core, { mode: 'reverse',
        fixed_items: pp.fixed_items.filter(function (x) { return x.key !== 'rent'; }) })],
    ];
    var out = [];
    for (var i = 0; i < cases.length; i++) {
      var payload = Object.assign({}, cases[i][1], { client_request_id: 'sb_r294_' + Date.now() + '_H' + i });
      try {
        var r = await wx.cloud.callFunction({ name: 'calcSandbox', data: payload });
        var res = r && r.result;
        out.push({ label: cases[i][0], code: res && res.code, msg: res && res.msg,
          breakEven: res && res.data ? res.data.break_even_monthly_fen : null,
          rentCap: res && res.data ? res.data.rent_cap_fen : null });
      } catch (e) { out.push({ label: cases[i][0], err: String(e && e.message) }); }
    }
    return out;
  }), 120000, 'validDaysCtrl');
};

// ===== 轮次 2 · 带 shop_id 重验（裸调用漏了 api.call 注入的 shop_id，前面的"恒拒"可能是假象）=====
STEPS2.r5g = async (mp) => {
  await navTo(mp, '/pages/sandbox/index');
  await waitReady(mp, 24000, 3000);
  return await T(mp.evaluate(async function () {
    var app = (typeof getApp === 'function') ? getApp() : null;
    var shopId = (app && app.globalData && app.globalData.shop_id) || '';
    var q = getCurrentPages(); var p = q[q.length - 1];
    p.setData({ areaNum: '60', rentYuan: '3000', headcountNum: '2',
      laborUnitYuan: '3200', targetYuan: '8000', avgPriceYuan: '12', tablesNum: '8' });
    var pp = p.buildPresetParam('forward');
    var core = {
      city_tier: pp.city_tier, biz_type: pp.biz_type,
      build_items: pp.build_items, fixed_items: pp.fixed_items, var_items: pp.var_items,
      gross_margin_pct: pp.gross_margin_pct, target_profit_fen: pp.target_profit_fen,
      expected_revenue_fen: pp.expected_revenue_fen,
      rev_price_fen: pp.rev_price_fen, seats: pp.seats, open_days: pp.open_days,
      target_rent_rate: pp.target_rent_rate, pixel_eff_fen: pp.pixel_eff_fen,
    };
    var cases = [
      ['I1 forward + shop_id', Object.assign({}, core, { mode: 'forward' })],
      ['I2 reverse + shop_id', Object.assign({}, core, { mode: 'reverse',
        fixed_items: pp.fixed_items.filter(function (x) { return x.key !== 'rent'; }) })],
    ];
    var out = { shopId: shopId };
    out.rows = [];
    for (var i = 0; i < cases.length; i++) {
      var payload = Object.assign({ shop_id: shopId }, cases[i][1],
        { client_request_id: 'sb_r294_' + Date.now() + '_I' + i });
      try {
        var r = await wx.cloud.callFunction({ name: 'calcSandbox', data: payload });
        var res = r && r.result;
        out.rows.push({ label: cases[i][0], code: res && res.code, msg: res && res.msg,
          breakEven: res && res.data ? res.data.break_even_monthly_fen : null,
          rentCap: res && res.data ? res.data.rent_cap_fen : null });
      } catch (e) { out.rows.push({ label: cases[i][0], err: String(e && e.message) }); }
    }
    return out;
  }), 120000, 'shopIdCtrl');
};

const ALL = Object.assign({}, STEPS, STEPS2);

(async function () {
  const names = ONLY.length ? ONLY : Object.keys(ALL);
  for (const name of names) {
    if (!ALL[name]) { log('STEP ' + name + ' SKIP'); continue; }
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      let mp = null;
      try {
        mp = await automator.connect({ wsEndpoint: WS });
        const res = await ALL[name](mp);
        results[name] = { ok: true, attempt: attempt, res: res };
        log('=== STEP ' + name + ' OK (attempt ' + attempt + ') ===\n' + JSON.stringify(res));
        ok = true;
      } catch (e) {
        results[name] = { ok: false, attempt: attempt, err: String((e && e.message) || e) };
        log('=== STEP ' + name + ' FAIL(attempt ' + attempt + ') === ' + (e && e.message));
      } finally {
        try { if (mp) await T(mp.disconnect(), 5000, 'disconnect'); } catch (e) {}
      }
      if (!ok) await sleep(2500);
    }
    await sleep(1000);
  }
  fs.writeFileSync(path.join(OUT, 'walk_report.json'), JSON.stringify(results, null, 2));
  log('report written: walk_report.json');
  process.exit(0);
})();
