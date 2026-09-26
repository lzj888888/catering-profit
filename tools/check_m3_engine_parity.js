// tools/check_m3_engine_parity.js —— R131 · M3 计算引擎多副本「行为等价」守卫
//
// ===== 为什么立这条（v1.1 M3.27 R131 / round129 挂载）=====
// M3 的成本计算内核在**多份 service.js 里各有一份副本**（本仓不允许跨云函数共享代码，
// 只能靠扁平派生副本），规范 v1.1 §2 定的路线是「**引擎零改动，靠入参变换 + 后置渠道层**」。
// 这个路线成立的前提只有一个：**各副本必须行为等价**。
//
// 🔴 一旦某一份被单独改坏，会出现的症状是「**同一张卡，算两条不同的成本**」：
//   · 列表页走 getCostCard 的落库值（保存时 calcBom 算的）
//   · 「同步至最新价」走 syncCostCard 自己那份
//   · 保存走 saveCostCard 那份
//   ⇒ 没有任何报错、没有异常、只是**数字悄悄不一样**。这与 R130（写库静默 0 行）同族：
//     **静默错** 比 报错 危险得多。
//
// ===== 本轮实测的两种「合法差异」（先说清，免得后人误判）=====
// ① 文本**不**逐字等价：calcBom 版把 `(分/100)/系数/(出成/100)` 抽成了辅助函数
//    `purchasePerGramYuan(...)`；另两副本是内联写法。`calcCostCard` 里 calcBom 调
//    `lineNetCostYuan(qty, wan)`，另两副本内联 `qty * (wan / 10000)`。
//    ⇒ **数学等价、文本不同**。所以本守卫判**行为**，不判文本（判文本会假红）。
// ② 各副本**并不都含全部具名函数**：`getCostCard` / `getCardVersions` 是纯出参映射层，
//    一个计算函数都没有；`wouldCreateCycle` 只在 saveCostCard 侧。
//    ⇒ 不能断言「5 份都有 4 个函数」，那只会在真因之外的位置翻红。
//
// ===== 本守卫判据 =====
// A. 三份含计算内核的副本（calcBom / saveCostCard / syncCostCard）均可 require，
//    且 `calcCostCard` 是函数（非退化：确认判据真的跑起来了）。
// B. **确定性伪随机 3000+ 组**输入，三份副本输出**逐字节一致**（比对 5 个金额字段 + 明细行）。
// C. **S3 既有锚点回归**：用生产引擎复算 v1.0 M3.11 的宫保鸡丁与红油底料，必须命中。
//    （这一条同时是「引擎本身没坏」的铁证 —— 改动任一副本都会被它抓到。）
// D. **反恒真（正负互证）**：对拍必须**有分辨力** —— 故意构造一个有差异的变体，
//    断言对拍**判它不等**。否则「0 不一致」可能只是因为比了个恒等的东西（假绿）。
// E. 断言数下界（防后人删断言）。

const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CF = path.join(REPO, 'cloudfunctions');

// 含计算内核的三份副本（顺序即对拍基准：第一份为基准）
const COPIES = ['calcBom', 'saveCostCard', 'syncCostCard'];
// 出参里参与比对的金额字段（整数分或百分数）
const KEYS = ['unit_cost_fen', 'material_total_fen', 'gross_profit_fen', 'gross_margin_pct', 'reverse_price_fen', 'batch_total_fen'];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('✅ ' + m); };
const no = (m) => { fail++; console.log('❌ ' + m); };
const check = (m, c) => (c ? ok(m) : no(m));

// ===================== 载入副本 =====================
console.log('===== A. 副本可加载（非退化）=====');

const mods = {};
for (const c of COPIES) {
  const p = path.join(CF, c, 'service.js');
  let m = null, err = null;
  try { m = require(p); } catch (e) { err = (e && e.message) || String(e); }
  mods[c] = m;
  check('A 副本 ' + c + '/service.js 可 require 且 calcCostCard 是函数',
    !!m && typeof m.calcCostCard === 'function');
  if (err) console.log('    ↳ require 失败原因：' + err);
}
check('A-非退化：三份副本全部载入（0 份 = 判据没跑起来）',
  COPIES.every((c) => mods[c] && typeof mods[c].calcCostCard === 'function'));

// 另两份副本存在但**不含计算函数**（如实登记其角色，防止后人以为漏了）
for (const c of ['getCostCard', 'getCardVersions']) {
  let m = null;
  try { m = require(path.join(CF, c, 'service.js')); } catch (e) { m = null; }
  check('A-登记：' + c + '/service.js 为纯映射层（不含 calcCostCard，故不参与对拍）',
    !!m && typeof m.calcCostCard !== 'function');
}

// ===================== 确定性输入 =====================
let seed = 20260926;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function makeCase(nLines) {
  const lines = [];
  for (let i = 0; i < nLines; i++) {
    lines.push({
      material_id: 'm' + i,
      material_name: 'mat' + i,
      quantity: Math.round(1 + rnd() * 500),
      net_unit_cost: Math.round(100 + rnd() * 50000),
      input_type: 1,
    });
  }
  const mode = rnd() < 0.3 ? 'B' : 'A';
  return {
    lines,
    mode,
    lossPct: Math.round(rnd() * 900) / 100,
    auxFen: Math.round(rnd() * 5000),
    batchOutput: mode === 'B' ? Math.round(1 + rnd() * 20) : 0,
    priceFen: Math.round(rnd() * 10000),
    targetMarginPct: Math.round(rnd() * 80),
  };
}
function sig(out) {
  if (!out || typeof out !== 'object') return JSON.stringify(out);
  return KEYS.map((k) => k + '=' + String(out[k])).join('|') +
    '||lines=' + JSON.stringify((out.lines || []).map((l) => [l.quantity, l.net_unit_cost, l.line_net_cost_fen]));
}

// ===================== 对拍 =====================
console.log('');
console.log('===== B. 三副本行为对拍（确定性 3000 组）=====');

const CASES = 3000;
let compared = 0, diff = 0, nonEmpty = 0;
const samples = [];
for (let t = 0; t < CASES; t++) {
  const p = makeCase(1 + Math.floor(rnd() * 12));
  let base = null;
  for (const c of COPIES) {
    if (!mods[c]) continue;
    let out;
    try { out = mods[c].calcCostCard(p); } catch (e) { out = { __err: (e && e.msg) || String(e) }; }
    const s = sig(out);
    if (out && out.unit_cost_fen != null) nonEmpty++;
    if (base === null) { base = { c, s }; continue; }
    compared++;
    if (s !== base.s) {
      diff++;
      if (samples.length < 3) samples.push({ t, base_c: base.c, oth_c: c, base: base.s.slice(0, 220), oth: s.slice(0, 220) });
    }
  }
}
check('B-① 对拍组数 ≥ 5000（非退化：真的比了这么多）', compared >= 5000);
check('B-② 三副本输出不一致数 = 0（实测 ' + diff + '）', diff === 0);
check('B-③ 非退化：受测输出里 unit_cost_fen 非空计数 > 0（实测 ' + nonEmpty + '）', nonEmpty > 0);
if (diff) {
  for (const s of samples) {
    console.log('    反例 t=' + s.t + ' [' + s.base_c + ' vs ' + s.oth_c + ']');
    console.log('      base: ' + s.base);
    console.log('      oth : ' + s.oth);
  }
}

// ===================== S3 锚点回归 =====================
console.log('');
console.log('===== C. S3 既有锚点回归（生产引擎实算）=====');

// v1.0 M3.11.1 宫保鸡丁：净料单位成本（万分之一元）由 S3.1 的采购价/换算/出成率推出
const GONGBAO = {
  lines: [
    { material_id: 'a', material_name: '鸡胸肉', quantity: 200, net_unit_cost: 333, input_type: 1 },
    { material_id: 'b', material_name: '花生米', quantity: 50, net_unit_cost: 200, input_type: 1 },
    { material_id: 'c', material_name: '干辣椒', quantity: 10, net_unit_cost: 400, input_type: 1 },
    { material_id: 'd', material_name: '葱姜蒜', quantity: 30, net_unit_cost: 100, input_type: 1 },
    { material_id: 'e', material_name: '调料油', quantity: 20, net_unit_cost: 200, input_type: 1 },
  ],
  mode: 'A', lossPct: 5, auxFen: 50, batchOutput: 0, priceFen: 2800, targetMarginPct: 60,
};
const HONGYOU = {
  lines: [
    { material_id: 'a', material_name: '牛油', quantity: 500, net_unit_cost: 400, input_type: 1 },
    { material_id: 'b', material_name: '干辣椒', quantity: 200, net_unit_cost: 400, input_type: 1 },
    { material_id: 'c', material_name: '花椒', quantity: 50, net_unit_cost: 800, input_type: 1 },
    { material_id: 'd', material_name: '豆瓣酱', quantity: 300, net_unit_cost: 160, input_type: 1 },
    { material_id: 'e', material_name: '香料', quantity: 50, net_unit_cost: 1200, input_type: 1 },
  ],
  mode: 'B', lossPct: 0, auxFen: 200, batchOutput: 10, priceFen: 0, targetMarginPct: 0,
};

const gb = mods.calcBom ? mods.calcBom.calcCostCard(GONGBAO) : null;
check('C-① 宫保鸡丁 unit_cost_fen = 975（实测 ' + (gb && gb.unit_cost_fen) + '）', !!gb && gb.unit_cost_fen === 975);
check('C-② 宫保鸡丁 material_total_fen = 876（实测 ' + (gb && gb.material_total_fen) + '）', !!gb && gb.material_total_fen === 876);
check('C-③ 宫保鸡丁 gross_profit_fen = 1825（实测 ' + (gb && gb.gross_profit_fen) + '）', !!gb && gb.gross_profit_fen === 1825);
check('C-④ 宫保鸡丁 gross_margin_pct = 65.18（实测 ' + (gb && gb.gross_margin_pct) + '）', !!gb && gb.gross_margin_pct === 65.18);
check('C-⑤ 宫保鸡丁 reverse_price_fen = 2438（目标毛利率 60%，实测 ' + (gb && gb.reverse_price_fen) + '）', !!gb && gb.reverse_price_fen === 2438);

const hy = mods.calcBom ? mods.calcBom.calcCostCard(HONGYOU) : null;
check('C-⑥ 红油底料（模式 B）batch_total_fen = 4480（实测 ' + (hy && hy.batch_total_fen) + '）', !!hy && hy.batch_total_fen === 4480);
check('C-⑦ 红油底料 单份 unit_cost_fen = 448（实测 ' + (hy && hy.unit_cost_fen) + '）', !!hy && hy.unit_cost_fen === 448);
check('C-⑧ 锚点回归在三份副本上同时成立（任一副本漂了即红）',
  COPIES.every((c) => {
    if (!mods[c]) return false;
    try {
      const o1 = mods[c].calcCostCard(GONGBAO), o2 = mods[c].calcCostCard(HONGYOU);
      return o1.unit_cost_fen === 975 && o2.batch_total_fen === 4480;
    } catch (e) { return false; }
  }));

// ===================== 反恒真：对拍必须有分辨力 =====================
console.log('');
console.log('===== D. 反恒真（对拍必须能分辨差异）=====');

// D-① 输入侧：只改 lossPct 1 个百分点 ⇒ 输出**必须**不同（否则对拍比的是恒等量）
const t1 = JSON.parse(JSON.stringify(GONGBAO));
const t2 = JSON.parse(JSON.stringify(GONGBAO));
t2.lossPct = 6;
check('D-① 输入敏感：lossPct 5→6 时输出必须不同（对拍有分辨力）',
  !!mods.calcBom && sig(mods.calcBom.calcCostCard(t1)) !== sig(mods.calcBom.calcCostCard(t2)));

// D-② 输入侧：只改一行用量 ⇒ 输出必须不同
const t3 = JSON.parse(JSON.stringify(GONGBAO));
t3.lines[0].quantity = 201;
check('D-② 输入敏感：明细用量 200→201 时输出必须不同',
  !!mods.calcBom && sig(mods.calcBom.calcCostCard(t1)) !== sig(mods.calcBom.calcCostCard(t3)));

// D-③ 变体实现：构造一个「差 1 分」的假引擎，断言对拍**判它不等**
//      —— 若这条绿，说明 B 段的「0 不一致」不是因为比较器瞎了。
function shiftedEngine(p) {
  const o = mods.calcBom.calcCostCard(p);
  return Object.assign({}, o, { unit_cost_fen: (o.unit_cost_fen || 0) + 1 });
}
check('D-③ 变体实现（unit_cost_fen 偏移 1 分）必须被对拍判为不等',
  sig(shiftedEngine(GONGBAO)) !== sig(mods.calcBom.calcCostCard(GONGBAO)));

// D-④ 模式语义：mode 非法必须抛错（R81 断言式白名单），三副本一致
check('D-④ mode 非法值时三副本均抛错（R81 一致性）',
  COPIES.every((c) => {
    if (!mods[c]) return false;
    try { mods[c].calcCostCard(Object.assign({}, GONGBAO, { mode: 'C' })); return false; }
    catch (e) { return true; }
  }));

// ===================== E：断言数下界 =====================
console.log('');
console.log('===== E. 覆盖度 =====');
const TOTAL = pass + fail;
// 下界取实测值的保守下沿（别凭估 —— 本仓已交过 4 次学费）。
// round129 首次实跑 = 22（含本条自身），取 18（留 4 条余量，防后续正常增删即红）。
check('E-① 断言数 ≥ 18（实测 22 的保守下沿）', TOTAL >= 18);

console.log('');
console.log('==== R131 M3 引擎多副本行为等价守卫：' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fail) {
  console.log('--- 违规要点 ---');
  console.log('  1) 若 B 段红：某份 service.js 的 calcCostCard 被单独改坏了 ——');
  console.log('     规范 v1.1 §2 要求「引擎零改动」，请回退该副本，改用入参变换实现需求。');
  console.log('  2) 若 C 段红：引擎本身的既有锚点漂了 —— 这是最高级别事故，先回退再查。');
  process.exit(1);
}
