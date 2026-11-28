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
// 🔴 R782：判据已从「加权平均 CM<0」改成「亏损菜占比 ≥80%」——加权平均会被单道巨亏拉负，
//   不能代表"整店在亏"（见下方 H-② 的反例）。这里的用例是 6 道全亏 ⇒ 占比 100%，新判据照样拦。
check('⑦ 亏损菜占比 ≥80% ⇒ ok=false（不许贴「卖得好、也每份留得多」）', qal.ok === false, 'ok=' + qal.ok);
check('⑦ reason = all_loss（页面据此区分"菜太少"与"全在亏"）', qal.reason === 'all_loss', String(qal.reason));
check('⑦ 给的是「先解决定价」这类提示，不是四类建议',
  typeof qal.notText === 'string' && qal.notText.indexOf('定价') > 0, qal.notText);

const MIXED = [
  row('正1', 100, 40), row('正2', 90, 35), row('正3', 80, 30),
  row('正4', 70, 25), row('亏1', 60, -10), row('亏2', 50, -20),
];
const qmx = build(MIXED);
check('⑦ 对照：4 赚 2 亏（亏损占 33%）仍正常出四象限', qmx.ok === true, 'ok=' + qmx.ok);

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

// ===== H. R782：交叉审计后的六处修正 =====
//   来源：`Desktop\豆包剪辑\00_总索引与决策\交叉审计_R781四象限_2026-11-28.md`
//   每条都对应一个"上线后会输出错误结论"的实测反例，不是防御性演练。
console.log('===== H · R782 审计修正 =====');

// H-① cut 格升序 —— 审计 §一 B：降序会把最亏的折叠进「还有 N 道」（实测占该格亏损 71.6%）
const CUT4 = [
  row('热1', 100, 30), row('热2', 90, 25), row('热3', 80, 20),
  row('亏1元', 4, -1), row('亏5元', 3, -5), row('亏50元', 2, -50), row('亏300元', 1, -300),
];
const cutCell = build(CUT4).cells.find((c) => c.key === 'cut');
check('H-① 🔴 cut 格按总毛利额**升序**：最亏的必须排第一，不许被折叠',
  !!cutCell && cutCell.names[0] === '亏300元', cutCell ? cutCell.names.join('、') : '无 cut 格');

// H-② 少数巨亏不许抹整页 —— 审计 §二 E 原病例
const FEW_BIG_LOSS = [];
for (let i = 0; i < 29; i++) FEW_BIG_LOSS.push(row('赚' + i, 10, 5));
FEW_BIG_LOSS.push(row('巨亏', 1000, -300));
const qFew = build(FEW_BIG_LOSS);
check('H-② 🔴 1 道巨亏把加权平均拉负 ⇒ **仍须出四象限**（改前整页抹掉 + 印「毛利都是负的」假话）',
  qFew.ok === true, 'ok=' + qFew.ok + (qFew.notText ? ' / ' + String(qFew.notText).slice(0, 16) : ''));
check('H-②b 部分亏损必须在顶部点名最亏那道（不许沉默）',
  typeof qFew.lossWarnText === 'string' && qFew.lossWarnText.indexOf('巨亏') >= 0,
  String(qFew.lossWarnText).slice(0, 30));

// H-③ 全亏闸门按占比 —— 测两侧（90% 拦 / 60% 放行；后者加权平均仍为负，正是改判据的分界）
const LOSS90 = [];
for (let i = 0; i < 9; i++) LOSS90.push(row('亏' + i, 10, -5));
LOSS90.push(row('赚', 10, 5));
const LOSS60 = [];
for (let i = 0; i < 6; i++) LOSS60.push(row('亏' + i, 10, -5));
for (let i = 0; i < 4; i++) LOSS60.push(row('赚' + i, 10, 5));
const q90 = build(LOSS90), q60 = build(LOSS60);
check('H-③ 🔴 亏损菜 90% ⇒ 拦（ok=false），且文案带真实道数',
  q90.ok === false && /\d+/.test(String(q90.notText)), String(q90.notText).slice(0, 30));
check('H-③b 亏损菜 60% ⇒ 放行（加权平均仍为负，但多数菜在赚 ⇒ 四象限有意义）',
  q60.ok === true, 'ok=' + q60.ok);

// H-④ 集中度含亏损菜时不许 >100% —— 审计 §二 I-2 原病例（改前实测 107.5%）
const CONC_LOSS = [
  row('大赚', 100, 10), row('小亏1', 10, -5), row('小亏2', 10, -5),
  row('小赚1', 10, 1), row('小赚2', 10, 1), row('小赚3', 10, 1),
];
const qConc = build(CONC_LOSS);
check('H-④ 🔴 有亏损菜时集中度仍 ≤100%（分母只算正毛利）',
  qConc.concPct === null || qConc.concPct <= 100, String(qConc.concPct));

// H-⑤ 没填类目 ⇒ 必须说「全店一起比」—— category 在默认建卡（novice）流程里不渲染，
//   所以「主菜跟主菜比」对绝大多数店是假话（审计 §二 H）
const NO_CAT = [
  row('热1', 200, 25), row('热2', 180, 20), row('热3', 160, 15), row('米饭', 300, 2),
  row('可乐', 40, 3), row('酸梅汤', 35, 4),
];
const qNoCat = build(NO_CAT);
check('H-⑤ 🔴 无类目 ⇒ scope=whole_shop（页面据此改说「全店一起比」）',
  qNoCat.scope === 'whole_shop', String(qNoCat.scope));
check('H-⑤b 无类目时说明里**不得**出现「同类目内」',
  typeof qNoCat.scopeText === 'string' && qNoCat.scopeText.indexOf('同类目内') < 0,
  String(qNoCat.scopeText).slice(0, 24));

// H-⑥ 混合类目 ⇒ 未归类的菜不进四格、单独列（审计 §二 D：2 道饮品 + 4 道无类目曾合并成 1 组混比）
const PART_CAT = [
  row('热1', 200, 25, '热菜'), row('热2', 180, 20, '热菜'), row('热3', 160, 15, '热菜'),
  row('饮1', 40, 3, '饮品'), row('饮2', 35, 4, '饮品'), row('饮3', 30, 2.5, '饮品'),
  row('没填类目', 50, 10),
];
const qPart = build(PART_CAT);
const sumPart = qPart.cells.reduce((s2, c) => s2 + c.count, 0);
check('H-⑥ 🔴 混合类目 ⇒ 未归类的 1 道不进四格（四格合计 6 道，不是 7）',
  sumPart === 6 && qPart.unclassifiedCount === 1, `四格 ${sumPart} / 未归类 ${qPart.unclassifiedCount}`);
check('H-⑥b 未归类必须说出来并带菜名，不许静默吞掉',
  typeof qPart.unclassifiedText === 'string' && qPart.unclassifiedText.indexOf('没填类目') >= 0,
  String(qPart.unclassifiedText).slice(0, 30));

console.log(`\n==== 四象限守卫结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
