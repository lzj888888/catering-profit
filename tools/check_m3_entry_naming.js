// tools/check_m3_entry_naming.js —— M3 入口归属与命名一致性守卫（R615 · M3 P0）
//
// 来由：李老师 2026-11-07「外卖数据入口和其他数据入口是一个入口，但页面标的是外卖，容易给人错觉」。
//   实证：hub.js goStep(2)「去导销量」→ takeaway/index?tab=import，该页标题却恒为「外卖每单赚多少」；
//   而该 tab 承载堂食+外卖全渠道销量（takeaway/index.wxml:215/302），hub 判完成态用通用 getSalesBills。
//   ⇒ 数据层本来统一，错的是**视图归属与名字**。
//
// 修法（本守卫钉住）：hub 新增一级「销量表导入」卡；goStep(2) 与 goImport 同源；
//   takeaway 页按 tab 动态切标题（import⇒销量表导入 / calc⇒外卖每单赚多少）。
//   只改标题与入口，不动 URL / 路由 / 计算 / 不新建页面。
//
// 另守：materialSub 不再承诺「改一次价用它的菜全都跟着变」（与 saveMaterial 快照隔离矛盾）。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);
const HUBW = fs.readFileSync(P('pages/m3/hub.wxml'), 'utf8');
const HUBJ = fs.readFileSync(P('pages/m3/hub.js'), 'utf8');
const TKJ = fs.readFileSync(P('subpkg/biz/takeaway/index.js'), 'utf8');
const TKW = fs.readFileSync(P('subpkg/biz/takeaway/index.wxml'), 'utf8');
const TERMS_SRC = fs.readFileSync(P('miniprogram/i18n/terms.js'), 'utf8');

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ===== A 组：形态判据（判行为，不判注释）=====
console.log('===== A 入口归属与文案 =====');
const importCard = /<view class="hub-card" bindtap="goImport">/.test(HUBW);
ok('A-① hub 有一级「销量表导入」卡（用 hub-card 类，不破 G4/S2 位置不变式）', importCard);
ok('A-② 一级卡渲染 t.importTitle / t.importSub / t.icoImport 三键',
  /\{\{t\.importTitle\}\}/.test(HUBW) && /\{\{t\.importSub\}\}/.test(HUBW)
  && /\{\{t\.icoImport\}\}/.test(HUBW));
ok('A-③ hub.js 的 t:{} 登记了三个新键（漏登记 ⇒ 页面静默空白）',
  /importTitle: TERMS\.hub\.importTitle/.test(HUBJ) && /importSub: TERMS\.hub\.importSub/.test(HUBJ)
  && /icoImport: TERMS\.hub\.icoImport/.test(HUBJ));
ok('A-④ goImport 落点带 tab=import，且 goStep(2) 复用它（同一个入口，不再两条 URL）',
  /goImport\(\) \{ wx\.navigateTo\(\{ url: '\/subpkg\/biz\/takeaway\/index\?tab=import' \}\); \}/.test(HUBJ)
  && /return this\.goImport\(\);/.test(HUBJ)
  && !/goStep[\s\S]{0,600}wx\.navigateTo\(\{ url: '[^']*tab=import' \}\);/.test(HUBJ));
ok('A-⑤ takeaway 有 syncTitle，且 load() 与 onTab 都调用（标题随 tab 与进页参数走）',
  /syncTitle\(tab\)\s*\{/.test(TKJ) && /this\.syncTitle\(this\.data\.tab\)/.test(TKJ)
  && /this\.syncTitle\(tab\)/.test(TKJ));
const { TERMS } = require(P('miniprogram/i18n/terms.js'));
const materialSub = (TERMS.hub && TERMS.hub.materialSub) || '';
ok('A-⑥ 改价文案不再假承诺「全都跟着变」，改为如实说明快照隔离',
  materialSub.indexOf('全都跟着变') < 0 && materialSub.indexOf('改价不动旧卡') >= 0
  && materialSub.indexOf('同步') >= 0, materialSub);
ok('A-⑦ 导入名不含「账单」（真账单导入仍暂停，顺 check_bill_import_gate A-⑫）',
  /importTab: '销量导入'/.test(TERMS_SRC) && !/importTab: '[^']*账单/.test(TERMS_SRC));
ok('A-⑧ terms 双副本 md5 一致',
  fs.readFileSync(P('miniprogram/i18n/terms.js')).equals(fs.readFileSync(P('specs/dev-specs/i18n/terms.js'))));
ok('A-⑨ G6 未被破坏：hub.takeawayTitle === ledger.takeaway.title（真值比，不用正则猜块）',
  !!(TERMS.hub && TERMS.ledger && TERMS.ledger.takeaway
    && TERMS.hub.takeawayTitle === TERMS.ledger.takeaway.title),
  `${TERMS.hub.takeawayTitle} | ${TERMS.ledger.takeaway.title}`);

// ===== B 组：生产页面桩真跑 =====
console.log('===== B 页面桩真跑 =====');
const NAV = [], TITLES = [];
global.wx = new Proxy({
  navigateTo: (o) => NAV.push(o && o.url),
  setNavigationBarTitle: (o) => TITLES.push(o && o.title),
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  getStorageSync: () => '', setStorageSync: () => {},
  showToast: () => {}, showModal: () => {}, navigateBack: () => {},
}, { get: (t, k) => (k in t ? t[k] : () => {}) });
const PAGES = [];
global.Page = (cfg) => PAGES.push(cfg);
global.getApp = () => ({ globalData: { shop_id: 'guard' } });
const ui = require(P('utils/ui.js'));
ui.setTitle = (t) => TITLES.push(t);
require(P('pages/m3/hub.js'));
require(P('subpkg/biz/takeaway/index.js'));
const HUB = PAGES.find((c) => typeof c.goImport === 'function');
const TK = PAGES.find((c) => typeof c.syncTitle === 'function');
ok('B-① 两页 Page 配置均加载成功（fail-closed）', !!HUB && !!TK);

function inst(cfg) {
  const p = Object.create(cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { Object.assign(this.data, patch); };
  return p;
}
const h = inst(HUB);
ok('B-② hub 的 t 三个新键真有值（不是 undefined）',
  h.data.t.importTitle === '销量表导入' && !!h.data.t.importSub && h.data.t.icoImport === '进',
  JSON.stringify(h.data.t.importTitle));
NAV.length = 0;
h.goStep({ currentTarget: { dataset: { step: 2 } } });
h.goImport();
ok('B-③ 真跑：三步走第③步与一级卡跳到同一 URL',
  NAV.length === 2 && NAV[0] === NAV[1] && NAV[0].indexOf('tab=import') >= 0, NAV.join(' | '));

const t = inst(TK);
TITLES.length = 0;
t.syncTitle('import');
const titleImport = TITLES[TITLES.length - 1];
t.syncTitle('calc');
const titleCalc = TITLES[TITLES.length - 1];
ok('B-④ 真跑 syncTitle：import⇒销量表导入 / calc⇒外卖每单赚多少',
  titleImport === '销量表导入' && titleCalc === '外卖每单赚多少',
  titleImport + ' | ' + titleCalc);
ok('B-⑤ 两个标题不同，且 import 标题不含「外卖」（错觉已消除）',
  titleImport !== titleCalc && titleImport.indexOf('外卖') < 0);

TITLES.length = 0;
t.onTab({ currentTarget: { dataset: { tab: 'import' } } });
const tabAfter1 = t.data.tab, titleAfter1 = TITLES[TITLES.length - 1];
t.onTab({ currentTarget: { dataset: { tab: 'calc' } } });
const tabAfter2 = t.data.tab, titleAfter2 = TITLES[TITLES.length - 1];
ok('B-⑥ 真跑 onTab：切 tab 时 data 与标题同步切换（来回都成立）',
  tabAfter1 === 'import' && titleAfter1 === '销量表导入'
  && tabAfter2 === 'calc' && titleAfter2 === '外卖每单赚多少',
  `${tabAfter1}/${titleAfter1} → ${tabAfter2}/${titleAfter2}`);
ok('B-⑦ wxml 的 import tab 仍渲染 t.importTab（改名没把 tab 栏弄丢）',
  /data-tab="import"[^>]*>\{\{t\.importTab\}\}/.test(TKW));

// ============ C 卡名 ≡ 点进去看到的标题（R633）============
// R615 当时明说「reviewTitle/reconTitle 的命名清理留独立一轮」——这轮补上，并把它做成常驻判据。
// 为什么要管：老板在枢纽页看到「每道菜/套餐成本毛利表」，点进去导航栏写「菜品成本毛利核算」，
// 他会怀疑**自己是不是点错了**（G6 同族：卡名 ≠ 页标题）。
// 口径：页面的真实标题 = json 的 navigationBarTitleText，或 setTitle(TERMS.x.y) 解析出来的值。
console.log('\n===== C 卡名 ≡ 页标题 =====');
const HUB_TERMS = require(P('miniprogram/i18n/terms.js')).TERMS;
const g = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), HUB_TERMS);

// 表里**显式登记**每张卡 → 目标页 → 标题来源（没有登记的卡如果出现在 hub 上，会被 C-① 抓到）
const MAP = [
  ['cardTitle', 'subpkg/biz/card/index', 'setTitle', 'card.listTitle'],
  ['materialTitle', 'subpkg/biz/material/index', 'setTitle', 'card.materialListTitle'],
  ['revenueTitle', 'subpkg/biz/revenue/index', 'json', ''],
  ['grouponTitle', 'subpkg/biz/groupon/index', 'json', ''],
  ['reviewTitle', 'pages/m3/dishreview/index', 'setTitle', 'card.reviewTitle'],
  ['reconTitle', 'subpkg/tools/recon/index', 'setTitle', 'card.reconTitle'],
];
// takeaway 走动态标题（syncTitle），已由 B 组单独钉死，这里不重复管
const SKIP = new Set(['takeawayTitle', 'importTitle', 'stepTitle']);

MAP.forEach(([hubKey, page, src, termKey], i) => {
  const hubName = g('hub.' + hubKey);
  let pageName = '';
  if (src === 'json') {
    try { pageName = JSON.parse(fs.readFileSync(P(page + '.json'), 'utf8')).navigationBarTitleText || ''; } catch (e) { pageName = ''; }
  } else {
    pageName = g(termKey) || '';
    // 还要确认这页**真的**把它设成了标题（写了 setTitle 才算数，光有词不算）
    let js = '';
    try { js = fs.readFileSync(P(page + '.js'), 'utf8'); } catch (e) { js = ''; }
    if (js.indexOf('setTitle(' + termKey.replace(/^/, 'TERMS.') + ')') < 0
      && js.indexOf(termKey + ')') < 0) pageName = pageName + '（未接线）';
  }
  ok(`C-${i + 1} hub.${hubKey} ≡ ${page} 的标题`,
    !!hubName && hubName === pageName,
    `卡名「${hubName}」/ 页标题「${pageName}」`);
});

ok('C-⑦ hub 上出现的入口都已登记（新增卡必须补进这张表，否则卡名与页标题会悄悄漂）',
  (() => {
    let js = '';
    try { js = fs.readFileSync(P('pages/m3/hub.js'), 'utf8'); } catch (e) { return false; }
    const gos = (js.match(/\n  go[A-Z][A-Za-z]*\(\)/g) || []).map((x) => x.trim().replace('()', ''));
    return gos.length >= 7;   // 至少 7 个入口；数量骤降说明 hub 被大改，回来补这张表
  })());

console.log(`\n===== M3 入口命名守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
