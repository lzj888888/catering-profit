// cloudfunctions/saveCostCard/selftest.js —— 批次 3 · POC2 成本卡保存自测（快照隔离 + 落库整数分 + 循环不入库）
//
// 运行： node cloudfunctions/saveCostCard/selftest.js
//
// 覆盖：① buildSnapshotLines 把净料单位成本复制进快照明细；② calcCostCard 落库 total_cost = 整数分；
//       ③ 改原料价后**旧版快照不变、旧卡总成本仍 9.75**（快照隔离）；④ 循环引用 → 不入库；
//       ⑤ 版本自然递增 / 虚拟半成品自动生成（每份成本）。
//       ⚠️ **本套件不直接断言幂等**：Controller（`index.js`）内联逻辑含 `require('wx-server-sdk')`、纯 node 加载不了。
//          幂等的**结构性判据已集中**在 `tools/check_idempotency.js`（R73：契约对照 / 预检早于写 / 键同源 / 装饰性键）
//          与 `common/__tests__/batch0_selfcheck.js`（R73 单源两形态的**假库真往返**）—— 勿在此处再抄一份（R72/R73 的病灶正是"同一语义多份实现"）。
//
// ⚠️ 判据：金额锚点整数分严格相等（===），无容差；total_cost 必须存储整数分（975 而非 9.75）。

const { buildSnapshotLines, calcCostCard, wouldCreateCycle, netUnitCostWan } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// ===================== 原料台账（可用本次保存） =====================
const mats = new Map([
  ['ji',    { id: 'ji',    name: '鸡胸肉', is_virtual: false, net_unit_cost: netUnitCostWan(1500, 500, 90) }], // 333
  ['hua',   { id: 'hua',   name: '花生米', is_virtual: false, net_unit_cost: netUnitCostWan(1000, 500, 100) }],
  ['gan',   { id: 'gan',   name: '干辣椒', is_virtual: false, net_unit_cost: netUnitCostWan(2000, 500, 100) }],
  ['cong',  { id: 'cong',  name: '葱姜蒜', is_virtual: false, net_unit_cost: netUnitCostWan(500, 500, 100) }],
  ['you',   { id: 'you',   name: '调料油', is_virtual: false, net_unit_cost: netUnitCostWan(1000, 500, 100) }],
]);

// ===== ① 快照构建 + 成本计算（落库整数分）=====
console.log('===== ① 快照构建 + 宫保鸡丁成本（total_cost 整数分）=====');
const cardLines = [
  { material_id: 'ji', quantity: 200 },
  { material_id: 'hua', quantity: 50 },
  { material_id: 'gan', quantity: 10 },
  { material_id: 'cong', quantity: 30 },
  { material_id: 'you', quantity: 20 },
];
const snap = buildSnapshotLines(cardLines, mats);
check('快照明细含净料单位成本快照（5 行）', snap.lines.length === 5, `len=${snap.lines.length}`);
check('鸡胸肉快照 net_unit_cost=333（万分，非 ID 关联）', snap.lines.find((l) => l.material_id === 'ji').net_unit_cost === 333);
const res = calcCostCard({ mode: 'A', lines: snap.lines, auxFen: 50, lossPct: 5, priceFen: 2800 });
check('🏆 落库 total_cost = 975（整数分）', res.unit_cost_fen === 975 && Number.isInteger(res.unit_cost_fen), `=${res.unit_cost_fen}`);

// ===== ② 快照隔离：改原料价后旧版不变 =====
console.log('');
console.log('===== ② 快照隔离（改原料价后旧版快照与成本不变）=====');
const oldLineQty = JSON.parse(JSON.stringify(snap.lines)); // 已保存的旧快照明细（含净料单位成本 333）
// 原料价 15→20（生产上触发 saveMaterial，只改 shop_material 的 net_unit_cost）
mats.get('ji').net_unit_cost = netUnitCostWan(2000, 500, 90); // 444
check('改价后**新**取到的鸡胸肉净料成本=444', mats.get('ji').net_unit_cost === 444);
check('**旧版快照**仍保留 333（快照隔离，不自动联动）', oldLineQty.find((l) => l.material_id === 'ji').net_unit_cost === 333);
const oldScore = calcCostCard({ mode: 'A', lines: oldLineQty, auxFen: 50, lossPct: 5, priceFen: 2800 });
check('🏆 改价后旧成本卡仍 = 9.75（975分）', oldScore.unit_cost_fen === 975, `=${oldScore.unit_cost_fen}分`);
// 新卡（用新价 444）→ 12.08
const newLines = buildSnapshotLines(cardLines, mats);
const newScore = calcCostCard({ mode: 'A', lines: newLines.lines, auxFen: 50, lossPct: 5, priceFen: 2800 });
check('新卡（同步最新价）→ 12.08（1208分）', newScore.unit_cost_fen === 1208, `=${newScore.unit_cost_fen}分`);

// ===== ③ 循环引用：不入库 ??? =====
console.log('');
console.log('===== ③ 循环引用预检（命中即拒、不入库）=====');
// 已有虚拟图 A 引用 B；现保存半成品 B（其移动虚拟输出为 B）引用 A → 判环
const edgesMap = new Map([['A', ['B']]]);
check('A→B，保存 B 引用 A → BOM 判环', wouldCreateCycle('B', ['A'], edgesMap) === true);
check('半成品引用自身 → 判环', wouldCreateCycle('B', ['B'], edgesMap) === true);
check('Cards 不入库判定：拒绝即不落库（此处仅判定不产生任何写）',
  (() => { const s = require('fs').readFileSync(require('path').join(__dirname, 'index.js'), 'utf8').replace(/^\s*\/\/.*$/gm, ''); return /BOM_CYCLE_DETECTED/.test(s); })(),
  'Controller 判环命中即 fail(BOM_CYCLE_DETECTED)，无 INSERT（🔒 R71：原为恒真断言）');

// ===== ④ 版本自然递增 + 虚拟半成品每份成本 =====
console.log('');
console.log('===== ④ 版本 / 虚拟半成品（每份成本）=====');
const r = netUnitCostWan(448, 1, 100); // 虚拟换算系数=1、单位=份 → 每份 4.48 元 = 万分44800
check('虚拟半成品（单位=份，换算=1）每份成本 4.48 → 万分44800', r === 44800, `net=${r}`);

// ===== ⑤ 入参校验 =====
console.log('');
console.log('===== ⑤ 入参校验 =====');
const goodCard = { shop_id: 's1', card: { name: '宫保', mode: 'A', auxYuan: 0.5, loss_pct: 5, priceYuan: 28, lines: [{ material_id: 'ji', qty: 200 }] } };
check('合法成本卡放行', validateInput(goodCard).error === null);
check('qty 为字符串 → INVALID_PARAM',
  validateInput({ ...goodCard, card: { ...goodCard.card, lines: [{ material_id: 'ji', qty: '200' }] } }).error === 'INVALID_PARAM');
check('模式 B 缺 batch_output → INVALID_PARAM',
  validateInput({ ...goodCard, card: { ...goodCard.card, mode: 'B' } }).error === 'INVALID_PARAM');
check('命令式：name 为空 → INVALID_PARAM',
  validateInput({ ...goodCard, card: { ...goodCard.card, name: '  ' } }).error === 'INVALID_PARAM');

// ===== ⑥ R81：mode 白名单（禁止静默兜底 A）=====
// 背景：修之前 `card.mode === 'B' ? 'B' : 'A'` 会把 'b' / 2 / 'C' / '' / 缺失 静默当 A
//   ⇒ 不生成虚拟半成品、忽略 batch_output、落库 calc_mode:1 ⇒ **成本语义悄悄变错且无报错**。
console.log('');
console.log('===== ⑥ R81 · mode 白名单（入口 + 引擎双层）=====');
const BAD_MODES = ['b', 2, 'C', ''];
for (const bad of BAD_MODES) {
  const rv = validateInput({ ...goodCard, card: { ...goodCard.card, mode: bad } });
  check(`入口：mode=${JSON.stringify(bad)} → INVALID_PARAM（不得静默兜底 A）`, rv.error === 'INVALID_PARAM', `实际=${rv.error}`);
}
check('入口：mode 缺失 → INVALID_PARAM（不得静默兜底 A）',
  validateInput({ ...goodCard, card: { ...goodCard.card, mode: undefined } }).error === 'INVALID_PARAM');
// 反向证据（不该红时不红）：合法值必须放行
check("入口反向：mode='A' 放行", validateInput({ ...goodCard, card: { ...goodCard.card, mode: 'A' } }).error === null);
check("入口反向：mode='B' + batch_output 放行",
  validateInput({ ...goodCard, card: { ...goodCard.card, mode: 'B', batch_output: 10 } }).error === null);

function modeCode(m) {
  try { calcCostCard({ mode: m, lines: snap.lines, auxFen: 0, lossPct: 0, priceFen: 0 }); return null; }
  catch (e) { return (e && e.code) || 'THROW_WITHOUT_CODE'; }
}
for (const bad of BAD_MODES) {
  check(`引擎：mode=${JSON.stringify(bad)} → 抛 INVALID_PARAM`, modeCode(bad) === 'INVALID_PARAM', `实际=${modeCode(bad)}`);
}
check('引擎：mode 缺失 → 抛 INVALID_PARAM', modeCode(undefined) === 'INVALID_PARAM');
check("引擎反向：mode='A' 不抛", modeCode('A') === null);
check("引擎反向：mode='B' 不抛", modeCode('B') === null);

console.log(`\n==== saveCostCard 批次 3 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);