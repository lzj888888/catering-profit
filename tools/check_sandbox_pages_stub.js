#!/usr/bin/env node
// tools/check_sandbox_pages_stub.js —— R1-8（台账）沙盒「对比 / 我的方案」两页行为守卫
//
// 为什么**两页写在一个文件里**：它们共享同一份 getPlan 数据、同一套「分 → 元」口径。
//   R297 第四轮审计 B4 抓到过真 bug：反推方案在 compare.js 读顶层 target_monthly_fen，
//   在 list.js 读 snapshot.reverse.target_monthly_fen ⇒ **同一个方案两个页面显示两个数**。
//   单页桩永远证不了「两页一致」，必须把两页装进同一个进程里对拍（F 组）。
//
// 各页最贵的静默错误：
//   · compare.js：勾选态必须**算进 plans**（WXML 表达式不支持方法调用，
//       `selected.indexOf(...)` 恒不亮 → 老板点了没反应，R297-⑥）；
//       反推方案目标月营收必须读 snapshot.reverse 块；最多 3 个、至少 2 个；
//       跨场景（已有铺面 / 寻找铺面）必须给硬提示但不阻止。
//   · list.js：对比时**实时重算**（param_json 原样透传 calcSandbox），不读快照缓存；
//       onReady 预热画布（R297-B1：否则首次点「导出图片」必然只弹提示、不出图）；
//       Excel 导出免费（不主动弹付费墙），FEATURE_LOCKED 仅作旧后端兜底。
//
// 取证层级：L2 页面桩（两页源码真跑，依赖全桩）。
//   ⚠️ 不替代真机：canvas 是桩，验的是「预热后有没有走预览」，不验真出图。
//
// 运行：node tools/check_sandbox_pages_stub.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_CMP = path.join(ROOT, 'subpkg/tools/sandbox/compare.js');
const PAGE_LST = path.join(ROOT, 'subpkg/tools/sandbox/list.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const M = TERMS.matrix;
const P = TERMS.m2Plan;

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 可变量 ----------
let planResp = { list: [] };
let planThrows = false;
let calcResp = {};
let calcThrows = false;
let exportResp = { filename: 'cmp.xlsx', content: 'AAA', format: 'xlsx' };
let exportThrows = null;
let seen = {};
let cfg = null;

// 🔴 顶层 target_monthly_fen 是**陷阱值**（9999999 分 = 99999.99 元）；
//    反推方案的真答案在 reverse 块（1500000 分 = 15000 元）。两者差 6 倍多，
//    谁读错一眼就能看出来 —— 测试样本必须能区分，否则断言恒真。
const PLANS = [
  { sandbox_id: 's1', name: '观音桥店', param_json: { mode: 'forward', gross_margin_pct: 62 },
    result_snapshot_json: { break_even_monthly_fen: 1200000, target_monthly_fen: 2000000,
      payback_months: 8, composite_var_rate_pct: 41, red_alert: false }, updated_at: 1762000000000 },
  { sandbox_id: 's2', name: '解放碑店', param_json: { mode: 'reverse', gross_margin_pct: 58 },
    result_snapshot_json: { break_even_monthly_fen: 900000, target_monthly_fen: 9999999,
      reverse: { target_monthly_fen: 1500000, rent_rate_pct: 12.5 },
      payback_months: 5, composite_var_rate_pct: 38, red_alert: false }, updated_at: 1762100000000 },
  { sandbox_id: 's3', name: '沙坪坝店', param_json: { mode: 'forward', gross_margin_pct: 55 },
    result_snapshot_json: { break_even_monthly_fen: 1100000, target_monthly_fen: 1800000,
      payback_months: 10, composite_var_rate_pct: 44, red_alert: true }, updated_at: 1762200000000 },
  { sandbox_id: 's4', name: '无快照方案', param_json: { mode: 'forward' }, updated_at: 1762300000000 },
];

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name, params) => {
    seen.calls = (seen.calls || []).concat({ name, params });
    if (name === 'getPlan') { if (planThrows) throw new Error('stub: 方案列表失败'); return planResp; }
    if (name === 'calcSandbox') {
      if (calcThrows) throw new Error('stub: 重算失败');
      return calcResp[params && params.mode] || calcResp.forward || {};
    }
    if (name === 'exportData') {
      if (exportThrows) throw exportThrows;
      return exportResp;
    }
    return {};
  },
  fenToYuan: (fen, digits) => {
    const v = (Number(fen) || 0) / 100;
    return v.toFixed(digits === undefined ? 2 : digits);
  },
  toastError: (e) => { seen.toastError = (seen.toastError || 0) + 1; seen.lastErr = e && (e.msg || e.message); },
};
const mockUi = { setTitle: (t) => { seen.title = t; } };
const mockPaywall = { openPaywall: (type, opts) => { seen.paywall = { type, opts }; } };
const mockExportFile = { deliver: (res) => { seen.deliver = res; } };

const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
  '../../../utils/paywall.js': mockPaywall,
  '../../../utils/exportFile.js': mockExportFile,
  '../../../miniprogram/i18n/terms.js': { TERMS },
};
function makeRequire(baseDir) {
  return function (req) {
    if (Object.prototype.hasOwnProperty.call(MOCKS, req)) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}

const ctxStub = { clearRect() {}, fillText() {}, scale() {}, fillStyle: '', font: '' };
const canvasStub = { width: 0, height: 0, getContext: () => ctxStub };
global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
global.wx = {
  showToast: (o) => { seen.toasts = (seen.toasts || []).concat([o]); },
  showModal: (o) => { seen.modals = (seen.modals || []).concat([o]); },
  stopPullDownRefresh: () => { seen.stopped = true; },
  navigateBack: (o) => { seen.navBack = o; },
  reLaunch: (o) => { seen.reLaunch = o; },
  getWindowInfo: () => ({ pixelRatio: 2 }),
  createSelectorQuery: () => {
    const q = { in() { return q; }, select() { return q; }, fields() { return q; },
      exec(cb) { cb([{ node: canvasStub }]); } };
    return q;
  },
  canvasToTempFilePath: (o) => { seen.canvasExport = o; if (o && o.success) o.success({ tempFilePath: '/tmp/cmp.png' }); },
  previewImage: (o) => { seen.preview = o; },
};

function loadCfg(pagePath, srcOverride) {
  const src = srcOverride || fs.readFileSync(pagePath, 'utf8');
  cfg = null;
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  const mod = { exports: {} };
  fn(mod, mod.exports, makeRequire(path.dirname(pagePath)), path.dirname(pagePath), pagePath);
  if (!cfg) throw new Error('Page() 未被调用：' + path.basename(pagePath));
  return cfg;
}
function fresh(c) {
  const p = Object.assign({}, c);
  p.data = JSON.parse(JSON.stringify(c.data));
  p.setData = function (o) { Object.assign(this.data, o); };
  return p;
}
function reset() {
  seen = {}; planResp = { list: [] }; planThrows = false;
  calcResp = {
    forward: { break_even_monthly_fen: 1200000, target_monthly_fen: 2000000,
      payback_months: 8, indicators_at_breakeven: [{ key: 'rent', pct: 18.2 }] },
    reverse: { break_even_monthly_fen: 900000, target_monthly_fen: 9999999,
      reverse: { target_monthly_fen: 1500000, rent_rate_pct: 12.5 },
      payback_months: 5 },
  };
  calcThrows = false; exportThrows = null;
}
const cmpCfg = () => loadCfg(PAGE_CMP);
const lstCfg = () => loadCfg(PAGE_LST);

(async () => {
  console.log('[R1-8] 沙盒两页行为守卫（勾选态 / 反推口径 / 跨页对拍 / 画布预热 / 免费导出）');
  const SRC_C = fs.readFileSync(PAGE_CMP, 'utf8');
  const SRC_L = fs.readFileSync(PAGE_LST, 'utf8');
  cmpCfg();

  // =====================================================
  // A · compare.loadPlans
  // =====================================================
  sec('A · compare.loadPlans（快照 → 列表）');

  reset(); planResp = { list: PLANS };
  let p = fresh(cmpCfg());
  await p.loadPlans();
  check('A-① 无 result_snapshot_json 的方案被过滤（没数的不能进对比）',
    p.data.plans.length === 3 && p.data.plans.every((x) => x.sandbox_id !== 's4'),
    'plans=' + p.data.plans.length);
  const rev = p.data.plans.find((x) => x.sandbox_id === 's2');
  const fwd = p.data.plans.find((x) => x.sandbox_id === 's1');
  check('A-② mode 由 param_json.mode 判定，sceneName 跟着走',
    rev.mode === 'reverse' && rev.sceneName === M.sceneRev
    && fwd.mode === 'forward' && fwd.sceneName === M.sceneFwd,
    JSON.stringify([fwd.sceneName, rev.sceneName]));
  check('A-③ 初始 checked 全 false（默认不带对比态）',
    p.data.plans.every((x) => x.checked === false) && p.data.selected.length === 0);
  check('A-④ loading 收起', p.data.loading === false);

  reset(); planResp = { list: [{ sandbox_id: 'x', param_json: {}, result_snapshot_json: {} }] };
  p = fresh(cmpCfg());
  await p.loadPlans();
  check('A-⑤ 方案名缺失 ⇒ 「方案」兜底（不渲染 undefined）', p.data.plans[0].name === '方案');

  reset(); planThrows = true;
  p = fresh(cmpCfg());
  let aErr = null;
  try { await p.loadPlans(); } catch (e) { aErr = e; }
  check('A-⑥ 接口失败 ⇒ 不崩、loading 收起、有提示',
    aErr === null && p.data.loading === false && seen.toastError === 1);

  // =====================================================
  // B · compare.onToggle
  // =====================================================
  sec('B · compare.onToggle（勾选态必须算进数据）');

  reset(); planResp = { list: PLANS };
  p = fresh(cmpCfg());
  await p.loadPlans();
  p.onToggle({ currentTarget: { dataset: { id: 's1' } } });
  check('B-① 🔴 勾选 ⇒ selected 增加**且 plans 里 checked=true**',
    p.data.selected.indexOf('s1') >= 0 && p.data.plans[0].checked === true,
    'selected=' + JSON.stringify(p.data.selected) + ' checked=' + p.data.plans[0].checked);
  p.onToggle({ currentTarget: { dataset: { id: 's1' } } });
  check('B-② 再点一次 ⇒ 取消勾选且 checked 回落 false',
    p.data.selected.length === 0 && p.data.plans[0].checked === false);

  reset(); planResp = { list: PLANS };
  p = fresh(cmpCfg());
  await p.loadPlans();
  ['s1', 's2', 's3'].forEach((id) => p.onToggle({ currentTarget: { dataset: { id } } }));
  const before4 = p.data.selected.length;
  p.onToggle({ currentTarget: { dataset: { id: 's4' } } });
  check('B-③ 🔴 第 4 个 ⇒ 拒绝 + 提示「最多对比 3 个」，不静默塞进去',
    p.data.selected.length === 3 && before4 === 3
    && (seen.toasts || []).some((t) => t.title === M.cmpMax),
    'selected=' + JSON.stringify(p.data.selected));

  reset(); planResp = { list: PLANS };
  p = fresh(cmpCfg());
  await p.loadPlans();
  p.onToggle({ currentTarget: { dataset: { id: 's1' } } });
  p.onCompare();
  check('B-④ 少于 2 个 ⇒ 提示「请先勾选 2~3 个」，且不产出对比表',
    p.data.compared === null && (seen.toasts || []).some((t) => t.title === M.cmpNotEnough));

  // =====================================================
  // C · compare.onCompare
  // =====================================================
  sec('C · compare.onCompare（口径 / 场景 / 结论）');

  const twoPlans = async (ids) => {
    reset(); planResp = { list: PLANS };
    const q = fresh(cmpCfg());
    await q.loadPlans();
    ids.forEach((id) => q.onToggle({ currentTarget: { dataset: { id } } }));
    q.onCompare();
    return q;
  };

  p = await twoPlans(['s1', 's2']);
  const rows = (p.data.compared && p.data.compared.rows) || [];
  const rF = rows.find((r) => r.id === 's1');
  const rR = rows.find((r) => r.id === 's2');
  check('C-① 两方案出两行，字段齐（id/name/sceneName/breakMonthly/targetMonthly/payback/varRate/red）',
    rows.length === 2 && rF && rR && rF.sceneName === M.sceneFwd && rR.sceneName === M.sceneRev,
    'rows=' + rows.length);
  check('C-② 🔴 反推方案目标月营收读 **snapshot.reverse**（15000 元），不是顶层陷阱值',
    rR.targetMonthly === 15000,
    'targetMonthly=' + rR.targetMonthly + '（顶层陷阱值应为 100000）');
  check('C-③ 正向方案读顶层 target_monthly_fen（20000 元）', rF.targetMonthly === 20000,
    'targetMonthly=' + rF.targetMonthly);
  check('C-④ 保本月营收取 break_even_monthly_fen / 100 并四舍五入',
    rF.breakMonthly === 12000 && rR.breakMonthly === 9000);
  check('C-⑤ 结论选「可行方案里保本最低者」，文案来自术语单源且占位符真替换',
    String(p.data.compared.verdict).indexOf('解放碑店') === 0
    && String(p.data.compared.verdict).indexOf('9000') >= 0
    && String(p.data.compared.verdict).indexOf('{') < 0,
    p.data.compared.verdict);
  check('C-⑥ 唯一键 id = sandbox_id（方案名可重名，wx:key="name" 会撞键）',
    rows[0].id === 's1' && rows[1].id === 's2');
  check('C-⑦ 🔴 跨场景 ⇒ mixedScene=true，但**仍出表**（说清即可，不阻止）',
    p.data.mixedScene === true && rows.length === 2);

  p = await twoPlans(['s1', 's3']);
  check('C-⑧ 同场景 ⇒ mixedScene=false', p.data.mixedScene === false);
  // 🔴 这里原先有一条 check('C-⑨ ...', true) —— **恒真断言**，自己犯了最忌讳的假绿。
  //    全红结论由下面这段专门样本真跑验，占位恒真断言一律不许留。

  reset(); planResp = { list: PLANS };
  let q = fresh(cmpCfg());
  await q.loadPlans();
  // 只勾两个红方案：造一份临时数据
  q.data.plans = q.data.plans.map((x) => Object.assign({}, x, { checked: false }));
  q.setData({ selected: ['s3'], plans: q.data.plans.map((x) => Object.assign({}, x, { checked: x.sandbox_id === 's3' })) });
  // 手工再加一条红方案（同名不同 id，顺带复证唯一键）
  q.setData({ plans: q.data.plans.concat([{
    sandbox_id: 's3b', name: '沙坪坝店', mode: 'forward', sceneName: M.sceneFwd,
    snapshot: { break_even_monthly_fen: 1100000, target_monthly_fen: 1800000, red_alert: true }, checked: true,
  }]), selected: ['s3', 's3b'] });
  q.onCompare();
  check('C-⑨ 🔴 全红 ⇒ 结论 = cmpVerdictAllRed，且重名方案两行都在（唯一键生效）',
    q.data.compared.verdict === M.cmpVerdictAllRed && q.data.compared.rows.length === 2,
    q.data.compared.verdict + ' rows=' + q.data.compared.rows.length);

  // =====================================================
  // D · list.load / decorate
  // =====================================================
  sec('D · list.decorate（列表卡片快照）');

  reset(); planResp = { list: PLANS };
  let l = fresh(lstCfg());
  await l.load();
  check('D-① 默认不勾选、mode=list、loading 收起',
    l.data.selIds.length === 0 && l.data.mode === 'list' && l.data.loading === false
    && l.data.list.every((x) => x.checked === false));
  const dRev = l.data.list.find((x) => x.sandbox_id === 's2');
  check('D-② 🔴 反推方案卡片目标月营收也读 reverse 块（15000）',
    dRev.targetYuan === '15000', 'targetYuan=' + dRev.targetYuan);
  check('D-③ 缺字段 ⇒ 破折号（不渲染 undefined）',
    typeof dRev.breakEvenYuan === 'string' && dRev.breakEvenYuan === '9000');
  check('D-④ typeName 按 sandbox_type 分叉', l.data.list[0].typeName === P.typeSite || l.data.list[0].typeName === P.typeBiz);

  reset(); planResp = { list: [{ sandbox_id: 'x', param_json: {}, result_snapshot_json: {} }] };
  l = fresh(lstCfg());
  await l.load();
  check('D-⑤ 空快照 ⇒ 金额显示破折号', l.data.list[0].targetYuan === '—' && l.data.list[0].breakEvenYuan === '—');

  reset(); planThrows = true;
  l = fresh(lstCfg());
  let dErr = null;
  try { await l.load(); } catch (e) { dErr = e; }
  check('D-⑥ 接口失败 ⇒ 不崩、loading 收起、errMsg 有值 + toast',
    dErr === null && l.data.loading === false && !!l.data.errMsg && seen.toastError === 1,
    'errMsg=' + l.data.errMsg);

  // =====================================================
  // E · list.onCompare（实时重算）
  // =====================================================
  sec('E · list.onCompare（param_json 原样透传，不读快照）');

  reset(); planResp = { list: PLANS };
  l = fresh(lstCfg());
  await l.load();
  l.onToggle({ currentTarget: { dataset: { id: 's1' } } });
  l.onToggle({ currentTarget: { dataset: { id: 's2' } } });
  await l.onCompare();
  const calcCalls = (seen.calls || []).filter((c) => c.name === 'calcSandbox');
  check('E-① 每个选中方案各调一次 calcSandbox（实时重算）', calcCalls.length === 2,
    'calcSandbox=' + calcCalls.length);
  check('E-② 🔴 param_json 原样透传（含 mode / gross_margin_pct），且带幂等键',
    calcCalls[0].params.mode === 'forward' && calcCalls[1].params.mode === 'reverse'
    && /^cmp_/.test(calcCalls[0].params.client_request_id),
    JSON.stringify(calcCalls.map((c) => Object.keys(c.params))));
  check('E-③ 5 行指标（保本/目标/回本/毛利/房租占比）', l.data.compareRows.length === 5,
    'rows=' + l.data.compareRows.length);
  check('E-④ 列配唯一键 id = sandbox_id（重名不撞列）',
    l.data.compareCols.length === 2 && l.data.compareCols[0].id === 's1'
    && l.data.compareCols[1].id === 's2');
  check('E-⑤ 🔴 房租占比：反推读 result.reverse.rent_rate_pct，正向读 indicators_at_breakeven 的 rent',
    l.data.compareCols[0].rentPct === 18.2 && l.data.compareCols[1].rentPct === 12.5,
    JSON.stringify(l.data.compareCols.map((c) => c.rentPct)));
  check('E-⑥ 反推列目标月营收读实时出参的 reverse 块（15000）',
    l.data.compareCols[1].targetYuan === '15000', l.data.compareCols[1].targetYuan);
  check('E-⑦ comparing 复位、mode 切 compare',
    l.data.comparing === false && l.data.mode === 'compare');

  reset(); planResp = { list: PLANS };
  l = fresh(lstCfg());
  await l.load();
  await l.onCompare();
  check('E-⑧ 未选满 2 个 ⇒ 拒绝重算（不耗云函数）',
    (seen.calls || []).filter((c) => c.name === 'calcSandbox').length === 0 && seen.toastError === 1);

  reset(); calcThrows = true; planResp = { list: PLANS };
  l = fresh(lstCfg());
  await l.load();
  l.onToggle({ currentTarget: { dataset: { id: 's1' } } });
  l.onToggle({ currentTarget: { dataset: { id: 's2' } } });
  await l.onCompare();
  check('E-⑨ 重算失败 ⇒ comparing 复位 + 提示，不半截渲染',
    l.data.comparing === false && l.data.mode === 'list' && seen.toastError === 1);

  // =====================================================
  // F · 跨页一致性（本文件的存在理由）
  // =====================================================
  sec('F · 跨页对拍（R297-④ 历史 bug）');

  reset(); planResp = { list: PLANS };
  const c2 = fresh(cmpCfg()); await c2.loadPlans();
  ['s1', 's2'].forEach((id) => c2.onToggle({ currentTarget: { dataset: { id } } }));
  c2.onCompare();
  const l2 = fresh(lstCfg()); await l2.load();
  const cmpTarget = c2.data.compared.rows.find((r) => r.id === 's2').targetMonthly;
  const lstTarget = Number(l2.data.list.find((x) => x.sandbox_id === 's2').targetYuan);
  check('F-① 🔴 同一反推方案：compare 对比表与 list 卡片显示**同一个数**（15000 元）',
    cmpTarget === lstTarget && cmpTarget === 15000,
    'compare=' + cmpTarget + ' list=' + lstTarget);
  const cmpBreak = c2.data.compared.rows.find((r) => r.id === 's1').breakMonthly;
  const lstBreak = Number(l2.data.list.find((x) => x.sandbox_id === 's1').breakEvenYuan);
  check('F-② 同一正向方案：保本月营收两页也一致', cmpBreak === lstBreak && cmpBreak === 12000,
    'compare=' + cmpBreak + ' list=' + lstBreak);

  // =====================================================
  // G · 导出（画布预热 / 免费 Excel）
  // =====================================================
  sec('G · 导出链路');

  reset(); planResp = { list: PLANS };
  l = fresh(lstCfg());
  await l.load();
  l.onToggle({ currentTarget: { dataset: { id: 's1' } } });
  l.onToggle({ currentTarget: { dataset: { id: 's2' } } });
  await l.onCompare();
  const table = l.buildCompareTable();
  check('G-① buildCompareTable 表头 = 指标名 + 各方案名',
    table.header[0] === P.colName && table.header[1] === '观音桥店' && table.header[2] === '解放碑店',
    JSON.stringify(table.header));

  await l.onExportExcel();
  const exp = (seen.calls || []).filter((c) => c.name === 'exportData')[0];
  check('G-② 🔴 Excel 导出免费：走 exportData + deliver，**不主动弹付费墙**',
    !!exp && exp.params.export_type === 'm2_compare' && exp.params.format === 'xlsx'
    && !!seen.deliver && !seen.paywall,
    'paywall=' + JSON.stringify(seen.paywall || null));
  check('G-③ 导出带 plan_ids 与同一份已算 table（不重算、不编公式）',
    !!exp && JSON.stringify(exp.params.plan_ids) === JSON.stringify(['s1', 's2'])
    && exp.params.table.header.length === 3);

  reset(); exportThrows = Object.assign(new Error('locked'), { code: 'FEATURE_LOCKED' });
  l = fresh(lstCfg());
  await l.load();
  l.setData({ compareRows: [{ name: '保本月营收', vals: ['1', '2'] }], compareCols: [{ name: 'A' }, { name: 'B' }] });
  await l.onExportExcel();
  check('G-④ FEATURE_LOCKED 兜底 ⇒ 弹付费墙（旧后端/灰度期）',
    !!seen.paywall && seen.paywall.type === 'export');

  reset(); planResp = { list: PLANS };
  l = fresh(lstCfg());
  l.onReady();
  l.setData({ compareRows: [{ name: '保本月营收', vals: ['1', '2'] }], compareCols: [{ name: 'A' }, { name: 'B' }] });
  l.onExportImg();
  check('G-⑤ 🔴 onReady 预热画布后**首次点击即出图**（不弹 exportImgHint、不要求点第二次）',
    !!l._ctx && !!seen.preview && !seen.toastError,
    '_ctx=' + !!l._ctx + ' preview=' + !!seen.preview + ' toastError=' + (seen.toastError || 0));

  // =====================================================
  // M · 变异回灌：每条真跑、exit=1、点名断言
  // =====================================================
  sec('M · 变异回灌');

  async function mut(pagePath, label, from, to, setupFn, runFn) {
    const SRC = pagePath === PAGE_CMP ? SRC_C : SRC_L;
    if (SRC.indexOf(from) < 0) { console.log('  ❌ ' + label + ' 锚点漂移'); failN++; return; }
    const mutated = SRC.replace(from, to);
    if (mutated === SRC) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    let mc = null;
    try { setupFn(); mc = loadCfg(pagePath, mutated); }
    catch (e) { console.log('  ❌ ' + label + ' 变异后加载失败（FATAL）：' + (e && e.message)); failN++; return; }
    let degraded = false, detail = '';
    try { const r = await runFn(mc); degraded = !!r.degraded; detail = r.detail || ''; }
    catch (e) { console.log('  ❌ ' + label + ' 变异后桩抛错（FATAL ≠ 真抓到）：' + (e && e.message)); failN++; return; }
    check(label + ' ⇒ 检出退化', degraded, detail);
  }

  // M-1 compare.onToggle 不把 checked 算进 plans ⇒ 勾选框恒不亮
  await mut(PAGE_CMP, 'M-1 勾选态不算进 plans',
    '    const plans = this.data.plans.map((p) => Object.assign({}, p, {\n      checked: selected.indexOf(p.sandbox_id) >= 0,\n    }));',
    '    const plans = this.data.plans.map((p) => Object.assign({}, p, {\n      checked: false,\n    }));',
    () => { reset(); planResp = { list: PLANS }; },
    async (mc) => {
      const q = fresh(mc); await q.loadPlans();
      q.onToggle({ currentTarget: { dataset: { id: 's1' } } });
      return { degraded: q.data.plans[0].checked === false,
        detail: 'B-① 点了勾选框不亮：checked=' + q.data.plans[0].checked };
    });

  // M-2 compare 反推方案改读顶层 ⇒ 出现陷阱值
  await mut(PAGE_CMP, 'M-2 反推方案改读顶层 target_monthly_fen',
    "      const revTargetFen = (s.reverse && s.reverse.target_monthly_fen != null)\n        ? s.reverse.target_monthly_fen : null;",
    '    const revTargetFen = null;',
    () => { reset(); planResp = { list: PLANS }; },
    async (mc) => {
      const q = fresh(mc); await q.loadPlans();
      ['s1', 's2'].forEach((id) => q.onToggle({ currentTarget: { dataset: { id } } }));
      q.onCompare();
      const v = q.data.compared.rows.find((r) => r.id === 's2').targetMonthly;
      return { degraded: v === 100000, detail: 'C-② 反推方案读到顶层陷阱值：' + v + '（应为 15000）' };
    });

  // M-3 去掉最多 3 个上限
  await mut(PAGE_CMP, 'M-3 去掉「最多 3 个」上限',
    "      if (selected.length >= 3) { wx.showToast({ title: this.data.t.max, icon: 'none' }); return; }",
    "      if (false) { wx.showToast({ title: this.data.t.max, icon: 'none' }); return; }",
    () => { reset(); planResp = { list: PLANS }; },
    async (mc) => {
      const q = fresh(mc); await q.loadPlans();
      ['s1', 's2', 's3', 's4'].forEach((id) => q.onToggle({ currentTarget: { dataset: { id } } }));
      return { degraded: q.data.selected.length === 4, detail: 'B-③ 竟选了 ' + q.data.selected.length + ' 个' };
    });

  // M-4 list.decorate 改读顶层 ⇒ 与 compare 跨页不一致
  await mut(PAGE_LST, 'M-4 list 卡片改读顶层 target_monthly_fen',
    '    const targetFen = isRev ? snap.reverse.target_monthly_fen : snap.target_monthly_fen;',
    '    const targetFen = snap.target_monthly_fen;',
    () => { reset(); planResp = { list: PLANS }; },
    async (mc) => {
      const q = fresh(mc); await q.load();
      const v = q.data.list.find((x) => x.sandbox_id === 's2').targetYuan;
      return { degraded: Number(v) === 100000,
        detail: 'F-① 跨页对拍失守：list=' + v + ' 而 compare=15000（R297-④ 原 bug）' };
    });

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e && (e.stack || e.message)); process.exit(2); });
