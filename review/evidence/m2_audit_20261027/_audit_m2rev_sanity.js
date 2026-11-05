#!/usr/bin/env node
// _audit_m2rev_sanity.js —— M2「寻找铺面 / 新开店」(mode=reverse) 只读取证：数值常识量级回归
// 做法：把 subpkg/tools/sandbox/matrix.js 的 Page 对象原样加载进来（stub wx/Page/getApp），
//       再把 api.call 劫持到本地**生产引擎**（cloudfunctions/calcSandbox 的 validateClean + calcSandbox），
//       ⇒ 走的是页面自己的 buildClean / toRow / buildPivot / buildInsight / buildCash / fixedBreakOf，零改业务代码。
// 只读：不改任何业务文件。
'use strict';
const path = require('path');
const ROOT = (() => { const fs = require('fs'); const p = require('path');
  let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(p.join(d, 'app.json'))) return d; d = p.dirname(d); }
  return __dirname; })();  // R529：归档到 review/evidence/ 后仍能定位仓根（原来写死 __dirname）


// ---------- 0. stub 小程序运行时 ----------
const wxStub = {
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: (o) => { TOASTS.push(o.title); },
  showModal: () => {},
  cloud: { callFunction: async () => { throw new Error('should be intercepted'); } },
  navigateTo: () => {}, navigateBack: () => {},
  canvasToTempFilePath: () => {}, createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }) }),
  previewImage: () => {},
};
const TOASTS = [];
global.wx = wxStub;
let PAGE = null;
global.Page = (o) => { PAGE = o; };
global.getApp = () => ({ globalData: { shop_id: 'audit' } });

// ---------- 1. 把 api.call 劫持到生产引擎 ----------
const api = require(path.join(ROOT, 'utils', 'api.js'));
const svc = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js'));
const val = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'validate.js'));
const AUDIT_LOG = [];
api.call = async (name, payload) => {
  if (name === 'calcSandbox' && payload && payload.action === 'matrix') {
    const arr = payload.clean_array || [];
    if (arr.length === 0 || arr.length > 1000) throw Object.assign(new Error('matrix.clean_array 需 1~1000'), { code: 'INVALID_PARAM' });
    const rejected = [];
    const rows = arr.map((c, i) => {
      const v = val.validateClean(c && typeof c === 'object' ? c : {});
      if (v.error) { rejected.push({ index: i, code: v.error, msg: v.msg }); return null; }
      return svc.calcSandbox(v.clean);
    });
    if (rejected.length === arr.length) throw Object.assign(new Error('全部拒绝'), { code: rejected[0].code });
    AUDIT_LOG.push({ batch: arr.length, rejected: rejected.slice() });
    return { rows, rejected };
  }
  throw new Error('unexpected api.call: ' + name);
};
api.toastError = (e) => { TOASTS.push('ERR:' + ((e && e.msg) || (e && e.message) || String(e))); };

require(path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'matrix.js'));

// ---------- 2. 构造「页面实例」 ----------
function newPage() {
  const inst = Object.create(PAGE);
  inst.data = JSON.parse(JSON.stringify(PAGE.data));
  inst.setData = function (patch, cb) {
    for (const k in patch) {
      const ks = k.split('.');
      let o = this.data;
      for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
      o[ks[ks.length - 1]] = patch[k];
    }
    if (cb) cb();
  };
  return inst;
}

const PRESETS = PAGE.data.presets.map((p) => p.key);
const y2f = (v) => api.yuanToFen(v);

function run(opts) {
  const p = newPage();
  p.onLoad(Object.assign({ mode: 'reverse' }, opts.query || {}));
  if (opts.presetIdx != null) p.setData({ presetIdx: opts.presetIdx });
  if (opts.cityIdx != null) p.setData({ cityIdx: opts.cityIdx, fieldTouched: Object.assign({}, p.data.fieldTouched, { rent: false }) });
  if (opts.cityIdx != null) { p.onCityChange({ detail: { value: opts.cityIdx } }); }
  if (opts.dims) p.setData({ dims: opts.dims });
  if (opts.advOpen != null) p.setData({ advOpen: opts.advOpen });
  if (opts.global) {
    const g = Object.assign({}, p.data.global, opts.global);
    p.setData({ global: g });
  }
  if (opts.cash) p.setData({ cash: Object.assign({}, p.data.cash, opts.cash) });
  return p;
}

const yuan = (f) => (f == null ? null : Math.round(Number(f) / 100));

// ---------- 3. 用例 ----------
const CASES = [
  {
    name: 'C1 县城 40㎡ 面馆（预设值：2人/毛利率63%/未填投入）',
    presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2,
    dims: { rent: [1000, 2000, 3000, 4000, 5000], labor: [2], margin: [63], target: [0, 10000] },
    global: { area: 40 }, advOpen: false,
    cash: { rentYuan: 3000, budgetYuan: 100000, equipYuan: 50000, stockYuan: 10000 },
  },
  {
    name: 'C2 县城 40㎡ 面馆 + 投入 8 万设备(5年)',
    presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2,
    dims: { rent: [1000, 2000, 3000, 4000, 5000], labor: [2], margin: [55], target: [0, 10000] },
    global: { area: 40, buildEquipYuan: '80000', buildEquipYears: 5 }, advOpen: false,
    cash: { rentYuan: 3000, budgetYuan: 100000, equipYuan: 80000, stockYuan: 10000 },
  },
  {
    name: 'C3 二三线 40㎡ 茶饮（tid=县城档位被强制成 tier23 的默认档 3000~10000）',
    presetIdx: PRESETS.indexOf('cafe_tea'), cityIdx: 1,
    dims: { rent: [3000, 5000, 7000, 10000], labor: [2], margin: [67], target: [0, 10000] },
    global: { area: 30 }, advOpen: false,
    cash: { rentYuan: 5000, budgetYuan: 150000, equipYuan: 80000, stockYuan: 20000 },
  },
  {
    name: 'C4 二三线 120㎡ 火锅烧烤（半自助预设，含 buildRef 26.2万）',
    presetIdx: PRESETS.indexOf('hotpot_half_self'), cityIdx: 1,
    dims: { rent: [6000, 8000, 10000, 12000], labor: [5], margin: [53], target: [0, 20000] },
    global: { area: 120 }, advOpen: false,
    cash: { rentYuan: 8000, budgetYuan: 400000, equipYuan: 106000, stockYuan: 30000 },
  },
  {
    name: 'C5 一线 150㎡ 中式正餐',
    presetIdx: PRESETS.indexOf('dining_sichuan'), cityIdx: 0,
    dims: { rent: [10000, 15000, 20000, 28000], labor: [5], margin: [60], target: [0, 30000] },
    global: { area: 150 }, advOpen: false,
    cash: { rentYuan: 15000, budgetYuan: 800000, equipYuan: 200000, stockYuan: 50000 },
  },
];

function showRow(r) {
  return [
    String(r.rent).padStart(7), String(r.targetYuan).padStart(7),
    String(r.breakMonthly == null ? '—' : r.breakMonthly).padStart(8),
    String(r.beCashMonthly == null ? '—' : r.beCashMonthly).padStart(8),
    String(r.targetMonthly == null ? '—' : r.targetMonthly).padStart(8),
    String(r.breakDaily == null ? '—' : r.breakDaily).padStart(7),
    String(r.payback == null ? '—' : r.payback).padStart(7),
    String(r.rentPct == null ? '—' : r.rentPct).padStart(6),
    String(r.laborYuan == null ? '—' : r.laborYuan).padStart(7),
    r.red ? 'RED' : '   ',
    r.invalid ? 'INVALID' : '',
  ].join(' | ');
}

(async () => {
  console.log('='.repeat(100));
  console.log('A. 页面 presets 列表（matrix.js data.presets）:', JSON.stringify(PRESETS));
  console.log('   data.pivotFix =', JSON.stringify(PAGE.data.pivotFix), '| default mode =', PAGE.data.mode,
    '| pivotRowDim =', PAGE.data.pivotRowDim, '| advOpen =', PAGE.data.advOpen, '| colsOpen =', PAGE.data.colsOpen);
  console.log('='.repeat(100));

  for (const c of CASES) {
    const p = run(c);
    console.log('\n\n########## ' + c.name + ' ##########');
    console.log('  preset =', PRESETS[p.data.presetIdx], '| cityIdx =', p.data.cityIdx,
      '| area =', p.data.global.area, '| laborUnit =', JSON.stringify(p.data.global.laborUnitYuan),
      '| buildItems =', JSON.stringify(p.buildItems()));
    await p.onGenerate();
    const res = p.data.result;
    if (!res) { console.log('  ❌ 无结果，toast =', JSON.stringify(TOASTS)); continue; }
    console.log('  rows =', res.rows.length, '| rejected =', JSON.stringify(res.rejected), '| partialText =', JSON.stringify(res.partialText));
    console.log('  ' + ['rent(元)', 'target', '保本月', '现金保本', '目标月', '保本日', '回本', '租占比', '人工/月'].map((s) => s.padStart(7)).join(' | '));
    res.rows.forEach((r) => console.log('  ' + showRow(r)));

    console.log('  --- 结论卡 insight ---');
    console.log('  ' + JSON.stringify(res.insight, null, 1).replace(/\n/g, '\n  '));
    console.log('  --- 透视表 pivot ---');
    console.log('  rows =', JSON.stringify(res.pivot.rows), ' cols =', JSON.stringify(res.pivot.cols),
      ' fixMargin =', res.pivot.fixMargin, ' fixRent =', res.pivot.fixRent, ' fixLabor =', res.pivot.fixLabor);
    console.log('  cells =', JSON.stringify(res.pivot.cells));
    console.log('  --- 固定费用构成 fixedBreak ---');
    console.log('  ' + JSON.stringify(p.data.fixedBreak));
    console.log('  --- 现金卡 cashRes ---');
    console.log('  ' + JSON.stringify(p.data.cashRes));
    console.log('  fixedMonthly(月净流出反推) =', p.fixedMonthlyYuan(Number(p.data.cash.rentYuan)));
    console.log('  buildSumText =', JSON.stringify(p.data.buildSumText));
  }
  console.log('\nTOASTS =', JSON.stringify(TOASTS, null, 1));
  console.log('AUDIT_LOG =', JSON.stringify(AUDIT_LOG));
})();
