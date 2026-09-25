// _m3_sim.js —— M3 成本核算「按现状推导模拟」探针（round125）
// 目的：不手算，直接 require 两份**生产引擎**跑数据，看当前实现能算什么、算成什么样。
//   引擎A = cloudfunctions/calcBom/service.js        （反算/预览用）
//   引擎B = cloudfunctions/saveCostCard/service.js   （落库用）
// 全部结论必须来自本脚本的真实输出，不得事后口述数字。

const path = require('path');
const R = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/cloudfunctions';
const A = require(path.join(R, 'calcBom/service.js'));
const B = require(path.join(R, 'saveCostCard/service.js'));

const yuan = (fen) => (fen / 100).toFixed(2);
const line = (s) => console.log(s);

// ============ 0. 两份引擎是否同源（逐点对拍） ============
line('========== 0. 双引擎对拍（calcBom vs saveCostCard） ==========');
function randCase(rnd) {
  const n = 1 + Math.floor(rnd() * 8);
  const lines = [];
  for (let i = 0; i < n; i++) lines.push({ quantity: Math.round(rnd() * 900) + 1, net_unit_cost: Math.round(rnd() * 5000) });
  return {
    mode: rnd() < 0.5 ? 'A' : 'B',
    lines,
    auxFen: Math.round(rnd() * 800),
    lossPct: Math.round(rnd() * 20),
    batchOutput: 1 + Math.round(rnd() * 20),
    priceFen: Math.round(rnd() * 10000),
    targetMarginPct: Math.round(rnd() * 80),
  };
}
let seed = 20260925;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let mismatch = 0, firstDiff = null;
for (let t = 0; t < 5000; t++) {
  const c = randCase(rnd);
  const ra = A.calcCostCard(c);
  const rb = B.calcCostCard(c);
  const keys = ['material_total_fen', 'unit_cost_fen', 'batch_total_fen', 'gross_profit_fen', 'gross_margin_pct', 'reverse_price_fen'];
  for (const k of keys) {
    if (ra[k] !== rb[k]) { mismatch++; if (!firstDiff) firstDiff = { t, k, a: ra[k], b: rb[k], c }; break; }
  }
  if (mismatch > 3) break;
}
line(`随机 5000 组对拍：不一致 = ${mismatch} 处`);
if (firstDiff) line('  首处差异: ' + JSON.stringify(firstDiff));

// 净料单位成本函数也对拍
let nw = 0;
for (let t = 0; t < 20000; t++) {
  const pp = 1 + Math.floor(rnd() * 20000), cf = [250, 500, 1000, 100, 1][Math.floor(rnd() * 5)], yr = 1 + Math.floor(rnd() * 100);
  if (A.netUnitCostWan(pp, cf, yr) !== B.netUnitCostWan(pp, cf, yr)) nw++;
}
line(`netUnitCostWan 随机 20000 组：不一致 = ${nw} 处`);

// ============ 1. S3 官方锚点复核（引擎是否仍命中锁定值） ============
line('');
line('========== 1. S3 官方锚点复核（规范锁定值） ==========');
const gbLines = [
  { quantity: 200, net_unit_cost: A.netUnitCostWan(1500, 500, 90) },  // 鸡胸肉 15元/斤 出成90%
  { quantity: 50, net_unit_cost: A.netUnitCostWan(1000, 500, 100) }, // 花生米 10元/斤
  { quantity: 10, net_unit_cost: A.netUnitCostWan(2000, 500, 100) }, // 干辣椒 20元/斤
  { quantity: 30, net_unit_cost: A.netUnitCostWan(500, 500, 100) },  // 葱姜蒜 5元/斤
  { quantity: 20, net_unit_cost: A.netUnitCostWan(1000, 500, 100) }, // 调料油 10元/斤
];
const gb = A.calcCostCard({ mode: 'A', lines: gbLines, auxFen: 50, lossPct: 5, priceFen: 2800, targetMarginPct: 60 });
line(`宫保鸡丁 明细合计=${yuan(gb.material_total_fen)} 总成本=${yuan(gb.unit_cost_fen)} (期望 9.75) 毛利=${yuan(gb.gross_profit_fen)} (期望 18.25) 毛利率=${gb.gross_margin_pct}% (期望 65.18) 反算60%=${yuan(gb.reverse_price_fen)} (期望 24.38)`);
line(`  逐行净料万分快照 = [${gbLines.map((l) => l.net_unit_cost).join(', ')}]`);

const hongYou = A.calcCostCard({
  mode: 'B',
  lines: [
    { quantity: 500, net_unit_cost: A.netUnitCostWan(2000, 500, 100) }, // 牛油 20元/斤
    { quantity: 200, net_unit_cost: A.netUnitCostWan(2000, 500, 100) }, // 干辣椒 20元/斤
    { quantity: 50, net_unit_cost: A.netUnitCostWan(4000, 500, 100) },  // 花椒 40元/斤
    { quantity: 300, net_unit_cost: A.netUnitCostWan(800, 500, 100) },  // 豆瓣酱 8元/斤
    { quantity: 50, net_unit_cost: A.netUnitCostWan(6000, 500, 100) },  // 香料 60元/斤
  ],
  auxFen: 200, lossPct: 0, batchOutput: 10,
});
line(`红油底料 整批=${yuan(hongYou.batch_total_fen)} (期望 44.80) 单份=${yuan(hongYou.unit_cost_fen)} (期望 4.48)`);

const xiangGuo = A.calcCostCard({
  mode: 'A',
  lines: [
    { quantity: 1, net_unit_cost: hongYou.unit_cost_fen * 100 },       // 红油底料 1 份 4.48
    { quantity: 500, net_unit_cost: A.netUnitCostWan(300, 500, 100) }, // 时蔬拼盘 3元/斤
    { quantity: 100, net_unit_cost: A.netUnitCostWan(2000, 500, 100) },// 肉丸 20元/斤
  ],
  auxFen: 50, lossPct: 3, priceFen: 3800,
});
line(`麻辣香锅 明细合计=${yuan(xiangGuo.material_total_fen)} (期望 11.48) 总成本=${yuan(xiangGuo.unit_cost_fen)} (期望 12.35) 毛利率=${xiangGuo.gross_margin_pct}% (期望 67.50)`);

// ============ 2. 真实门店数据推导（耙三样自造数据） ============
line('');
line('========== 2. 真实门店数据推导（我按耙三样实际填） ==========');
// 原料档案：[名称, 采购单价(分), 换算系数, 出成率%]
const MAT = [
  ['牛腩（耙牛肉主料）', 3800, 500, 75],
  ['牛筋', 3000, 500, 80],
  ['土豆', 300, 500, 100],
  ['白萝卜', 150, 500, 85],
  ['干辣椒', 2000, 500, 100],
  ['花椒', 4000, 500, 100],
  ['郫县豆瓣酱', 800, 500, 100],
  ['牛油', 2000, 500, 100],
  ['香菜', 600, 500, 90],
  ['食用油', 1000, 500, 100],
];
const M = {};
line('原料档案（净料单位成本由生产引擎算）：');
for (const [name, pp, cf, yr] of MAT) {
  const wan = A.netUnitCostWan(pp, cf, yr);
  M[name] = wan;
  line(`  ${name.padEnd(20, '　')} 采购 ${yuan(pp)}元/${cf}g 出成${yr}%  ⇒ 净料 ${(wan / 10000).toFixed(4)} 元/g`);
}

line('');
line('菜品①　耙牛肉（单份 · 模式A）售价 68 元');
const pa = A.calcCostCard({
  mode: 'A',
  lines: [
    { quantity: 300, net_unit_cost: M['牛腩（耙牛肉主料）'] },
    { quantity: 100, net_unit_cost: M['牛筋'] },
    { quantity: 200, net_unit_cost: M['土豆'] },
    { quantity: 150, net_unit_cost: M['白萝卜'] },
    { quantity: 15, net_unit_cost: M['干辣椒'] },
    { quantity: 8, net_unit_cost: M['花椒'] },
    { quantity: 40, net_unit_cost: M['郫县豆瓣酱'] },
    { quantity: 10, net_unit_cost: M['香菜'] },
  ],
  auxFen: 150, lossPct: 6, priceFen: 6800,
});
line(`  明细合计=${yuan(pa.material_total_fen)}  总成本=${yuan(pa.unit_cost_fen)}  毛利=${yuan(pa.gross_profit_fen)}  毛利率=${pa.gross_margin_pct}%`);

line('');
line('菜品②　红油底料（批量预制 · 模式B · 产出10份）—— 第1层BOM');
const hd = A.calcCostCard({
  mode: 'B',
  lines: [
    { quantity: 500, net_unit_cost: M['牛油'] },
    { quantity: 200, net_unit_cost: M['干辣椒'] },
    { quantity: 50, net_unit_cost: M['花椒'] },
    { quantity: 300, net_unit_cost: M['郫县豆瓣酱'] },
  ],
  auxFen: 200, lossPct: 0, batchOutput: 10,
});
line(`  整批总成本=${yuan(hd.batch_total_fen)}  单份=${yuan(hd.unit_cost_fen)}  ⇒ 虚拟原料「红油底料」单价 ${yuan(hd.unit_cost_fen)} 元/份`);

line('');
line('菜品③　香锅牛杂（引用半成品 · 模式A）售价 58 元 —— 第2层BOM');
const xg = A.calcCostCard({
  mode: 'A',
  lines: [
    { quantity: 1, net_unit_cost: hd.unit_cost_fen * 100 },
    { quantity: 200, net_unit_cost: M['牛筋'] },
    { quantity: 150, net_unit_cost: M['土豆'] },
    { quantity: 10, net_unit_cost: M['香菜'] },
  ],
  auxFen: 80, lossPct: 3, priceFen: 5800,
});
line(`  明细合计=${yuan(xg.material_total_fen)}  总成本=${yuan(xg.unit_cost_fen)}  毛利=${yuan(xg.gross_profit_fen)}  毛利率=${xg.gross_margin_pct}%`);

// ============ 3. 现状能力探针：设想里的能力，引擎层能否表达 ============
line('');
line('========== 3. 现状能力探针（试图表达 v1.0/v1.1 设想） ==========');

// 3.1 多规格：同一道菜大份/小份，能否表达？
line('[3.1 多规格] 尝试用两行"同一原料不同用量"表达 —— 结果：会变成同一张卡里的两条明细，不是两个规格');
const spec = A.calcCostCard({ mode: 'A', lines: [{ quantity: 300, net_unit_cost: M['牛腩（耙牛肉主料）'] }, { quantity: 150, net_unit_cost: M['牛腩（耙牛肉主料）'] }], auxFen: 0, lossPct: 0, priceFen: 0 });
line(`  同原料两行合计 = ${yuan(spec.material_total_fen)}（= 450g 一份，而非"大份/小份两张卡"）`);

// 3.2 赠品/零价行：引擎能否接受 qty=0？
try {
  const gift = A.calcCostCard({ mode: 'A', lines: [{ quantity: 0, net_unit_cost: M['香菜'] }], auxFen: 0, lossPct: 0, priceFen: 0 });
  line(`[3.2 零价/赠品行] 引擎接受 qty=0 ⇒ 合计 ${yuan(gift.material_total_fen)}，但 validate.js 要求 qty>0 ⇒ 保存会被拒`);
} catch (e) { line('[3.2 零价/赠品行] 引擎抛错: ' + e.message); }

// 3.3 售价低于成本：引擎会不会报警？
const below = A.calcCostCard({ mode: 'A', lines: [{ quantity: 300, net_unit_cost: M['牛腩（耙牛肉主料）'] }], auxFen: 0, lossPct: 0, priceFen: 1000 });
line(`[3.3 售价低于成本] 成本 ${yuan(below.unit_cost_fen)} vs 售价 10.00 ⇒ 毛利 ${yuan(below.gross_profit_fen)}（负），引擎**不报错**，照常返回；预警须前端做`);

// 3.4 外卖渠道：引擎入参有没有渠道/佣金位置？
line('[3.4 外卖/渠道] 引擎入参字段 = ' + JSON.stringify(Object.keys(A.calcCostCard({ mode: 'A', lines: [], auxFen: 0, lossPct: 0, priceFen: 0 }))) + ' —— 无 channel / commission / 到手价 任何位置');

// 3.5 套餐：能否用一张卡汇总多道菜？
line('[3.5 套餐] 引擎只认 lines[{quantity,net_unit_cost}]；没有"引用某张成本卡"的入参 ⇒ 套餐在引擎层无位置');

// 3.6 目标毛利率反算的边界
line('[3.6 反算边界] 目标毛利率=100% ⇒ reverse=' + A.calcCostCard({ mode: 'A', lines: [{ quantity: 100, net_unit_cost: 1000 }], auxFen: 0, lossPct: 0, priceFen: 0, targetMarginPct: 100 }).reverse_price_fen + '（0=拒绝，符合 <100 约束）');

// ============ 4. 精度纪律探针：浮点累积 vs 整数高精度 ============
line('');
line('========== 4. 精度探针（规范要求整数累积，实现用双精度累积） ==========');
seed = 777;
const rnd2 = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let fenDiff = 0, example = null;
for (let t = 0; t < 200000; t++) {
  const n = 1 + Math.floor(rnd2() * 60);
  const lines = [];
  for (let i = 0; i < n; i++) lines.push({ quantity: Math.round(rnd2() * 2000) + 1, net_unit_cost: Math.round(rnd2() * 9999) + 1 });
  const got = A.calcCostCard({ mode: 'A', lines, auxFen: 0, lossPct: 0, priceFen: 0 }).material_total_fen;
  // 精确参照：Σ(qty × wan) 为整数（单位 1e-4 元·g），÷100 后 round
  let S = 0;
  for (const l of lines) S += l.quantity * l.net_unit_cost; // 整数，安全范围内精确
  const want = Math.round(S / 100);
  if (got !== want) { fenDiff++; if (!example) example = { n, got, want, lines: lines.slice(0, 3) }; }
  if (fenDiff > 2) break;
}
line(`随机 20 万组（1~60 行）「浮点累积 vs 整数精确」出现 1 分差异 = ${fenDiff} 次`);
if (example) line('  反例: ' + JSON.stringify(example));

// 4.2 模式B：整批先round再除份数 vs 整批高精度除份数
seed = 4242;
const rnd3 = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let bDiff = 0, bEx = null;
for (let t = 0; t < 200000; t++) {
  const lines = [{ quantity: Math.round(rnd3() * 5000) + 1, net_unit_cost: Math.round(rnd3() * 9999) + 1 }];
  const auxFen = Math.round(rnd3() * 999);
  const out = 1 + Math.round(rnd3() * 30);
  const got = A.calcCostCard({ mode: 'B', lines, auxFen, lossPct: 0, batchOutput: out, priceFen: 0 }).unit_cost_fen;
  const exactBatchWan = lines[0].quantity * lines[0].net_unit_cost; // 1e-4元·g → 元: /10000
  const exactFen = (exactBatchWan / 10000 + auxFen / 100) * 100;     // 分（高精度）
  const want = Math.round(exactFen / out);
  if (got !== want) { bDiff++; if (!bEx) bEx = { got, want, auxFen, out, line: lines[0] }; }
  if (bDiff > 2) break;
}
line(`模式B 随机 20 万组「整批先round再除 vs 高精度除后round」差异 = ${bDiff} 次`);
if (bEx) line('  反例: ' + JSON.stringify(bEx));

// ============ 5. 判环函数探针 ============
line('');
line('========== 5. 循环引用判环探针 ==========');
// 正常 DAG（菱形）：新卡 X 引用 B、C；B→D，C→D（D 是既有半成品）
const edges = new Map([['B', ['D']], ['C', ['D']], ['D', []]]);
line(`菱形 DAG（X→B→D, X→C→D）判环 = ${B.wouldCreateCycle('X', ['B', 'C'], edges)}（应 false）`);
// 真环：新卡 X 引用 B；B 引用 X'
const edges2 = new Map([['B', ['X']]]);
line(`真环（X→B, B→X）判环 = ${B.wouldCreateCycle('X', ['B'], edges2)}（应 true）`);
// 深链：X→B→C→D→E→F（6 层）
const edges3 = new Map([['B', ['C']], ['C', ['D']], ['D', ['E']], ['E', ['F']], ['F', []]]);
line(`6 层无环链（X→B→…→F）判环 = ${B.wouldCreateCycle('X', ['B'], edges3)}（应 false；MAX_DEPTH=${B.MAX_DEPTH}，超深即判环）`);

line('');
line('========== 探针结束 ==========');
