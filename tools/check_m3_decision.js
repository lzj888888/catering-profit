// tools/check_m3_decision.js —— M3 利润决策台守卫（R615 · 2026-11-07）
//
// 守什么：`utils/m3Decision.js` 把复盘出参组织成「该动哪道菜」的那套判据，
//   以及复盘页接线、术语登记、免费档降级、数据不足 fail-closed。
//
// 为什么必须守：这套判据的核心是**分界线用本店中位数**、**亏损必判低**、**免费档绝不凑毛利**。
//   三条任意一条被改坏，老板都会拿到一个「看着像结论、其实是错的」清单 —— 而页面不会报错。
//
// 判行为不判字面：数字全部来自生产纯函数真跑（合成 12 道菜样本），不 grep 注释。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const D = require(P('utils/m3Decision.js'));
const DEC_SRC = fs.readFileSync(P('utils/m3Decision.js'), 'utf8');
const PAGE_JS = fs.readFileSync(P('pages/m3/dishreview/index.js'), 'utf8');
const PAGE_WXML = fs.readFileSync(P('pages/m3/dishreview/index.wxml'), 'utf8');
const TERMS_SRC = fs.readFileSync(P('miniprogram/i18n/terms.js'), 'utf8');

const Y = (n) => Math.round(n * 100);

// ===== A 接线与文案 =====
console.log('===== A 接线 / 登记 / 合规 =====');
ok('A-① 四个纯函数都导出', ['buildDishDecision', 'buildComboDecision', 'buildTakeawayWaterfall', 'projectCostRise']
  .every((k) => typeof D[k] === 'function'));
ok('A-② 复盘页 require 决策模块且 data 顶层有 decision（防顶层绑定静默空白）',
  /require\('\.\.\/\.\.\/\.\.\/utils\/m3Decision\.js'\)/.test(PAGE_JS)
  && /^\s{4}decision: null,/m.test(PAGE_JS));
ok('A-③ wxml 真渲染 decision.actions / medianLine / insufficientText',
  /\{\{decision\.actions\}\}/.test(PAGE_WXML) && /\{\{decision\.medianLine\}\}/.test(PAGE_WXML)
  && /\{\{decision\.insufficientText\}\}/.test(PAGE_WXML));
ok('A-④ 页面 t:{} 登记了全部 16 个 dec* 键（漏登记 ⇒ 静默空白）', (() => {
  const keys = ['decTitle', 'decSub', 'decMedianLine', 'decKindCut', 'decKindRaise', 'decKindBundle',
    'decKindPush', 'decCutText', 'decRaiseText', 'decBundleText', 'decPushText',
    'decInsFew', 'decInsCoverage', 'decInsNoDishes', 'decInsNoMargin', 'decFreeNote'];
  const miss = keys.filter((k) => !new RegExp('^\\s*' + k + ': TERMS\\.card\\.' + k + ',', 'm').test(PAGE_JS));
  return miss.length === 0;
})());
ok('A-⑤ terms 双副本 md5 一致', fs.readFileSync(P('miniprogram/i18n/terms.js'))
  .equals(fs.readFileSync(P('specs/dev-specs/i18n/terms.js'))));
ok('A-⑥ 决策文案不含行业档位词（D14：不贴明星/瘦狗/金牛/问题菜）',
  ['明星', '瘦狗', '金牛', '问题菜'].every((w) => !new RegExp('dec\\w*: \'[^\']*' + w).test(TERMS_SRC)));
ok('A-⑦ 免费档分支不产出毛利结论（不产 gainFen、不调 marginOf；允许 grossFen:null 占位）', (() => {
  const i = DEC_SRC.indexOf("if (tier === 'free')");
  const j = DEC_SRC.indexOf('// ---- 付费档', i);
  const seg = i >= 0 && j > i ? DEC_SRC.slice(i, j) : '';
  return seg.length > 0 && seg.indexOf('gainFen:') < 0 && seg.indexOf('marginOf(') < 0;
})());
ok('A-⑧ 外卖页接了瀑布：require 决策模块 + onCalc 里算 waterfall + 两个术语键已登记',
  /const M3D = require\('\.\.\/\.\.\/\.\.\/utils\/m3Decision\.js'\)/.test(fs.readFileSync(P('subpkg/biz/takeaway/index.js'), 'utf8'))
  && /M3D\.buildTakeawayWaterfall\(result\.cash\)/.test(fs.readFileSync(P('subpkg/biz/takeaway/index.js'), 'utf8'))
  && /wfTitle: TK\.wfTitle/.test(fs.readFileSync(P('subpkg/biz/takeaway/index.js'), 'utf8')));
ok('A-⑨ 外卖 wxml 真渲染瀑布条（分段宽度 = 各项占比，含到手段）',
  /\{\{view\.waterfall\.items\}\}/.test(fs.readFileSync(P('subpkg/biz/takeaway/index.wxml'), 'utf8'))
  && /wf-\{\{item\.key\}\}/.test(fs.readFileSync(P('subpkg/biz/takeaway/index.wxml'), 'utf8'))
  && /wf-receipt/.test(fs.readFileSync(P('subpkg/biz/takeaway/index.wxml'), 'utf8')));
ok('A-⑩ 涨价影响面有「每 100 份毛利少」（值由成本差×100 算出，不是手写文案）',
  /hundred_delta: api\.fenToYuan\(\(a\.new_total_cost_fen - a\.old_total_cost_fen\) \* 100, 2\)/
    .test(fs.readFileSync(P('subpkg/tools/metrics/impact.js'), 'utf8'))
  && /\{\{item\.hundred_delta\}\}/.test(fs.readFileSync(P('subpkg/tools/metrics/impact.wxml'), 'utf8')));

// ===== B 纯函数真跑（合成 12 道菜：四格各 3 道）=====
console.log('===== B 判据真跑 =====');
const rows = [
  { name: '招牌牛肉面', qty: 300, amountFen: Y(6000), totalCostFen: Y(2100), grossFen: Y(3900) },
  { name: '酸辣粉', qty: 280, amountFen: Y(4200), totalCostFen: Y(1960), grossFen: Y(2240) },
  { name: '小面', qty: 260, amountFen: Y(3120), totalCostFen: Y(1560), grossFen: Y(1560) },
  { name: '炸酱面', qty: 240, amountFen: Y(4320), totalCostFen: Y(3600), grossFen: Y(720) },
  { name: '肥肠面', qty: 220, amountFen: Y(4840), totalCostFen: Y(4180), grossFen: Y(660) },
  { name: '豌杂面', qty: 200, amountFen: Y(3600), totalCostFen: Y(3200), grossFen: Y(400) },
  { name: '现磨豆浆', qty: 40, amountFen: Y(400), totalCostFen: Y(120), grossFen: Y(280) },
  { name: '卤蛋', qty: 35, amountFen: Y(175), totalCostFen: Y(70), grossFen: Y(105) },
  { name: '凉拌黄瓜', qty: 30, amountFen: Y(360), totalCostFen: Y(120), grossFen: Y(240) },
  { name: '豪华套餐', qty: 20, amountFen: Y(1600), totalCostFen: Y(1900), grossFen: Y(-300) },
  { name: '双人套餐', qty: 15, amountFen: Y(1050), totalCostFen: Y(1250), grossFen: Y(-200) },
  { name: '儿童餐', qty: 10, amountFen: Y(600), totalCostFen: Y(700), grossFen: Y(-100) },
];
const full = D.buildDishDecision({ rows, unmatchedAmountFen: Y(2000), tier: 'full' });
ok('B-① 12 道样本出结论，覆盖率 93.8%', full.ok === true && full.coveragePct === 93.8,
  `ok=${full.ok} cov=${full.coveragePct}`);
const cells = {};
full.quadrant.forEach((q) => { cells[q.cell] = (cells[q.cell] || 0) + 1; });
ok('B-② 四格各 3 道（分类没偏）',
  cells.many_high === 3 && cells.many_low === 3 && cells.few_high === 3 && cells.few_low === 3,
  JSON.stringify(cells));
ok('B-③ 分界线用本店中位数：销量中位 120、毛利率中位 33.4%',
  full.medianQty === 120 && full.medianMarginPct === 33.4,
  `${full.medianQty} / ${full.medianMarginPct}`);
ok('B-④ 排序先砍在亏的（3 条 cut，按亏损降序 300/200/100）',
  full.actions.slice(0, 3).every((a) => a.kind === 'cut')
  && full.actions[0].lossFen === Y(300) && full.actions[1].lossFen === Y(200) && full.actions[2].lossFen === Y(100),
  full.actions.map((a) => a.kind + ':' + (a.lossFen || a.gainFen || a.grossFen)).join(','));
ok('B-⑤ 提价收益可独立复算：肥肠面 = 4840×33.4% − 660 = 956.56 元',
  full.actions.some((a) => a.kind === 'raise' && a.gainFen === Math.round(Y(4840) * 33.4 / 100) - Y(660)),
  (full.actions.find((a) => a.kind === 'raise') || {}).gainFen);
ok('B-⑥ 亏损菜绝不会被判「高毛利」（炸酱面 16.7% 落 many_low）',
  full.quadrant.find((q) => q.name === '炸酱面').cell === 'many_low'
  && full.quadrant.find((q) => q.name === '豪华套餐').cell === 'few_low');

const free = D.buildDishDecision({ rows, unmatchedAmountFen: Y(2000), tier: 'free' });
ok('B-⑦ 免费档只出 top_sales，且零毛利字段',
  free.actions.length > 0 && free.actions.every((a) => a.kind === 'top_sales'
    && a.gainFen === undefined && a.grossFen === undefined));

const few = D.buildDishDecision({ rows: rows.slice(0, 9), unmatchedAmountFen: Y(100), tier: 'full' });
ok('B-⑧ 9 道 ⇒ fail-closed（few_dishes，不给动作）',
  few.insufficient === true && few.reason === 'few_dishes' && few.actions.length === 0);
const lowCov = D.buildDishDecision({ rows, unmatchedAmountFen: Y(30000), tier: 'full' });
ok('B-⑨ 覆盖率 <60% ⇒ fail-closed（low_coverage，不给动作）',
  lowCov.insufficient === true && lowCov.reason === 'low_coverage' && lowCov.coveragePct < 60,
  `cov=${lowCov.coveragePct}`);

const wf = D.buildTakeawayWaterfall({
  payment_fen: Y(100), commission_fen: Y(6), delivery_fee_fen: Y(5), delivery_subsidy_fen: Y(2),
  subsidy_merchant_fen: Y(8), promo_fen: Y(3), receipt_fen: Y(76), profit_fen: Y(13),
});
const sumPct = wf.items.reduce((s, i) => s + i.pct, 0);
ok('B-⑩ 外卖瀑布：各项占比 + 到手率 = 100%（一位小数不失真）',
  Math.abs(sumPct + wf.receiptRatePct - 100) < 0.05 && wf.receiptRatePct === 76,
  `${sumPct} + ${wf.receiptRatePct}`);
ok('B-⑪ 临界点 = 到手利润 ÷ 顾客实付 = 13%',
  wf.breakEvenDropPct === 13, String(wf.breakEvenDropPct));

const combos = D.buildComboDecision([
  { name: 'B 套餐', merchantLoseFen: Y(-3) }, { name: 'A 套餐', merchantLoseFen: Y(6) },
]);
ok('B-⑫ 套餐按「少赚」降序，且 kind 正确',
  combos[0].name === 'A 套餐' && combos[0].kind === 'raise' && combos[1].kind === 'push');

const pr = D.projectCostRise(rows, 10);
ok('B-⑬ 涨价 10%：每道成本增量 = round(成本×10%)，合计可复算',
  pr.rows[0].costDeltaFen === Math.round(Y(2100) * 0.1)
  && pr.totalDeltaFen === pr.rows.reduce((s, r) => s + r.costDeltaFen, 0),
  `total=${pr.totalDeltaFen}`);

console.log(`\n===== M3 决策台守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
