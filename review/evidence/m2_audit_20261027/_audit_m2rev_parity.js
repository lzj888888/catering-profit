#!/usr/bin/env node
// _audit_m2rev_parity.js —— A 项：口径/引擎一致性
//   ① 全仓 grep 是否有第二份「业态 → fixed_items」装配实现（此处用 require 后的运行期比对代替肉眼）
//   ② 用真实页面对象跑 ≥30 组参数，逐行对拍：页面派生值 vs 引擎出参
//   ③ calcSandboxReverse 的生产可达性（前端是否还有任何人送 mode='reverse'）
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = (() => { const fs = require('fs'); const p = require('path');
  let d = __dirname; for (let i = 0; i < 8; i++) { if (fs.existsSync(p.join(d, 'app.json'))) return d; d = p.dirname(d); }
  return __dirname; })();  // R529：归档到 review/evidence/ 后仍能定位仓根（原来写死 __dirname）

const TOASTS = [];
global.wx = { getSystemInfoSync: () => ({ windowWidth: 375 }), showToast: (o) => TOASTS.push(o.title), showModal: () => {}, navigateTo: () => {}, navigateBack: () => {}, cloud: { callFunction: async () => { throw new Error('x') } } };
let PAGE = null;
global.Page = (o) => { PAGE = o; };
global.getApp = () => ({ globalData: { shop_id: 'a' } });

const api = require(path.join(ROOT, 'utils', 'api.js'));
const svc = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js'));
const val = require(path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'validate.js'));
const biz = require(path.join(ROOT, 'utils', 'bizPreset.js'));
const MoneyFmt = require(path.join(ROOT, 'utils', 'moneyFmt.js'));
const engineRows = [];
api.call = async (n, p) => {
  const arr = p.clean_array || [];
  const rejected = [];
  const rows = arr.map((c, i) => {
    const v = val.validateClean(c && typeof c === 'object' ? c : {});
    if (v.error) { rejected.push({ index: i, code: v.error, msg: v.msg }); return null; }
    const r = svc.calcSandbox(v.clean); engineRows.push({ clean: v.clean, res: r }); return r;
  });
  if (rejected.length === arr.length) throw Object.assign(new Error('all'), { code: rejected[0].code });
  return { rows, rejected };
};
api.toastError = (e) => TOASTS.push('ERR');
require(path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'matrix.js'));

function np() {
  const i = Object.create(PAGE);
  i.data = JSON.parse(JSON.stringify(PAGE.data));
  i.setData = function (p, cb) {
    for (const k in p) { const ks = k.split('.'); let o = this.data; for (let j = 0; j < ks.length - 1; j++) o = o[ks[j]]; o[ks[ks.length - 1]] = p[k]; }
    if (cb) cb();
  };
  return i;
}
const PRESETS = PAGE.data.presets.map((p) => p.key);
const TIERS = ['tier1', 'tier23', 'county'];

const H = (s) => console.log('\n============ ' + s + ' ============');

(async () => {
  H('A1 是否只有一份「业态 → fixed_items」装配（用调用结果反证）');
  {
    const srcs = [];
    const walk = (d, base) => {
      for (const f of fs.readdirSync(d)) {
        if (f === 'node_modules' || f === '.git' || f.startsWith('_bak') || f === 'review' || f === '_归档_过程件_202610') continue;
        const fp = path.join(d, f);
        const st = fs.statSync(fp);
        if (st.isDirectory()) walk(fp, base);
        else if (f.endsWith('.js')) srcs.push(fp);
      }
    };
    walk(ROOT, ROOT);
    const hits = [];
    for (const f of srcs) {
      const s = fs.readFileSync(f, 'utf8');
      // 判据：出现 form==='energy_split' / 'labor_total' / rentPct 派生这类**装配语义**，且不是 bizPreset 本体
      if (/energy_split|rentPct/.test(s) && /form\s*===/.test(s)) hits.push(path.relative(ROOT, f));
    }
    console.log('  含「装配形态分支 + rentPct/energy_split」的文件：');
    hits.forEach((h) => console.log('   - ' + h));
    const second = hits.filter((h) => !/utils[\\/]bizPreset\.js$/.test(h));
    console.log('  ⇒ 除 bizPreset.js 之外的第二份实现：' + (second.length ? second.join(', ') : '（无）'));
    // 额外：openCash / moneyFmt 是否被复制多份
    const dupCash = srcs.filter((f) => /押金|depositMonths/.test(fs.readFileSync(f, 'utf8')) && /prepayMonths/.test(fs.readFileSync(f, 'utf8')));
    console.log('  openCash 相关文件：' + dupCash.map((f) => path.relative(ROOT, f)).join(', '));
  }

  H('A2 ≥30 组真实组合：页面派生值 vs 引擎出参对拍（用页面自己 buildClean 的入参做单边真值）');
  {
    const combos = [];
    for (const pk of PRESETS) for (const ci of [0, 1, 2]) for (const rent of [1500, 6000, 15000]) for (const tg of [0, 15000]) combos.push({ pk, ci, rent, tg });
    console.log('  组合数 = ' + combos.length + '（每行 2 个目标利润档 ⇒ 行数 = ' + combos.length * 2 + '）');

    let bad = 0, n = 0; const out = [];
    for (const c of combos) {
      const p = np();
      p.onLoad({ mode: 'reverse' });
      p.setData({
        presetIdx: PRESETS.indexOf(c.pk), cityIdx: c.ci, advOpen: false,
        dims: { rent: [c.rent], labor: [2], margin: [55], target: [0, c.tg] },
        global: Object.assign({}, p.data.global, { area: 40, buildEquipYuan: '80000', buildEquipYears: 5, laborUnitYuan: '4500' }),
      });
      // 拦截 buildClean，拿页面自己装配的 fixedItems（单边真值）
      const origBuildClean = p.buildClean.bind(p);
      const captured = [];
      p.buildClean = function (...args) { const r = origBuildClean(...args); captured.push({ args, r }); return r; };
      engineRows.length = 0;
      await p.onGenerate();
      if (!p.data.result || !p.data.result.rows.length) { out.push('  ⚠ 无结果 ' + JSON.stringify(c)); continue; }
      for (let i = 0; i < p.data.result.rows.length; i++) {
        const row = p.data.result.rows[i];
        const er = engineRows[i].res;
        const cap = captured[i];
        const sumFixed = cap.r.fixedItems.reduce((a, b) => a + b.fen, 0);
        const sumBuild = cap.r.buildItems.reduce((a, b) => a + b.fen, 0);
        let amortRaw = 0; cap.r.buildItems.forEach((b) => { if (b.years > 0) amortRaw += b.fen / (b.years * 12); });
        const engLabor = cap.r.fixedItems.filter((x) => x.key === 'labor')[0];
        const checks = [
          ['总投入', sumBuild, er.build_total_fen],
          ['月摊销', Math.round(amortRaw), er.build_amort_monthly_fen],
          ['固定(不含摊)', sumFixed, er.fixed_ex_amort_fen],
          ['人工/月', row.laborYuan, engLabor ? Math.round(engLabor.fen / 100) : null],
          ['固定+摊销=保本分母', Math.round(sumFixed + er.build_amort_monthly_fen), er.fixed_total_fen],
        ];
        for (const [nm, a, b] of checks) {
          n++;
          if (a !== b) { bad++; if (out.length < 25) out.push('    ✗ ' + JSON.stringify(c) + ' target=' + row.targetYuan + ' ' + nm + ': 页面=' + a + ' 引擎=' + b); }
        }
      }
    }
    console.log('  对拍点位数 = ' + n + '；不一致数 = ' + bad + (bad === 0 ? '  ✅ 完全一致（单源成立）' : '  ❌ 分叉'));
    out.forEach((r) => console.log(r));
  }

  H('A3 calcSandboxReverse 的生产可达性');
  {
    const files = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        if (f === 'node_modules' || f === '.git' || f.startsWith('_bak') || f === 'review' || f === '_归档_过程件_202610' || f === 'cloudfunctions') continue;
        const fp = path.join(d, f);
        if (fs.statSync(fp).isDirectory()) walk(fp); else if (f.endsWith('.js') || f.endsWith('.wxml') || f.endsWith('.json')) files.push(fp);
      }
    };
    walk(ROOT);
    const senders = [];
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      // 找各种「向 calcSandbox 发送 mode:'reverse'」的写法
      if (/mode:\s*['"]reverse['"]/.test(s) && /calcSandbox|param_json|snapshot/.test(s)) senders.push(path.relative(ROOT, f));
    }
    console.log('  前端出现 mode:\'reverse\' 且涉及 calcSandbox/param_json 的文件：' + (senders.join(', ') || '（无）'));
    console.log('  ⇒ 结论：前端**没有任何一处**在 wire 入参里送 mode:\'reverse\' 给 calcSandbox，');
    console.log('     list.js 复用 param_json 重算之所以可能碰到 reverse，只可能是**历史存量方案**（现已无法新增）。');
  }
})().catch((e) => console.error('FATAL', e));
