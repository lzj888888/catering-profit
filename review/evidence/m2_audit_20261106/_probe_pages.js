// M2 审计页面桩探针 · 2026-11-06 —— 真跑生产页面源码，具鉴别力变异 + 独立复算
// 复用 10-27 harness 结构（stub wx/Page/getApp，api.call 劫持到生产引擎）
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = (() => { let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(path.join(d, 'app.json'))) return d; d = path.dirname(d); } return __dirname; })();
const OUT = [];
const log = (...a) => { const s = a.join(' '); OUT.push(s); console.log(s); };
let PASS = 0, FAIL = 0, ISSUE = 0;
const ok = (n, c, d) => { if (c) { PASS++; log('  [PASS] ' + n + (d ? ' | ' + d : '')); } else { FAIL++; log('  [FAIL] ' + n + (d ? ' | ' + d : '')); } };
const issue = (n, d) => { ISSUE++; log('  [ISSUE] ' + n + ' | ' + d); };

const TOASTS = [];
global.wx = new Proxy({
  getSystemInfoSync: () => ({ windowWidth: 375 }), showToast: (o) => TOASTS.push(o.title),
  showModal: () => {}, navigateTo: () => {}, navigateBack: () => {},
  getStorageSync: () => '', setStorageSync: () => {},
}, { get: (t, k) => (k in t ? t[k] : () => {}) });
let PAGE = null;
global.Page = (o) => { PAGE = o; };
global.getApp = () => ({ globalData: { shop_id: 'audit' } });

const api = require(path.join(ROOT, 'utils', 'api.js'));
const svc = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js'));
const val = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'validate.js'));
api.call = async (name, payload) => {
  if (name === 'calcSandbox' && payload && payload.action === 'matrix') {
    const arr = payload.clean_array || [];
    const rejected = [];
    const rows = arr.map((c, i) => {
      const v = val.validateClean(c && typeof c === 'object' ? c : {});
      if (v.error) { rejected.push({ index: i, code: v.error }); return null; }
      return svc.calcSandbox(v.clean);
    });
    return { rows, rejected };
  }
  throw new Error('unexpected api.call: ' + name);
};
api.toastError = () => {};
require(path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'matrix.js'));
const PRESETS = PAGE.data.presets.map((p) => p.key);

function newPage() {
  const inst = Object.create(PAGE);
  inst.data = JSON.parse(JSON.stringify(PAGE.data));
  inst.setData = function (patch, cb) {
    for (const k in patch) {
      const ks = k.split('.'); let o = this.data;
      for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
      o[ks[ks.length - 1]] = patch[k];
    }
    if (cb) cb();
  };
  return inst;
}
function setup(opts) {
  const p = newPage();
  p.onLoad(Object.assign({ mode: 'reverse' }, (opts && opts.query) || {}));
  if (opts) {
    if (opts.presetIdx != null) p.setData({ presetIdx: opts.presetIdx });
    if (opts.cityIdx != null) { p.setData({ cityIdx: opts.cityIdx }); p.onCityChange({ detail: { value: opts.cityIdx } }); }
    if (opts.dims) p.setData({ dims: opts.dims });
    if (opts.global) p.setData({ global: Object.assign({}, p.data.global, opts.global) });
    if (opts.cash) p.setData({ cash: Object.assign({}, p.data.cash, opts.cash) });
  }
  return p;
}

(async () => {
  // ===== T1 D6：具鉴别力变异 —— pivotFix.labor 改成**在档位内**的 3 =====
  log('\n===== T1 透视表人工维过滤（具鉴别力变异 2→3） =====');
  {
    const p = setup({ presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2,
      dims: { rent: [3000], labor: [2, 3], margin: [55], target: [0] }, global: { area: 40 } });
    await p.onGenerate();
    const rows = (p.data.result && p.data.result.rows) || [];
    const c2 = p.buildPivot(rows).cells;
    p.data.pivotFix.labor = 3;
    const c3 = p.buildPivot(rows).cells;
    log('  labor=2 cells=' + JSON.stringify(c2));
    log('  labor=3 cells=' + JSON.stringify(c3));
    ok('T1 D6 人工维真过滤：改 2→3 后 cells 变化', JSON.stringify(c2) !== JSON.stringify(c3));
    // 999 是「不在档位」⇒ 按 R331 应回落到第一档，不变是预期（历史探针用它做变异不具鉴别力）
    p.data.pivotFix.labor = 999;
    const c999 = p.buildPivot(rows).cells;
    ok('T1 R331 回落：999 不在档位 ⇒ 退到第一档（等于 labor=2）', JSON.stringify(c999) === JSON.stringify(c2));
  }

  // ===== T2 P4：房租杠杆 —— 用生产引擎真跑相邻两档，独立复算 Δ保本/千元 =====
  log('\n===== T2 房租杠杆：页面公式 vs 引擎真跑差分 =====');
  {
    const p = setup({ presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2,
      dims: { rent: [1000, 2000, 3000, 4000, 5000], labor: [2], margin: [63], target: [0] },
      global: { area: 40 }, cash: { rentYuan: 3000, budgetYuan: 100000, equipYuan: 50000, stockYuan: 10000 } });
    await p.onGenerate();
    const rows = ((p.data.result && p.data.result.rows) || []).filter((r) => r.targetYuan === 0 && !r.invalid && !r.red);
    rows.forEach((r) => log('  租=' + r.rent + ' 保本月=' + r.breakMonthly + ' 页面leverYuan=' + r.leverYuan));
    const ins = p.buildInsight(rows);
    log('  结论卡 leverText = ' + (ins && ins.leverText));
    if (rows.length >= 2) {
      const a = rows[0], b = rows[1];
      const deltaRent = Number(b.rent) - Number(a.rent);
      const trueDelta = (b.breakMonthly - a.breakMonthly) / deltaRent * 1000; // 每涨 1000 元房租的保本增量
      const pageLever = Number(a.leverYuan);
      log('  🔴 引擎真跑：房租 ' + a.rent + '→' + b.rent + ' ⇒ 保本 +' + (b.breakMonthly - a.breakMonthly).toFixed(2)
        + ' 元 ⇒ 每千元真实需多卖 ' + trueDelta.toFixed(2) + ' 元；页面写 ' + pageLever + ' 元');
      log('  ⇒ 低估倍数 = ' + (trueDelta / pageLever).toFixed(2) + '×（<1 表示高估）');
      issue('P4 房租杠杆口径', `页面 ${pageLever} 元/千元 vs 引擎差分 ${trueDelta.toFixed(2)} 元/千元`);
    }
  }

  // ===== T3 P9：现金卡装修是否读老板填的投入 =====
  log('\n===== T3 现金卡装修 vs 上方「开店投入」 =====');
  {
    const p = setup({ presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2,
      dims: { rent: [3000, 4000], labor: [2], margin: [63], target: [0] },
      global: { area: 40, buildDecorYuan: '50000', buildEquipYuan: '80000' },
      cash: { rentYuan: 3000, budgetYuan: 200000, equipYuan: 80000, stockYuan: 10000 } });
    await p.onGenerate();
    await p.buildCash();
    const c = p.data.cashRes;
    log('  老板填：装修 50000 元 / 设备 80000 元 / 面积 40㎡');
    log('  页面上方 buildSumText = ' + JSON.stringify(p.data.buildSumText));
    log('  现金卡 partsText = ' + (c && c.partsText));
    const decorLine = (c && c.partsText || '');
    const usesOwn = /5\.0万|50000/.test(decorLine);
    ok('T3 现金卡装修采用老板填的 5 万', usesOwn, decorLine);
    if (!usesOwn) issue('P9 现金卡装修按面积自算', '老板填 5 万，现金卡仍写「装修 3.6万」（40㎡×900）');
  }

  // ===== T4 P11：组合数占位符 =====
  log('\n===== T4 组合数文案 =====');
  {
    const p = setup({});
    log('  data.t.count = ' + JSON.stringify(p.data.t.count));
    const wxml = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/matrix.wxml'), 'utf8');
    log('  wxml 渲染 = ' + (wxml.match(/<text class="count">[^<]*<\/text>/) || ['(未找到)'])[0]);
    const hasFmt = /fmt\([^)]*t\.count|count:.*result\.count|'t\.count'/.test(
      fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/matrix.js'), 'utf8'));
    ok('T4 {n} 有 fmt 替换', hasFmt, hasFmt ? '' : 'wxml 直接渲染 {{t.count}} ⇒ 显示「共 {n} 组组合」');
    if (!hasFmt) issue('P11 组合数占位符未替换', '{{t.count}} = 「共 {n} 组组合」，result.count 无人渲染');
  }

  // ===== T5 P1：可承受最高月租可行性 =====
  log('\n===== T5 可承受最高月租（P1 修复复验） =====');
  {
    const mk = (target, real) => {
      const p = setup({ presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2,
        dims: { rent: [1000, 3000, 5000, 8000, 10000], labor: [2], margin: [55], target: [target] },
        global: { area: 40 } });
      p.setData({ realMonthYuan: String(real) });
      return p;
    };
    const p1 = mk(10000, 0), p2 = mk(10000, 30000), p3 = mk(500000, 30000);
    await p1.onGenerate(); await p2.onGenerate(); await p3.onGenerate();
    const t1 = (p1.data.result.insight || {}).bestText, t2 = (p2.data.result.insight || {}).bestText,
      t3 = (p3.data.result.insight || {}).bestText;
    log('  未填预估营收 ⇒ ' + t1);
    log('  填 3 万 / 目标 1 万 ⇒ ' + t2);
    log('  填 3 万 / 目标 50 万 ⇒ ' + t3);
    ok('T5 P1 未填营收不出结论', /填一个|预估/.test(String(t1)));
    ok('T5 P1 结论随目标利润变化', String(t2) !== String(t3), `t2=${t2} t3=${t3}`);
  }

  // ===== T6 P5：空档位 =====
  log('\n===== T6 维度留空 ⇒ 0 值行（P5 复验，真跑 onGenerate） =====');
  {
    const p = setup({ presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2,
      dims: { rent: [3000, ''], labor: [2, ''], margin: [55], target: [0, ''] }, global: { area: 40 } });
    log('  badDimOf() = ' + JSON.stringify(p.badDimOf()));
    await p.onGenerate();
    const rows = (p.data.result && p.data.result.rows) || [];
    const zero = rows.filter((r) => Number(r.rent) === 0 || Number(r.labor) === 0);
    log('  行数=' + rows.length + ' 含 0 值档位行数=' + zero.length);
    ok('T6 P5 空档不生成 0 值行', zero.length === 0, `zero=${zero.length}`);
    if (zero.length) issue('P5 空档生成 0 值行', `${zero.length} 行含 rent=0 或 labor=0，人工归零使保本被低估`);
  }

  // ===== T7 按钮绑定严谨差集（含 async / 对象方法） =====
  log('\n===== T7 M2 四页事件绑定 vs handler 差集 =====');
  for (const n of ['index', 'matrix', 'compare', 'list']) {
    const wxml = fs.readFileSync(path.join(ROOT, `subpkg/tools/sandbox/${n}.wxml`), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, `subpkg/tools/sandbox/${n}.js`), 'utf8');
    const binds = [...wxml.matchAll(/(?:bind|catch)[a-zA-Z]*\s*=\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    const uniq = [...new Set(binds)];
    const missing = uniq.filter((h) => {
      const re = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?' + h + '\\s*\\(|\\b' + h + '\\s*:\\s*(?:async\\s*)?function|\\b' + h + '\\s*:\\s*async');
      return !re.test(js);
    });
    log(`  ${n}: 绑定 ${uniq.length} 个，缺 handler = ${missing.length ? missing.join(', ') : '0'}`);
    ok(`T7 ${n} 零漏绑`, missing.length === 0, missing.join(','));
  }

  // ===== T8 九条拍板落地扫描 =====
  log('\n===== T8 10-27 九条拍板落地扫描 =====');
  const IDX = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/index.js'), 'utf8');
  const MTX = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/matrix.js'), 'utf8');
  const BIZ = fs.readFileSync(path.join(ROOT, 'utils/bizPreset.js'), 'utf8');
  const TERMS = fs.readFileSync(path.join(ROOT, 'miniprogram/i18n/terms.js'), 'utf8');
  const WXML = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/index.wxml'), 'utf8');
  const checks = [
    ['序1 现金卡 Number(fixedExAmort)', /Number\(best\.fixedExAmort\)/.test(MTX)],
    ['序2 D1/D2 hasFixed = rent>0 && labor>0', /const hasFixed = rentFen > 0 && laborFen > 0/.test(IDX)],
    ['序3 D3 水电气任一项 >0 生效', /energy \+ gas > 0/.test(BIZ)],
    ['序3 D3-C 水电合并 energyYuan', /energyYuan/.test(BIZ) && /energyYuan/.test(IDX)],
    ['序4 D4 矩阵 manage 同形状', /manageYuan/.test(MTX) && /manageOptLabel/.test(MTX)],
    ['序5 D5 两个标签', /fixedTotalNoAmort/.test(TERMS) && /fixedTotalWithAmort/.test(WXML)],
    ['序6 D6 透视按人工过滤', /Number\(r\.labor\) === fixLaborVal/.test(MTX)],
    ['序7 D7-a 死键映射已清（t.length 收缩）', !/turn[A-Z]\w*:\s*M\.turn/.test(IDX)],
    ['序8 D8 派生项标注', /derivedNotePrefix/.test(TERMS) && /derivedNote/.test(IDX)],
    ['序9 行为守卫 ≥4 个', ['check_m2_forward_failclosed.js', 'check_m2_energy_split.js',
      'check_m2_matrix_manage.js', 'check_m2_matrix_pivot.js', 'check_m2_partial_behavior.js']
      .every((f) => fs.existsSync(path.join(ROOT, 'tools', f)))],
  ];
  checks.forEach(([n, c]) => { ok('T8 ' + n, c); if (!c) issue('九条未落地', n); });

  // ===== T9 validate 真实链路：边界毛利率 & reverse 分母 =====
  log('\n===== T9 validate 真实链路 =====');
  const wireBase = { shop_id: 'a', city_tier: 'tier23', biz_type: 'dining',
    build_items: [], fixed_items: [{ key: 'rent', fen: 1000000 }], var_items: [],
    gross_margin_pct: 65, target_profit_fen: 0, expected_revenue_fen: 0 };
  for (const g of [0.1, 65, 100, 120, -10]) {
    const v = val.validateInput(Object.assign({}, wireBase, { gross_margin_pct: g }));
    log('  毛利率 ' + g + '% ⇒ ' + (v.error ? '拒：' + v.msg : '放行 clean.grossMarginPct=' + (v.clean && v.clean.grossMarginPct)));
  }
  const revWire = Object.assign({}, wireBase, { mode: 'reverse', rev_price_fen: 4500, seats: 20,
    open_days: 26, target_rent_rate: 12, fixed_items: [{ key: 'labor', fen: 2000000 }] });
  const vr = val.validateInput(revWire);
  log('  reverse wire（不带 valid_days）⇒ ' + (vr.error ? '拒：' + vr.msg
    : 'clean.validDays=' + vr.clean.validDays + ' clean.open_days=' + vr.clean.open_days));
  if (!vr.error) {
    const rr = svc.calcSandboxReverse(vr.clean);
    const fwd = svc.calcSandbox(Object.assign({}, vr.clean, {
      fixedItems: vr.clean.fixedItems.filter((x) => x.key !== 'rent'),
      varItems: vr.clean.varItems.concat([{ key: 'rentRate', pct: 12 }]),
    }));
    log('  reverse.target_daily_fen=' + rr.target_daily_fen + '（÷' + rr.valid_days + '）');
    log('  正算同变换 target_daily_fen=' + fwd.target_daily_fen + '（÷' + fwd.valid_days + '）');
    ok('T9 reverse 两处日均分母一致（真实 validate 链路）', rr.target_daily_fen === fwd.target_daily_fen,
      `差 ${(rr.target_daily_fen - fwd.target_daily_fen) / 100} 元/天`);
  }

  log('\n===== 汇总：' + PASS + ' PASS / ' + FAIL + ' FAIL / ' + ISSUE + ' ISSUE =====');
  fs.writeFileSync(path.join(__dirname, 'pages_probe.out'), OUT.join('\n') + '\n', 'utf8');
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
