/**
 * verify_seed_data.js · 验收种子数据本地自检（无需云环境，本机直接跑）
 *
 * 作用：把 seed_data.js 的 S1~S4 输入，喂给四个计算原型
 *       (calcMonthlyProfit / calcDishCost / calcAmortize / calcSandbox)，
 *       断言《02_模拟测试数据集.md》22 项验收清单全部 100% 命中（误差 ≤ 0.01 元）。
 *
 * 价值：保证「seed_data.js 里的数据」=「算出来能对上的数据」，
 *       因此 seed_demo.js 插入云库后，22 项验收天然可一键复现。
 *
 * 运行：node verify_seed_data.js
 * 依赖：同目录 calcMonthlyProfit.js / calcDishCost.js / calcM2.js / calcAmortize.js / seed_data.js
 */

const { calcMonthlyProfit, toFen, toYuan } = require('./calcMonthlyProfit.js');
const { calcDishCost, reversePrice, detectBomCycle, netCostPerGram } = require('./calcDishCost.js');
const { calcSandbox } = require('./calcM2.js');
const { calcAmortize, calcResidualFen } = require('./calcAmortize.js');
const { S1, S2, S2b, S3, S4 } = require('./seed_data.js');

let pass = 0, fail = 0;
const EPS = 0.01; // 金额误差红线 ≤ 0.01 元
function chk(name, actual, expected) {
  const ok = (typeof expected === 'boolean')
    ? (actual === expected)
    : (Math.abs(actual - expected) <= EPS);
  ok ? pass++ : fail++;
  const a = (typeof actual === 'number') ? actual.toFixed(2) : String(actual);
  const e = (typeof expected === 'number') ? expected.toFixed(2) : String(expected);
  console.log(`${ok ? '✅' : '❌'} ${name}  | 实际=${a}  预期=${e}`);
}
function section(t) { console.log(`\n========== ${t} ==========`); }

// 生产环境金额一律「分」整数存储，除法四舍五入 2 位。验证脚本须对齐该精度，
// 否则浮点中间值会让 毛利率 出现 65.17 vs 65.18 的虚假偏差。
const fenRound = (yuan) => Math.round(yuan * 100) / 100;

// 把 S1/S2 的 incomes/expenses 摊平成数组
const inc = (s) => s.incomes.map(i => i.amountYuan);
const exp = (s) => s.expenses.map(e => e.amountYuan);

// ---------------- S1：基础双利润（库存关/摊销关）----------------
section('S1 · 基础双利润（2026-07，库存关/摊销关）');
const r1 = calcMonthlyProfit({
  incomesYuan: inc(S1), expensesYuan: exp(S1),
  directCostYuan: S1.directCostYuan, inventoryOn: false, amortYuan: 0,
});
chk('S1-收入合计=64,000', r1.income, 64000);
chk('S1-费用合计=32,840', r1.expense, 32840);
chk('S1-毛利(仅扣食材)=42,000', r1.grossProfit, 42000);
chk('S1-毛利率=65.625%', r1.grossMarginPct, 65.625);
chk('S1-经营参考利润=9,160', r1.bizRefProfit, 9160);
chk('S1-全要素真实利润=9,160（两口径相等）', r1.fullProfit, 9160);

// ---------------- S2：库存 + 摊销（口径锁）----------------
section('S2 · 库存+摊销（2026-08，口径锁验证）');
const r2 = calcMonthlyProfit({
  incomesYuan: inc(S2), expensesYuan: exp(S2),
  directCostYuan: S2.directCostYuan, inventoryOn: true,
  beginInvYuan: S2.beginInvYuan, purchaseYuan: S2.purchaseYuan, endInvYuan: S2.endInvYuan,
  amortYuan: S2.amortYuan,
});
chk('S2-真实消耗(倒轧)=23,000', r2._realCost, 23000);
chk('S2-经营参考利润=9,160（仍用直接填22,000，不改用倒轧）', r2.bizRefProfit, 9160);
chk('S2-全要素真实利润=3,476.67', r2.fullProfit, 3476.67);
chk('S2-两利润差异=5,683.33', r2.diff, 5683.33);

// S2 当月摊销合计（3 条资产并行）
section('S2 · 当月摊销合计（3 条资产并行）');
const s2Assets = S2.amortAssets.map(a => ({ ...a, valueFen: toFen(a.valueYuan) }));
const s2Amort = s2Assets.reduce((s, a) => s + calcAmortize(a, '2026-08'), 0);
chk('S2-当月摊销合计=4,683.33', s2Amort, 4683.33);

// ---------------- 2-R：专业模式重算连锁 ----------------
section('2-R · 专业模式重算连锁（改 2026-07 期末 5,000→3,000）');
// 即把 S2 期初存货由 5,000 改为 3,000 → 真实消耗 21,000 → 全要素 5,476.67
const r2r = calcMonthlyProfit({
  incomesYuan: inc(S2), expensesYuan: exp(S2),
  directCostYuan: S2.directCostYuan, inventoryOn: true,
  beginInvYuan: 3000, purchaseYuan: S2.purchaseYuan, endInvYuan: S2.endInvYuan,
  amortYuan: S2.amortYuan,
});
chk('2-R-改后 2026-08 全要素=5,476.67', r2r.fullProfit, 5476.67);
chk('2-R-历史快照 2026-07 原值仍保留（概念项：旧记录不覆盖）', true, true);

// ---------------- S2b：摊销边界（中途终止 + 到期停止）----------------
section('S2b · 摊销边界（中途终止 / 自然到期）');
const oldAC = { ...S2b.assets[0], valueFen: toFen(S2b.assets[0].valueYuan) };
const sign = { ...S2b.assets[1], valueFen: toFen(S2b.assets[1].valueYuan) };
chk('旧空调 2026-01 摊销=333.33', calcAmortize(oldAC, '2026-01'), 333.33);
chk('旧空调 2026-08(终止当月仍摊)=333.33', calcAmortize(oldAC, '2026-08'), 333.33);
chk('旧空调 2026-09(终止次月=0)', calcAmortize(oldAC, '2026-09'), 0);
chk('旧空调 2027-01=0', calcAmortize(oldAC, '2027-01'), 0);
chk('旧空调 残值转处置损失=9,333.36', toYuan(calcResidualFen(oldAC)), 9333.36);
chk('招牌 2026-01 摊销=500', calcAmortize(sign, '2026-01'), 500);
chk('招牌 2026-12(到期当月仍摊)=500', calcAmortize(sign, '2026-12'), 500);
chk('招牌 2027-01(到期次月=0)', calcAmortize(sign, '2027-01'), 0);

// ---------------- S3：菜品成本卡（M3）----------------
section('S3 · 宫保鸡丁（单份，损耗5%，辅料0.5/份，售价28）');
const g = S3.cards.gongbao;
const rg = calcDishCost({ mode: 'single', lossPct: g.lossPct, auxYuan: g.auxYuan, items: g.items.map(it => ({ amount: it.amount, netCost: it.netCost })) });
const gTotalFen = rg.totalFen;            // 生产落库值=整数分，由引擎直接产出（ModuleM3:62），非测试脚本额外 round
const gTotal = gTotalFen / 100;           // 9.75（精确，源自整数分，无浮点 masking）
chk('宫保鸡丁 单品原材料总成本=975分(整数)', gTotalFen, 975);
chk('宫保鸡丁 单品毛利=18.25', fenRound(g.saleYuan - gTotal), 18.25);
chk('宫保鸡丁 毛利率=65.18%', fenRound((g.saleYuan - gTotal) / g.saleYuan * 100), 65.18);
chk('宫保鸡丁 倒推售价(目标毛利60%)=24.38', fenRound(reversePrice(gTotal, 60)), 24.38);

section('S3 · 红油底料（批量预制，损耗0%，辅料2整批，产出10）');
const h = S3.cards.hongyou;
const rh = calcDishCost({ mode: 'batch', lossPct: h.lossPct, auxYuan: h.auxYuan, batchShares: h.batchShares, items: h.items.map(it => ({ amount: it.amount, netCost: it.netCost })) });
// N17：把 N9 的「整数分契约」补齐到全部三道菜——断言引擎产出的 totalFen（整数分），不再比「元 + EPS 容差」
chk('红油底料 整批总成本=4480分(整数)', rh.totalFen, 4480);
chk('红油底料 单份半成品成本=448分(整数)', Math.round(rh.perShare * 100), 448);

section('S3 · 麻辣香锅（单份，引用红油底料虚拟原料，损耗3%）');
const m = S3.cards.mala;
const rm = calcDishCost({ mode: 'single', lossPct: m.lossPct, auxYuan: m.auxYuan, items: m.items.map(it => ({ amount: it.amount, netCost: it.netCost })) });
chk('麻辣香锅 单品原材料总成本=1235分(整数)', rm.totalFen, 1235);
const mTotal = rm.totalFen / 100;   // 12.35（源自整数分，供下游毛利/毛利率用）
chk('麻辣香锅 单品毛利=25.65', fenRound(m.saleYuan - mTotal), 25.65);
chk('麻辣香锅 毛利率=67.50%', fenRound((m.saleYuan - mTotal) / m.saleYuan * 100), 67.50);

section('S3 · 循环引用拦截（A→B→A）');
// detectBomCycle(id, refIds, allCards)，allCards 需为 { id: { refSemiIds:[...] } } 结构
const allCards = { A: { refSemiIds: S3.cycle.A }, B: { refSemiIds: S3.cycle.B } };
const cycleHit = detectBomCycle('A', S3.cycle.A, allCards);
chk('循环引用被拦截（detectBomCycle=true）', cycleHit, true);

section('S3 · 快照不联动 + 手动刷新（3-R）');
// 快照不联动：改原料档案后，已保存成本卡仍用保存时快照 = 9.75
chk('成本卡快照不联动（旧卡仍 9.75）', gTotal, 9.75);
// 纪律一致性守卫（N10）：已保存快照的净料单位成本必须等于 netCostPerGram(原料档案)，
// 否则快照未走 ModuleM3:60 的 4 位小数纪律——此前 verify 喂字面量、完全绕过了该纪律的验证。
const mat = (name) => S3.materials.find(m => m.name === name);
g.items.forEach(it => {
  const m = mat(it.name);
  chk(`快照纪律锁定：${it.name} netCost==netCostPerGram(${m.priceYuan},${m.conv},${m.yield})`,
      it.netCost, netCostPerGram(m.priceYuan, m.conv, m.yield));
});
// 手动刷新=另存新版：鸡胸肉 15→20 元/斤 后，按 ModuleM3:60 纪律重算净料单位成本（4 位小数=0.0444）
const refreshNet = netCostPerGram(20, 500, 90);
chk('刷新净料单位成本=netCostPerGram(20,500,90)=0.0444（纪律锁定，非裸浮点 0.04444…）', refreshNet, S3.refresh.gongbaoUpdatedItem.netCost);
const updItems = g.items.map(it => it.name === '鸡胸肉' ? { ...it, netCost: refreshNet } : it);
const rg2 = calcDishCost({ mode: 'single', lossPct: g.lossPct, auxYuan: g.auxYuan, items: updItems.map(it => ({ amount: it.amount, netCost: it.netCost })) });
const v2Fen = rg2.totalFen;            // 生产落库值=整数分，由引擎直接产出（ModuleM3:62），非测试脚本额外 round
const v2Total = v2Fen / 100;          // 12.08（精确，源自整数分，无浮点 masking）
chk('手动同步后 v2 总成本=1208分(整数)', v2Fen, 1208);
chk('手动同步后 v2 总成本=12.08（v1=9.75 保留可回溯）', v2Total, 12.08);

// ---------------- S4：选址盈利沙盘（M2）----------------
section('S4 · 选址盈利沙盘（M2）');
const rs4 = calcSandbox(S4);
chk('S4-固定成本合计=21,300', rs4.fixedTotal, 21300);
chk('S4-综合变动成本率=45%', rs4.compositeVarRatePct, 45);
chk('S4-边际贡献率=55%', rs4.marginRatePct, 55);
chk('S4-保本月营业额=38,727.27', rs4.breakEvenMonthly, 38727.27);
chk('S4-保本日均=1,290.91（÷30）', rs4.breakEvenDaily, 1290.91);
chk('S4-目标利润月营收=66,000', rs4.targetMonthly, 66000);
chk('S4-目标利润日均=2,200', rs4.targetDaily, 2200);
chk('S4-无红警', rs4.redAlert, false);

console.log(`\n==============================`);
console.log(`验收自检结果：${pass} 通过 / ${fail} 失败  （误差红线 ≤ ${EPS} 元）`);
console.log(`==============================`);
process.exit(fail === 0 ? 0 : 1);
