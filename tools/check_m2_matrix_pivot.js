#!/usr/bin/env node
// tools/check_m2_matrix_pivot.js —— M2 矩阵透视表「按人工过滤」行为守卫（D6 · 2026-10-27 拍板）
//
// 为什么需要它（M2 整体审计 + 拍板 D6 实证：原 `filtered` 只按毛利率/租金过滤、`fixLabor` 写死 null
//   ⇒ 透视表里 2 人/3 人的数字叠在同一格子被后者覆盖，人工维度在透视视图里完全失效）：
//   2026-10-27 拍板（D6，R534）改为「透视表必须按人工过滤」，套用 R332 同款「优先 pivotFix.labor、
//   取不到退到结果中实际出现的第一档」。本守卫**驱动真实 buildPivot** 喂数字断言行为，并做源锚 + 变异
//   回灌证明分辨力（非恒绿）。
//
// 判据（P/A/B/C/E 五段，全部 fail-closed：读不到 / 加载失败 / 提取不到即判红）：
//   P 前置     矩阵源码可读 + 以 Page 桩加载成功 + buildPivot 是函数 + fakeThis 结构可用
//   A 行为     真实 buildPivot：fixLabor=3 ⇒ 单元值取 labor3 的 222（非 labor2 的 111）；
//              fixLabor=2 ⇒ 取 111；两态 cells 不同（人工维度在透视里生效，非被覆盖）
//   B 正控     pivotFix.labor=99（不在结果档位）→ 回退 laborPool[0]=2，单元取 111
//              （证明 R332 同款回退已随 D6 生效，修的是真数字差）
//   C 变异灵敏度 矩阵 buildPivot 必须含 `Number(r.labor) === fixLaborVal`（锁 R534 实改）；
//              变异：删掉该过滤条件 ⇒ 锚点判 false（守卫能抓回退，非恒绿）
//   E 自失效    源码非退化 + 断言数下界（防"扫空 ⇒ 恒绿"）
//
// 运行：node tools/check_m2_matrix_pivot.js   （由 verify_all.js 的 [m2-matrix-pivot] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MATRIX = path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'matrix.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');
const readOr = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

// ============ P 前置（fail-closed）============
sec('P 前置（fail-closed：读不到 / 加载失败即判红）');
const matrixSrc = readOr(MATRIX);
check('P-① 矩阵源码 matrix.js 可读', !!matrixSrc && matrixSrc.length > 1500, matrixSrc ? matrixSrc.length + ' 字符' : '读不到');
if (!matrixSrc) {
  console.log(`\n===== M2 matrix.pivot 守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败 ⇒ 直接判红（fail-closed）');
  process.exit(1);
}
let buildPivot = null;
try {
  const captured = {};
  global.Page = (o) => { captured.obj = o; };
  require(MATRIX);          // 模块加载时调用 Page({...})，捕获页面对象
  buildPivot = captured.obj ? captured.obj.buildPivot : null;
} catch (e) {
  buildPivot = null;
  console.log('  ⚠️ 加载 matrix.js 抛错：' + e.message);
}
check('P-② 以 Page 桩加载 matrix.js 成功 + buildPivot 是函数',
  typeof buildPivot === 'function');
if (typeof buildPivot !== 'function') {
  console.log(`\n===== M2 matrix.pivot 守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败 ⇒ 直接判红（fail-closed）');
  process.exit(1);
}

// ============ 复刻页面调用 buildPivot 的最小 fakeThis ============
function makeRows() {
  // 同行（rent=8000 / marginPct=55）下，labor 2 与 labor 3 给出**不同** targetDaily，
  // 从而透视单元若被人工过滤 ⇒ 两态 cells 必不同；若人工不过滤 ⇒ 后者覆盖前者（恒为同一子集）。
  return [
    { red: false, rent: 8000, marginPct: 55, labor: 2, targetYuan: 20000, targetDaily: 111 },
    { red: false, rent: 8000, marginPct: 55, labor: 3, targetYuan: 20000, targetDaily: 222 },
    { red: false, rent: 8000, marginPct: 55, labor: 2, targetYuan: 30000, targetDaily: 113 },
    { red: false, rent: 8000, marginPct: 55, labor: 3, targetYuan: 30000, targetDaily: 223 },
  ];
}
function fakeThis(laborFix) {
  return {
    data: {
      pivotRowDim: 'rent',                                   // 主轴=房租 ⇒ 固定维度=毛利率
      pivotFix: { margin: 55, labor: laborFix, rent: 8000 },
      dims: { rent: [8000], margin: [55], target: [20000, 30000], labor: [2, 3] },
    },
  };
}
const cellAt = (pv, rent, ty) => (pv && pv.cells ? pv.cells[rent + '|' + ty] : undefined);
const P = (laborFix) => buildPivot.call(fakeThis(laborFix), makeRows());

// ============ A 行为（核心：透视表按人工过滤，单元只取固定人工档的值）============
sec('A · 透视表按人工过滤（fixLabor 不同 ⇒ 单元值不同）');
{
  const p3 = P(3);
  check('A-① fixLabor=3 ⇒ cells[8000|20000] 必须 = 222（labor3 的值，非 labor2 的 111）',
    cellAt(p3, 8000, 20000) === 222, 'cell=' + cellAt(p3, 8000, 20000));
  check('A-①b fixLabor=3 ⇒ 上报 fixLabor 必须 = 3', p3.fixLabor === 3, 'fixLabor=' + p3.fixLabor);
  const p2 = P(2);
  check('A-② fixLabor=2 ⇒ cells[8000|20000] 必须 = 111（labor2 的值）',
    cellAt(p2, 8000, 20000) === 111, 'cell=' + cellAt(p2, 8000, 20000));
  check('A-③ 两态 cells 必须不同（人工维度在透视里生效，不被后者覆盖）',
    JSON.stringify(p3.cells) !== JSON.stringify(p2.cells),
    'p3=' + JSON.stringify(p3.cells) + ' / p2=' + JSON.stringify(p2.cells));
}

// ============ B 正控（fixLabor 不在结果档位 ⇒ 回退实际第一档）============
sec('B · 正控（pivotFix.labor 取不到 ⇒ 回退 laborPool[0]，R332 同款）');
{
  const p99 = P(99); // 99 不在 laborPool=[2,3] ⇒ 回退到 2
  check('B-① fixLabor=99（不在档位）→ 回退 laborPool[0]=2，cells 取 labor2 的 111',
    p99.fixLabor === 2 && cellAt(p99, 8000, 20000) === 111,
    'fixLabor=' + p99.fixLabor + ' / cell=' + cellAt(p99, 8000, 20000));
}

// ============ C 变异灵敏度（锁 R534 实改：buildPivot 必须按 labor 过滤）============
sec('C · 变异灵敏度（源锚 + 删条件回退可抓，非恒绿）');
check('C-① 矩阵 buildPivot 含 `Number(r.labor) === fixLaborVal`（锁 R534 实改）',
  matrixSrc.includes('Number(r.labor) === fixLaborVal'));
{
  const mutated = matrixSrc.replace(/Number\(r\.labor\) === fixLaborVal/g, 'true'); // 模拟删掉人工过滤条件
  check('C-② 变异：删掉 labor 过滤条件 ⇒ 锚点判 false（守卫能抓回退，非恒绿）',
    !mutated.includes('Number(r.labor) === fixLaborVal'));
}

// ============ E 自失效护栏（防"扫空 ⇒ 恒绿"）============
sec('E · 自失效护栏');
check('E-① 矩阵源码非退化（>1500 字符）', matrixSrc.length > 1500, matrixSrc.length + ' 字符');
check('E-② 断言数下界（pass ≥ 9，删一批仍 >0）', pass >= 9, `当前 pass=${pass}`);

console.log(`\n===== M2 matrix.pivot 守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
