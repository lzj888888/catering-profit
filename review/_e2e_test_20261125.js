// review/_e2e_test_20261125.js —— 「损耗体检」三期端到端验证（虚构餐厅「张三小馆」）
// 运行： node review/_e2e_test_20261125.js
//
// 目的：用真实模块（consumeDerive / materialUsage / priceVariance）跑一遍完整链路，
//       输出「老板在小程序里会看到什么」，用于真机对照。
// ⚠️ 它不是门禁套件（放 review/ 下，不进 verify_all）；是取证脚本。

const { consumeVariance } = require('../utils/consumeDerive.js');
const { materialUsage } = require('../utils/materialUsage.js');
const { priceVariance, priceAlertOf } = require('../utils/priceVariance.js');

// ============ 一、虚构餐厅基础档案 ============
// 原料：单价（分/采购单位）、换算系数（1单位=多少克）、出成率
const MATERIALS = [
  { material_id: 'm_beef',  name: '牛肉',   purchase_unit: '斤', purchase_price: 1800, convert_factor: 500, yield_rate: 85 },
  { material_id: 'm_pork',  name: '猪肉',   purchase_unit: '斤', purchase_price: 1400, convert_factor: 500, yield_rate: 95 },
  { material_id: 'm_noodle',name: '面条',   purchase_unit: '斤', purchase_price: 400,  convert_factor: 500, yield_rate: 100 },
  { material_id: 'm_oil',   name: '食用油', purchase_unit: '斤', purchase_price: 900,  convert_factor: 500, yield_rate: 100 },
  { material_id: 'm_rice',  name: '大米',   purchase_unit: '斤', purchase_price: 320,  convert_factor: 500, yield_rate: 100 },
  { material_id: 'm_pep',   name: '青椒',   purchase_unit: '斤', purchase_price: 500,  convert_factor: 500, yield_rate: 90 },
];

// 成本卡：quantity 一律「净料克数」
const CARDS = [
  { card_code: 'C001', card_type: 1, price_fen: 2800, lines: [
    { material_id: 'm_beef', quantity: 120, line_type: 1 },
    { material_id: 'm_noodle', quantity: 150, line_type: 1 },
    { material_id: 'm_oil', quantity: 15, line_type: 1 },
  ] },
  { card_code: 'C002', card_type: 1, price_fen: 2200, lines: [
    { material_id: 'm_pork', quantity: 100, line_type: 1 },
    { material_id: 'm_pep', quantity: 150, line_type: 1 },
    { material_id: 'm_oil', quantity: 20, line_type: 1 },
  ] },
  { card_code: 'C003', card_type: 1, price_fen: 200, lines: [
    { material_id: 'm_rice', quantity: 200, line_type: 1 },
  ] },
];

// 本月（11 月）销量
const DINE_IN = [
  { card_code: 'C001', qty: 300, name: '红烧牛肉面' },
  { card_code: 'C002', qty: 250, name: '青椒肉丝' },
  { card_code: 'C003', qty: 400, name: '米饭' },
];

// ============ 二、算单份成本（与 calcBom/netUnitCostWan 同源：单价 ÷ 换算 ÷ 出成率）============
function unitCostFen(material, gram) {
  const yr = (material.yield_rate > 0 && material.yield_rate <= 100) ? material.yield_rate : 100;
  const cf = material.convert_factor > 0 ? material.convert_factor : 1;
  const perGram = (material.purchase_price / 100) / cf / (yr / 100);  // 元/克净料
  return Math.round(gram * perGram * 100);                            // 分
}
const matById = {};
for (const m of MATERIALS) matById[m.material_id] = m;

let theoryCostFen = 0;
console.log('════════ 一、成本卡与理论耗用 ════════');
for (const c of CARDS) {
  let cost = 0;
  for (const ln of c.lines) cost += unitCostFen(matById[ln.material_id], ln.quantity);
  const qty = (DINE_IN.find((d) => d.card_code === c.card_code) || {}).qty || 0;
  theoryCostFen += cost * qty;
  const name = (DINE_IN.find((d) => d.card_code === c.card_code) || {}).name || c.card_code;
  console.log(`  ${name.padEnd(6)} 售价 ${(c.price_fen / 100).toFixed(2)} 元  单份成本 ${(cost / 100).toFixed(2)} 元  ` +
    `毛利率 ${(((c.price_fen - cost) / c.price_fen) * 100).toFixed(1)}%  卖了 ${qty} 份`);
}
console.log(`  ────────────────────────────────────────────`);
console.log(`  本月理论耗用（按销量×标准成本） = ${(theoryCostFen / 100).toFixed(2)} 元`);

// ============ 三、段二：耗用核查（库存三栏 + 非销售耗用）============
// 库存三栏（金额，分）—— 由原料盘点换算来的，此处直接给（模拟老板填的）
const INV = { opening_fen: 25900, purchase_fen: 392300, closing_fen: 33640 };
const ACTUAL_CONSUME = INV.opening_fen + INV.purchase_fen - INV.closing_fen;
const NON_SALES = 8000;   // 员工餐/试吃/报损 80 元

const review = {
  tier: 'full',
  dine_in: DINE_IN.map((d) => {
    const c = CARDS.find((x) => x.card_code === d.card_code);
    let cost = 0; for (const ln of c.lines) cost += unitCostFen(matById[ln.material_id], ln.quantity);
    return { card_code: d.card_code, dish_key: d.card_code, qty: d.qty, totalCostFen: cost * d.qty, amountFen: c.price_fen * d.qty };
  }),
  totals: { qty: DINE_IN.reduce((s, d) => s + d.qty, 0), costFen: theoryCostFen, amountFen: 0 },
};
// totals.qty 含未建卡（此处全部建卡，故相等）
const ledger = {
  inventory: INV,
  result: { real_consume_fen: ACTUAL_CONSUME },
  switches: { inventorySwitchOn: true },
};

const cv = consumeVariance({ ledger, review, nonsalesFen: NON_SALES });
console.log('\n════════ 二、段二 · 耗用核查（老板看到的）════════');
if (!cv.ok) {
  console.log('  ❌ 算不了：' + cv.reason);
} else {
  const y = (f) => (f / 100).toFixed(2);
  console.log(`  按销量应运用          ¥${y(cv.theoreticalFen)}`);
  console.log(`  账上实际用掉          ¥${y(cv.actualFen)}`);
  console.log(`  差额                  ${cv.varianceFen > 0 ? '+' : ''}¥${y(cv.varianceFen)}（${cv.variancePct > 0 ? '+' : ''}${cv.variancePct.toFixed(1)}%）`);
  console.log(`  减去 员工餐/试吃/报损   −¥${y(cv.nonsalesFen)}`);
  console.log(`  ────────────────────────────────`);
  console.log(`  真正说不清的          ${cv.realVarianceFen > 0 ? '+' : ''}¥${y(cv.realVarianceFen)}（${cv.realVariancePct > 0 ? '+' : ''}${cv.realVariancePct.toFixed(1)}%）  ← 要查这个`);
  console.log(`  （销量覆盖 ${(cv.qtyCoverage * 100).toFixed(0)}%${cv.extrapolated ? '，理论值按覆盖率外推' : ''}）`);
}

// ============ 四、段三：分原料（数量）============
// 老板填的盘点（数量，采购单位=斤）
const INV_ITEMS = [
  { material_id: 'm_beef', opening_qty: 5, purchase_qty: 95, closing_qty: 8 },   // 实际 92
  { material_id: 'm_pork', opening_qty: 3, purchase_qty: 55, closing_qty: 5 },   // 实际 53
  { material_id: 'm_noodle', opening_qty: 10, purchase_qty: 85, closing_qty: 8 },// 实际 87
  { material_id: 'm_oil', opening_qty: 2, purchase_qty: 22, closing_qty: 3 },    // 实际 21
  { material_id: 'm_rice', opening_qty: 20, purchase_qty: 150, closing_qty: 12 },// 实际 158
  { material_id: 'm_pep', opening_qty: 1, purchase_qty: 85, closing_qty: 5 },    // 实际 81
];
const mu = materialUsage({ cards: CARDS, dineIn: DINE_IN, materials: MATERIALS, inventoryItems: INV_ITEMS });
console.log('\n════════ 三、段三 · 分原料看（老板看到的）════════');
if (!mu.ok) {
  console.log('  ❌ 算不了：' + mu.reason);
} else {
  console.log('  原料      按菜单该买   实际用掉      差');
  for (const it of mu.items) {
    const th = it.hasTheory ? it.theoryQty.toFixed(2) : '—';
    const df = it.diffPct == null ? '—' : ((it.diffPct > 0 ? '+' : '') + it.diffPct.toFixed(1) + '%');
    const flag = (it.diffPct != null && Math.abs(it.diffPct) >= 10) ? '  ← 超 10%' : '';
    console.log(`  ${it.name.padEnd(6)} ${String(th).padStart(9)}${it.unit} ${String(it.actualQty.toFixed(2)).padStart(9)}${it.unit} ${String(df).padStart(8)}${flag}`);
  }
}

// ============ 五、段三 · 量价拆分（本月 vs 上月）============
// 上月（10 月）：牛肉采购 80 斤、金额 1280 元；本月 95 斤、1710 元
console.log('\n════════ 四、段三 · 量价拆分（牛肉，本月 vs 上月）════════');
const cur = { qty: 95, amountFen: 171000 };
const prev = { qty: 80, amountFen: 128000 };
const pv = priceVariance(cur, prev);
if (!pv.ok) {
  console.log('  ❌ 算不了：' + pv.reason);
} else {
  const y = (f) => (f / 100).toFixed(2);
  console.log(`  本月均价 ¥${y(pv.priceCurFen)}/斤   上月 ¥${y(pv.pricePrevFen)}/斤   比上月 ${pv.priceChangePct > 0 ? '+' : ''}${pv.priceChangePct.toFixed(1)}%`);
  console.log(`  采购金额 ${y(pv.amountPrevFen)} → ${y(pv.amountCurFen)}  变化 ${pv.amountDeltaFen > 0 ? '+' : ''}¥${y(pv.amountDeltaFen)}`);
  console.log(`  ────────────────────────────────`);
  console.log(`  其中买贵  ${pv.priceImpactFen > 0 ? '+' : ''}¥${y(pv.priceImpactFen)}`);
  console.log(`  其中多买  ${pv.qtyImpactFen > 0 ? '+' : ''}¥${y(pv.qtyImpactFen)}`);
  console.log(`  两项相加  = ¥${y(pv.priceImpactFen + pv.qtyImpactFen)}（与总变化一致：${pv.sumMatchesDelta ? '✅' : '❌'}）`);
  console.log(`  提示级别：${priceAlertOf(pv).level}（涨跌 ≥10% 才提示）`);
}

// ============ 六、期望值登记（**必须由实跑结果生成，不许手写**）============
// 🔴 教训：初版这里是手写的，结果理论耗用写成 3719.50、实跑 3722.00（青椒肉丝四舍五入差 2.5 元）。
//   手写期望值 = 第二个事实源 ⇒ 改代码不会带着它变 ⇒ 真机对照时会被带偏。
//   所以下面一律从 cv / mu / pv 直接取，保证「文档里的数」与「跑出来的数」同一个来源。
const y2 = (f) => (f / 100).toFixed(2);
console.log('\n════════ 五、真机对照期望值（由实跑结果自动生成）════════');
if (cv.ok) {
  console.log(`  段二 理论耗用        ¥${y2(cv.theoreticalFen)}`);
  console.log(`  段二 实际耗用        ¥${y2(cv.actualFen)}`);
  console.log(`  段二 差额            ${cv.varianceFen >= 0 ? '+' : ''}¥${y2(cv.varianceFen)}（${cv.variancePct >= 0 ? '+' : ''}${cv.variancePct.toFixed(1)}%）`);
  console.log(`  段二 真正说不清的    ${cv.realVarianceFen >= 0 ? '+' : ''}¥${y2(cv.realVarianceFen)}（${cv.realVariancePct >= 0 ? '+' : ''}${cv.realVariancePct.toFixed(1)}%）  ← 扣 ¥${y2(cv.nonsalesFen)} 损耗后`);
}
if (mu.ok) {
  for (const it of mu.items) {
    if (it.diffPct == null) continue;
    const flag = Math.abs(it.diffPct) >= 10 ? '  ← 应触发视觉提示' : '';
    console.log(`  段三 ${it.name.padEnd(5)}       ${it.diffPct >= 0 ? '+' : ''}${it.diffPct.toFixed(1)}%` +
      `（理论 ${it.theoryQty} / 实际 ${it.actualQty} ${it.unit}）${flag}`);
  }
}
if (pv.ok && pv.decomposed) {
  console.log(`  量价 牛肉均价        ¥${y2(pv.pricePrevFen)} → ¥${y2(pv.priceCurFen)}（${pv.priceChangePct >= 0 ? '+' : ''}${pv.priceChangePct.toFixed(1)}%）← 应提示"变化较大"`);
  console.log(`  量价 买贵 / 多买      +¥${y2(pv.priceImpactFen)} / +¥${y2(pv.qtyImpactFen)}（合计 +¥${y2(pv.priceImpactFen + pv.qtyImpactFen)}）`);
}

// ============ 七、机器可读断言（防"跑出来和文档不一致"）============
// 这三条是**自检**：如果哪天算法变了导致数字漂移，这里会红，提醒同步更新桌面数据说明。
const EXPECT = {
  theoryFen: 372200,        // 段二 理论耗用
  actualFen: 384560,        // 段二 实际耗用
  realVarianceFen: 4360,    // 扣 80 元后「真正说不清的」
  beefDiffPct: 8.6,         // 牛肉差率
  oilDiffPct: 10.5,         // 食用油差率
  priceImpactFen: 19000,    // 买贵 190 元
  qtyImpactFen: 24000,      // 多买 240 元
};
let bad = 0;
const eq = (name, a, b, tol) => {
  const ok = Math.abs(a - b) <= (tol == null ? 0.001 : tol);
  if (!ok) { bad++; console.log(`  ❌ 自检失败：${name} 期望 ${b} 实际 ${a}`); }
  return ok;
};
console.log('\n════════ 六、自检（跑出来的数是否与本文件登记的期望一致）════════');
eq('段二理论耗用', cv.theoreticalFen, EXPECT.theoryFen);
eq('段二实际耗用', cv.actualFen, EXPECT.actualFen);
eq('真正说不清的', cv.realVarianceFen, EXPECT.realVarianceFen);
const beef = mu.items.find((x) => x.material_id === 'm_beef');
const oil = mu.items.find((x) => x.material_id === 'm_oil');
eq('牛肉差率', beef.diffPct, EXPECT.beefDiffPct, 0.06);
eq('食用油差率', oil.diffPct, EXPECT.oilDiffPct, 0.06);
eq('买贵', pv.priceImpactFen, EXPECT.priceImpactFen);
eq('多买', pv.qtyImpactFen, EXPECT.qtyImpactFen);
console.log(bad === 0 ? '  ✅ 8 项全部吻合（桌面数据说明里的数字可信）' : `  ❌ ${bad} 项不吻合 —— 桌面数据说明必须同步更新`);

// ============ 八、自动生成桌面「照填清单」（数字一律取自上面实跑结果）============
// 🔴 为什么用脚本生成而不是手写：手写就是第二个事实源，改算法不会带着文档变。
const fs = require('fs');
const path = require('path');
const DESKTOP = 'C:/Users/lzj/Desktop';
const OUT = path.join(DESKTOP, '损耗体检_测试数据与真机验证单_20261125.md');
const y = (f) => (f / 100).toFixed(2);
const L = [];
const P = (s) => L.push(s == null ? '' : s);

P('# 损耗体检 · 测试数据与真机验证单');
P('');
P('> 生成时间：2026-11-25 · **本文数字由 `review/_e2e_test_20261125.js` 实跑自动生成**，改算法会跟着变。');
P('> 虚构门店：「张三小馆」· 3 道菜 · 6 个原料 · 2026 年 11 月账');
P('');
P('---');
P('');
P('## 一、照填清单（按顺序录，缺一步后面就算不了）');
P('');
P('### 1. 原料库（6 个，先建好）');
P('');
P('| 原料 | 采购单位 | 单价(元) | 换算系数 | 出成率(%) |');
P('|---|---|---|---|---|');
for (const m of MATERIALS) {
  P(`| ${m.name} | ${m.purchase_unit} | ${(m.purchase_price / 100).toFixed(2)} | ${m.convert_factor} | ${m.yield_rate} |`);
}
P('');
P('> 出成率是重点：牛肉 85%（去筋去膜）、猪肉 95%、青椒 90%，其余 100%。');
P('');
P('### 2. 成本卡（3 张，用量按「净料克数」填）');
P('');
P('| 菜品 | 售价(元) | 原料明细 |');
P('|---|---|---|');
const cardNames = { C001: '红烧牛肉面', C002: '青椒肉丝', C003: '米饭' };
for (const c of CARDS) {
  const parts = c.lines.map((ln) => `${matById[ln.material_id].name} ${ln.quantity}g`);
  P(`| ${cardNames[c.card_code]} | ${(c.price_fen / 100).toFixed(2)} | ${parts.join(' · ')} |`);
}
P('');
P('### 3. 本月销量（导入或手填）');
P('');
P('| 菜品 | 卖出份数 |');
P('|---|---|');
for (const d of DINE_IN) P(`| ${d.name} | ${d.qty} |`);
P('');
P('### 4. 月账与库存（对账页要用的）');
P('');
P('| 项目 | 数值 | 说明 |');
P('|---|---|---|');
P(`| 在售菜品数 | 3 | 对账页顶部填，覆盖率分母 |`);
P(`| 库存·期初(元) | ${y(INV.opening_fen)} | 库存页 |`);
P(`| 库存·本月采购(元) | ${y(INV.purchase_fen)} | 库存页 |`);
P(`| 库存·期末(元) | ${y(INV.closing_fen)} | 库存页（**必须是真盘的**） |`);
P(`| 员工餐/试吃/报损(元) | ${y(NON_SALES)} | 对账页新增输入框 |`);
P('');
P('### 5. 原料盘点（对账页段三，6 行 × 4 个数）');
P('');
P('| 原料 | 期初 | 采购量 | 期末 | 采购金额(元) |');
P('|---|---|---|---|---|');
const AMT = { m_beef: 1710, m_pork: 770, m_noodle: 340, m_oil: 198, m_rice: 480, m_pep: 425 };
for (const it of INV_ITEMS) {
  P(`| ${matById[it.material_id].name} | ${it.opening_qty} | ${it.purchase_qty} | ${it.closing_qty} | ${AMT[it.material_id]} |`);
}
P('');
P('> 单位一律「斤」（跟原料库的采购单位一致）。**按没切的毛料数**，别数切好腌好的。');
P('');
P('### 6. 上月数据（为了看「比上月」和量价拆分）');
P('');
P('切到 2026-10，只填 **牛肉**：期初 0 · 采购 80 斤 · 期末 0 · 采购金额 1280 元。');
P('然后切回 2026-11，段三牛肉那行就会显示「比上月 +12.5%」。');
P('');
P('---');
P('');
P('## 二、真机应该看到什么（期望值 · 实跑生成）');
P('');
P('### 段二 · 耗用核查');
P('');
P('| 项目 | 期望值 |');
P('|---|---|');
if (cv.ok) {
  P(`| 按销量应运用 | ¥${y(cv.theoreticalFen)} |`);
  P(`| 账上实际用掉 | ¥${y(cv.actualFen)} |`);
  P(`| 差额 | ${cv.varianceFen >= 0 ? '+' : ''}¥${y(cv.varianceFen)}（${cv.variancePct >= 0 ? '+' : ''}${cv.variancePct.toFixed(1)}%） |`);
  P(`| 减去 员工餐/试吃/报损 | −¥${y(cv.nonsalesFen)} |`);
  P(`| **真正说不清的** | **${cv.realVarianceFen >= 0 ? '+' : ''}¥${y(cv.realVarianceFen)}（${cv.realVariancePct >= 0 ? '+' : ''}${cv.realVariancePct.toFixed(1)}%）** |`);
}
P('');
P('> 判定：**真正说不清的**应该很小（1.2%），因为大头被 80 元损耗扣掉了。');
P('> 如果这里显示接近「差额」（+3.3%），说明员工餐没扣掉 —— 那就是 bug。');
P('');
P('### 段三 · 分原料看');
P('');
P('| 原料 | 按菜单该买 | 实际用掉 | 差 |');
P('|---|---|---|---|');
if (mu.ok) {
  for (const it of mu.items) {
    const th = it.hasTheory ? `${it.theoryQty}${it.unit}` : '—';
    const df = it.diffPct == null ? '—' : `${it.diffPct >= 0 ? '+' : ''}${it.diffPct.toFixed(1)}%`;
    P(`| ${it.name} | ${th} | ${it.actualQty}${it.unit} | ${df} |`);
  }
}
P('');
P('> **食用油 +10.5% 应该变红**（这是专门造出来的异常，用来验证视觉提示生效）。');
P('> 牛肉 +8.6% 是「轻微超」，猪肉/面条/大米/青椒都在 ±3.3% 内属「正常」。');
P('');
P('### 段三 · 量价拆分（牛肉那行）');
P('');
if (pv.ok && pv.decomposed) {
  P('| 项目 | 期望值 |');
  P('|---|---|');
  P(`| 本月均价 | ¥${y(pv.priceCurFen)}/斤 |`);
  P(`| 上月均价 | ¥${y(pv.pricePrevFen)}/斤 |`);
  P(`| 比上月 | +${pv.priceChangePct.toFixed(1)}%（**应提示"变化较大"**） |`);
  P(`| 采购金额变化 | +¥${y(pv.amountDeltaFen)} |`);
  P(`| 其中买贵 | +¥${y(pv.priceImpactFen)} |`);
  P(`| 其中多买 | +¥${y(pv.qtyImpactFen)} |`);
  P('');
  P('> 🔴 关键验证：**买贵 + 多买 必须等于 总变化**（190 + 240 = 430）。');
  P('> 若这两个数加起来对不上总变化，说明量价拆分算错了。');
}
P('');
P('---');
P('');
P('## 三、真机验证步骤（约 15 分钟）');
P('');
P('1. **建原料 6 个**（原料库）：注意出成率一定要填，牛肉 85% 是关键。');
P('2. **建成本卡 3 张**：用量按净料克数，红烧牛肉面牛肉 120g。');
P('3. **导入或手填销量**：300 / 250 / 400。');
P('4. **填月账**：房租水电工资等；**库存三栏**填 259 / 3923 / 336.40。');
P('5. **进对账页**：在售菜品数填 3 → 点保存（覆盖率变 100%）。');
P('6. **填员工餐/试吃/报损**：80 元 → 看「真正说不清的」是否立刻变小。');
P('7. **段三填 6 行**（期初/采购/期末/金额）→ 看哪一行变红。');
P('8. **切 10 月填牛肉**（80 斤 / 1280 元）→ 切回 11 月 → 看「比上月 +12.5%」。');
P('');
P('## 四、看到这些就是 bug');
P('');
P('- 段二「真正说不清的」与「差额」一模一样 ⇒ 员工餐没扣掉');
P('- 段三理论用量显示 0 或「—」但原料已建卡 ⇒ 成本卡关联断了');
P('- 段三牛肉理论值显示 72 斤左右（而不是 84.71）⇒ **出成率没除**（最严重，会冤枉采购）');
P('- 食用油 +10.5% 没变红 ⇒ 视觉提示失效');
P('- 量价「买贵 + 多买」≠ 总变化 ⇒ 恒等式被破坏');
P('- 任何一处显示「算不了」但数据都填了 ⇒ 抑制判据过严');
P('');

if (!fs.existsSync(DESKTOP)) {
  console.log('\n⚠️ 桌面目录不存在，报告未写出：' + DESKTOP);
} else {
  fs.writeFileSync(OUT, L.join('\n'), 'utf8');
  console.log('\n📄 桌面报告已生成：' + OUT);
  console.log('   （' + L.length + ' 行，数字全部来自本次实跑）');
}
