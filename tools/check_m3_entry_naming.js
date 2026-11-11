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
/**
 * 🔴 R707 判据**反转**：M3 上不再有「销量表导入」卡。
 *
 * 原判据（R615）守「必须有这张卡」，因为当时把全渠道销量导入从外卖页 tab2 提成了一级入口。
 * R707 撤回 —— 这是**产品判断变了，不是实现变了**：
 *   导入是一个**动作**，而 M3 是「去哪干活」的清单（目的地）。
 *   做成卡 = 让老板「先来这导、再退出去别处看」。李老师 2026-11-11 原话：
 *   「他正常就是进去之后他就需要看每单赚多少…你导进去退出来再进，好多人没那个习惯」。
 *   查证后它真正服务的下游只有一个半：
 *     · 外卖单均测算 —— 同页 tab2，入口本来就在，不割裂；
 *       ⚠️ 且该 tab 是纯手工测算器，**不读**导入数据 ⇒ 「导完看这单赚多少」是假出口，不设；
 *     · 菜品排行榜 —— 原先只能看/删、不能导，是唯一真断点 ⇒ 入口补在那页（见 A-④）；
 *     · 渠道营收（收款日报）、团购（手工填价）—— 数据源无关。
 *
 * ⇒ 本组现在守**反向**：这张卡不许回来。守卫反转不是放松，是**把这次决策锁住**：
 *   谁把卡加回去，这里必须红。
 */
const importCardIn = (wxml) => /<view class="hub-card"[^>]*bindtap="goImport"/.test(wxml);
ok('A-① M3 上**没有**「销量表导入」入口卡（导入是动作，不是目的地）',
  importCardIn(HUBW) === false);
// 反恒真：给一个把导入卡加回去的影子样本，同一判据必须给 true（即 A-① 会判红）
ok('A-①b 反恒真：影子样本里把导入卡加回去，A-① 必须判红',
  importCardIn(HUBW.replace(
    '<view class="hub-grid">',
    '<view class="hub-grid"><view class="hub-card" bindtap="goImport"></view>'
  )) === true, '影子样本已证伪');

/**
 * 🔴 R704：宫格把长副文案换成 *Short（每列 ≈155px，长描述会撑 3~4 行、同排参差）。
 * 原判据只守「导入卡那一张必须带副文案」，本意是**入口卡必须解释自己是干什么的**。
 * 卡撤掉后本意不能跟着消失 ⇒ 升级成守**全部 hub-card**：每张都必须渲染 hub-desc。
 * 这比原来更严（原来只查一张），也正好锁住「不许有裸卡名无解释」这条既有纪律。
 * ⚠️ 不能用 `<view class="hub-card"[\s\S]*?</view>` 取块：卡内第一层就有
 *   `<view class="hub-ico">…</view>`，非贪婪会当场截断、把 hub-desc 划到块外（假绿）。
 *   按类名 split 才对 —— 每段恰是"从这张卡到下一张卡之前"。
 */
const cardChunks = HUBW.split('<view class="hub-card"').slice(1);
const withDesc = cardChunks.filter((c) => /class="hub-desc"/.test(c));
ok('A-② 每一张入口卡都带解释副文案（hub-desc；Short 或 Sub 皆可）',
  cardChunks.length >= 7 && withDesc.length === cardChunks.length,
  cardChunks.length + ' 张卡 / ' + withDesc.length + ' 张带副文案');
// 反恒真：从影子样本抠掉一张卡的 hub-desc，条数必须掉下来（证明判据有分辨力）
ok('A-②b 反恒真：抠掉一张卡的 hub-desc，A-② 必须判红',
  (function () {
    const shadow = HUBW.replace('<text class="hub-desc">{{t.cardShort}}</text>', '');
    const ch = shadow.split('<view class="hub-card"').slice(1);
    const wd = ch.filter((c) => /class="hub-desc"/.test(c));
    return shadow.indexOf('{{t.cardShort}}') < 0 && wd.length < ch.length;
  })(), '影子样本已证伪');
ok('A-③ hub.js 的 t:{} **不再**登记导入卡三键（与 A-① 呼应；漏删就是死登记，下一个人会以为还有卡）',
  !/importTitle: TERMS\.hub\.importTitle/.test(HUBJ)
  && !/importSub: TERMS\.hub\.importSub/.test(HUBJ)
  && !/icoImport: TERMS\.hub\.icoImport/.test(HUBJ));
/**
 * 🔴 R707：入口搬到「菜品赚多赚少排行榜」（本仓唯一吃菜品级销量的分析页）。
 * 守的仍是**接线**三件套（函数存在 ≠ 页面调用）：wxml 真绑定 + js 真实现 + 落点带 tab=import。
 * 只写其中一件都会出现「按钮在、点了没反应」或「函数在、页面没入口」。
 */
const DRW = fs.readFileSync(P('pages/m3/dishreview/index.wxml'), 'utf8');
const DRJ = fs.readFileSync(P('pages/m3/dishreview/index.js'), 'utf8');
/**
 * 🔴 变异 M4 教训：初版判据是 `/bindtap="goImport"/.test(DRW)` —— 页内**有两处**同名绑定
 *   （首屏空态块 + 数据设置折叠区），抠掉首屏那个照样过 ⇒ 假绿。
 *   ⇒ 必须数**恰好 2 处**，且首屏那块里必须真有按钮（A-④c）。
 */
const goBtnN = (DRW.match(/bindtap="goImport"/g) || []).length;
ok('A-④ 排行榜页有就地导入入口：wxml 两处绑定（首屏 + 折叠区）+ js 真实现 + 落点带 tab=import',
  goBtnN === 2
  && /goImport\(\) \{ wx\.navigateTo\(\{ url: '\/subpkg\/biz\/takeaway\/index\?tab=import' \}\); \}/.test(DRJ),
  '绑定 ' + goBtnN + ' 处');
// 守「通往销量导入的 URL 只此一处」：M3 已无该 URL，排行榜恰好一处（多一处必是又开了岔路）
ok('A-④b 通往销量导入的 URL 全仓只有排行榜这一处（M3 不再有第二条，避免走岔）',
  (HUBJ.match(/takeaway\/index\?tab=import/g) || []).length === 0
  && (DRJ.match(/takeaway\/index\?tab=import/g) || []).length === 1,
  'hub=' + (HUBJ.match(/takeaway\/index\?tab=import/g) || []).length
  + ' dr=' + (DRJ.match(/takeaway\/index\?tab=import/g) || []).length);
/**
 * 🔴 变异 M8 教训：初版只查页内**存在** `wx:if="{{!bills.length}}"` —— 可「数据设置」折叠区
 *   里本来就有一行 `<view class="muted" wx:if="{{!bills.length}}">还没有导入任何账单。</view>`
 *   ⇒ 把首屏整块挪走 / 关掉，判据仍被折叠区那行满足 ⇒ 假绿。
 *   ⇒ 必须定位到**那个 card2 块本身**，并确认块内有按钮。
 */
const emptyIdx = DRW.indexOf('<view class="card2" wx:if="{{!bills.length}}">');
const emptyBlock = emptyIdx >= 0 ? DRW.slice(emptyIdx, emptyIdx + 600) : '';
ok('A-④c 未导入时首屏那块 card2 里就有导入按钮（不能只藏在折叠区：老板看不到就不会点）',
  emptyIdx >= 0 && emptyBlock.indexOf('bindtap="goImport"') >= 0,
  '首屏块@' + emptyIdx + ' 按钮在内=' + (emptyBlock.indexOf('bindtap="goImport"') >= 0));
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
// ⚠️ R707：原来按 goImport 认 HUB —— 该方法已随导入卡删除 ⇒ 改用 goMaterial 认领
const HUB = PAGES.find((c) => typeof c.goMaterial === 'function');
const TK = PAGES.find((c) => typeof c.syncTitle === 'function');
ok('B-① 两页 Page 配置均加载成功（fail-closed）', !!HUB && !!TK);

function inst(cfg) {
  const p = Object.create(cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { Object.assign(this.data, patch); };
  return p;
}
const h = inst(HUB);
// 🔴 R707 反向断言：三个键必须是 undefined —— 有值说明"卡删了但 t 还在登记"，
//   那是死登记（页面不渲染却占着 i18n 键，下一个人会以为还有这张卡）。
ok('B-② hub 的 t 里导入卡三键已是 undefined（删卡后不许留死登记）',
  h.data.t.importTitle === undefined && h.data.t.importSub === undefined
  && h.data.t.icoImport === undefined,
  JSON.stringify([h.data.t.importTitle, h.data.t.importSub, h.data.t.icoImport]));
NAV.length = 0;
h.goMaterial(); h.goCard();
ok('B-③ 真跑：①② 两张步骤卡各跳各的（3 次调用只剩 2 次，③ 已随卡删除）',
  NAV.length === 2
  && NAV[0] === '/subpkg/biz/material/index'
  && NAV[1] === '/subpkg/biz/card/index',
  NAV.join(' | '));
ok('B-③b 真跑：goImport 已不是 hub 的方法（防止"方法还在、卡没了"的悬空入口）',
  typeof h.goImport === 'undefined');

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
// R707：'importTitle' 已不在 hub 上（卡删了）⇒ 从 SKIP 移除，免得下一个人以为它还被特殊对待
const SKIP = new Set(['takeawayTitle', 'stepTitle']);

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
