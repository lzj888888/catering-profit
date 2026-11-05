#!/usr/bin/env node
// _audit_m2rev_edge.js —— M2 reverse 边界取证（透视多维 / 空档 / 手改档位的字符串键 / 结论恒等式 / 现金卡数量级）
// 只读：加载 matrix.js 的 Page 对象，api.call 劫持到生产引擎。
'use strict';
const path = require('path');
const ROOT = (() => { const fs = require('fs'); const p = require('path');
  let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(p.join(d, 'app.json'))) return d; d = p.dirname(d); }
  return __dirname; })();  // R529：归档到 review/evidence/ 后仍能定位仓根（原来写死 __dirname）

const TOASTS = [];
global.wx = {
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: (o) => TOASTS.push(o.title),
  showModal: () => {}, navigateTo: () => {}, navigateBack: () => {},
  cloud: { callFunction: async () => { throw new Error('intercepted') } },
};
let PAGE = null;
global.Page = (o) => { PAGE = o; };
global.getApp = () => ({ globalData: { shop_id: 'audit' } });

const api = require(path.join(ROOT, 'utils', 'api.js'));
const svc = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js'));
const val = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'validate.js'));
api.call = async (name, payload) => {
  const arr = payload.clean_array || [];
  const rejected = [];
  const rows = arr.map((c, i) => {
    const v = val.validateClean(c && typeof c === 'object' ? c : {});
    if (v.error) { rejected.push({ index: i, code: v.error, msg: v.msg }); return null; }
    return svc.calcSandbox(v.clean);
  });
  if (rejected.length === arr.length) throw Object.assign(new Error('全部拒绝'), { code: rejected[0].code });
  return { rows, rejected };
};
api.toastError = (e) => TOASTS.push('ERR:' + ((e && e.msg) || String(e)));
require(path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'matrix.js'));

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
const line = (s) => console.log(s);
const H = (s) => line('\n================ ' + s + ' ================');

(async () => {
  // ---------- E1：透视表是否过滤「人工」维（多个人工档位）----------
  H('E1 透视表 cells 是否含人工维（labor=[2,3]，advOpen=true）');
  {
    const p = newPage();
    p.onLoad({ mode: 'reverse' });
    p.setData({
      presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2, advOpen: true,
      dims: { rent: [3000, 5000], labor: [2, 3], margin: [55, 63], target: [0, 10000] },
      global: Object.assign({}, p.data.global, { area: 40 }),
    });
    await p.onGenerate();
    const rows = p.data.result.rows;
    line('总行数 = ' + rows.length + '（应为 2租 × 2人 × 2毛 × 2目标 = 16）');
    rows.forEach((r) => line('  rent=' + r.rent + ' labor=' + r.labor + ' margin=' + r.marginPct
      + ' target=' + r.targetYuan + ' targetMonthly=' + r.targetMonthly + ' targetDaily=' + r.targetDaily));
    const pv = p.data.result.pivot;
    line('  pivot.rows = ' + JSON.stringify(pv.rows) + ' cols = ' + JSON.stringify(pv.cols));
    line('  pivot.cells = ' + JSON.stringify(pv.cells, null, 1));
    const dimpl = rows.filter((r) => r.labor === 3 && r.marginPct === 55 && r.targetYuan === 0 && r.rent === 3000);
    const d2imp = rows.filter((r) => r.labor === 2 && r.marginPct === 55 && r.targetYuan === 0 && r.rent === 3000);
    line('  ※ 3000|0 单元格 = ' + pv.cells['3000|0']
      + ' ；labor=2 那行 daily=' + (d2imp[0] && d2imp[0].targetDaily)
      + ' ；labor=3 那行 daily=' + (dimpl[0] && dimpl[0].targetDaily));
    line('  ⇒ 页面上「透视表固定人工」输入框的值 = ' + p.data.pivotFix.labor + '，改它会不会重算透视？见 E2');
  }

  // ---------- E2：改「透视表固定人工」有没有效果 ----------
  H('E2 改 pivotFix.labor 是否真的改变透视表');
  {
    const p = newPage();
    p.onLoad({ mode: 'reverse' });
    p.setData({
      presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2, advOpen: true,
      dims: { rent: [3000, 5000], labor: [2, 3], margin: [55], target: [0, 10000] },
      global: Object.assign({}, p.data.global, { area: 40 }),
    });
    await p.onGenerate();
    const before = JSON.stringify(p.data.result.pivot.cells);
    p.onPivotFixInput({ currentTarget: { dataset: { key: 'labor' } }, detail: { value: '999' } });
    const after = JSON.stringify(p.data.result.pivot.cells);
    line('  改前 pivotFix.labor=' + p.data.pivotFix.labor + ' cells=' + before);
    line('  改后 cells=' + after);
    line('  ⇒ cells 是否变化: ' + (before === after ? '❌ 完全不变（输入被静默忽略）' : '✅ 变了'));
    p.onPivotFixInput({ currentTarget: { dataset: { key: 'margin' } }, detail: { value: '63' } });
    line('  改 pivotFix.margin=63（不在结果档位里 55）后 cells=' + JSON.stringify(p.data.result.pivot.cells));
    line('  ⇒ R331 回落生效否: fixMargin 显示=' + p.data.result.pivot.fixMargin + '（仍可能是原值，见下）');
  }

  // ---------- E3：老板手改租金档位（页面 onChangeDimInput 存的是字符串）----------
  H('E3 手改档位为带小数的字符串 ⇒ 单元格能否命中');
  {
    const p = newPage();
    p.onLoad({ mode: 'reverse' });
    p.setData({ presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2 });
    // 模拟老板把第 1 档改成 "3000.00"（微信 input digit 允许两位小数），第 2 档改成 "5000"
    p.onDimInput({ currentTarget: { dataset: { dim: 'rent', idx: 0 } }, detail: { value: '3000.00' } });
    p.onDimInput({ currentTarget: { dataset: { dim: 'rent', idx: 1 } }, detail: { value: '5000' } });
    p.setData({ dims: Object.assign({}, p.data.dims, { rent: ['3000.00', '5000'], labor: [2], margin: [55], target: [0, 10000] }) });
    await p.onGenerate();
    const pv = p.data.result.pivot;
    line('  dims.rent = ' + JSON.stringify(p.data.dims.rent));
    line('  pivot.rows = ' + JSON.stringify(pv.rows));
    line('  pivot.cells = ' + JSON.stringify(pv.cells));
    const missing = pv.rows.filter((r) => pv.cells[r + '|' + pv.cols[0]] == null);
    line('  ⇒ 页面会渲染成「—」的行档位: ' + JSON.stringify(missing) + (missing.length ? ' ❌' : ' （无）'));
  }

  // ---------- E4：空档被当成 0 ----------
  H('E4 维度留空 ⇒ Number("")=0 ⇒ 是否生成 rent=0 / labor=0 的行');
  {
    const p = newPage();
    p.onLoad({ mode: 'reverse' });
    p.setData({
      presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2, advOpen: true,
      dims: { rent: [3000, ''], labor: [2, ''], margin: [55], target: [0, ''] },
      global: Object.assign({}, p.data.global, { area: 40 }),
    });
    const bad = p.badDimOf();
    line('  badDimOf() = ' + JSON.stringify(bad) + '（空 ⇒ 空串：不拦截）');
    await p.onGenerate();
    const rows = p.data.result ? p.data.result.rows : [];
    line('  行数 = ' + rows.length);
    rows.forEach((r) => line('   rent=' + r.rent + ' labor=' + r.labor + ' target=' + r.targetYuan
      + ' invalid=' + !!r.invalid + ' red=' + !!r.red + ' breakMonthly=' + r.breakMonthly + ' laborYuan=' + r.laborYuan));
    const zero = rows.filter((r) => r.rent === 0 || r.labor === 0);
    line('  ⇒ 含 0 值的档位行数 = ' + zero.length);
  }

  // ---------- E5：结论卡「可承受最高月租」的判别力 ----------
  H('E5 结论卡 maxRent 的判别力（改业态/改目标/改投入，结论是否变）');
  {
    const combos = [
      { name: '面馆 tier23 target1万 margin55', presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 1, target: [0, 10000], margin: [55] },
      { name: '面馆 tier23 target50万 margin55', presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 1, target: [0, 500000], margin: [55] },
      { name: '面馆 tier23 target1万 margin5 ', presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 1, target: [0, 10000], margin: [5] },
      { name: '面馆 tier23 target1万 margin1 ', presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 1, target: [0, 10000], margin: [1] },
    ];
    for (const c of combos) {
      const p = newPage();
      p.onLoad({ mode: 'reverse' });
      p.setData({
        presetIdx: c.presetIdx, cityIdx: c.cityIdx, advOpen: false,
        dims: { rent: [3000, 5000, 8000, 10000], labor: [2], margin: c.margin, target: c.target },
        global: Object.assign({}, p.data.global, { area: 40 }),
      });
      await p.onGenerate();
      const ins = p.data.result && p.data.result.insight;
      line('  ' + c.name + ' ⇒ ' + (ins && ins.has ? ins.bestText : JSON.stringify(ins)));
    }
    line('  （四组的最高租金档都是 10000 ⇒ 若四组结论全是 10000，说明结论不含任何可行性判据）');
  }

  // ---------- E6：现金卡「每月净流出」的类型/数量级 ----------
  H('E6 现金卡 fixedMonthly（fixedExAmort 是字符串？）');
  {
    const p = newPage();
    p.onLoad({ mode: 'reverse' });
    p.setData({
      presetIdx: PRESETS.indexOf('fastfood_noodle'), cityIdx: 2,
      dims: { rent: [3000], labor: [2], margin: [55], target: [0, 10000] },
      global: Object.assign({}, p.data.global, { area: 40 }),
      cash: Object.assign({}, p.data.cash, { rentYuan: 3000, budgetYuan: 200000, equipYuan: 50000, stockYuan: 10000 }),
    });
    await p.onGenerate();
    const row = p.data.result.rows[0];
    line('  row.fixedExAmort = ' + JSON.stringify(row.fixedExAmort) + ' (typeof ' + (typeof row.fixedExAmort) + ')');
    line('  fixedMonthlyYuan(3000) = ' + p.fixedMonthlyYuan(3000));
    line('  fixedMonthlyYuan(5500)（老板填的租金不在档位上）= ' + p.fixedMonthlyYuan(5500));
    line('  cashRes = ' + JSON.stringify(p.data.cashRes, null, 1));
    const r = require(path.join(ROOT, 'utils', 'openCash.js')).estimateOpenCash({
      areaM2: 40, rentFen: 300000, budgetFen: 20000000, equipFen: 5000000, stockFen: 1000000,
      fixedMonthlyFen: api.yuanToFen(14250),
    });
    line('  【对照】若每月净流出用正确的 14250 元 ⇒ runway=' + r.runwayMonths + ' 个月, level=' + r.level);
  }

  // ---------- E7：导出行 vs 页面表头列数 / 顺序 ----------
  H('E7 导出 14 列顺序 vs wxml 表头顺序');
  {
    const fs = require('fs');
    const wxml = fs.readFileSync(path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'matrix.wxml'), 'utf8');
    const th = (wxml.match(/<view class="tr th">([\s\S]*?)<\/view>\s*\n\s*<!--/) || [])[1]
      || (wxml.split('<view class="tr th">')[1] || '').split('</view>')[0];
    const cols = Array.from((th.match(/\{\{t\.([A-Za-z0-9_]+)\}\}/g) || []).map((s) => s.slice(4, -2)));
    line('  wxml 表头键 = ' + JSON.stringify(cols) + ' 共 ' + cols.length + ' 列');
    const js = fs.readFileSync(path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'matrix.js'), 'utf8');
    const hd = (js.match(/const header = \[([\s\S]*?)\];/) || [])[1] || '';
    const exp = Array.from((hd.match(/t\.([A-Za-z0-9_]+)/g) || []).map((s) => s.slice(2)));
    line('  导出表头键 = ' + JSON.stringify(exp) + ' 共 ' + exp.length + ' 列');
    line('  顺序是否逐列一致: ' + (JSON.stringify(cols) === JSON.stringify(exp)
      ? '✅ 完全一致' : '❌ 不一致（键名不同属预期：屏幕短名 vs 导出长名，但**顺序**必须一致）'));
  }

  line('\nTOASTS = ' + JSON.stringify(TOASTS));
})();
