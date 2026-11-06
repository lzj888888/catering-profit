// tools/check_m2_semantic_diff.js —— M2 语义差分守卫（R615 审计收口）
//
// 来由：2026-11-06 M2 全景审计发现 286 条既有守卫断言全绿，却挡不住四类
//   「数字照出、结论失真」的问题。既有守卫判的是「代码形状 / 字段在不在」，
//   本套件补的是「结论对不对」：用生产页面源码 + 生产引擎真跑，判行为不判注释。
//
// 覆盖：
//   P5 空档位不得生成 rent=0 / labor=0 的假行（人工归零 ⇒ 保本腰斩，方向乐观）
//   P4 房租杠杆必须等于引擎相邻租金档的保本差分，不得按 1000÷毛利率 另编（实测低估 1.30×）
//   P9 现金卡装修必须采用老板在「开店要投多少」里填的数，不得按面积另估（同屏两数）
//   P11 组合数必须渲染替换后的成品串，不得直出「共 {n} 组组合」
//
// fail-closed：任何一段源码解析不到 / 页面桩加载不到 ⇒ 直接判红，不静默跳过。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);
const MTX = fs.readFileSync(P('subpkg/tools/sandbox/matrix.js'), 'utf8');
const WXML = fs.readFileSync(P('subpkg/tools/sandbox/matrix.wxml'), 'utf8');
const CASH = fs.readFileSync(P('utils/openCash.js'), 'utf8');
const TERMS = fs.readFileSync(P('miniprogram/i18n/terms.js'), 'utf8');

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ===== A 组：静态防回潮（判行为，不判注释）=====
console.log('===== A 修复形态 =====');
ok('A-① onGenerate 对空档位直接跳过（不是 Number("")=0）',
  MTX.split('\n').some((l) => l.indexOf('[r, l, m, tg].some(') >= 0
    && l.indexOf("x === ''") >= 0 && l.indexOf('continue;') >= 0));
ok('A-② 空档跳过写在 Number(r/l/m/tg) 之前（顺序反了等于没跳过）',
  (() => {
    const i = MTX.indexOf("if ([r, l, m, tg].some(");
    const j = MTX.indexOf('const rv = Number(r)', i < 0 ? 0 : i);
    return i > 0 && j > i && j - i < 400;
  })());
ok('A-③ 不再存在「1000 ÷ 毛利率」旧式杠杆公式',
  !/Math\.round\(1000 \/ mRate\)/.test(MTX) && !/Math\.round\(1000 \/ \(leverMargin \/ 100\)\)/.test(MTX));
ok('A-④ applyLeverByDiff 存在且被 onGenerate 真调用',
  /applyLeverByDiff\(rows\)\s*\{/.test(MTX) && /rows = this\.applyLeverByDiff\(rows\);/.test(MTX));
ok('A-⑤ openCash 装修优先取 decorFen，且 buildCash 传了老板填的装修',
  /decorFen = num\(c\.decorFen\) > 0 \? num\(c\.decorFen\) : Math\.round\(area \* decorUnit\)/.test(CASH)
  && /decorFen: y2f\(g\.buildDecorYuan\)/.test(MTX));
ok('A-⑥ 组合数渲染成品串且 data 顶层声明（防顶层绑定静默空白）',
  /\{\{countText\}\}/.test(WXML) && !/\{\{t\.count\}\}/.test(WXML)
  && /countText: ''/.test(MTX) && /countText: fmt\(this\.data\.t\.count, \{ n: rows\.length \}\)/.test(MTX));
ok('A-⑦ 杠杆文案不再声称「按毛利率计」，且单档时结论句可隐藏',
  !/insightLever:.*按毛利率/.test(TERMS) && /wx:if="\{\{result\.insight\.leverText\}\}"/.test(WXML));

// ===== B 组：生产页面桩真跑 =====
console.log('===== B 行为真跑 =====');
global.wx = new Proxy({
  getSystemInfoSync: () => ({ windowWidth: 375 }), showToast: () => {}, showModal: () => {},
  navigateTo: () => {}, navigateBack: () => {}, getStorageSync: () => '', setStorageSync: () => {},
}, { get: (t, k) => (k in t ? t[k] : () => {}) });
let PAGE = null;
global.Page = (o) => { PAGE = o; };
global.getApp = () => ({ globalData: { shop_id: 'guard' } });
const api = require(P('utils/api.js'));
const svc = require(P('cloudfunctions/calcSandbox/service.js'));
const val = require(P('cloudfunctions/calcSandbox/validate.js'));
api.call = async (name, payload) => {
  if (name === 'calcSandbox' && payload && payload.action === 'matrix') {
    const rows = (payload.clean_array || []).map((c) => {
      const v = val.validateClean(c && typeof c === 'object' ? c : {});
      return v.error ? null : svc.calcSandbox(v.clean);
    });
    return { rows, rejected: [] };
  }
  throw new Error('unexpected api.call: ' + name);
};
api.toastError = () => {};
require(P('subpkg/tools/sandbox/matrix.js'));
ok('B-① 页面源码加载成功（Page 配置可取，fail-closed）', !!PAGE && typeof PAGE.onGenerate === 'function');

function setup(opts) {
  const p = Object.create(PAGE);
  p.data = JSON.parse(JSON.stringify(PAGE.data));
  p.setData = function (patch, cb) {
    for (const k in patch) {
      const ks = k.split('.'); let o = this.data;
      for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
      o[ks[ks.length - 1]] = patch[k];
    }
    if (cb) cb();
  };
  p.onLoad({ mode: 'reverse' });
  if (opts.presetIdx != null) p.setData({ presetIdx: opts.presetIdx });
  if (opts.cityIdx != null) { p.setData({ cityIdx: opts.cityIdx }); p.onCityChange({ detail: { value: opts.cityIdx } }); }
  if (opts.dims) p.setData({ dims: opts.dims });
  if (opts.global) p.setData({ global: Object.assign({}, p.data.global, opts.global) });
  if (opts.cash) p.setData({ cash: Object.assign({}, p.data.cash, opts.cash) });
  return p;
}
const NOODLE = () => ({
  presetIdx: Math.max(0, PAGE.data.presets.findIndex((p) => p.key === 'fastfood_noodle')),
  cityIdx: 2,
});

(async () => {
  // B-② P5
  const p5 = setup(Object.assign(NOODLE(), {
    dims: { rent: [3000, ''], labor: [2, ''], margin: [55], target: [0, ''] }, global: { area: 40 },
  }));
  await p5.onGenerate();
  const r5 = (p5.data.result && p5.data.result.rows) || [];
  const zero = r5.filter((r) => Number(r.rent) === 0 || Number(r.labor) === 0);
  ok('B-② P5 空档场景零个 0 值行且有效档仍出数', zero.length === 0 && r5.length > 0,
    `rows=${r5.length} zero=${zero.length}`);

  // B-③ P4（真值由引擎相邻档独立复算）
  const p4 = setup(Object.assign(NOODLE(), {
    dims: { rent: [1000, 2000, 3000, 4000, 5000], labor: [2], margin: [63], target: [0] },
    global: { area: 40 }, cash: { rentYuan: 3000, budgetYuan: 100000, equipYuan: 50000, stockYuan: 10000 },
  }));
  await p4.onGenerate();
  const rr = (p4.data.result.rows || []).filter((r) => r.targetYuan === 0 && !r.invalid && !r.red);
  const truth = Math.round((rr[1].breakMonthly - rr[0].breakMonthly) / (rr[1].rent - rr[0].rent) * 1000);
  ok('B-③ P4 leverYuan ≡ 引擎相邻档差分，且结论卡同值',
    Math.abs(Number(rr[0].leverYuan) - truth) <= 1
    && String(p4.data.result.insight.leverText).indexOf(String(rr[0].leverYuan)) >= 0,
    `page=${rr[0].leverYuan} truth=${truth}`);

  // B-④ P4 单档 fail-closed
  const one = setup(Object.assign(NOODLE(), {
    dims: { rent: [3000], labor: [2], margin: [63], target: [0] }, global: { area: 40 },
  }));
  await one.onGenerate();
  ok('B-④ P4 单档无法差分 ⇒ 不给数（不编公式）',
    one.data.result.rows[0].leverYuan == null && !one.data.result.insight.leverText);

  // B-⑤ P9（填 5 万 / 不填回落）
  const mk = (decor) => setup(Object.assign(NOODLE(), {
    dims: { rent: [3000, 4000], labor: [2], margin: [63], target: [0] },
    global: Object.assign({ area: 40, buildEquipYuan: '80000' }, decor ? { buildDecorYuan: decor } : {}),
    cash: { rentYuan: 3000, budgetYuan: 200000, equipYuan: 80000, stockYuan: 10000 },
  }));
  const p9 = mk('50000'); await p9.onGenerate(); await p9.buildCash();
  const noDecor = mk(''); await noDecor.onGenerate(); await noDecor.buildCash();
  ok('B-⑤ P9 装修 5 万被采用、未填时回落面积估算',
    /装修 5\.0万/.test(String(p9.data.cashRes && p9.data.cashRes.partsText))
    && /装修 3\.6万/.test(String(noDecor.data.cashRes && noDecor.data.cashRes.partsText)));

  // B-⑥ P11
  const p11 = setup(Object.assign(NOODLE(), {
    dims: { rent: [3000, 5000], labor: [2, 3], margin: [55], target: [0] }, global: { area: 40 },
  }));
  await p11.onGenerate();
  const n = p11.data.result.rows.length;
  ok('B-⑥ P11 组合数成品串无占位符且等于实际行数',
    !/\{n\}/.test(String(p11.data.countText)) && String(p11.data.countText).indexOf(String(n)) >= 0,
    `"${p11.data.countText}" n=${n}`);

  // B-⑦ 回归：正常场景账不变
  const reg = setup(Object.assign(NOODLE(), {
    dims: { rent: [1000, 2000, 3000, 4000, 5000], labor: [2], margin: [63], target: [0, 10000] },
    global: { area: 40 },
  }));
  await reg.onGenerate();
  const rs = reg.data.result.rows;
  ok('B-⑦ 正常场景 10 行齐全且首行保本 = 审计基线 14606.56',
    rs.length === 10 && Math.abs(rs[0].breakMonthly - 14606.56) < 0.01,
    `rows=${rs.length} be=${rs[0].breakMonthly}`);

  console.log(`\n===== M2 语义差分守卫结果：${pass} 通过 / ${failN} 失败 =====`);
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => {
  console.error('  ❌ 守卫运行异常（fail-closed）:', e && (e.stack || e.message));
  process.exit(1);
});
