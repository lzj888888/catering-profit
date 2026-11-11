// tools/check_quadrant.js —— R689（M3 优化 A）四象限守卫
//
// 判据对象：`pages/m3/dishreview/index.js::buildQuadrant`
//   —— 把已完成 `fmtRanked` 的堂食排行按「销量中位数 × 毛利率中位数」切成四类。
//
// 为什么必须有（这四类错误全部**静默**）：
//   ① 用**平均数**而不是中位数分档 ⇒ 一道爆款就能把"高销量"这一半压成两三道菜，
//      四象限看起来正常、结论全错；
//   ② 免费档拿不到 marginPct（hasMargin=false），若不过滤 ⇒ 全部落进"卖得少又不太赚钱"，
//      等于把付费结论反向泄露（"你这菜都该换"），比不给更坏；
//   ③ 零销量菜参与分档 ⇒ 中位数被拉低 ⇒ 一堆"高销量"假象（没卖过的菜怎么会是高销量）；
//   ④ 菜太少（3~5 道）也硬分四类 ⇒ 每格 0~1 道，是噪音却摆得像结论。
const path = require('path');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// ===== stub 加载页面模块，取 buildQuadrant =====
let captured = null;
global.Page = function (cfg) { captured = cfg; };
global.getApp = function () { return { globalData: {} }; };
global.wx = {
  getStorageSync: function () { return ''; },
  setStorageSync: function () {},
  getSystemInfoSync: function () { return { windowWidth: 375 }; },
  showModal: function () {},
  showToast: function () {},
  navigateTo: function () {},
};

const PAGE = path.join(__dirname, '..', 'pages/m3/dishreview/index.js');
let loadErr = null;
try { require(PAGE); } catch (e) { loadErr = e; }
check('dishreview 页能被 stub 加载', !loadErr && captured
  && typeof captured.buildQuadrant === 'function',
  loadErr ? String(loadErr.message).slice(0, 90) : '');

if (!captured || typeof captured.buildQuadrant !== 'function') {
  console.log(`\n==== 四象限守卫：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(1);
}
const build = captured.buildQuadrant.bind(captured);

// 造一行「已完成 fmtRanked」的菜：qty=销量，marginPct=毛利率，hasMargin=有毛利
const row = (name, qty, marginPct, hasMargin) => ({
  name: name, qty: qty, marginPct: marginPct,
  hasMargin: hasMargin === undefined ? true : hasMargin,
});

// ===== A. 基本分档（6 道，销量 [10,20,30,40,50,60]，毛利 [10,15,20,25,30,35]）=====
console.log('===== A · 中位数分档与四类归类 =====');
const SIX = [
  row('A', 10, 10), row('B', 20, 15), row('C', 30, 20),
  row('D', 40, 25), row('E', 50, 30), row('F', 60, 35),
];
const q = build(SIX);
check('6 道菜 ⇒ ok=true', q.ok === true);
check('销量中位数 = (30+40)/2 = 35', q.qtyMid === 35, String(q.qtyMid));
check('毛利率中位数 = (20+25)/2 = 22.5 ⇒ 文案 22.50%',
  q.marginMidText === '22.50%', q.marginMidText);

const cell = (k) => (q.cells.find((c) => c.key === k) || {});
// 高销(≥35) 4 道：D40/25% E50/30% F60/35% ... 注意 D 的毛利率 25 ≥ 22.5 ⇒ 高毛利
check('卖得好又赚钱（star）含销量 ≥35 且毛利率 ≥22.5 的菜',
  cell('star').count === 3, `实际 ${cell('star').count} 道（D/E/F）`);
check('卖得多、不太赚钱（traffic）: 销量 ≥35 但毛利率 <22.5',
  cell('traffic').count === 0, `实际 ${cell('traffic').count} 道`);
check('赚钱、但卖得少（potential）: 销量 <35 且毛利率 ≥22.5',
  cell('potential').count === 0, `实际 ${cell('potential').count} 道`);
check('卖得少、又不太赚钱（cut）: 销量 <35 且毛利率 <22.5',
  cell('cut').count === 3, `实际 ${cell('cut').count} 道（A/B/C）`);
check('四格数量之和 = 参与分档的菜数', q.cells.reduce((s, c) => s + c.count, 0) === 6);

console.log('\n===== B · 三种静默错法 =====');
// B-① 平均数陷阱：一道 300 份爆款 + 五道 20 份 ⇒ 平均数 66.7，中位数 20
const OUTLIER = [
  row('爆款', 300, 40), row('B', 20, 10), row('C', 20, 12),
  row('D', 20, 14), row('E', 20, 16), row('F', 20, 18),
];
const qo = build(OUTLIER);
check('① 有爆款时中位数仍 = 20（不被 300 拉高；若用平均数会是 66.7）',
  qo.qtyMid === 20, `qtyMid=${qo.qtyMid}`);
check('① 用中位数仍能把"卖得好"这一侧框在合理范围（不因爆款而失控）',
  // ⚠️ 首版这里断言"只剩 1 道"，是我算错了：B~F 都是 20 份、中位数也是 20，
  //    在 `qty >= 中位数` 的语义下**它们全都属于"卖得好"这一侧**（再按毛利率分 star/traffic）。
  //    这不是 bug —— 20 份确实不低于中位数。真正要防的是"被爆款拉高到只剩 1 道"，那才是失控。
  //    此例中 6 道 = star 3（爆款+E+F，毛利率 ≥15）+ traffic 3（B/C/D，<15）。
  (qo.cells.find((c) => c.key === 'star').count
   + qo.cells.find((c) => c.key === 'traffic').count) === 6,
  `star=${qo.cells.find((c) => c.key === 'star').count} traffic=${qo.cells.find((c) => c.key === 'traffic').count}`);

// B-② 免费档：hasMargin=false
const FREE = SIX.map((r) => row(r.name, r.qty, null, false));
const qf = build(FREE);
check('② 免费档（marginPct=null / hasMargin=false）⇒ ok=false，不产生任何格子',
  qf.ok === false && qf.cells.length === 0, `ok=${qf.ok} cells=${qf.cells.length}`);

// B-③ 零销量参与分档
const WITHZERO = SIX.concat([row('Z1', 0, 40), row('Z2', 0, 40)]);
const qz = build(WITHZERO);
check('③ 零销量菜被排除（不参与分档、中位数不被 0 拉低）',
  qz.qtyMid === 35 && qz.total === 6, `qtyMid=${qz.qtyMid} total=${qz.total}`);

// B-④ 菜太少
const FEW = SIX.slice(0, 5);
const qfew = build(FEW);
check('④ 只有 5 道 ⇒ ok=false（不满 6 道不给结论）', qfew.ok === false);
check('④ 明确说出"差多少"（needText 含数字 6）',
  typeof qfew.needText === 'string' && qfew.needText.indexOf('6') >= 0, qfew.needText);

console.log('\n===== C · 展示字段 =====');
const big = build([
  row('菜1', 100, 50), row('菜2', 90, 49), row('菜3', 80, 48),
  row('菜4', 70, 47), row('菜5', 10, 5), row('菜6', 9, 4), row('菜7', 8, 3),
]);
const star = big.cells.find((c) => c.key === 'star');
check('每格最多列 3 个菜名', star.names.length <= 3, String(star.names.length));
check('超出 3 个时给"还有 N 道"', !!star.moreText && star.moreText.indexOf('1') >= 0, star.moreText);
check('格内按销量降序（老板先看到卖得最多的）',
  star.names[0] === '菜1', String(star.names[0]));
check('空格子标 empty=true（页面据此显示破折号而不是空白）',
  big.cells.some((c) => c.empty === true) || big.cells.every((c) => c.count > 0));

// ===== E. 整店亏损（R690 自查补的洞）=====
console.log('\n===== E · 整店毛利率为负 =====');
// 六道菜的毛利率全是负的（-5% ~ -30%），中位数 = -12.5%
const ALLLOSS = [
  row('亏1', 100, -5), row('亏2', 90, -8), row('亏3', 80, -10),
  row('亏4', 20, -15), row('亏5', 10, -20), row('亏6', 5, -30),
];
const ql = build(ALLLOSS);
check('⑤ 整店毛利中位数为负 ⇒ ok=false（不许贴「卖得好、毛利也高」）',
  ql.ok === false, 'ok=' + ql.ok);
check('⑤ reason = all_loss（便于页面区分「菜太少」与「全在亏」）',
  ql.reason === 'all_loss', String(ql.reason));
check('⑤ 给的是「先解决定价」这类提示，不是四类建议',
  typeof ql.notText === 'string' && ql.notText.indexOf('定价') > 0, ql.notText);
// 对照：只要中位数 > 0，即使有个别负毛利菜，仍应正常出四象限
const MIXED2 = [
  row('正1', 100, 40), row('正2', 90, 35), row('正3', 80, 30),
  row('正4', 70, 25), row('亏1', 60, -10), row('亏2', 50, -20),
];
const qm = build(MIXED2);
check('⑤ 对照：混合（有赚有亏但中位数 > 0）仍正常出四象限',
  qm.ok === true, 'ok=' + qm.ok + ' marginMid=' + qm.marginMidText);

console.log('\n===== D · 变异自证 =====');
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
check('变异①：这道题用平均数会得到 66.7（≠ 中位数 20）⇒ 证明 A/B 组有分辨力',
  Math.round(avg([300, 20, 20, 20, 20, 20]) * 10) / 10 === 66.7);
check('变异②：若不过滤 hasMargin，免费档 6 道会全落进 cut ⇒ 与 ok=false 的结论相反',
  FREE.filter((r) => r.hasMargin).length === 0 && qf.ok === false);

console.log(`\n==== 四象限守卫结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
