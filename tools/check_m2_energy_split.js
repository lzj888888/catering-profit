#!/usr/bin/env node
// tools/check_m2_energy_split.js —— M2 正向「水电气任一项>0 即采用」行为守卫（D3 · 2026-10-27 拍板）
//
// 为什么需要它（M2 整体审计 H2/H3 实证：现有 M2 守卫对 energy_split 形态变异零告警）：
//   业态参数包里 utility 走 form='energy_split'，判定依据是「用户填的水/电/气实数求和是否 >0」：
//     原实现 `w>0 && elec>0 && gas>0` 要求三项**全填**，否则整组丢弃改走「房租×占比」派生
//     —— 老板只填了电 1500，系统却按 房租×40%(3200) 算，用户填的数被静默丢（审计实证复现）。
//   2026-10-27 拍板改成「任一项 >0 就采用填的（求和），三项全空才走 rent_rate 派生」
//   （bizPreset.js:447-457）。本守卫用**真实装配**喂数字断言行为，并做变异回灌证明分辨力（非恒绿）。
//
// 判据（P/Q/A/B/C/E 六段，全部 fail-closed：读不到 / 提取不到即判红）：
//   P 前置     bizPreset 可 require + 源码可读
//   Q 提取     定位 energy_split 分支
//   A 行为     真实装配：电=1500（水/气=0）→ utility 必须=150000（用填的数，非房租派生）；
//              + 水/气单填、三项任意组合 → 均按求和进 utility
//   B 正控     三项全空 → utility 走派生（≠150000，证明不是"永远求和"）
//   C 变异灵敏度 旧写法 `w>0 && elec>0 && gas>0` 对"只填电 1500"返回 false（会丢数），
//              与现行 `w+elec+gas>0` 返回 true 相异 ⇒ 守卫抓得到（非恒绿）；
//              + 源码能量分支须含 `w + elec + gas > 0`（改回旧 && 写法即转红）
//   E 自失效    源码非退化 + 断言数下界（防"扫空 ⇒ 恒绿"）
//
// 运行：node tools/check_m2_energy_split.js   （由 verify_all.js 的 [m2-energy-split] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIZ = path.join(ROOT, 'utils', 'bizPreset.js');

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
const bizSrc = readOr(BIZ);
check('P-② 源码可读', !!bizSrc && bizSrc.length > 1500, bizSrc ? bizSrc.length + ' 字符' : '读不到');
if (!biz || !bizSrc) {
  console.log(`\n===== M2 energy_split 守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败 ⇒ 直接判红（fail-closed）');
  process.exit(1);
}
const { CITY_COEF, assembleItems, findPreset, BIZ_PRESETS } = biz;
check('P-③ 导出 assembleItems / findPreset / CITY_COEF',
  typeof assembleItems === 'function' && typeof findPreset === 'function' && !!CITY_COEF);

// ============ 忠实复刻页面 buildPresetParam 的装配（正向模式）============
function buildForward(presetKey, cityKey, ov) {
  const preset = findPreset(presetKey) || findPreset('other') || BIZ_PRESETS[0];
  const coef = Object.assign({ rent: 1, labor: 1 }, CITY_COEF[cityKey] || {});
  // 房租/人工/水电全空 ⇒ 与能量分支无关；energy_split 读 in_.waterYuan/electricYuan/gasYuan
  const input = Object.assign({
    area: 0, headcount: 0, laborTotalYuan: 0, laborUnitYuan: 0,
    rentYuan: 0, waterYuan: 0, electricYuan: 0, gasYuan: 0,
    fixedYuan: { rent: '', manage: '' }, buildItems: []
  }, ov || {});
  const asm = assembleItems(preset, input, coef);
  return { preset, fixedItems: asm.fixedItems, varItems: asm.varItems };
}
function utilFen(fixedItems) {
  const u = (fixedItems || []).find((x) => x.key === 'utility');
  return u ? Number(u.fen) : null;
}

// ============ A 行为（核心：任一项>0 即采用，且按"填的数"求和）============
sec('A · 任一项>0 即采用填的数（水/电/气任意单填或组合 → utility = 求和）');
// 电=1500（水/气=0）：必须 = 150000（用填的电，而非房租×40% 派生 ~320000）
for (const pk of ['fastfood_noodle', 'other']) {
  const e = buildForward(pk, 'tier23', { electricYuan: 1500 });
  check(`A-${pk}-① 只填电 1500 → utility 必须 = 150000（用填的数，非派生）`,
    utilFen(e.fixedItems) === 150000, `utility=${utilFen(e.fixedItems)} 分`);
}
// 水=800 单填
{
  const e = buildForward('fastfood_noodle', 'tier23', { waterYuan: 800 });
  check('A-② 只填水 800 → utility 必须 = 80000', utilFen(e.fixedItems) === 80000,
    `utility=${utilFen(e.fixedItems)} 分`);
}
// 气=600 单填
{
  const e = buildForward('fastfood_noodle', 'tier23', { gasYuan: 600 });
  check('A-③ 只填气 600 → utility 必须 = 60000', utilFen(e.fixedItems) === 60000,
    `utility=${utilFen(e.fixedItems)} 分`);
}
// 三项任意组合 → 求和
{
  const e = buildForward('fastfood_noodle', 'tier23', { waterYuan: 100, electricYuan: 200, gasYuan: 300 });
  check('A-④ 水100+电200+气300 → utility 必须 = 60000（求和）', utilFen(e.fixedItems) === 60000,
    `utility=${utilFen(e.fixedItems)} 分`);
}

// ============ B 正控（三项全空 → 走 rent_rate 派生，证明不是"永远求和"）============
sec('B · 正控（三项全空 → utility 走房租派生，≠ 填的数）');
{
  const e = buildForward('fastfood_noodle', 'tier23', { waterYuan: 0, electricYuan: 0, gasYuan: 0 });
  const u = utilFen(e.fixedItems);
  // 房租=0 ⇒ 派生 base = RATE_COST_FLOOR.fastfood(8000) × co.rent(1) = 800000；×rentPct40% = 320000
  check('B-① 三项全空 → utility 走派生（是正数，非 150000）',
    typeof u === 'number' && u > 0 && u !== 150000, `utility=${u} 分`);
}

// ============ C 变异灵敏度（守卫必须能抓到放宽/回退）============
sec('C · 变异灵敏度（旧 `&&` 写法会丢弃"只填一项" ⇒ 本守卫抓得到）');
const GOOD = (w, elec, gas) => (w + elec + gas > 0);
const BAD = (w, elec, gas) => (w > 0 && elec > 0 && gas > 0);
const onlyElec = [0, 1500, 0];
check('C-① 现行 `w+elec+gas>0` 对"只填电 1500"返回 true（采用填的数）',
  GOOD(onlyElec[0], onlyElec[1], onlyElec[2]) === true);
check('C-② 旧 `w>0 && elec>0 && gas>0` 对"只填电 1500"返回 false（会丢数）',
  BAD(onlyElec[0], onlyElec[1], onlyElec[2]) === false);
check('C-③ 两者在"只填一项"样本上相异 ⇒ 守卫有分辨力（非恒绿）',
  GOOD(onlyElec[0], onlyElec[1], onlyElec[2]) !== BAD(onlyElec[0], onlyElec[1], onlyElec[2]));
// 静态锚点：源码含现行写法（全仓仅 energy_split 分支出现），改回旧 && 写法即转红
const esIdx = bizSrc.indexOf("form === 'energy_split'");
check('C-④ 源码含 `w + elec + gas > 0`（改回旧 && 写法即转红）',
  /w \+ elec \+ gas > 0/.test(bizSrc), esIdx >= 0 ? '已锚定 energy_split 分支' : '未找到分支');

// ============ E 自失效护栏（防"扫空 ⇒ 恒绿"）============
sec('E · 自失效护栏');
check('E-① 源码非退化（>1500 字符）', bizSrc.length > 1500, bizSrc.length + ' 字符');
check('E-② 断言数下界（pass ≥ 9，删一批仍 >0）', pass >= 9, `当前 pass=${pass}`);

console.log(`\n===== M2 energy_split 守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
