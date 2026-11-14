#!/usr/bin/env node
// tools/check_buffet_cost_entry.js —— 「自助线食材消耗」录入闭环守卫（R738）
//
// 【为什么要有】
//   R272 做自助餐人均食材成本时，文案写的是：
//     「待填写（在「设置」页填本月自助食材消耗）」
//     「请在「设置」页填写本月自助食材消耗总额（单位：分）」
//   而店铺设置页（subpkg/tools/shop/setting）**从来没有这个输入框** —— 全仓零写入入口。
//   后端 saveShopSetting 支持该键、getDishReview 也在读，唯独前端缺一段 UI ⇒
//   老板按提示去设置页只会扑空。这类缺陷有个共同特征：**它不报错、不崩、门禁全绿**，
//   因为没有任何断言要求「提示里指的那条路必须真的存在」。
//
// 【判据五层】
//   A · 接线点：页面有输入框 / 有保存按钮 / 两个方法真存在 / 后端出参带 total+时间
//   B · 行为面（真跑页面）：回显、元→分、脏输入、清空、失败不卡死
//   C · 后端纯函数：computeCoverage 回 foodCostTotalFen / foodCostUpdatedAt
//   D · 跨月提醒：该键是**店铺级单值**（不按月存）⇒ 录的月份 ≠ 统计月份必须提示
//   E · 变异回灌：把换算改坏、把跨月比较改坏 ⇒ 对应断言必须当场转红
//
// 【铁律】不看"注释里写了什么"，只真跑页面源码读 data / 真调生产函数。
//   用法：node tools/check_buffet_cost_entry.js

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');

const R = [];
let curGroup = '';
function group(name) { curGroup = name; }
function ck(name, pass, detail) { R.push({ group: curGroup, name, pass: !!pass, detail: detail || '' }); }

// ── 生产函数（后端口径的唯一真相源）──
const svc = require(F('cloudfunctions/getDishReview/service.js'));

// 自助线：100 份、营收 24,000.00 元（= 2,400,000 分）
const SALES = [{ dish_key: '自助餐', category: 'buffet', amount: 2400000, qty: 100 }];
const TS_NOV = new Date(2026, 10, 10, 12, 0, 0).getTime();   // 2026-11-10（本地时间，与页面同口径）
const TS_OCT = new Date(2026, 9, 10, 12, 0, 0).getTime();    // 2026-10-10

function buffetFixture(costFen, updatedAt) {
  const cov = svc.computeCoverage(SALES, new Set(), costFen, { updatedAt });
  return {
    tier: 'full',
    range: {},
    dine_in: [], unmatched: [], takeaway: null, mapping: [],
    totals: {},
    coverageA: cov.coverageA,
    coverageC: cov.coverageC,
    buffet: cov.buffet,
  };
}

// ── 页面真跑桩 ──
global.getApp = () => ({ globalData: { shop_id: 's1' }, setShopContext: () => {} });
global.wx = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, safeArea: { bottom: 667 } }),
  showToast: (o) => { seen.toast.push(o && o.title); },
  showModal: () => {}, hideLoading: () => {}, showLoading: () => {},
  navigateTo: () => {}, switchTab: () => {}, reLaunch: () => {}, redirectTo: () => {},
  setNavigationBarTitle: () => {},
  getCurrentPages: () => [{ route: 'pages/m3/dishreview/index' }],
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: (cb) => cb && cb([]) }) }) }),
  nextTick: (f) => f && f(), vibrateShort: () => {}, stopPullDownRefresh: () => {},
};

let reviewFixture = buffetFixture(null, 0);
let saveThrows = false;
const seen = { calls: [], toast: [], toastError: 0 };
const apiMod = require(F('utils/api.js'));
apiMod.call = async (name, params) => {
  seen.calls.push({ name, params });
  if (name === 'getDishReview') return reviewFixture;
  if (name === 'saveShopSetting') {
    if (saveThrows) { const e = new Error('mock fail'); e.code = 'SYSTEM_ERROR'; throw e; }
    return { ok: true };
  }
  if (name === 'getCostCard') return { cards: [], items: [] };
  return {};
};
apiMod.toastError = () => { seen.toastError += 1; };
apiMod.ensureShop = async () => {};

function reset() { seen.calls.length = 0; seen.toast.length = 0; seen.toastError = 0; saveThrows = false; }

const PAGE_ABS = F('pages/m3/dishreview/index.js');
const PAGE_SRC = read('pages/m3/dishreview/index.js');

function loadPage(src, month) {
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  const M = new Module(PAGE_ABS, module);
  M.filename = PAGE_ABS;
  M.paths = Module._nodeModulePaths(path.dirname(PAGE_ABS));
  M._compile(src, PAGE_ABS);
  if (!cfg) return null;
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p.data.month = month || '2026-11';
  return p;
}

async function runPage(fix, month, src) {
  reviewFixture = fix;
  const p = loadPage(src || PAGE_SRC, month);
  await p.load();
  return p;
}

(async () => {
  // ================================================================
  group('A · 接线点（提示指的路必须真的存在）');
  // ================================================================
  const wxml = read('pages/m3/dishreview/index.wxml');
  const js = read('pages/m3/dishreview/index.js');
  ck('A-① 复核页有数字输入框并绑定 onBuffetCostInput',
    /<input[^>]*bindinput="onBuffetCostInput"/.test(wxml), '');
  ck('A-② 有保存按钮绑定 onSaveBuffetCost',
    /<(button)[^>]*catchtap="onSaveBuffetCost"|<button[^>]*bindtap="onSaveBuffetCost"/.test(wxml), '');
  ck('A-③ 两个方法在页面里真存在（不是只在 wxml 里挂个名字）',
    /onBuffetCostInput\s*\(/.test(js) && /async\s+onSaveBuffetCost\s*\(/.test(js), '');
  ck('A-④ 保存走 saveShopSetting 且带 buffet_food_cost_total + 幂等键',
    /saveShopSetting[\s\S]{0,160}?buffet_food_cost_total/.test(js)
    && /client_request_id:\s*'bc_'\s*\+\s*Date\.now\(\)/.test(js), '');
  // 死指路的**反面**判据：术语值不许再把老板指去「设置」页（那里没有这个输入框）
  const TERMS = require(F('miniprogram/i18n/terms.js')).TERMS;
  ck('A-⑤ 文案不再指路到「设置」页（设置页没有该输入框 ⇒ 那是指向空地的提示）',
    String(TERMS.card.reviewBuffetNoCost).indexOf('设置') < 0
    && String(TERMS.card.reviewBuffetHint).indexOf('设置') < 0,
    `noCost「${TERMS.card.reviewBuffetNoCost}」`);
  ck('A-⑥ 后端出参带「已填总额 + 录入时间」（否则输入框无法回显、跨月无法提醒）',
    /foodCostTotalFen/.test(read('cloudfunctions/getDishReview/service.js'))
    && /foodCostUpdatedAt/.test(read('cloudfunctions/getDishReview/service.js'))
    && /updatedAt:\s*buffetFoodCostUpdatedAt/.test(read('cloudfunctions/getDishReview/index.js')), '');

  // ================================================================
  group('B · 行为面（真跑页面）');
  // ================================================================
  reset();
  const filled = await runPage(buffetFixture(2400000, TS_NOV));
  ck('B-① 已填 ⇒ 输入框回显 240000.00 分对应的「24000.00」元',
    String(filled.data.buffetCostYuan) === '24000.00', `实得「${filled.data.buffetCostYuan}」`);

  reset();
  const empty = await runPage(buffetFixture(null, 0));
  ck('B-② 未填 ⇒ 输入框为空且 hasCostInput=false（不要把 null 显示成 0.00）',
    String(empty.data.buffetCostYuan) === '' && empty.data.buffet_hasCostInput === false,
    `值「${empty.data.buffetCostYuan}」hasCostInput=${empty.data.buffet_hasCostInput}`);

  reset();
  let p = await runPage(buffetFixture(null, 0));
  p.setData({ buffetCostYuan: '24000' });
  await p.onSaveBuffetCost();
  let call = seen.calls.filter((c) => c.name === 'saveShopSetting').pop();
  ck('B-③ 填 24000 元 ⇒ 提交 2400000 分（整数分入库；单位算错 100 倍是这里最容易犯的错）',
    !!call && call.params.buffet_food_cost_total === 2400000,
    call ? String(call.params.buffet_food_cost_total) : '未调用');

  reset();
  p = await runPage(buffetFixture(null, 0));
  p.setData({ buffetCostYuan: '0.07' });
  await p.onSaveBuffetCost();
  call = seen.calls.filter((c) => c.name === 'saveShopSetting').pop();
  ck('B-④ 填 0.07 元 ⇒ 提交 7 分（十进制安全形态；朴素 * 100 会出 7.000000000000001）',
    !!call && call.params.buffet_food_cost_total === 7,
    call ? String(call.params.buffet_food_cost_total) : '未调用');

  reset();
  p = await runPage(buffetFixture(null, 0));
  p.setData({ buffetCostYuan: '-5' });
  await p.onSaveBuffetCost();
  ck('B-⑤ 填负数 ⇒ 不发请求，只提示（脏输入不许出门）',
    seen.calls.filter((c) => c.name === 'saveShopSetting').length === 0 && seen.toast.length === 1,
    `调用 ${seen.calls.filter((c) => c.name === 'saveShopSetting').length} 次 / toast ${JSON.stringify(seen.toast)}`);

  reset();
  p = await runPage(buffetFixture(2400000, TS_NOV));
  p.setData({ buffetCostYuan: '' });
  await p.onSaveBuffetCost();
  call = seen.calls.filter((c) => c.name === 'saveShopSetting').pop();
  ck('B-⑥ 清空输入再保存 ⇒ 传 null（后端据此删行 = 撤销这个数，与"填 0"区分开）',
    !!call && call.params.buffet_food_cost_total === null,
    call ? JSON.stringify(call.params.buffet_food_cost_total) : '未调用');

  reset();
  saveThrows = true;
  p = await runPage(buffetFixture(null, 0));
  p.setData({ buffetCostYuan: '100' });
  await p.onSaveBuffetCost();
  ck('B-⑦ 保存失败 ⇒ toastError 且 saving 复位（按钮不许卡在禁用态）',
    seen.toastError === 1 && p.data.buffetCostSaving === false,
    `toastError=${seen.toastError} saving=${p.data.buffetCostSaving}`);

  // ================================================================
  group('C · 后端纯函数（出参口径）');
  // ================================================================
  const covFilled = svc.computeCoverage(SALES, new Set(), 2400000, { updatedAt: TS_NOV });
  ck('C-① 已填 ⇒ buffet.foodCostTotalFen = 2400000、foodCostUpdatedAt 原样回传',
    covFilled.buffet.foodCostTotalFen === 2400000 && covFilled.buffet.foodCostUpdatedAt === TS_NOV,
    `${covFilled.buffet.foodCostTotalFen} / ${covFilled.buffet.foodCostUpdatedAt}`);
  const covEmpty = svc.computeCoverage(SALES, new Set(), null, { updatedAt: 0 });
  ck('C-② 未填 ⇒ foodCostTotalFen = null（不是 0 —— 0 会被当成"填了 0 元"）',
    covEmpty.buffet.foodCostTotalFen === null, String(covEmpty.buffet.foodCostTotalFen));
  ck('C-③ 人均成本口径未被我改动：2,400,000 ÷ 100 份 = 24,000 分/人',
    covFilled.buffet.perCapitaCostFen === 24000, String(covFilled.buffet.perCapitaCostFen));
  // 🔴 首次填写走的是 insert 分支：**必须带 updated_at** —— 否则这一行永远没有录入时间，
  //   「跨月提醒」（D-①）在第一次填写之后就永远不触发（最该提醒的那批数据恰好是它）。
  const sss = stripComments(read('cloudfunctions/saveShopSetting/index.js'));
  ck('C-④ 首次写入该键的 insert 带 updated_at（无时间 ⇒ 跨月提醒永远不触发）',
    /insert\('shop_switch',\s*\{[^}]*value:\s*v\.buffet_food_cost_total[^}]*updated_at:/.test(sss), '');

  // ================================================================
  group('D · 跨月提醒（店铺级单值 vs 按月统计）');
  // ================================================================
  const stale = await runPage(buffetFixture(2400000, TS_OCT), '2026-11');
  ck('D-① 录的月份(2026-10) ≠ 统计月份(2026-11) ⇒ 提示"请按本月实际更新"',
    stale.data.buffetCostStale === true, `stale=${stale.data.buffetCostStale}`);
  const fresh = await runPage(buffetFixture(2400000, TS_NOV), '2026-11');
  ck('D-② 【对照】同月录入 ⇒ 不提示（证明 D-① 不是恒真）',
    fresh.data.buffetCostStale === false, `stale=${fresh.data.buffetCostStale}`);
  ck('D-③ 已录时显示「已录 ¥X（YYYY-MM-DD）」——录入时间必须让老板看得见',
    String(fresh.data.buffetCostRecordedText).indexOf('24000.00') >= 0
    && String(fresh.data.buffetCostRecordedText).indexOf('2026-11-10') >= 0,
    `「${fresh.data.buffetCostRecordedText}」`);

  // ================================================================
  group('E · 变异回灌（改坏实现，断言必须转红）');
  // ================================================================
  const ANCHOR_CONV = 'fen = Math.round(Number((num * 100).toFixed(10)));';
  const ANCHOR_STALE = "const buffetCostStale = !!(buffetCostFen > 0 && _recAt > 0 && _ymOf(_recAt) !== String(this.data.month || ''));";
  ck('E-⓪ 两个变异锚点在当前源码中都存在（锚点漂移会让下面两条恒绿）',
    js.indexOf(ANCHOR_CONV) >= 0 && js.indexOf(ANCHOR_STALE) >= 0, '锚点在位');

  {
    const mutSrc = PAGE_SRC.replace(ANCHOR_CONV, 'fen = Math.round(Number(raw));');
    reset();
    const mp = await runPage(buffetFixture(null, 0), '2026-11', mutSrc);
    mp.setData({ buffetCostYuan: '24000' });
    await mp.onSaveBuffetCost();
    const mc = seen.calls.filter((c) => c.name === 'saveShopSetting').pop();
    const degraded = !mc || mc.params.buffet_food_cost_total !== 2400000;
    ck('E-① 变异：去掉「元→分」换算 ⇒ B-③ 当场转红（证明 B-③ 真在测换算，不是恒真）',
      degraded, `变异后提交 ${mc ? mc.params.buffet_food_cost_total : '未调用'}（期望 ≠ 2400000）`);
  }
  {
    const mutSrc = PAGE_SRC.replace(ANCHOR_STALE, 'const buffetCostStale = false;');
    const mp = await runPage(buffetFixture(2400000, TS_OCT), '2026-11', mutSrc);
    ck('E-② 变异：跨月比较恒 false ⇒ D-① 当场转红',
      mp.data.buffetCostStale === false, `变异后 stale=${mp.data.buffetCostStale}（期望 false = 该提醒消失了）`);
  }

  // ================================================================
  group('F · 自失效护栏');
  // ================================================================
  ck('F-① 断言总数 ≥ 18（防本文件被掏空后仍报「全绿」）', R.length >= 18, String(R.length));
  ck('F-② 页面源码里确有 t 映射（漏映射 ⇒ 真机静默空白，check_page_terms 判据②同源）',
    /reviewBuffetCostLabel:\s*TERMS\.card\.reviewBuffetCostLabel/.test(js)
    && /reviewBuffetCostSave:\s*TERMS\.card\.reviewBuffetCostSave/.test(js), '');

  // ================================================================
  // 汇总
  // ================================================================
  let pass = 0, fail = 0;
  let g = '';
  for (const r of R) {
    if (r.group !== g) { g = r.group; console.log('\n' + g); }
    if (r.pass) { pass += 1; console.log('  ✅ ' + r.name + (r.detail ? '  (' + r.detail + ')' : '')); }
    else { fail += 1; console.log('  ❌ ' + r.name + (r.detail ? '  (' + r.detail + ')' : '')); }
  }
  console.log(`\n===== 自助线食材消耗录入守卫结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('守卫自身异常：', e && e.stack || e);
  process.exit(2);
});
