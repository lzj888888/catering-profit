#!/usr/bin/env node
// tools/check_m2_matrix_manage.js —— M2 正向「矩阵与单页管理费口径统一」行为守卫（D4 · 2026-10-27 拍板）
//
// 为什么需要它（M2 整体审计 H3 实证：现有 M2 守卫对 fixedYuan 形状差异零告警）：
//   单页 forward 的 fixedYuan 带 `manage` 键（留空=0），矩阵 forward（buildClean）旧版只传
//   `{ rent }` ⇒ manage 键缺失 ⇒ 装配层走「房租 × rentPct」派生（快餐 8000×80%=6400、火锅 4160…）
//   —— 同店两页保本差 ~1.1 万，且数字照出、零报错（审计实证复现）。
//   2026-10-27 拍板（D4，R533）：矩阵 buildClean 也补 `manage` 键，与单页同形状
//   （值可空/0 ⇒ 不评；填了 >0 ⇒ 用用户的），管理费不再被静默派生。
//   本守卫用**真实装配**喂数字断言行为，并做源锚 + 变异回灌证明分辨力（非恒绿）。
//
// 判据（P/A/B/C/E 五段，全部 fail-closed：读不到 / 提取不到即判红）：
//   P 前置     bizPreset 可 require + matrix.js / index.js 源码可读 + 导出齐全
//   A 行为     真实装配：fixedYuan 带 `manage:''` ⇒ 装配产物**不含** manage（不派生，=0）
//              + fixedYuan 带 `manage:'5000'` ⇒ manage 必须 = 500000（用填的数）
//   B 正控     fixedYuan **缺** manage 键 ⇒ 装配产物派生 manage（>0）⇒ 证明「键在/键缺」两态数字相异
//   C 变异灵敏度 矩阵 buildClean 的 fixedYuan 必须含 manage（源锚，锁 R533 实改）；
//              单页 index.js forward 亦含 manage（两页收敛）；
//              变异：把 buildClean 的 manage 键删掉 ⇒ 锚点判 false（守卫能抓回退，非恒绿）；
//              数字证明：键在空(null) ≠ 键缺派生(>0)
//   E 自失效    源码非退化 + 断言数下界（防"扫空 ⇒ 恒绿"）
//
// 运行：node tools/check_m2_matrix_manage.js   （由 verify_all.js 的 [m2-matrix-manage] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIZ = path.join(ROOT, 'utils', 'bizPreset.js');
const MATRIX = path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'matrix.js');
const INDEX = path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'index.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');
const readOr = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

// ============ P 前置（fail-closed）============
sec('P 前置（fail-closed：读不到 / require 不出即判红）');
let biz = null;
try { biz = require(BIZ); } catch (e) { biz = null; }
check('P-① utils/bizPreset.js 可 require', !!biz);
const matrixSrc = readOr(MATRIX);
const indexSrc = readOr(INDEX);
check('P-② 矩阵源码 matrix.js 可读', !!matrixSrc && matrixSrc.length > 1500, matrixSrc ? matrixSrc.length + ' 字符' : '读不到');
check('P-③ 单页源码 index.js 可读', !!indexSrc && indexSrc.length > 1500, indexSrc ? indexSrc.length + ' 字符' : '读不到');
if (!biz || !matrixSrc || !indexSrc) {
  console.log(`\n===== M2 matrix.manage 守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败 ⇒ 直接判红（fail-closed）');
  process.exit(1);
}
const { CITY_COEF, assembleItems, findPreset, BIZ_PRESETS } = biz;
check('P-④ 导出 assembleItems / findPreset / CITY_COEF',
  typeof assembleItems === 'function' && typeof findPreset === 'function' && !!CITY_COEF);

// ============ 忠实复刻页面装配（fixed_opt 形态，rent=8000）============
const KEYS = ['fastfood_noodle', 'fastfood_other', 'hotpot_half_self'];
function buildWith(presetKey, cityKey, fixedYuan) {
  const preset = findPreset(presetKey) || findPreset('other') || BIZ_PRESETS[0];
  const coef = Object.assign({ rent: 1, labor: 1 }, CITY_COEF[cityKey] || {});
  const input = {
    area: 0, headcount: 0, laborTotalYuan: 0, laborUnitYuan: 0,
    rentYuan: 8000, waterYuan: 0, electricYuan: 0, gasYuan: 0,
    fixedYuan: fixedYuan, buildItems: []
  };
  const asm = assembleItems(preset, input, coef);
  return asm.fixedItems;
}
function manageFen(items) {
  const m = (items || []).find((x) => x.key === 'manage');
  return m ? Number(m.fen) : null;
}

// ============ A 行为（核心：矩阵新形状 → manage 键在且空 ⇒ 不派生）============
sec('A · fixedYuan 带 manage 键（空/填）⇒ 装配产物按用户作答，不派生');
for (const k of KEYS) {
  const newM = manageFen(buildWith(k, 'tier23', { rent: 8000, manage: '' }));
  check(`A-${k}-① 键在且空 → manage 必须=null（不派生房租×占比）`,
    newM === null, `manage=${newM}`);
}
for (const k of KEYS) {
  const fillM = manageFen(buildWith(k, 'tier23', { rent: 8000, manage: '5000' }));
  check(`A-${k}-② 键在且填 5000 → manage 必须=500000（用填的数）`,
    fillM === 500000, `manage=${fillM}`);
}

// ============ B 正控（键缺失 ⇒ 派生 >0，证明「键在/键缺」两态数字相异）============
sec('B · 正控（键缺失 ⇒ manage 走房租×占比派生，且 ≠「键在空」）');
for (const k of KEYS) {
  const newM = manageFen(buildWith(k, 'tier23', { rent: 8000, manage: '' }));
  const oldM = manageFen(buildWith(k, 'tier23', { rent: 8000 })); // 旧矩阵：缺 manage 键
  check(`B-${k}-① 键缺失→派生(>0) 且 与「键在空」相异`,
    typeof oldM === 'number' && oldM > 0 && newM !== oldM,
    `键在空=${newM} / 键缺失派生=${oldM}`);
}

// ============ C 变异灵敏度（锁 R533 实改：矩阵 buildClean 必须带 manage 键）============
sec('C · 变异灵敏度（源锚 + 单页收敛 + 删键回退可抓，非恒绿）');
// 源锚助手：仅在 buildClean 函数体内（签名 → 其首个 assembleItems 调用）查找 fixedYuan 含 manage
function buildCleanHasManage(src) {
  const bc = src.indexOf('buildClean(');
  if (bc < 0) return false;
  const end = src.indexOf('assembleItems(preset, input, coef)', bc);
  if (end < 0) return false;
  const region = src.slice(bc, end);
  return /fixedYuan:\s*\{\s*rent:[^}]*manage:/.test(region);
}
check('C-① 矩阵 buildClean 的 fixedYuan 含 manage（锁 R533 实改）',
  buildCleanHasManage(matrixSrc) === true, '已锚定 buildClean 固定费用构造');
// 单页收敛：index.js forward 亦带 manage 键（第 1756 行：isReverse ? {} : { rent, manage }）
check('C-② 单页 index.js forward 亦含 manage（两页口径收敛）',
  indexSrc.includes('{ rent: this.data.rentYuan, manage: this.data.manageYuan }'));
// 变异回灌：把 buildClean 的 manage 键删掉（模拟 R533 回退）⇒ 锚点必须判 false
{
  const bc = matrixSrc.indexOf('buildClean(');
  const end = matrixSrc.indexOf('assembleItems(preset, input, coef)', bc);
  const region = matrixSrc.slice(bc, end);
  const mutatedRegion = region.replace(', manage: this.data.global.manageYuan', '');
  const mutated = matrixSrc.slice(0, bc) + mutatedRegion + matrixSrc.slice(end);
  check('C-③ 变异：buildClean 去掉 manage 键 ⇒ 锚点判 false（守卫能抓回退，非恒绿）',
    buildCleanHasManage(mutated) === false);
}
// 数字证明：键在空(null) ≠ 键缺失派生(>0)
{
  const newM = manageFen(buildWith('fastfood_noodle', 'tier23', { rent: 8000, manage: '' }));
  const oldM = manageFen(buildWith('fastfood_noodle', 'tier23', { rent: 8000 }));
  check('C-④ 数字级证明：「键在空=null」≠「键缺失派生>0」⇒ 修的是真数字差',
    newM === null && typeof oldM === 'number' && oldM > 0, `键在空=${newM} / 键缺失派生=${oldM}`);
}

// ============ E 自失效护栏（防"扫空 ⇒ 恒绿"）============
sec('E · 自失效护栏');
check('E-① 矩阵源码非退化（>1500 字符）', matrixSrc.length > 1500, matrixSrc.length + ' 字符');
check('E-② 断言数下界（pass ≥ 16，删一批仍 >0）', pass >= 16, `当前 pass=${pass}`);

console.log(`\n===== M2 matrix.manage 守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
