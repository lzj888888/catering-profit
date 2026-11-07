// 渠道营收页面守卫（R616 · 队列 #141 接线）
//
// 守的是什么事故：这个页面最大的风险不是崩，是**主数摆错**。
//   若把「现金流入（含充值）」当主数展示，老板会以为自己这个月赚了 59,700（实际经营营收 64,547），
//   而且下个月搞充送活动时会被虚高一大截 —— 这正是李老师说的「不能给人错误信息」。
//   ⇒ 本守卫只真跑**数**：主数必须是 M1 权责制营收，现金流入只能当副数且带对账标签。
//
// 零依赖：xlsx 用不到（本守卫只测装配与静态形态，不解析文件）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);
const WXML = fs.readFileSync(P('subpkg/biz/revenue/index.wxml'), 'utf8');
const PAGE = fs.readFileSync(P('subpkg/biz/revenue/index.js'), 'utf8');
const WXSS = fs.readFileSync(P('subpkg/biz/revenue/index.wxss'), 'utf8');
const FN = fs.readFileSync(P('cloudfunctions/importSalesBill/index.js'), 'utf8');
const HUB = fs.readFileSync(P('pages/m3/hub.wxml'), 'utf8');
const HUBJS = fs.readFileSync(P('pages/m3/hub.js'), 'utf8');
const APP = JSON.parse(fs.readFileSync(P('app.json'), 'utf8'));
const TERMS = require(P('miniprogram/i18n/terms.js')).TERMS;

let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}

// ===== 页面桩：真跑生产 index.js 的 buildView =====
const noop = () => {};
global.wx = new Proxy({
  showToast: noop, showLoading: noop, hideLoading: noop, navigateTo: noop, showModal: noop,
  setNavigationBarTitle: noop, getStorageSync: () => '', setStorageSync: noop,
  cloud: { uploadFile: async () => ({ fileID: 'x' }) },
}, { get: (t, k) => (k in t ? t[k] : noop) });
global.getApp = () => ({ globalData: { shop_id: 's1' } });
let pageCfg = null;
global.Page = (c) => { pageCfg = c; };
require(P('subpkg/biz/revenue/index.js'));

// 云端返回结构（数字取自真数据 9.1–9.13 的真跑结果，与 importSalesBill 出参同形）
const RD = {
  shape: 'revenue_daily',
  cashInflow: {
    formula: '现金 + 充值 + 扫码 + 挂账还款',
    totalYuan: 59700.8, totalFen: 5970080,
    declaredYuan: 59700.8, declaredFen: 5970080,
    pass: true, checkedShifts: 24, mismatches: [],
    purpose: 'cash_reconciliation', note: '现金流入口径含充值，只用于对现金账；不是经营收入',
  },
  revenueM1: {
    formula: '现金+扫码+储值卡消费+挂账消费+团购核销+美团外卖+京东外卖+淘宝闪购',
    basis: 'accrual',
    dineInYuan: 61850.7, dineInFen: 6185070,
    takeawayYuan: 2696.38, takeawayFen: 269638,
    totalYuan: 64547.08, totalFen: 6454708,
    pendingOtherYuan: 550, pendingOtherFen: 55000,
  },
  bridge: {
    cashInflowYuan: 59700.8, revenueM1Yuan: 64547.08,
    diffYuan: 4846.28, diffPct: 8.12,
    bossOver: [
      { key: 'recharge', label: '充值（预存，钱到了但还没消费）', yuan: 22673 },
      { key: 'ledgerRepay', label: '挂账还款（收回的是旧账，早就确认过收入）', yuan: 2067 },
    ],
    bossOverSum: 24740,
    m1Over: [
      { key: 'memberConsume', label: '储值卡消费（钱充值时收过了，消费才算收入）', yuan: 22126 },
      { key: 'ledgerNew', label: '挂账消费（吃了没付钱，但已经发生）', yuan: 1504.5 },
      { key: 'groupon', label: '团购核销（平台结算，不走收银台）', yuan: 3259.4 },
      { key: 'waimai', label: '外卖（平台结算，不走收银台）', yuan: 2696.38 },
    ],
    m1OverSum: 29586.28, identityDiffYuan: 4846.28, identityOk: true,
  },
  channelYuan: {
    grouponMeituan: 2506, grouponDouyin: 753.4, waimaiMeituan: 232.19,
    waimaiJd: 385.84, waimaiTaobao: 2078.35,
  },
  days: [{ date: '2026-09-01', revenueM1Yuan: 5976.53, cashInflowYuan: 4539.5, shifts: 2 },
    { date: '2026-09-13', revenueM1Yuan: 4181.4, cashInflowYuan: 4181.4, shifts: 2 }],
  shiftCount: 24,
  // R618：真数据的覆盖范围（9.1-9.13，9 月 30 天 ⇒ 月末缺 17 天）
  coverage: {
    ok: true, month: '2026-09', firstDate: '2026-09-01', lastDate: '2026-09-13',
    dayCount: 13, monthDays: 30, missingCount: 17, partial: true, complete: false,
    missingDates: ['2026-09-14'], tailMissingCount: 17,
    tailMissingDates: ['2026-09-14', '2026-09-15', '2026-09-16'],
    note: '只到 09-13，之后 17 天没有记录',
  },
};

// ===================== A 静态形态：两个数都在、主数归属正确 =====================
console.log('=== A 组 静态形态 ===');

ok('A-① 页面桩抓到了 Page 配置（守卫真跑的前提）', !!pageCfg && typeof pageCfg.buildView === 'function');

ok('A-② 主数变量名是 mainText，且源码里绑定 M1 营收（不是 cashInflow）',
  /mainText:\s*money\(m1\.totalYuan\)/.test(PAGE) && /mainText:\s*money\(ci\./.test(PAGE) === false,
  'mainText←m1.totalYuan=' + /mainText:\s*money\(m1\.totalYuan\)/.test(PAGE));

ok('A-③ 副数变量名是 cashText，绑定的是现金流入',
  /cashText:\s*money\(ci\.totalYuan\)/.test(PAGE));

ok('A-④ wxml 同时渲染主数与副数（只给一个数 ⇒ 老板没法对账）',
  WXML.indexOf('{{r.mainText}}') > 0 && WXML.indexOf('{{r.cashText}}') > 0);

ok('A-⑤ wxml 必须渲染差额（给两个数不给差额 = 制造疑问）',
  WXML.indexOf('{{r.diffText}}') > 0);

ok('A-⑥ 差额桥在页面里，且默认收起（先说结论再展开依据）',
  WXML.indexOf('onToggleBridge') > 0 && /bridgeOpen:\s*false/.test(PAGE));

ok('A-⑦ 口径提醒必须出现（「充值不算收入」这句话要在页面上）',
  WXML.indexOf('{{t.caliberTip}}') > 0
  && String(TERMS.revenue.caliberTip).indexOf('充值') >= 0
  && String(TERMS.revenue.caliberTip).indexOf('不算收入') >= 0);

ok('A-⑧ 副数旁必须写明「含充值，只对账用」（否则副数会被当成营收）',
  String(TERMS.revenue.cashNote).indexOf('含充值') >= 0);

ok('A-⑨ 五个渠道的文案键齐备（缺一个就少一条渠道）',
  ['chanGrouponMeituan', 'chanGrouponDouyin', 'chanWaimaiMeituan', 'chanWaimaiJd', 'chanWaimaiTaobao']
    .every((k) => typeof TERMS.revenue[k] === 'string' && TERMS.revenue[k]),
  Object.keys(TERMS.revenue).length + ' 个键');

// 🔴 变异暴露的洞：第一版只判 '64547'（无逗号），而 `'64,547.08'` 里是 `64,547`
//   ⇒ 硬编码真数据能溜过去。现同时判带逗号与不带逗号两种写法。
ok('A-⑩ 页面不写死任何金额（防有人图省事硬编码真数据）',
  ['59700', '59,700', '64547', '64,547', '4846', '4,846']
    .every((x) => PAGE.indexOf(x) < 0));

ok('A-⑪ 页面不自己算营收（源码里不得出现 现金+扫码 之类的加法）',
  PAGE.indexOf('cashInflowYuan +') < 0 && PAGE.indexOf('memberConsume +') < 0);

ok('A-⑫ 字号守 AD-G1（页面不得出现 < 28rpx 的字号）',
  (() => {
    const nums = (WXSS.match(/font-size:\s*(\d+)rpx/g) || []).map((x) => parseInt(x.replace(/\D/g, ''), 10));
    return nums.length > 0 && nums.every((n) => n >= 28);
  })(),
  (WXSS.match(/font-size:\s*\d+rpx/g) || []).length + ' 处字号');

// ===================== B 页面桩真跑装配：主数到底是谁 =====================
console.log('\n=== B 组 真跑装配（主数归属是核心）===');

const v = pageCfg.buildView(RD);

ok('B-① 🔴 主数 = 64,547.08（经营营收）；不是 59,700.80（现金流入）',
  v.mainText === '64,547.08' && v.mainText !== '59,700.80', '主数=' + v.mainText);

ok('B-② 副数 = 59,700.80（现金流入，供对账）',
  v.cashText === '59,700.80', '副数=' + v.cashText);

ok('B-③ 差额 = +4,846.28（8.12%）且标为「增」色',
  v.diffText === '+4,846.28（8.12%）' && v.diffUp === true, v.diffText);

ok('B-④ 堂食/外卖拆分都对（61,850.70 / 2,696.38）',
  v.dineInText === '61,850.70' && v.takeawayText === '2,696.38');

ok('B-⑤ 差额桥两侧项数对：M1 多算 4 项、老板多算 2 项',
  v.m1Over.length === 4 && v.bossOver.length === 2,
  'm1Over=' + v.m1Over.length + ' bossOver=' + v.bossOver.length);

// 🔴 变异暴露的洞：原断言只查 fixture 里有没有 0（fixture 全是正值 ⇒ 去掉过滤也不红，判据无鉴别力）。
//   现**主动造一个 0 值项**，真跑一遍看它有没有被滤掉。
ok('B-⑥ 差额桥零值项被过滤（不显示「＋0.00」这种废话）', (() => {
  const rd0 = JSON.parse(JSON.stringify(RD));
  rd0.bridge.m1Over.push({ key: 'zero', label: '零值项', yuan: 0 });
  rd0.bridge.bossOver.push({ key: 'zero2', label: '零值项2', yuan: 0 });
  const v0 = pageCfg.buildView(rd0);
  return v0.m1Over.length === 4 && v0.bossOver.length === 2
    && v0.m1Over.every((x) => x.text !== '0.00') && v0.bossOver.every((x) => x.text !== '0.00');
})(), '造 0 值项后仍 ' + '4/2');

ok('B-⑦ 渠道只列有数的（5 个都有数 ⇒ 5 条；去掉一个 0 值 ⇒ 4 条）',
  v.channels.length === 5 && (() => {
    const rd2 = JSON.parse(JSON.stringify(RD));
    rd2.channelYuan.grouponDouyin = 0;
    return pageCfg.buildView(rd2).channels.length === 4;
  })());

ok('B-⑧ 未确认含义的「茶楼」单独提示，且**不计入**主数（主数里没有它）',
  v.pendingText.indexOf('茶楼') >= 0 && v.pendingText.indexOf('550.00') >= 0
  && v.mainText === '64,547.08');

ok('B-⑨ 对账通过时给正向反馈（他表里的数与我们反推公式一致）',
  v.reconOk === true && v.reconText.indexOf('24') >= 0, v.reconText.slice(0, 30));

ok('B-⑩ 对账不通过时改成提醒（不假装通过）', (() => {
  const rd2 = JSON.parse(JSON.stringify(RD));
  rd2.cashInflow.pass = false;
  rd2.cashInflow.mismatches = [{ date: '2026-09-06', shift: '晚' }];
  const v2 = pageCfg.buildView(rd2);
  return v2.reconOk === false && v2.reconText.indexOf('1') >= 0;
})());

ok('B-⑪ 差额为负时也能正确展示（不写死正号）', (() => {
  const rd2 = JSON.parse(JSON.stringify(RD));
  rd2.bridge.diffYuan = -1234.5;
  rd2.bridge.diffPct = -2.07;
  const v2 = pageCfg.buildView(rd2);
  return v2.diffUp === false && v2.diffText.indexOf('-1,234.50') >= 0;
})());

ok('B-⑫ 缺字段不崩（云端老版本返回没有 bridge 也不白屏）', (() => {
  const v3 = pageCfg.buildView({ revenueM1: { totalYuan: 1 }, cashInflow: {} });
  return v3.mainText === '1.00' && typeof v3.diffText === 'string';
})());

// ===================== C 云函数接线 =====================
console.log('\n=== C 组 云函数接线 ===');

ok('C-① importSalesBill 引了营收解析器（就近放置，不进 common）',
  FN.indexOf("require('./revenueDailyParse')") > 0);

// 🔴 变异暴露的洞（修了两轮）：
//   第一版只比两处 index ⇒ 比较的是**首次出现**，在前面插一次调用会让两边同时前移、关系不变。
//   第二版按「上一处分流注释」切段 ⇒ 把调用插在注释**之上**就漏了（切段不含那行）。
//   现直接从文件头切到营收分支，判「这之前没有任何 detectDishMatrix 调用」。
//   ⚠️ 用带括号的 `detectDishMatrix(` = 调用形式；文件头的解构里是 `detectDishMatrix,`（逗号），不会误伤。
ok('C-② 营收报表分支在菜品/账单识别之前（签名独特，先试它不会误判）', (() => {
  const iRev = FN.indexOf('RevenueDaily.detectRevenueDaily');
  const iDish = FN.indexOf('const dishDetect = detectDishMatrix(matrix)');
  if (iRev < 0 || iDish < 0) return false;
  return iRev < iDish && FN.slice(0, iRev).indexOf('detectDishMatrix(') < 0;
})(),
  '营收@' + FN.indexOf('RevenueDaily.detectRevenueDaily')
  + ' < 菜品@' + FN.indexOf('const dishDetect = detectDishMatrix(matrix)')
  + ' | 之前有调用=' + (FN.slice(0, FN.indexOf('RevenueDaily.detectRevenueDaily')).indexOf('detectDishMatrix(') >= 0));

ok('C-③ 🔴 只读：该分支内不得写库（老板只是看一眼，不能改他任何数据）', (() => {
  const i = FN.indexOf('RevenueDaily.detectRevenueDaily');
  const j = FN.indexOf('const dishDetect = detectDishMatrix(matrix)');
  const seg = FN.slice(i, j > i ? j : i + 3000);
  return seg.indexOf('collection(') < 0 && seg.indexOf('.add(') < 0 && seg.indexOf('.update(') < 0;
})());

// 🔴 判「有没有把整表外发」这个行为，不判字面：第一次写成 `FN.indexOf('revOut.shifts') < 0`，
//   把 `shiftCount: (revOut.shifts || []).length`（只取长度，合法）误伤了。
ok('C-④ 回传不含 shifts 原始明细（24 班次 × 17 列没必要给前端，也防整表外泄）',
  /\bshifts\s*:\s*revOut\.shifts\b/.test(FN) === false
  && /\bshifts\s*:\s*\(revOut\.shifts/.test(FN) === false);

ok('C-⑤ 回传的现金流入带 purpose 标签（前端据此判断「这是对账口径」）',
  FN.indexOf('purpose: revOut.cashInflow.purpose') > 0);

ok('C-⑥ 回传营收口径字段齐全（dineIn/takeaway/total/pendingOther 都有分与元）',
  ['dineInYuan', 'dineInFen', 'takeawayYuan', 'takeawayFen', 'totalYuan', 'totalFen',
    'pendingOtherYuan', 'pendingOtherFen'].every((k) => FN.indexOf(k + ':') > 0));

// ===================== D 入口与路由 =====================
console.log('\n=== D 组 入口与路由 ===');

ok('D-① app.json 注册了 subpkg/biz/revenue/index',
  (APP.subpackages || []).some((p) => p.root === 'subpkg/biz' && p.pages.indexOf('revenue/index') >= 0));

ok('D-② hub 有卡片且绑定 goRevenue',
  HUB.indexOf('bindtap="goRevenue"') > 0 && HUBJS.indexOf('goRevenue()') > 0);

// 🔴 变异暴露的洞：只比 `TERMS.hub.revenueTitle === TERMS.revenue.title` 抓不到
//   「hub.js 里写死字面量」这种改法（TERMS 本身没变 ⇒ 照旧相等，但页面显示已经不是术语了）。
//   现加判：hub.js 的赋值必须**引用 TERMS**，不得写死。
ok('D-③ hub 卡片文案与页面标题同源（G6 同族：卡名 ≠ 页标题是坑）',
  TERMS.hub.revenueTitle === TERMS.revenue.title
  && HUBJS.indexOf('revenueTitle: TERMS.hub.revenueTitle') >= 0,
  TERMS.hub.revenueTitle + ' vs ' + TERMS.revenue.title
  + ' | 映射来自TERMS=' + (HUBJS.indexOf('revenueTitle: TERMS.hub.revenueTitle') >= 0));

ok('D-④ 页面标题走 ui.setTitle 与术语单源（不写死在 json）',
  PAGE.indexOf('ui.setTitle(T.title)') > 0);

// ===================== F 覆盖范围（R618）：只报有没有数据，不猜原因 =====================
console.log('\n=== F 组 覆盖范围 ===');

const cvf = (patch) => pageCfg.buildView(Object.assign({}, RD, {
  coverage: Object.assign({}, RD.coverage, patch),
}));

ok('F-① 🔴 真数据 9.1-9.13 ⇒ 报「月末缺 17 天」（不是静默通过）',
  (() => { const c = pageCfg.buildView(RD).cover; return c && c.kind === 'tail' && c.text.indexOf('17') > 0; })(),
  JSON.stringify(pageCfg.buildView(RD).cover));

ok('F-② 整月齐全时给出齐全提示（不能永远报缺失）',
  (() => {
    const c = cvf({ missingCount: 0, tailMissingCount: 0, partial: false, complete: true }).cover;
    return c && c.kind === 'ok' && c.text.indexOf('30') > 0;
  })());

ok('F-③ 只有中间缺天（月末是齐的）⇒ 走 mid，不误报成 tail',
  (() => {
    const c = cvf({ missingCount: 1, tailMissingCount: 0, missingDates: ['2026-09-07'] }).cover;
    return c && c.kind === 'mid' && c.text.indexOf('09.07') > 0;
  })());

ok('F-④ 云端没给 coverage 时页面不崩、不显示空块（旧云端兼容）',
  (() => {
    const v = pageCfg.buildView(Object.assign({}, RD, { coverage: undefined }));
    return v.cover === null && v.mainText === '64,547.08';
  })());

ok('F-⑤ 文案给两个可能，不替老板断定原因（没营业 / 没导全）',
  String(TERMS.revenue.coverTail).indexOf('没营业') > 0
  && String(TERMS.revenue.coverTail).indexOf('没导全') > 0
  && String(TERMS.revenue.coverNote).indexOf('不代表账错') >= 0);

ok('F-⑥ wxml 真的渲染了这块（文案存在但没渲染 = 白写）',
  WXML.indexOf('{{r.cover.text}}') > 0 && WXML.indexOf('{{t.coverTitle}}') > 0);

// 🔴 关键：日期缺口必须由云端算好送下来，页面**不许自己算**
//   （页面自己 new Date 会踩时区/闰月/跨年，且和云端口径分叉）
ok('F-⑦ 页面不自己算日期缺口（源码不得出现 new Date / getDate / getMonth）',
  PAGE.indexOf('new Date') < 0 && PAGE.indexOf('getDate(') < 0 && PAGE.indexOf('getMonth(') < 0);

ok('F-⑧ 覆盖范围不参与营收计算（cover 只能读 coverage，不能碰 revenueM1/cashInflow）',
  /cover:\s*buildCover\(rd\.coverage\)/.test(PAGE));

// ===================== 汇总 =====================
console.log('\n===== 渠道营收页面守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
