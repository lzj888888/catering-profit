#!/usr/bin/env node
// tools/check_material_edit_stub.js —— R1-8（台账）原料新增/编辑表单页行为守卫
//
// 为什么需要它：`subpkg/biz/material/edit.js` 此前零桩，只有静态形状守卫。
//   它是**所有用到该原料的菜品成本的源头**（净料成本 = 单价 ÷ 系数 ÷ 出成率），
//   静默错误最伤人：
//
//   🔴 ① 金额铁律（R426）：单价"元"输入 → 前端 Math.round(元×100) 转"分"。
//      但 onSave 用 `Number(priceYuan)||0` 而非 yuanToFen：粘贴「12,000」⇒
//      NaN ⇒ Math.round(NaN×100)=NaN ⇒ purchase_price_fen=0（0 是合法金额）
//      ⇒ 这个原料按 0 元/斤存库，**全店用到它的菜成本一起变 0**，零报错。
//      checkAmounts() 必须在保存前拦（横幅只提醒不改数）。
//   🔴 ② 换算系数 >0（round155）：`Number(convert_factor)||0`，`!(cf>0)` 拦；
//      **不再静默兜底**回 500（"不许静默改掉老板敲的数"）。
//   🔴 ③ 出成率上界（R297）：units.yieldRateOf 判 (0,100]，前置给人话，
//      不让云端 msg 被 api.js 覆盖成"出错了"。
//   🔴 ④ R406 成本三要素键：编辑改价后必须如实告知"成本卡不自动变"；
//      n=0 不弹、读失败不当成 0（读成功才算数）。
//   🔴 ⑤ afterSaved 清 id+isEdit：否则下一条原料被当成"编辑第一条"⇒ 覆盖。
//
// 取证层级：L2 页面桩（Page/wx/getApp/依赖全桩，真跑页面源码）。不替代真机。
//   本页不自己算成本（净料成本公式在 calcCostCard/units），重点在**装配、判定、载荷、路由**。
//
// 运行：node tools/check_material_edit_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/biz/material/edit.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const units = require(path.join(ROOT, 'utils/units.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 可变量 ----------
let seen = {};
let syncAffected = [{ id: 'D1' }];
let syncThrow = false;

const MOCK_MATERIAL = {
  id: 'M1', name: '面粉', purchase_price_fen: 500, convert_factor: '500',
  yield_rate: 100, category: 'dry', purchase_unit: '斤', aliases: '[]', remark: '', std_key: '',
};

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls.push({ name, params });
    if (name === 'getMaterial') return { list: [JSON.parse(JSON.stringify(MOCK_MATERIAL))] };
    if (name === 'saveMaterial') return { ok: true };
    if (name === 'syncCostCard') {
      if (syncThrow) throw new Error('stub: syncCostCard 失败');
      return { affected: syncAffected };
    }
    return {};
  },
  fenToYuan: (fen, digits) => { const v = (Number(fen) || 0) / 100; return v.toFixed(digits === undefined ? 2 : digits); },
  toastError: (e) => { seen.toastError = (seen.toastError || 0) + 1; seen.lastErr = e && (e.msg || e.message); },
};
const mockUi = { setTitle: (t) => { seen.title = t; } };
const mockLexicon = { suggestByName: () => [] };

const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
  '../../../utils/materialLexicon.js': mockLexicon,
};
function makeRequire(baseDir) {
  return function (req) {
    if (Object.prototype.hasOwnProperty.call(MOCKS, req)) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}

let cfg = null;
function loadCfg(srcOverride) {
  const src = srcOverride || SRC;
  cfg = null;
  global.getApp = () => ({ globalData: { switches: { inv: true } } });
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(PAGE)), path.dirname(PAGE), PAGE);
  if (!cfg) throw new Error('Page() 未被调用：material/edit.js');
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() {
  seen = { calls: [], toasts: [], modals: [], nav: [], redirected: [], scrolled: false };
  syncAffected = [{ id: 'D1' }];
  syncThrow = false;
}
function flush() { return new Promise((r) => setTimeout(r, 15)); }

global.Page = (c) => { cfg = c; };
global.wx = {
  showToast: (o) => { seen.toasts.push(o); },
  showModal: (o) => { seen.modals.push(o); },
  navigateBack: () => { seen.nav.push('back'); },
  redirectTo: (o) => { seen.redirected.push(o); },
  pageScrollTo: (o) => { seen.scrolled = true; },
  stopPullDownRefresh: () => {},
};

const SRC = fs.readFileSync(PAGE, 'utf8');

(async () => {
  console.log('[R1-8] 原料新增/编辑表单页行为守卫（金额铁律 / 系数>0 / 出成率上界 / 成本三要素键 / afterSaved 清 id）');

  // =====================================================
  // A · 金额铁律（R426）：不可读金额被拦、可读才放行
  // =====================================================
  sec('A · 金额铁律 checkAmounts（R426）：「12,000」等读不成 ⇒ 拦在保存前');
  reset();
  let p = fresh(loadCfg());
  p.data.name = '面粉';
  p.data.priceYuan = '12,000';
  const a1 = p.checkAmounts();
  check('A-① 含千分位「12,000」⇒ 返回 1（读不成金额）', a1 === 1 && p.data.badAmountCount === 1, 'ret=' + a1 + ' bad=' + p.data.badAmountCount);

  reset();
  p = fresh(loadCfg());
  p.data.name = '面粉';
  p.data.priceYuan = '12.5';
  const a2 = p.checkAmounts();
  check('A-② 可读「12.5」⇒ 返回 0（放行）', a2 === 0 && p.data.badAmountCount === 0, 'ret=' + a2 + ' bad=' + p.data.badAmountCount);

  reset();
  p = fresh(loadCfg());
  p.data.name = '面粉';
  p.data.priceYuan = '12,000';
  p.data.convert_factor = '500';
  p.data.yield_rate = '100';
  await p.onSave();
  await flush();
  const aSave = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  const aModal = (seen.modals || []).filter((m) => m.content === TERMS.ui.amountBadTip).length;
  check('A-③ 🔴 不可读金额 ⇒ onSave 被金额拦：不调 saveMaterial + 弹 amountBadTip', aSave === 0 && aModal === 1, 'save=' + aSave + ' modal=' + aModal);

  // =====================================================
  // B · 换算系数 >0（round155，不许静默兜底）
  // =====================================================
  sec('B · 换算系数必须 >0（round155）：清空/0 拦，不准静默回 500');
  reset();
  p = fresh(loadCfg());
  p.data.name = '面粉'; p.data.priceYuan = '5'; p.data.yield_rate = '100'; p.data.convert_factor = '';
  await p.onSave(); await flush();
  const b1save = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  const b1toast = (seen.toasts || []).filter((t) => t.title === TERMS.card.matConvert).length;
  check('B-① 系数清空 ⇒ 拦：不调 saveMaterial + 弹 matConvert', b1save === 0 && b1toast === 1, 'save=' + b1save + ' toast=' + b1toast);

  reset();
  p = fresh(loadCfg());
  p.data.name = '面粉'; p.data.priceYuan = '5'; p.data.yield_rate = '100'; p.data.convert_factor = '0';
  await p.onSave(); await flush();
  const b2save = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  check('B-② 系数填 0 ⇒ 同样拦（0 不是 >0）', b2save === 0, 'save=' + b2save);

  // =====================================================
  // C · 出成率上界（R297）：units.yieldRateOf 判 (0,100]
  // =====================================================
  sec('C · 出成率上界（R297）：0 / 150 拦，100 / 80.5 放行');
  reset();
  p = fresh(loadCfg());
  p.data.name = '面粉'; p.data.priceYuan = '5'; p.data.convert_factor = '500'; p.data.yield_rate = '0';
  await p.onSave(); await flush();
  const c1save = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  const c1toast = (seen.toasts || []).filter((t) => t.title === TERMS.card.yieldRangeErr).length;
  check('C-① 出成率 0 ⇒ 拦：不调 saveMaterial + 弹 yieldRangeErr', c1save === 0 && c1toast === 1, 'save=' + c1save + ' toast=' + c1toast);

  reset();
  p = fresh(loadCfg());
  p.data.name = '面粉'; p.data.priceYuan = '5'; p.data.convert_factor = '500'; p.data.yield_rate = '150';
  await p.onSave(); await flush();
  const c2save = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  check('C-② 出成率 150（越界）⇒ 拦', c2save === 0, 'save=' + c2save);

  reset();
  p = fresh(loadCfg());
  p.data.name = '面粉'; p.data.priceYuan = '5'; p.data.convert_factor = '500'; p.data.yield_rate = '100';
  await p.onSave(); await flush();
  const c3 = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  const c3m = (seen.calls.find((c) => c.name === 'saveMaterial') || {}).params || {};
  check('C-③ 出成率 100（合法）⇒ 放行，且元→分正确（5 元 = 500 分）',
    c3 === 1 && c3m.material && c3m.material.purchase_price_fen === 500 && c3m.material.convert_factor === 500 && c3m.material.yield_rate === 100,
    'fen=' + (c3m.material && c3m.material.purchase_price_fen));

  // =====================================================
  // D · 名称校验
  // =====================================================
  sec('D · 名称为空 ⇒ 拦');
  reset();
  p = fresh(loadCfg());
  p.data.name = ''; p.data.priceYuan = '5'; p.data.convert_factor = '500'; p.data.yield_rate = '100';
  await p.onSave(); await flush();
  const d1save = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  const d1toast = (seen.toasts || []).filter((t) => t.title === TERMS.card.matName).length;
  check('D-① 名称为空 ⇒ 拦：不调 saveMaterial + 弹 matName', d1save === 0 && d1toast === 1, 'save=' + d1save + ' toast=' + d1toast);

  // =====================================================
  // E · afterSaved 清 id+isEdit（R406：防下一条覆盖第一条）
  // =====================================================
  sec('E · afterSaved 重置（清 id+isEdit，防连续录入覆盖）');
  reset();
  p = fresh(loadCfg());
  p.data.id = 'M1'; p.data.isEdit = true; p.data.name = '面粉'; p.data.saving = true;
  p.afterSaved('面粉');
  check('E-① 🔴 afterSaved 必须清 id 与 isEdit（否则下一条被当编辑第一条覆盖）', p.data.id === '' && p.data.isEdit === false, 'id=' + p.data.id + ' isEdit=' + p.data.isEdit);
  check('E-② afterSaved 复位 saving + 设 savedName + 清 name', p.data.saving === false && p.data.savedName === '面粉' && p.data.name === '', 'saving=' + p.data.saving + ' saved=' + p.data.savedName);
  check('E-③ afterSaved 采购单位/换算回默认（防填错下一条）',
    p.data.purchase_unit === TERMS.card.matUnitDefault && p.data.convert_factor === String(units.suggestConvert(TERMS.card.matUnitDefault) || 1),
    'unit=' + p.data.purchase_unit + ' cf=' + p.data.convert_factor);

  // =====================================================
  // F · R406 成本三要素键比对（编辑改价如实告知，n=0 不弹、读失败不当 0）
  // =====================================================
  sec('F · R406 编辑改价：成本三要素键比对与影响面告知（不撒谎）');

  // F-① 改价（成本变）⇒ 调 dry_run + 弹带数量的 matImpactAsk(n)
  reset();
  p = fresh(loadCfg());
  await p.onLoad({ id: 'M1' }); await flush();
  p.data.priceYuan = '6';   // 500→600 分，成本变
  await p.onSave(); await flush();
  const f1save = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  const f1sync = seen.calls.filter((c) => c.name === 'syncCostCard');
  const f1modal = (seen.modals || []).filter((m) => m.content === TERMS.card.matImpactAsk(1));
  check('F-① 🔴 改价（成本变）⇒ saveMaterial + syncCostCard(dry_run) + 弹 matImpactAsk(1)',
    f1save === 1 && f1sync.length === 1 && f1sync[0].params.dry_run === true && f1modal.length === 1,
    'save=' + f1save + ' sync=' + f1sync.length + ' modal=' + f1modal.length);

  // F-② 只改别名/备注（成本不变）⇒ 不调 syncCostCard、直接 savedDone（不弹）
  reset();
  p = fresh(loadCfg());
  await p.onLoad({ id: 'M1' }); await flush();
  // 不动 priceYuan(5.00)/convert(500)/yield(100) ⇒ 成本键不变
  await p.onSave(); await flush();
  const f2sync = seen.calls.filter((c) => c.name === 'syncCostCard').length;
  const f2modal = (seen.modals || []).length;
  const f2toast = (seen.toasts || []).filter((t) => t.title === TERMS.ui.savedDone).length;
  check('F-② 成本不变（只改别名/备注）⇒ 不弹影响面、savedDone 提示', f2sync === 0 && f2modal === 0 && f2toast === 1, 'sync=' + f2sync + ' modal=' + f2modal + ' toast=' + f2toast);

  // F-③ 影响面弹窗的「去影响面」按钮契约（confirmText=matImpactGo）
  reset();
  p = fresh(loadCfg());
  await p.onLoad({ id: 'M1' }); await flush();
  p.data.priceYuan = '6';
  await p.onSave(); await flush();
  const f3modal = (seen.modals || []).find((m) => m.title === TERMS.card.matPriceSaved);
  check('F-③ 影响面弹窗 confirmText=matImpactGo（直达影响面）、cancelText=matImpactSkip',
    !!f3modal && f3modal.confirmText === TERMS.card.matImpactGo && f3modal.cancelText === TERMS.card.matImpactSkip,
    f3modal ? 'confirm=' + f3modal.confirmText : '无弹窗');

  // F-④ 真·0 道菜用到 ⇒ 不弹（savedDone + navigateBack，不打扰）
  reset(); syncAffected = [];
  p = fresh(loadCfg());
  await p.onLoad({ id: 'M1' }); await flush();
  p.data.priceYuan = '6';
  await p.onSave(); await flush();
  const f4modal = (seen.modals || []).length;
  check('F-④ 确实 0 道菜 ⇒ 不弹影响面（n===0 不打扰）', f4modal === 0, 'modal=' + f4modal);

  // F-⑤ 探数失败（读不到）⇒ 仍弹「不带数量」通用版，不当成 0
  reset(); syncThrow = true;
  p = fresh(loadCfg());
  await p.onLoad({ id: 'M1' }); await flush();
  p.data.priceYuan = '6';
  await p.onSave(); await flush();
  const f5modal = (seen.modals || []).filter((m) => m.content === TERMS.card.matImpactAskUnknown);
  check('F-⑤ 🔴 探数失败（读不到）⇒ 仍弹通用版 matImpactAskUnknown（不当成 0 不弹）', f5modal.length === 1, 'modal=' + f5modal.length);

  // =====================================================
  // G · 连击保护（saving）
  // =====================================================
  sec('G · 连击保护：saving=true 时 onSave 直接 return');
  reset();
  p = fresh(loadCfg());
  p.data.name = '面粉'; p.data.priceYuan = '5'; p.data.convert_factor = '500'; p.data.yield_rate = '100'; p.data.saving = true;
  await p.onSave(); await flush();
  const g1save = seen.calls.filter((c) => c.name === 'saveMaterial').length;
  check('G-① saving=true ⇒ onSave 提前 return，不调 saveMaterial', g1save === 0, 'save=' + g1save);

  // =====================================================
  // M · 变异回灌：每条必须真跑、exit=1、点名断言
  // =====================================================
  sec('M · 变异回灌（证明上面不是恒真）');

  async function mut(label, from, to, setupFn, runFn) {
    if (SRC.indexOf(from) < 0) { console.log('  ❌ ' + label + ' 锚点漂移'); failN++; return; }
    const mutated = SRC.replace(from, to);
    if (mutated === SRC) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let mc = null;
    try { setupFn(); mc = loadCfg(mutated); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return; }
    let degraded = false, detail = '';
    try { const r = await runFn(mc); degraded = !!r.degraded; detail = r.detail || ''; }
    catch (e) { console.log('  ❌ ' + label + ' 变异后桩抛错（FATAL ≠ 真抓到）：' + (e && e.message)); failN++; return; }
    check(label + ' ⇒ 检出退化', degraded, detail);
    loadCfg();
  }

  // M-1 删掉金额拦（回到 R426 的坑：12,000 也能存，成本归零）
  await mut('M-1 删除金额前置拦',
    "    if (this.checkAmounts() > 0) {\n      wx.showModal({ content: TERMS.ui.amountBadTip, showCancel: false, confirmText: TERMS.buttons.gotIt });\n      return;\n    }\n",
    '',
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      q.data.name = '面粉'; q.data.priceYuan = '12,000'; q.data.convert_factor = '500'; q.data.yield_rate = '100';
      await q.onSave(); await flush();
      const c = seen.calls.filter((x) => x.name === 'saveMaterial').length;
      return { degraded: c >= 1, detail: 'A-③ 不可读金额竟放行 saveMaterial=' + c };
    });

  // M-2 换算系数静默兜底回 500（round155 要禁的行为）
  await mut('M-2 换算系数静默兜底回 500',
    "    const cf = Number(this.data.convert_factor) || 0;",
    "    const cf = Number(this.data.convert_factor) || units.suggestConvert(this.data.purchase_unit) || 1;",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      q.data.name = '面粉'; q.data.priceYuan = '5'; q.data.yield_rate = '100'; q.data.convert_factor = '';
      await q.onSave(); await flush();
      const c = seen.calls.filter((x) => x.name === 'saveMaterial').length;
      return { degraded: c >= 1, detail: 'B-① 清空系数竟被兜底放行 saveMaterial=' + c };
    });

  // M-3 删除出成率上界拦（回到 R297 的坑：填 0/150 ⇒ 成本虚高）
  await mut('M-3 删除出成率上界拦',
    "    if (yr === null) { wx.showToast({ title: TERMS.card.yieldRangeErr, icon: 'none' }); return; }",
    '',
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      q.data.name = '面粉'; q.data.priceYuan = '5'; q.data.convert_factor = '500'; q.data.yield_rate = '0';
      await q.onSave(); await flush();
      const c = seen.calls.filter((x) => x.name === 'saveMaterial').length;
      return { degraded: c >= 1, detail: 'C-① 出成率 0 竟放行 saveMaterial=' + c };
    });

  // M-4 afterSaved 不清 id（回到 R406 的坑：下一条覆盖第一条）
  await mut('M-4 afterSaved 不清 id',
    "      id: '',\n      isEdit: false,\n    }, () => this.refreshUnitHint());",
    "      isEdit: false,\n    }, () => this.refreshUnitHint());",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      q.data.id = 'M1'; q.data.isEdit = true; q.data.name = '面粉'; q.data.saving = true;
      q.afterSaved('面粉');
      return { degraded: q.data.id !== '' || q.data.isEdit !== false, detail: 'E-① afterSaved 后 id=' + q.data.id + ' isEdit=' + q.data.isEdit };
    });

  // M-5 成本三要素键比对恒假（回到 R406 的坑：改价不提示，老板按旧成本定价）
  await mut('M-5 成本三要素键比对恒假',
    "      if (newCostKey !== origCostKey) {",
    "      if (false) {",
    () => { reset(); },
    async (mc) => {
      const q = fresh(mc);
      await q.onLoad({ id: 'M1' }); await flush();
      q.data.priceYuan = '6';
      await q.onSave(); await flush();
      const sync = seen.calls.filter((x) => x.name === 'syncCostCard').length;
      const modal = (seen.modals || []).length;
      return { degraded: sync === 0 && modal === 0, detail: 'F-① 成本变了却没提示 sync=' + sync + ' modal=' + modal };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e && (e.stack || e.message)); process.exit(2); });
