#!/usr/bin/env node
// tools/check_recon_page_behavior.js —— M3 对账页（subpkg/tools/recon）行为桩守卫
//
// 为什么必须有：对账页承载 A（覆盖率无上界）/ B（时间截面）/ R298X（抑制文案串味）三代口径问题，
//   却是核心页里唯一没有页面桩行为断言的（11-12 发现 D）。静态守卫只证「代码里有没有这句」，
//   证不了「calc() 真跑时会不会把错数放出去」。本守卫在 node 内 require **真实页面源码**，
//   桩掉依赖，真跑 calc()，钉住从入参到 result 的整条链。
//
// 取证层级：L2 页面桩（页面源码真跑，依赖全桩）。不替代真机渲染。
// 运行：node tools/check_recon_page_behavior.js

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/tools/recon/index.js');
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 可变量 ----------
let cfg = null;
let ledgerResp = {}, cardsResp = { list: [] }, contextResp = {}, reviewResp = {}, monthListResp = { list: [] };
let seen = {};

const mockApi = {
  ensureShop: async () => ({ shop_id: 'shop_test' }),
  call: async (name) => {
    if (name === 'getLedger') return ledgerResp;
    if (name === 'getCostCard') return cardsResp;
    if (name === 'getShopContext') return contextResp;
    if (name === 'getMonthList') return monthListResp;
    if (name === 'getDishReview') return reviewResp;
    return {};
  },
  fenToYuan: (fen, digits) => ((Number(fen) || 0) / 100).toFixed(digits === undefined ? 2 : digits),
  toastError: (e) => { seen.toastErr = (seen.toastErr || 0) + 1; seen.lastErr = e && (e.msg || e.message); },
};
const mockUi = {
  setTitle: (t) => { seen.title = t; },
  nowMonth: () => '2026-08',
  recentMonths: () => ['2026-08', '2026-07'],
  monthRange: (m) => ({ from: m + '-01', to: m + '-31' }),
};
const MOCKS = {
  '../../../utils/api.js': mockApi,
  '../../../utils/ui.js': mockUi,
  '../../../miniprogram/i18n/terms.js': { TERMS },
};
function makeRequire(baseDir) {
  return function (req) {
    if (Object.prototype.hasOwnProperty.call(MOCKS, req)) return MOCKS[req];
    if (req[0] === '.') return require(path.resolve(baseDir, req));
    return require(req);
  };
}
global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
global.wx = { showToast: (o) => { seen.toast = o; }, navigateTo: (o) => { seen.nav = o; } };

const PAGE_DIR = path.dirname(PAGE);
const fakeRequire = makeRequire(PAGE_DIR);
const origSrc = fs.readFileSync(PAGE, 'utf8');

function loadPage(src) {
  cfg = null;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
    mod, mod.exports, fakeRequire, PAGE_DIR, PAGE);
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  return p;
}

// 造成本：3 张卡 60% 毛利；账本实际 60%。coverage 分母由 savedCount 控。
function cards(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push({ card_type: 1, price_fen: 10000, total_cost_fen: 4000 });
  return { list };
}
const LEDGER_OK = { income_items: [{ category: 'dine_in', amount_fen: 900000 }],
  result: { material_cost_fen: 360000 } };   // 实际毛利 = (90万−36万)/90万 = 60%

async function runCalc(p, month, savedCount) { await p.calc(month, savedCount); return p.data.result; }

(async () => {
  sec('S 判据本体：页面源码可加载、handler 齐全');
  const p0 = loadPage(origSrc);
  check('S-① 真实页面源码可 require 且 Page 配置捕获', !!p0 && typeof p0.calc === 'function');
  check('S-② 关键 handler 在场（calc/onMonthChange/onIncludeCombo/onSaveCount）',
    ['calc', 'onMonthChange', 'onIncludeCombo', 'onSaveCount', 'goFix'].every((k) => typeof p0[k] === 'function'));
  check('S-③ 文案键 reconMenuPriceNote 绑定单源（不是硬编码）',
    /reconMenuPriceNote:\s*TERMS\.card\.reconMenuPriceNote/.test(origSrc));

  sec('A 覆盖率上界（我方修的真缺口）');
  cardsResp = cards(100); ledgerResp = LEDGER_OK; reviewResp = {};
  let r = await runCalc(loadPage(origSrc), '2026-08', 30);   // coverage=100/30=3.33
  check('A-① coverage=3.33 ⇒ 抑制（上界挡住）', r.suppressed === true && r.reason === 'coverage_high',
    'reason=' + r.reason);
  check('A-② 抑制时差值/金额一律 null（不把错数放出去）',
    r.diffPp === null && r.diffFen === null && r.diffPpText === '—');
  check('A-③ 文案走专属键 reconSuppressCoverageHigh（不串到"覆盖率不足"）',
    r.suppressText === TERMS.card.reconSuppressCoverageHigh && r.suppressText !== TERMS.card.reconSuppressCoverage,
    r.suppressText && r.suppressText.slice(0, 30));
  r = await runCalc(loadPage(origSrc), '2026-08', 15);       // coverage=100/15=6.67
  check('A-④ 更极端 coverage 也抑制', r.suppressed === true && r.reason === 'coverage_high');
  r = await runCalc(loadPage(origSrc), '2026-08', 0);        // 未填在售数 ⇒ null
  check('A-⑤ 在售数=0 ⇒ coverage null ⇒ coverage_missing 抑制', r.suppressed === true && r.reason === 'coverage_missing');

  sec('B 合法区间与改价场景');
  cardsResp = cards(30); ledgerResp = LEDGER_OK;            // coverage=1
  r = await runCalc(loadPage(origSrc), '2026-08', 30);
  check('B-① coverage=1 合法不抑制（上界是 >1 不是 ≥1）', r.suppressed === false && r.reason === '',
    'diffPp=' + r.diffPp);
  check('B-② 合法时差值可算（60−60=0）', r.diffPp === 0 && r.diffPpText === '0.00 pp');
  check('B-③ B 的时间截面说明文案含"今天的成本/当时的成本"关键语义（防回归）',
    /今天的成本/.test(TERMS.card.reconMenuPriceNote) && /当时的成本/.test(TERMS.card.reconMenuPriceNote));

  sec('C 套餐排除与四舍五入边界');
  cardsResp = { list: [{ card_type: 3, price_fen: 10000, total_cost_fen: 1000 },
                       { card_type: 1, price_fen: 10000, total_cost_fen: 4000 }] };
  r = await runCalc(loadPage(origSrc), '2026-08', 1);        // 套餐不算独立菜品 ⇒ cardCount=1, coverage=1
  check('C-① 套餐卡不计入 cardCount（coverage=1/1 而非 2/1）', r.coverage === 1 && r.suppressed === false,
    'coverage=' + r.coverage);

  sec('F 变异回灌：把上界判据改坏，守卫必须转红');
  const broken = origSrc; // 页面源码本身不含判据（在 reconDerive），故这里变异"接线"：把 reconcile 调用改成恒放行
  const MUT_TARGET = 'const rec = reconcile({ menuPct: menu.pct, actualPct: actual.pct, coverage, incomeFen: actual.income_fen });';
  const MUT_BROKEN = 'const rec = { suppressed:false, menuPct:menu.pct, actualPct:actual.pct, diffPp:0, diffFen:0, reason:"", coverage };';
  if (!broken.includes(MUT_TARGET)) {
    check('F-① 变异靶点在页面源码中存在（否则变异无效）', false, '靶点未找到');
  } else {
    const mutSrc = broken.replace(MUT_TARGET, MUT_BROKEN);
    const pm = loadPage(mutSrc);
    cardsResp = cards(100); ledgerResp = LEDGER_OK;
    const rm = await runCalc(pm, '2026-08', 30);
    check('F-① 变异体（永远放行）在 A-① 判据下必须转红', rm.suppressed === false,
      '变异体 suppressed=' + rm.suppressed);
    // 还原态复核
    const rr = await runCalc(loadPage(origSrc), '2026-08', 30);
    check('F-② 原始源码仍正确抑制（变异不污染）', rr.suppressed === true && rr.reason === 'coverage_high');
  }

  console.log('\n===== 对账页行为桩结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => {
  console.error('桩运行异常:', e && (e.stack || e.message || e));
  process.exit(1);
});
