// tools/check_quadrant.js —— 四象限守卫（R689 建 / R690 补整店亏损 / **R781 换轴为毛利额 + 分类目比**）
//
// 判据对象：`pages/m3/dishreview/index.js::buildQuadrant`
//
// 🔴 R781 换轴（《菜单诊断与搭配系统_多轮结论汇编》§2.1 锁定口径）：
//   纵轴从**毛利率**换成**每份毛利额 CM = 毛利额 ÷ 份数**；分界线取该类目
//   「总毛利额 ÷ 总份数」（**加权平均**），不是各菜百分比/金额的简单平均。
//   为什么必须换：高毛利率低销量（潜力股）与薄利走量（忙活菜）只看百分比会判反；
//   整桌赚不赚钱最终看毛利**总额**。
//
//   R781 另加两条判据：
//   ⑤ **分类目比**（主菜跟主菜比）：招牌红烧肉每份留 25 元、可乐每份留 3 元，
//      混在一起算加权平均 ⇒ 可乐必然判"占位菜" ⇒ 误砍高周转小件（资料 §0 点名的最大风险）。
//   ⑥ **单菜样本门槛**：卖不到 10 份的菜波动极大，贴强标签会让老板砍掉试销款。
//
// 仍必须守住的四条（R689 原始判据，全部**静默**失败）：
//   ① 用**平均数**而不是中位数分销量档 ⇒ 一道爆款把"高销量"半边压成两三道；
//   ② 免费档拿不到 grossFen（hasMargin=false）⇒ 若不过滤，全落"卖得少又不赚钱"，
//      等于把付费结论反向泄露（"你这菜都该换"），比不给更坏；
//   ③ 零销量菜参与分档 ⇒ 中位数被拉低 ⇒ 一堆"高销量"假象；
//   ④ 菜太少（3~5 道）硬分四类 ⇒ 每格 0~1 道，是噪音却摆得像结论。
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

const build = captured && captured.buildQuadrant ? captured.buildQuadrant.bind(captured) : () => ({ cells: [] });

// 造一行「已完成 fmtRanked」的菜。
//   qty = 销量，cmYuan = **每份毛利额（元）**，category = 类目
//   ⇒ grossFen = qty × cmYuan × 100（分），这样「每份 CM」在读用例时一眼可算。
const row = (name, qty, cmYuan, category, hasMargin) => ({
  name,
  qty,
  grossFen: Math.round(qty * cmYuan * 100),
  category: category || '',
  hasMargin: hasMargin === undefined ? true : hasMargin,
});

// ===== A. 基本分档（6 道，同属"热菜"；销量 10~60，每份 CM 10~35 元）=====
console.log('===== A · 每份毛利额分档与四类归类 =====');
const SIX = [
  row('A', 10, 10), row('B', 20, 15), row('C', 30, 20),
  row('D', 40, 25), row('E', 50, 30), row('F', 60, 35),
];
const q = build(SIX);
check('6 道菜 ⇒ ok=true', q.ok === true);
check('销量中位数 = (30+40)/2 = 35', q.qtyMid === 35, String(q.qtyMid));
// 加权平均每份 CM = (10×10+20×15+30×20+40×25+50×30+60×35)/210 = 5600/210 ≈ 26.67 元 = 2667 分
check('分界线 = 加权平均每份毛利额 26.67 元（不是各菜百分比/金额的简单平均）',
  Math.abs(q.cmAvgFen - 2667) <= 1, String(q.cmAvgFen) + ' 分');

const cell = (k) => q.cells.find((c) => c.key === k);
const names = (k) => (cell(k).names || []).join(',');
// 高销(≥35)：D(40,25) E(50,30) F(60,35)；≥26.67 的 E/F = star，D = traffic
check('卖得好又真赚钱（star）= F,E（销量≥35 且每份 CM ≥26.67）', names('star') === 'F,E', names('star'));
check('卖得多、每份留得少（traffic）= D', names('traffic') === 'D', names('traffic'));
check('每份赚钱、点的人少（potential）：本样本应为空（C 销量 30<35 但 CM 20<26.67）',
  names('potential') === '', 'potential=' + names('potential'));
check('四格数量之和 = 参与分档的菜数', q.cells.reduce((s, c) => s + c.count, 0) === 6);

// ===== B. 四条静默失败 =====
console.log('===== B · 四条静默失败 =====');
const SPIKE = [row('爆款', 300, 20)].concat([1, 2, 3, 4, 5].map((i) => row('小' + i, 20, 20)));
const qs = build(SPIKE);
check('① 有 300 份爆款时销量中位数仍 = 20（若用平均数会是 66.7）',
  qs.qtyMid === 20, String(qs.qtyMid));

const FREE = SIX.map((r) => ({ name: r.name, qty: r.qty, grossFen: null, category: '', hasMargin: false }));
const qf = build(FREE);
check('② 免费档（grossFen=null / hasMargin=false）⇒ ok=false，不产生任何格子',
  qf.ok === false && qf.cells.length === 0, 'ok=' + qf.ok);

const WITHZERO = SIX.concat([row('Z1', 0, 40), row('Z2', 0, 40)]);
const qz = build(WITHZERO);
check('③ 零销量菜被排除（不参与分档、中位数不被 0 拉低）',
  qz.qtyMid === 35 && qz.total === 6, `qtyMid=${qz.qtyMid} total=${qz.total}`);

const qfew = build(SIX.slice(0, 5));
check('④ 只有 5 道 ⇒ ok=false（不满 6 道不给结论）', qfew.ok === false);
check('④ 明确说出"差多少"（needText 含数字 6）',
  typeof qfew.needText === 'string' && qfew.needText.indexOf('6') >= 0, qfew.needText);

// ===== C. 分类目比（R781 新增，防跨类目误判）=====
console.log('===== C · 分类目比（主菜跟主菜比）=====');
// 设计要点：可乐**绝对销量低（40 份）但在饮品类目内是最高的** —— 这才是跨类目比最坑的形态。
//   分类目比：饮品组内 40 ≥ 35(中位数) ⇒ 高销量、每份 3 < 3.19(加权平均) ⇒ traffic（卖得多留得少）
//   合并成一个类目：40 < 100(全局中位数)、3 < 17.6(全局加权) ⇒ 掉进 cut（不赚钱也卖不动）✗
const CROSS = [
  row('红烧肉', 200, 25, '热菜'), row('宫保鸡丁', 180, 20, '热菜'), row('麻婆豆腐', 160, 15, '热菜'),
  row('可乐', 40, 3, '饮品'), row('酸梅汤', 35, 4, '饮品'), row('豆浆', 30, 2.5, '饮品'),
];
const qc = build(CROSS);
const nmC = (k) => ((qc.cells.find((c) => c.key === k).names) || []).join(',');
check('⑤ 可乐（40 份、每份 3 元）在饮品类目内是**高销量**，不得被判「不赚钱也卖不动」',
  nmC('cut').indexOf('可乐') < 0, 'cut=' + nmC('cut'));
check('⑤ 可乐在饮品类目内相对最赚 ⇒ 归入 star 或 traffic',
  (nmC('star') + nmC('traffic')).indexOf('可乐') >= 0,
  'star=' + nmC('star') + ' traffic=' + nmC('traffic'));
check('⑤ 红烧肉不得因"每份 25 元远高于可乐"被判成潜力股（那是跨类目比的假象）',
  nmC('potential').indexOf('红烧肉') < 0, 'potential=' + nmC('potential'));

// 反证：抹掉类目后可乐会掉进 cut ⇒ 证明分类目这步真的起作用
const MERGED = CROSS.map((r) => ({ name: r.name, qty: r.qty, grossFen: r.grossFen, category: '', hasMargin: true }));
const qm2 = build(MERGED);
const nmM = (k) => ((qm2.cells.find((c) => c.key === k).names) || []).join(',');
check('⑤ 反证：抹掉类目后可乐会掉进「不赚钱也卖不动」⇒ 分类目比不是装饰',
  nmM('cut').indexOf('可乐') >= 0, 'merged cut=' + nmM('cut'));

// ===== D. 单菜样本门槛（R781 新增）=====
console.log('===== D · 单菜样本门槛 =====');
const LOW = SIX.concat([row('试销1', 3, 30), row('试销2', 2, 30)]);
const ql2 = build(LOW);
const lowTexts = ql2.cells.map((c) => c.lowSampleText).filter(Boolean).join(' | ');
check('⑥ 卖不到 10 份的菜要标"样本不足"（不许直接贴强标签让老板砍试销款）',
  !!lowTexts && lowTexts.indexOf('样本') >= 0, lowTexts || '无提示');

// ===== E. 整店每份毛利额为负 =====
console.log('===== E · 整店每份毛利额为负 =====');
const ALLLOSS = [
  row('亏1', 100, -5), row('亏2', 90, -8), row('亏3', 80, -10),
  row('亏4', 20, -15), row('亏5', 10, -20), row('亏6', 5, -30),
];
const qal = build(ALLLOSS);
check('⑦ 每份毛利额加权平均 < 0 ⇒ ok=false（不许贴「卖得好、也真赚钱」）', qal.ok === false, 'ok=' + qal.ok);
check('⑦ reason = all_loss（页面据此区分"菜太少"与"全在亏"）', qal.reason === 'all_loss', String(qal.reason));
check('⑦ 给的是「先解决定价」这类提示，不是四类建议',
  typeof qal.notText === 'string' && qal.notText.indexOf('定价') > 0, qal.notText);

const MIXED = [
  row('正1', 100, 40), row('正2', 90, 35), row('正3', 80, 30),
  row('正4', 70, 25), row('亏1', 60, -10), row('亏2', 50, -20),
];
const qmx = build(MIXED);
check('⑦ 对照：混合（有赚有亏但加权平均 > 0）仍正常出四象限', qmx.ok === true, 'ok=' + qmx.ok);

// ===== F. 展示字段与集中度（R781）=====
console.log('===== F · 展示字段与集中度 =====');
const big = build([
  row('菜1', 100, 50), row('菜2', 90, 49), row('菜3', 80, 48),
  row('菜4', 70, 47), row('菜5', 10, 5), row('菜6', 9, 4), row('菜7', 8, 3),
]);
const starBig = big.cells.find((c) => c.key === 'star');
check('F-① 每格最多列 3 个菜名', starBig.names.length <= 3, String(starBig.names.length));
check('F-② 超出 3 个时给"还有 N 道"', !!starBig.moreText, starBig.moreText);
check('F-③ 格内按**总毛利额**降序（谁最值得先处理排最前）',
  starBig.names[0] === '菜1', String(starBig.names[0]));
check('F-④ 集中度：给出"前 N 道贡献 X%"，且 N 至少 1',
  typeof big.concText === 'string' && big.concText.length > 0 && big.concTopN >= 1, big.concText);
check('F-⑤ 集中度百分比 ∈ [0,100]（分母为 0 时给 null 不出无穷大）',
  big.concPct === null || (big.concPct >= 0 && big.concPct <= 100), String(big.concPct));

// ===== G. 变异自证 =====
console.log('===== G · 变异自证 =====');
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
check('变异①：这道题用平均数会得 66.7（≠ 中位数 20）⇒ A/B 组有分辨力',
  Math.round(avg([300, 20, 20, 20, 20, 20]) * 10) / 10 === 66.7);
check('变异②：若不过滤 hasMargin，免费档 6 道会全落 cut ⇒ 与 ok=false 的结论相反',
  FREE.filter((r) => r.hasMargin).length === 0 && qf.ok === false);
check('变异③：把类目强行合并后可乐必落 cut ⇒ 证明分类目比有分辨力',
  nmM('cut').indexOf('可乐') >= 0);

console.log(`\n==== 四象限守卫结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
