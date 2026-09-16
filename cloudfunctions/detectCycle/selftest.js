// cloudfunctions/detectCycle/selftest.js —— 批次 3 · POC2 循环引用检测自测（用例 D + 深度 + 保存预检）
// 运行： node cloudfunctions/detectCycle/selftest.js
const { detectCycle, willCycleBeCreated, MAX_DEPTH } = require('./service');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== 用例 D · A→B→A 循环引用拦截 =====');
// 半成品 A 引用 B（A → B）；半成品 B 引用 A（B → A）→ 依赖环
check('A→B→A 检测到环 has_cycle=true', detectCycle([{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }]).has_cycle === true);
// 无环链：A → B → C
check('A→B→C 无环 has_cycle=false', detectCycle([{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]).has_cycle === false);
// 自引用：A → A（直接）→ 环
check('A→A 自引用判环', detectCycle([{ from: 'A', to: 'A' }]).has_cycle === true);
// 三角脏环
check('三节点环 A→B,B→C,C→A 判环', detectCycle([{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }]).has_cycle === true);
// 空边
check('空边无环', detectCycle([]).has_cycle === false);

console.log('');
console.log('===== 保存预检 willCycleBeCreated（saveCostCard 入口）=====');
// 已有依存：半成品 A 引用 B（边 A→B）。现保存半成品 B（输出虚拟 B），其引用 A（child=[A]）→ 必然成环 B→A→B
check('已有 A→B，保存 B 引用 A → 判环（BOC 拦截）',
  willCycleBeCreated('B', ['A'], [{ from: 'A', to: 'B' }]) === true);
// 已有 A→B，保存 C 引用 A → C→A→B 无环
check('已有 A→B，保存 C 引用 A → 无环',
  willCycleBeCreated('C', ['A'], [{ from: 'A', to: 'B' }]) === false);
// 保存半成品引用自身 → 判环
check('保存 B 引用自身 B → 判环', willCycleBeCreated('B', ['B'], []) === true);
// 新建独立半成品 D 引用 A → 无环
check('新建半成品 D 引用 A → 无环', willCycleBeCreated('D', ['A'], [{ from: 'A', to: 'B' }]) === false);

console.log('');
console.log('===== 深度上限（冗余兜底 ≤5 层）=====');
check('MAX_DEPTH 恒定为 5（强制遵守 §3）', MAX_DEPTH === 5, `MAX_DEPTH=${MAX_DEPTH}`);
// 6 层深链（超过 5 层兜底上限）→ 判环（更深层级的兜底）
const chain6 = ['n1','n2','n3','n4','n5','n6','n7'];
const edges6 = [];
for (let i = 0; i < chain6.length - 1; i++) edges6.push({ from: chain6[i], to: chain6[i+1] });
check('6 层深链（≥超 5 层兜底）判环', detectCycle(edges6).has_cycle === true, `len=${edges6.length} 边`);
// 4 层深链（≤5）→ 无环
const chain4 = ['a','b','c','d','e'];
const edges4 = [];
for (let i = 0; i < chain4.length - 1; i++) edges4.push({ from: chain4[i], to: chain4[i+1] });
check('4 层深链（≤5）无环', detectCycle(edges4).has_cycle === false);

console.log(`\n==== detectCycle 批次 3 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);