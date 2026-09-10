/**
 * POC2 锚点自测：用例 A~E
 * 运行：node test_poc2.js
 * 全部 ✅ 即代表 BOM/成本引擎算法命中验收锚点（误差 ≤ 0.01 元）
 *
 * ⚠️ 锚点已按豆包裁定锁定「口径 B」：中间保精度、最终 round 到分、总成本存整数分 9.75。
 *    9.73 仍是真错误值（辅料未纳入损耗放大）；9.76 为旧文档笔误（明细行先 round 再累加所致）。
 *    反算售价基于已存储的 9.75：9.75 ÷ 0.4 = 24.375 → 24.38。期望值已同步为 9.75 / 24.38 / 65.18% / 18.25。
 */
const { netCostPerGram, calcDishCost, reversePrice, detectBomCycle } = require('./calcDishCost.js');

let pass = 0, fail = 0;
function approx(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }
function check(name, actual, expected, note) {
  const ok = approx(actual, expected, 0.01);
  ok ? pass++ : fail++;
  let line = `${ok ? '✅' : '❌'} ${name}: 实际=${actual.toFixed(2)}  预期=${expected}`;
  if (note) line += `   ${note}`;
  console.log(line);
}

// 原料档案 -> 净料单位成本（元/克）
const M = {
  '鸡胸肉': netCostPerGram(15, 500, 90),
  '花生米': netCostPerGram(10, 500, 100),
  '干辣椒': netCostPerGram(20, 500, 100),
  '葱姜蒜': netCostPerGram(5, 500, 100),
  '调料油': netCostPerGram(10, 500, 100),
  '牛油': netCostPerGram(20, 500, 100),
  '花椒': netCostPerGram(40, 500, 100),
  '豆瓣酱': netCostPerGram(8, 500, 100),
  '香料': netCostPerGram(60, 500, 100),
  '时蔬拼盘': netCostPerGram(3, 500, 100),
  '肉丸': netCostPerGram(20, 500, 100),
};

console.log('原料净料成本(元/g，用于核对):');
for (const k in M) console.log(`  ${k}: ${M[k].toFixed(5)}`);

// ---- 用例 A · 宫保鸡丁（单份，损耗5%，辅料0.50）----
const gongbao = {
  mode: 'single', lossPct: 5, auxYuan: 0.50,
  items: [
    { ref: '鸡胸肉', amount: 200, netCost: M['鸡胸肉'] },
    { ref: '花生米', amount: 50, netCost: M['花生米'] },
    { ref: '干辣椒', amount: 10, netCost: M['干辣椒'] },
    { ref: '葱姜蒜', amount: 30, netCost: M['葱姜蒜'] },
    { ref: '调料油', amount: 20, netCost: M['调料油'] },
  ],
};
const rA = calcDishCost(gongbao);
const costR = Math.round(rA.total * 100) / 100; // 口径B：最终 round 到分存储 = 9.75
console.log('\n--- POC2 用例A: 宫保鸡丁（单份）---');
check('明细净料成本合计', rA.detail, 8.7667);
check('🟢 单品原材料总成本', costR, 9.75, '⚠️旧文档笔误标9.76；口径B锁定9.75(中间保精度,最终round)');
check('单品毛利(28-成本)', 28 - costR, 18.25);
check('单品毛利率%', (28 - costR) / 28 * 100, 65.18, '基于锁定成本9.75推导');

// ---- 用例 B · 红油底料（批量，产出10份，损耗0%，辅料2.00整批）----
const hongyou = {
  mode: 'batch', lossPct: 0, auxYuan: 2.00, batchShares: 10,
  items: [
    { ref: '牛油', amount: 500, netCost: M['牛油'] },
    { ref: '干辣椒', amount: 200, netCost: M['干辣椒'] },
    { ref: '花椒', amount: 50, netCost: M['花椒'] },
    { ref: '豆瓣酱', amount: 300, netCost: M['豆瓣酱'] },
    { ref: '香料', amount: 50, netCost: M['香料'] },
  ],
};
const rB = calcDishCost(hongyou);
console.log('\n--- POC2 用例B: 红油底料（批量→半成品）---');
check('整批明细合计', rB.detail, 42.80);
check('整批总成本', rB.batchTotal, 44.80);
check('🟢 单份半成品成本', rB.perShare, 4.48);

// 红油自动生成的虚拟原料：单位=份，换算系数=1，净料单位成本=每份成本 4.48
const hongyouVirtual = rB.perShare;

// ---- 用例 C · 麻辣香锅（引用半成品，第2层）----
const mala = {
  mode: 'single', lossPct: 3, auxYuan: 0.50,
  items: [
    { ref: '红油底料', amount: 1, netCost: hongyouVirtual },
    { ref: '时蔬拼盘', amount: 500, netCost: M['时蔬拼盘'] },
    { ref: '肉丸', amount: 100, netCost: M['肉丸'] },
  ],
};
const rC = calcDishCost(mala);
console.log('\n--- POC2 用例C: 麻辣香锅（引用红油半成品）---');
check('明细合计', rC.detail, 11.48);
check('🟢 单品原材料总成本', rC.total, 12.35);
check('单品毛利(38-成本)', 38 - rC.total, 25.65);
check('单品毛利率%', (38 - rC.total) / 38 * 100, 67.50);

// ---- 反算 ----
console.log('\n--- POC2 反算 ---');
check('目标毛利60% 售价', reversePrice(costR, 60), 24.38, '口径B：基于已存储的9.75反算 9.75÷0.4=24.375→24.38');

// ---- 用例 E · 快照与手动刷新 ----
console.log('\n--- POC2 用例E: 快照 ---');
check('保存后总成本(快照锁定)', costR, 9.75, '快照锁定存储值9.75');
// 改原料档案：鸡胸肉 15→20 元/斤（已保存卡不受影响，下面是"同步至最新价"后的新版本）
const M2 = Object.assign({}, M, { '鸡胸肉': netCostPerGram(20, 500, 90) });
const gongbaoV2 = {
  mode: 'single', lossPct: 5, auxYuan: 0.50,
  items: [
    { ref: '鸡胸肉', amount: 200, netCost: M2['鸡胸肉'] },
    { ref: '花生米', amount: 50, netCost: M['花生米'] },
    { ref: '干辣椒', amount: 10, netCost: M['干辣椒'] },
    { ref: '葱姜蒜', amount: 30, netCost: M['葱姜蒜'] },
    { ref: '调料油', amount: 20, netCost: M['调料油'] },
  ],
};
const rE = calcDishCost(gongbaoV2);
check('改价后新版本明细', rE.detail, 10.9889);
check('🟢 同步后新版本总成本', rE.total, 12.09);

// ---- 用例 D · 循环引用拦截 ----
console.log('\n--- POC2 用例D: 循环引用拦截 ---');
const allCards = { 'A': { refSemiIds: ['B'] }, 'B': { refSemiIds: ['A'] } };
const cyc = detectBomCycle('B', ['A'], allCards);
console.log(`${cyc ? '✅' : '❌'} A→B→A 检测: ${cyc ? 'BOM_CYCLE_DETECTED（数据不入库）' : '未检测（错误）'}`);
cyc ? pass++ : fail++;

console.log(`\n==== POC2 结果：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
