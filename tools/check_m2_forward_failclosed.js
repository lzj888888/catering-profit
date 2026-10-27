#!/usr/bin/env node
// tools/check_m2_forward_failclosed.js —— M2 正向「空表单不得出保本数」行为守卫（D1 · 2026-10-27 拍板）
//
// 为什么需要它（M2 整体审计 H1 实证：现有 8 个 M2 守卫对「hasFixed 放宽」零告警）：
//   正向测算的结果区门槛 `const hasFixed = rentFen > 0 && laborFen > 0;`
//   （subpkg/tools/sandbox/index.js 的 onCalcPresetFwd handler）是「房租或人工没填 ⇒ 整块不出数」
//   的唯一闸门。引擎 calcSandbox 本身**不** fail-closed —— 空表单时房租/人工虽为 0，但 utility/manage
//   会按 RATE_COST_FLOOR 兜底派生，引擎照样算出非空保本（实证：空表单引擎返回 603448 分）。
//   所以一旦有人把 `> 0` 放宽成 `>= 0`（或删掉这道闸门），空表单就会显示「保本点 ¥6034」这种假数，
//   而 8 个既有守卫一个都没抓到。本守卫用**真实装配 + 真实引擎路径**重现页面决策，并做变异回灌证明分辨力。
//
// 判据（P/Q/A/B/C/E 六段，全部 fail-closed：读不到 / 提取不到即判红）：
//   P 前置     bizPreset / calcSandbox 可 require + 页面源码可读
//   Q 提取     从页面源码锚定提取 `hasFixed` 谓词（必须同时含 rentFen 与 laborFen）
//   A 空表单   用 assembleItems 真实装配空表单 → rentFen=0 && laborFen=0；
//              + 引擎对空表单仍算出非空保本（证明门禁是"唯一"拦截）；
//              + hasFixed(空表单) 必须 === false（结果区整块不出数）
//   B 正控     已填表单 → hasFixed === true 且引擎算出非空保本（门禁不是"永远 false"）
//   C 变异灵敏度 把谓词 `> 0` 偷改成 `>= 0` ⇒ 对空表单变为 true ⇒ 本守卫抓得到（非恒绿）
//   E 自失效    页面源码非退化 + 断言数下界（防"扫空 ⇒ 恒绿"）
//
// 运行：node tools/check_m2_forward_failclosed.js   （由 verify_all.js 的 [m2-forward-failclosed] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIZ = path.join(ROOT, 'utils', 'bizPreset.js');
const CALC = path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js');
const PAGE = path.join(ROOT, 'subpkg', 'tools', 'sandbox', 'index.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');
const readOr = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

// ============ P 前置（fail-closed）============
sec('P 前置（fail-closed：读不到 / require 不出即判红）');
let biz = null, calc = null;
try { biz = require(BIZ); } catch (e) { biz = null; }
try { calc = require(CALC); } catch (e) { calc = null; }
check('P-① utils/bizPreset.js 可 require', !!biz);
check('P-② cloudfunctions/calcSandbox/service.js 可 require', !!calc);
const pageSrc = readOr(PAGE);
check('P-③ 页面源码可读', !!pageSrc && pageSrc.length > 1500, pageSrc ? pageSrc.length + ' 字符' : '读不到');
if (!biz || !calc || !pageSrc) {
  console.log(`\n===== M2 空表单 fail-closed 守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败 ⇒ 直接判红（fail-closed）');
  process.exit(1);
}
const { CITY_COEF, assembleItems, findPreset, BIZ_PRESETS } = biz;
check('P-④ 导出 assembleItems / findPreset / CITY_COEF',
  typeof assembleItems === 'function' && typeof findPreset === 'function' && !!CITY_COEF);

// ============ Q hasFixed 谓词提取（锚定 rentFen && laborFen）============
sec('Q · hasFixed 谓词提取（锚定 rentFen && laborFen，fail-closed）');
const hm = pageSrc.match(/const\s+hasFixed\s*=\s*(rentFen[\s\S]*?laborFen[^;]*);/);
const hasFixedExpr = hm ? hm[1].trim() : null;
check('Q-① 提取到 hasFixed 谓词', !!hasFixedExpr, hasFixedExpr || '未匹配（锚定 rentFen…laborFen 失败）');
check('Q-② 谓词同时含 rentFen 与 laborFen',
  !!hasFixedExpr && /rentFen/.test(hasFixedExpr) && /laborFen/.test(hasFixedExpr));
if (!hasFixedExpr) {
  console.log(`\n===== M2 空表单 fail-closed 守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 提取不到 hasFixed 谓词 ⇒ 直接判红（fail-closed）');
  process.exit(1);
}
const evalReal = new Function('rentFen', 'laborFen', 'return (' + hasFixedExpr + ');');

// ============ 忠实复刻页面 buildPresetParam('forward') 的装配 ============
function buildForward(presetKey, cityKey, ov) {
  const preset = findPreset(presetKey) || findPreset('other') || BIZ_PRESETS[0];
  const coef = Object.assign({ rent: 1, labor: 1 }, CITY_COEF[cityKey] || {});
  // 与页面同口径：房租/人工空 ⇒ fixedYuan 相应键传 ''；水电气全空 ⇒ utility 走兜底（与 H3/D3 无关，本守卫只看 rent/labor 门禁）
  const input = Object.assign({
    area: 0, headcount: 0, laborTotalYuan: 0, laborUnitYuan: 0,
    rentYuan: 0, waterYuan: 0, electricYuan: 0, gasYuan: 0,
    fixedYuan: { rent: '', manage: '' }, buildItems: []
  }, ov || {});
  const asm = assembleItems(preset, input, coef);
  // 正向模式：第二道防线不滤 rent（仅反推模式滤），与页面一致
  return { preset, fixedItems: asm.fixedItems, varItems: asm.varItems };
}
function rl(fi) {
  return {
    rentFen: fi.reduce((s, x) => s + (x.key === 'rent' ? Number(x.fen) || 0 : 0), 0),
    laborFen: fi.reduce((s, x) => s + (x.key === 'labor' ? Number(x.fen) || 0 : 0), 0),
  };
}
function runEngine(preset, fixedItems, varItems, margin) {
  const clean = {
    cityTier: 'tier23', bizType: preset.bizKey, buildItems: [],
    fixedItems, varItems, grossMarginPct: margin, targetProfitFen: 0,
    expectedRevenueFen: 0, validDays: 30,
  };
  return calc.calcSandbox(clean).break_even_monthly_fen;
}

// ============ A 空表单 fail-closed（核心）============
sec('A · 空表单 fail-closed（房租 + 人工都没填 ⇒ 整块不出保本数）');
for (const pk of ['noodle', 'other']) {
  const e = buildForward(pk, 'tier23', {});
  const r = rl(e.fixedItems);
  check(`A-${pk}-① 空表单装配出 rentFen=0 且 laborFen=0`, r.rentFen === 0 && r.laborFen === 0,
    `rentFen=${r.rentFen} laborFen=${r.laborFen}`);
  const be = runEngine(e.preset, e.fixedItems, e.varItems, 60);
  check(`A-${pk}-② 引擎对空表单仍算出非空保本（证明门禁是"唯一"拦截）`, Number(be) > 0,
    `break_even=${be} 分（若门禁失效，此数会被显示）`);
  const hf = evalReal(r.rentFen, r.laborFen);
  check(`A-${pk}-③ hasFixed(空表单) === false（结果区整块不出数）`, hf === false, `hasFixed=${hf}`);
}

// ============ B 正控（门禁不是"永远 false"）============
sec('B · 正控（房租 + 人工都填 ⇒ 正常出数）');
const f = buildForward('noodle', 'tier23',
  { rentYuan: 10000, fixedYuan: { rent: 10000, manage: '' }, laborTotalYuan: 8000 });
const rf = rl(f.fixedItems);
check('B-① 已填表单装配出 rentFen>0 且 laborFen>0', rf.rentFen > 0 && rf.laborFen > 0,
  `rentFen=${rf.rentFen} laborFen=${rf.laborFen}`);
check('B-② hasFixed(已填) === true', evalReal(rf.rentFen, rf.laborFen) === true);
const beF = runEngine(f.preset, f.fixedItems, f.varItems, 60);
check('B-③ 引擎对已填表单算出非空保本', Number(beF) > 0, `break_even=${beF} 分`);

// ============ C 变异灵敏度（守卫必须能抓到放宽）============
sec('C · 变异灵敏度（把 >0 放宽成 >=0，本守卫必须能抓到）');
// 模拟源码被改成 `rentFen >= 0 && laborFen >= 0`（在已提取的谓词上做等价替换）
const mutExpr = hasFixedExpr.replace(/> 0/g, '>= 0');
check('C-① 变异后谓词与原式不同（>0 ⇒ >=0）', !!mutExpr && mutExpr !== hasFixedExpr,
  `${hasFixedExpr} → ${mutExpr}`);
if (mutExpr) {
  const evalMut = new Function('rentFen', 'laborFen', 'return (' + mutExpr + ');');
  const e2 = rl(buildForward('noodle', 'tier23', {}).fixedItems);
  const mutEmpty = evalMut(e2.rentFen, e2.laborFen);
  check('C-② 变异后 hasFixed(空表单) 变为 true（放宽会"漏放"空表单 ⇒ 本守卫抓得到）',
    mutEmpty === true, `变异后 hasFixed=${mutEmpty}`);
}

// ============ E 自失效护栏（防"扫空 ⇒ 恒绿"）============
sec('E · 自失效护栏');
check('E-① 页面源码非退化（>1500 字符）', pageSrc.length > 1500, pageSrc.length + ' 字符');
check('E-② 断言数下界（pass ≥ 11，删一批仍 >0）', pass >= 11, `当前 pass=${pass}`);

console.log(`\n===== M2 空表单 fail-closed 守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
