// tools/check_revenue_manual.js —— 手填汇总守卫（R620，第 250 套件）
//
// 这个入口是为"不会做 Excel 的老板"开的。它最容易坏在两个地方：
//   ① **口径分叉** —— 手填另写一套营收算法，和 Excel 那条路算出两个数；
//   ② **假的好消息** —— 手填没有日明细、没有"表里营业收入"可对账，
//      却被显示成"整月 30 天齐全""对账零差异"。
// 所以这里既判结构，也**真跑一遍**手工转表 + 解析，看数对不对。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);

let pass = 0;
let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }
// 判源码关键词前先剥注释（R619 的教训：判据被自己注释击中过两次）
function stripComments(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const APP = JSON.parse(fs.readFileSync(P('app.json'), 'utf8'));
const PAGE = fs.readFileSync(P('subpkg/biz/revenue/manual/index.js'), 'utf8');
const WXML = fs.readFileSync(P('subpkg/biz/revenue/manual/index.wxml'), 'utf8');
const WXSS = fs.readFileSync(P('subpkg/biz/revenue/manual/index.wxss'), 'utf8');
const MAIN = fs.readFileSync(P('subpkg/biz/revenue/index.js'), 'utf8');
const MAINWXML = fs.readFileSync(P('subpkg/biz/revenue/index.wxml'), 'utf8');
const FN = fs.readFileSync(P('cloudfunctions/importSalesBill/index.js'), 'utf8');
const R = require(P('cloudfunctions/importSalesBill/revenueDailyParse.js'));
const TERMS = require(P('miniprogram/i18n/terms.js')).TERMS;
const MT = TERMS.revenueManual || {};

// ============ A 结构 ============
sec('A 结构（页面注册与分工）');

ok('A-① manual 页已在 app.json 的 subpkg/biz 分包里注册',
  (APP.subpackages || []).some((p) => p.root === 'subpkg/biz'
    && p.pages.indexOf('revenue/manual/index') >= 0));

ok('A-② 四个文件齐（js / wxml / wxss / json）',
  ['.js', '.wxml', '.wxss', '.json']
    .every((ext) => fs.existsSync(P('subpkg/biz/revenue/manual/index' + ext))));

// 手填页绝不能依赖 Excel —— 它存在的全部理由就是"老板没有表"
ok('A-③ 手填页不依赖任何 Excel/文件选择能力（否则这条路对不会做表的人还是死路）',
  stripComments(PAGE).indexOf('chooseMessageFile') < 0
  && stripComments(PAGE).indexOf('chooseMedia') < 0);

ok('A-④ 营收页有并列的手填入口（不是藏在角落的小字）',
  MAINWXML.indexOf('goManual') > 0 && MAIN.indexOf('goManual()') > 0
  && String(TERMS.revenue.manualEntry || '').length > 0,
  TERMS.revenue.manualEntry);

ok('A-⑤ 从手填页返回后会自动重读库（刚填的必须立刻出现，不能让老板以为没存上）',
  /onShow\(\)[\s\S]{0,160}loadStored\(\)/.test(MAIN));

// ============ B 口径（真跑）============
sec('B 口径（真跑手工转表 → 解析）');

const built = R.manualToRows({ cash: 1000, scan: 5000, waimaiMeituan: 800 }, '2026-09');

ok('B-① 表单字段全部落在解析器认得的列名上（前端不能自造列名绕过口径）',
  built.header.slice(2).every((h) => Object.keys(R.COL_MAP).indexOf(h) >= 0),
  built.header.slice(2).join(','));

ok('B-② 空表填 0 项时 filled=0（云端据此拒收，不落空数据）',
  R.manualToRows({}, '2026-09').filled === 0);

ok('B-③ 日期取当月最后一天（手填是整月汇总）',
  R.manualToRows({ cash: 1 }, '2026-09').rows[1][0] === '2026-09-30'
  && R.manualToRows({ cash: 1 }, '2026-02').rows[1][0] === '2026-02-28'
  && R.manualToRows({ cash: 1 }, '2028-02').rows[1][0] === '2028-02-29',
  R.manualToRows({ cash: 1 }, '2026-09').rows[1][0]);

const out = R.parseRevenueDaily(built.rows);
ok('B-④ 🔴 手填走**同一个** parseRevenueDaily，营收口径与 Excel 完全一致',
  out.ok === true && out.revenueM1.totalYuan === 6800
  && out.revenueM1.dineInYuan === 6000 && out.revenueM1.takeawayYuan === 800,
  '营收=' + out.revenueM1.totalYuan + ' 堂食=' + out.revenueM1.dineInYuan
  + ' 外卖=' + out.revenueM1.takeawayYuan);

ok('B-⑤ 现金流入口径也对（现金+充值+扫码+还款，充值不计营收）',
  out.cashInflow.totalYuan === 6000);

// 充值必须**不进**营收 —— 这是全项目最重要的一条口径，手填这条路也不能例外
const outTop = R.parseRevenueDaily(R.manualToRows({ cash: 100, recharge: 9999 }, '2026-09').rows);
ok('B-⑥ 🔴 手填充值 9999 ⇒ 营收一分不涨、现金流入跟着涨（与 Excel 同一条红线）',
  outTop.revenueM1.totalYuan === 100 && outTop.cashInflow.totalYuan === 10099,
  '营收=' + outTop.revenueM1.totalYuan + ' 现金流入=' + outTop.cashInflow.totalYuan);

ok('B-⑦ 手填不复写营收算法（云端不得自己加总 revenueM1）',
  stripComments(FN).indexOf('revenueM1.totalYuan =') < 0
  && stripComments(FN).indexOf('RevenueDaily.manualToRows') > 0);

ok('B-⑧ 🔴 手填的 coverage 必须标 manual 且 dayCount=0（不能显示成「整月齐全」）',
  /manual:\s*true/.test(FN) && /dayCount:\s*0/.test(FN),
  'manual标记=' + /manual:\s*true/.test(FN));

ok('B-⑨ 🔴 手填没有「表里营业收入」可对账 ⇒ pass 必须置 null，不能显示「零差异」',
  /cashInflow\.pass\s*=\s*null/.test(FN));

ok('B-⑩ 手填结果带 source=manual（来源可见，不能冒充平台原始凭证）',
  /source:\s*'manual'/.test(FN) && /source:\s*ctx\.source/.test(
    fs.readFileSync(P('cloudfunctions/importSalesBill/revenueStore.js'), 'utf8')));

// ============ C 老板能力面 ============
sec('C 老板能力面（他能不能填得出来）');

const ALL_ITEMS = (() => {
  // 从页面源码里抠出所有 item 的 hint 字段名，逐个数
  const m = PAGE.match(/hint:\s*T\.(h[A-Za-z]+)/g) || [];
  return m.map((x) => x.replace(/hint:\s*T\./, ''));
})();

ok('C-① 每个输入项都配了「去哪看」提示（没有提示 = 他填不出来 = 等于没这个功能）',
  ALL_ITEMS.length >= 11 && ALL_ITEMS.every((k) => typeof MT[k] === 'string' && MT[k].length >= 4),
  ALL_ITEMS.length + ' 项：' + ALL_ITEMS.slice(0, 4).join(','));

ok('C-② 全部选填：页面没有任何「必填」拦截（逼他填全等于劝退）',
  stripComments(PAGE).indexOf('必填') < 0 && stripComments(WXML).indexOf('required') < 0);

ok('C-③ 一个数没填时明确拒绝，并说人话',
  String(MT.emptyTip || '').indexOf('至少填一项') > 0);

ok('C-④ 充值与赊账那组默认收起（多数人答不上来，但不能藏起来让他不知道有这项）',
  /collapse:\s*true/.test(PAGE) && String(MT.gCreditHint || '').indexOf('留空') > 0,
  MT.gCredit);

// 术语黑名单：老板看不懂的词一个都不许出现在这个页面的文案里
const JARGON = ['权责发生制', '收付实现制', '现金流入', '应收应付', '冲销', '借方', '贷方', 'M1', '口径'];
const jargonHit = JARGON.filter((w) => JSON.stringify(MT).indexOf(w) >= 0);
ok('C-⑤ 🔴 这个页面的文案里没有任何会计术语（老板看不懂就等于没写）',
  jargonHit.length === 0, jargonHit.length ? '命中：' + jargonHit.join(',') : '零命中');

ok('C-⑥ 字号守 AD-G1（页面不得出现 < 28rpx 的字号 —— 店主多半在店里、光线不好）',
  (() => {
    const nums = (WXSS.match(/font-size:\s*(\d+)rpx/g) || []).map((x) => parseInt(x.replace(/\D/g, ''), 10));
    return nums.length > 0 && nums.every((n) => n >= 28);
  })(), (WXSS.match(/font-size:\s*\d+rpx/g) || []).length + ' 处字号');

ok('C-⑦ 触控高度 ≥ 88rpx（AD-G2：手上有油也能点中）',
  /min-height:\s*88rpx/.test(WXSS) && /height:\s*88rpx/.test(WXSS));

// ============ D 落库 ============
sec('D 落库（与 Excel 同一张表、同一套幂等）');

ok('D-① 手填也走 RevenueStore.commit（不另开一条写库路径）',
  /RevenueStore\.commit/.test(FN) && /action === 'revenue_save_manual'/.test(FN));

ok('D-② 手填的指纹含具体数值（同样的数重复存 = 幂等；改了数 = 新版本要确认）',
  /fileMd5:\s*'manual:'[\s\S]{0,80}JSON\.stringify\(vals\)|fileMd5:\s*'manual:'[\s\S]{0,120}fields/
    .test(FN) || /'manual:'\s*\+\s*shopId/.test(FN),
  'manual 指纹=' + /'manual:'/.test(FN));

ok('D-③ 手填换月/换数同样要确认（不静默覆盖已有的数）',
  /confirm:\s*input\.confirm === true/.test(FN));

ok('D-④ 手填分支在「下载文件」之前（手填没有文件，放后面会因缺 fileID 失败）',
  (() => {
    const s = stripComments(FN);
    const a = s.indexOf("action === 'revenue_save_manual'");
    const b = s.indexOf('cloud.downloadFile');
    return a > 0 && b > 0 && a < b;
  })());

console.log('\n===== 手填汇总守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
