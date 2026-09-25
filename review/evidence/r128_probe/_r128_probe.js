// _r128_probe.js —— round128 收码复核探针（不手算、不抄实现）
//
// 目标：验证快马在 saveCostCard/index.js 新增的「档案行/手工行分流合并」是否
//       ① 长度严格守恒  ② 顺序与输入逐位对应（material_id / material_name 不错配）
//       ③ 手工行净料成本正确（快照直传 / netUnitCostWan 计算 两条路径）
//
// 关键手法：**不用手抄** Controller 的那段算法 —— 而是从 index.js 源码里
//           **正则抽取第 5 段原文**，用 new Function 注入依赖后**执行生产代码本身**。
//           这样若快马改了那段、或我理解错了那段，本探针会直接失真而不是"自证正确"。
//
// 运行： node _r128_probe.js <repo_root>

const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const IDX = path.join(ROOT, 'cloudfunctions', 'saveCostCard', 'index.js');
const SVC = require(path.join(ROOT, 'cloudfunctions', 'saveCostCard', 'service.js'));

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const src = fs.readFileSync(IDX, 'utf8');

// ---------- 1. 抽取第 5 段源码（生产代码本体）----------
const M5 = src.match(/\/\/ ===== 5\. 构建快照明细[\s\S]*?(?=\/\/ ===== 6\.)/);
if (!M5) {
  console.log('❌ 未能从 index.js 抽取第 5 段（源码结构变了？抽不到就不许下结论）');
  process.exit(2);
}
const code5 = M5[0];
console.log('--- 抽取到的第 5 段（生产代码本体，共 ' + code5.split('\n').length + ' 行）---');
console.log(code5.split('\n').slice(0, 6).map(l => '    ' + l).join('\n'));
console.log('    ...');
console.log('');

// 构造可执行函数：注入 Controller 里的同名依赖
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
let runSeg5;
try {
  runSeg5 = new AsyncFn(
    'buildSnapshotLines', 'netUnitCostWan', 'card', 'materialsById', 'fail', 'ERROR_CODES',
    code5 + '\n; return snap;'
  );
} catch (e) {
  console.log('❌ 第 5 段无法编译：' + e.message);
  process.exit(2);
}

// 依赖桩（fail 在正常路径不会走到；走到即抛，便于定位）
function fail(code, msg) { const e = new Error('FAIL(' + code + '): ' + msg); e.__fail = code; throw e; }
const ERROR_CODES = { SYSTEM_ERROR: 'SYSTEM_ERROR', RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND' };

// ---------- 2. 原料台账（与 selftest 同源参数，便于交叉核对）----------
const { netUnitCostWan } = SVC;
const mats = new Map([
  ['ji',  { id: 'ji',  name: '鸡胸肉', is_virtual: false, net_unit_cost: netUnitCostWan(1500, 500, 90) }], // 333
  ['hua', { id: 'hua', name: '花生米', is_virtual: false, net_unit_cost: netUnitCostWan(1000, 500, 100) }], // 200
  ['gan', { id: 'gan', name: '干辣椒', is_virtual: false, net_unit_cost: netUnitCostWan(2000, 500, 100) }], // 400
]);

(async () => {
  // ========== 场景 A：纯档案行（回归，必须与改前同语义）==========
  console.log('===== 场景 A：纯档案行（回归）=====');
  const A = { mode: 'A', lines: [
    { material_id: 'ji',  quantity: 200, input_type: 1 },
    { material_id: 'hua', quantity: 50,  input_type: 1 },
  ] };
  const snapA = await runSeg5(SVC.buildSnapshotLines, netUnitCostWan, A, mats, fail, ERROR_CODES);
  check('A 长度守恒 2', snapA.lines.length === 2, 'len=' + snapA.lines.length);
  check('A 逐位对应 [鸡胸肉,花生米]',
    snapA.lines[0].material_name === '鸡胸肉' && snapA.lines[1].material_name === '花生米',
    snapA.lines.map(l => l.material_name).join('|'));
  check('A 均标 input_type=1', snapA.lines.every(l => l.input_type === 1));

  // ========== 场景 B：纯手工行 ==========
  console.log('');
  console.log('===== 场景 B：纯手工行（input_type=2）=====');
  const B = { mode: 'A', lines: [
    { input_type: 2, name: '临时-葱', quantity: 30, unit_price_fen: 500, yield_rate: 100 },
    { input_type: 2, name: '临时-油', quantity: 20, unit_price_fen: 1000, yield_rate: 100 },
  ] };
  const snapB = await runSeg5(SVC.buildSnapshotLines, netUnitCostWan, B, mats, fail, ERROR_CODES);
  check('B 长度守恒 2', snapB.lines.length === 2, 'len=' + snapB.lines.length);
  check('B 名称逐位对应 [临时-葱,临时-油]',
    snapB.lines[0].material_name === '临时-葱' && snapB.lines[1].material_name === '临时-油',
    snapB.lines.map(l => l.material_name).join('|'));
  check('B 均标 input_type=2', snapB.lines.every(l => l.input_type === 2));
  check('B material_id 为空串（手工行不挂档案）', snapB.lines.every(l => l.material_id === ''));
  check('B 手工行净料成本 = netUnitCostWan(500,1,100) 与 (1000,1,100)',
    snapB.lines[0].net_unit_cost === netUnitCostWan(500, 1, 100) &&
    snapB.lines[1].net_unit_cost === netUnitCostWan(1000, 1, 100),
    snapB.lines.map(l => l.net_unit_cost).join('|'));

  // ========== 场景 C：交错（本批次真正的风险点）==========
  console.log('');
  console.log('===== 场景 C：档案/手工交错（配对错位风险点）=====');
  const C = { mode: 'A', lines: [
    { material_id: 'ji',  quantity: 200, input_type: 1 },                                  // 档案
    { input_type: 2, name: '临时-A', quantity: 30, unit_price_fen: 500, yield_rate: 100 },  // 手工
    { material_id: 'hua', quantity: 50,  input_type: 1 },                                  // 档案
    { input_type: 2, name: '临时-B', quantity: 20, unit_price_fen: 1000, yield_rate: 100 }, // 手工
    { material_id: 'gan', quantity: 10,  input_type: 1 },                                  // 档案
  ] };
  const snapC = await runSeg5(SVC.buildSnapshotLines, netUnitCostWan, C, mats, fail, ERROR_CODES);
  check('C 长度守恒 5（档案3+手工2 不丢不重）', snapC.lines.length === 5, 'len=' + snapC.lines.length);
  const namesC = snapC.lines.map(l => l.material_name).join('|');
  check('🏆 C 逐位严格对应 [鸡胸肉,临时-A,花生米,临时-B,干辣椒]',
    namesC === '鸡胸肉|临时-A|花生米|临时-B|干辣椒', namesC);
  const typesC = snapC.lines.map(l => l.input_type).join(',');
  check('🏆 C input_type 序列 = 1,2,1,2,1', typesC === '1,2,1,2,1', typesC);
  check('🏆 C 档案行净料成本未被手工行污染（333/200/400）',
    snapC.lines[0].net_unit_cost === 333 && snapC.lines[2].net_unit_cost === 200 && snapC.lines[4].net_unit_cost === 400,
    snapC.lines.map(l => l.net_unit_cost).join('|'));
  check('C 手工行净料成本正确',
    snapC.lines[1].net_unit_cost === netUnitCostWan(500, 1, 100) &&
    snapC.lines[3].net_unit_cost === netUnitCostWan(1000, 1, 100),
    snapC.lines.filter(l => l.input_type === 2).map(l => l.net_unit_cost).join('|'));
  // 成本总额交叉核对：手工行必须真的计入
  const scoreC = SVC.calcCostCard({ mode: 'A', lines: snapC.lines, auxFen: 0, lossPct: 0, priceFen: 0 });
  const expectYuan = 200 * 0.0333 + 30 * (netUnitCostWan(500, 1, 100) / 10000) + 50 * 0.02
                   + 20 * (netUnitCostWan(1000, 1, 100) / 10000) + 10 * 0.04;
  check('🏆 C 总成本含手工行（引擎复算一致）',
    scoreC.material_total_fen === Math.round(expectYuan * 100),
    '实得 ' + scoreC.material_total_fen + ' / 期望 ' + Math.round(expectYuan * 100));

  // ========== 场景 D：手工行带快照（复制/回填路径）==========
  console.log('');
  console.log('===== 场景 D：手工行带 net_unit_cost 快照（应直传、不重算）=====');
  const D = { mode: 'A', lines: [
    { input_type: 2, name: '带快照行', quantity: 10, unit_price_fen: 999999, yield_rate: 1, net_unit_cost: 777 },
  ] };
  const snapD = await runSeg5(SVC.buildSnapshotLines, netUnitCostWan, D, mats, fail, ERROR_CODES);
  check('🏆 D 有快照时直传 777（不被 unit_price_fen 重算覆盖）',
    snapD.lines[0].net_unit_cost === 777, '=' + snapD.lines[0].net_unit_cost);

  // ========== 场景 E：档案行缺失必须仍报错（回归）==========
  console.log('');
  console.log('===== 场景 E：引用不存在的原料（回归：不得被静默跳过）=====');
  const E = { mode: 'A', lines: [{ material_id: 'nope', quantity: 10, input_type: 1 }] };
  let threw = null;
  try { await runSeg5(SVC.buildSnapshotLines, netUnitCostWan, E, mats, fail, ERROR_CODES); }
  catch (e) { threw = e; }
  check('E 未知原料 id → 抛 RESOURCE_NOT_FOUND（不静默）',
    !!(threw && String(threw.message).indexOf('RESOURCE_NOT_FOUND') >= 0),
    threw ? threw.message.slice(0, 60) : '(未抛错，危险)');

  console.log('');
  console.log('==== round128 复核探针：' + pass + ' 通过 / ' + failN + ' 失败 ====');
  process.exit(failN === 0 ? 0 : 1);
})();
