// R615 审计收口 · 四项修复真跑验证（页面桩 + 生产引擎），可重复执行
// 用法：node review/evidence/m2_audit_20261106/_probe_fix_verify.js
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = (() => { let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(path.join(d, 'app.json'))) return d; d = path.dirname(d); } return __dirname; })();
let PASS = 0, FAIL = 0;
const ok = (n, c, d) => { if (c) { PASS++; console.log('  [PASS] ' + n + (d ? ' | ' + d : '')); } else { FAIL++; console.log('  [FAIL] ' + n + (d ? ' | ' + d : '')); } };

global.wx = new Proxy({
  getSystemInfoSync: () => ({ windowWidth: 375 }), showToast: () => {}, showModal: () => {},
  navigateTo: () => {}, navigateBack: () => {}, getStorageSync: () => '', setStorageSync: () => {},
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

function setup(opts) {
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
  inst.onLoad(Object.assign({ mode: 'reverse' }, (opts && opts.query) || {}));
  if (opts) {
    if (opts.presetIdx != null) inst.setData({ presetIdx: opts.presetIdx });
    if (opts.cityIdx != null) { inst.setData({ cityIdx: opts.cityIdx }); inst.onCityChange({ detail: { value: opts.cityIdx } }); }
    if (opts.dims) inst.setData({ dims: opts.dims });
    if (opts.global) inst.setData({ global: Object.assign({}, inst.data.global, opts.global) });
    if (opts.cash) inst.setData({ cash: Object.assign({}, inst.data.cash, opts.cash) });
  }
  return inst;
}
const NOODLE = { presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2 };

(async () => {
  // ===== V1 P5 空档 fail-closed =====
  console.log('\n===== V1 P5 空档位 =====');
  {
    const p = setup(Object.assign({}, NOODLE, {
      dims: { rent: [3000, ''], labor: [2, ''], margin: [55], target: [0, ''] }, global: { area: 40 },
    }));
    await p.onGenerate();
    const rows = (p.data.result && p.data.result.rows) || [];
    const zero = rows.filter((r) => Number(r.rent) === 0 || Number(r.labor) === 0);
    console.log('  行数=' + rows.length + ' 含0值行=' + zero.length + '（修复前 8 / 6）');
    ok('V1 P5 空档不生成 0 值行', zero.length === 0, `zero=${zero.length}`);
    ok('V1 P5 有效档仍生成结果（没有全跳光）', rows.length > 0, `rows=${rows.length}`);
    ok('V1 P5 数字 0 仍是合法档位', /!==\s*'']|x === ''/.test(
      fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/matrix.js'), 'utf8')));
  }

  // ===== V2 P4 杠杆 = 引擎差分 =====
  console.log('\n===== V2 P4 房租杠杆 =====');
  {
    const p = setup(Object.assign({}, NOODLE, {
      dims: { rent: [1000, 2000, 3000, 4000, 5000], labor: [2], margin: [63], target: [0] },
      global: { area: 40 }, cash: { rentYuan: 3000, budgetYuan: 100000, equipYuan: 50000, stockYuan: 10000 },
    }));
    await p.onGenerate();
    const rows = (p.data.result.rows || []).filter((r) => r.targetYuan === 0 && !r.invalid && !r.red);
    const a = rows[0], b = rows[1];
    const truth = Math.round((b.breakMonthly - a.breakMonthly) / (b.rent - a.rent) * 1000);
    console.log('  引擎差分真值 = ' + truth + ' 元/千元；页面 leverYuan = ' + a.leverYuan);
    console.log('  结论卡 = ' + (p.data.result.insight && p.data.result.insight.leverText));
    ok('V2 P4 行级 leverYuan ≡ 引擎相邻差分', Math.abs(Number(a.leverYuan) - truth) <= 1, `page=${a.leverYuan} truth=${truth}`);
    ok('V2 P4 不再低估（>1.25×旧值 1587）', Number(a.leverYuan) > 1587 * 1.25, `lever=${a.leverYuan}`);
    ok('V2 P4 结论卡与明细表同值', String(p.data.result.insight.leverText).indexOf(String(a.leverYuan)) >= 0,
      p.data.result.insight.leverText);
    ok('V2 P4 文案不再声称「按毛利率计」', !/按毛利率/.test(String(p.data.result.insight.leverText)));
    // 单档 fail-closed
    const one = setup(Object.assign({}, NOODLE, {
      dims: { rent: [3000], labor: [2], margin: [63], target: [0] }, global: { area: 40 },
    }));
    await one.onGenerate();
    const orow = (one.data.result.rows || [])[0];
    ok('V2 P4 单档无法差分 ⇒ 不给数', orow.leverYuan == null && !one.data.result.insight.leverText,
      `lever=${orow.leverYuan} text=${JSON.stringify(one.data.result.insight.leverText)}`);
  }

  // ===== V3 P9 现金卡装修 =====
  console.log('\n===== V3 P9 现金卡装修 =====');
  {
    const mk = (decor) => setup(Object.assign({}, NOODLE, {
      dims: { rent: [3000, 4000], labor: [2], margin: [63], target: [0] },
      global: Object.assign({ area: 40, buildEquipYuan: '80000' }, decor ? { buildDecorYuan: decor } : {}),
      cash: { rentYuan: 3000, budgetYuan: 200000, equipYuan: 80000, stockYuan: 10000 },
    }));
    const p = mk('50000');
    await p.onGenerate();
    p.setData({ buildSumText: p.buildSumOf() });
    await p.buildCash();
    console.log('  上方合计 = ' + p.data.buildSumText);
    console.log('  现金卡 = ' + (p.data.cashRes && p.data.cashRes.partsText));
    ok('V3 P9 装修 5 万被现金卡采用', /装修 5\.0万/.test(String(p.data.cashRes && p.data.cashRes.partsText)),
      p.data.cashRes && p.data.cashRes.partsText);
    const noDecor = mk('');
    await noDecor.onGenerate(); await noDecor.buildCash();
    console.log('  未填装修（向后兼容回落） = ' + (noDecor.data.cashRes && noDecor.data.cashRes.partsText));
    ok('V3 P9 未填时仍按面积估算', /装修 3\.6万/.test(String(noDecor.data.cashRes && noDecor.data.cashRes.partsText)));
  }

  // ===== V4 P11 组合数 =====
  console.log('\n===== V4 P11 组合数 =====');
  {
    const p = setup(Object.assign({}, NOODLE, {
      dims: { rent: [3000, 5000], labor: [2, 3], margin: [55], target: [0] }, global: { area: 40 },
    }));
    await p.onGenerate();
    const n = p.data.result.rows.length;
    console.log('  countText = ' + JSON.stringify(p.data.countText) + ' 实际行数=' + n);
    ok('V4 P11 无 {n} 占位符', !/\{n\}/.test(String(p.data.countText)));
    ok('V4 P11 数字等于实际行数', String(p.data.countText).indexOf(String(n)) >= 0, `n=${n}`);
    const wxml = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/matrix.wxml'), 'utf8');
    ok('V4 P11 wxml 渲染 countText', /\{\{countText\}\}/.test(wxml) && !/\{\{t\.count\}\}/.test(wxml));
  }

  // ===== V5 正常场景不回归 =====
  console.log('\n===== V5 回归：正常场景账不变 =====');
  {
    const p = setup(Object.assign({}, NOODLE, {
      dims: { rent: [1000, 2000, 3000, 4000, 5000], labor: [2], margin: [63], target: [0, 10000] },
      global: { area: 40 },
    }));
    await p.onGenerate();
    const rows = p.data.result.rows;
    console.log('  行数=' + rows.length + ' 首行保本=' + rows[0].breakMonthly + ' 末行保本=' + rows[rows.length - 1].breakMonthly);
    ok('V5 正常场景 10 行齐全', rows.length === 10, `rows=${rows.length}`);
    ok('V5 首行保本仍是审计基线 14606.56', Math.abs(rows[0].breakMonthly - 14606.56) < 0.01,
      String(rows[0].breakMonthly));
  }

  console.log(`\n===== 修复验证：${PASS} PASS / ${FAIL} FAIL =====`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
