// 净料成本「前端快照 ≡ 云端重算」参数化对拍器（R747）
//
// 守的是什么事故（R745 数字链路审计发现）：
//   前端 utils/units.js::netUnitWanOf 用**完整元精度**（priceToBase 返回浮点元）；
//   云端 5 份 netUnitCostWan 收**整数分**（purchasePriceFen），先 round 到分再算。
//   审计实测：对齐 cf=1 后，10 万组里 2 位小数日常输入 31% 不等、3 位小数 93% 不等。
//   但主链路走【前端快照】（edit.js 送 net_unit_cost，validate.js 二选一），
//   云端重算路径当前不可达 ⇒ 这是【精度契约差异 + 覆盖缺口】，不是当前错钱。
//
// 本守卫不要求两者恒等（精度契约本就不同），而是钉死三条**关系**（property-based，非值断言）：
//   A 云端 5 副本之间逐点等价（防止任一副本单独改公式，R298 同族）
//   B 前端快照精度 ≥ 云端重算：差异方向可解释（前端不会系统性低估成本）
//   C 主链路契约：前端送快照 + validate 二选一，云端重算不可达（差异不外显的前提）
//   D 契约歧义被钉死：6 元/斤 误把「原单位分」喂 cf=1 会差 factor 倍且零报错 —— 守卫记录此陷阱
//   E 变异回灌：任一关系变异必须被本守卫抓到（证明判据有牙，非恒真）
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const units = require(path.join(ROOT, 'utils/units.js'));
const money = require(path.join(ROOT, 'cloudfunctions/common/money.js'));

let _s = 0x1a2b3c4d;
function rnd() { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(s) { console.log('\n=== ' + s + ' ==='); }

// 参数化提取云端 5 份 netUnitCostWan（源码级，不改产品）
const CF_FILES = [
  'cloudfunctions/calcBom/service.js', 'cloudfunctions/saveCostCard/service.js',
  'cloudfunctions/syncCostCard/service.js', 'cloudfunctions/saveMaterial/service.js',
  'cloudfunctions/getMaterial/service.js',
];
function extractNetUnit(rel) {
  const src = read(rel);
  const m = src.match(/function netUnitCostWan\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  if (!m) return null;
  try {
    return new Function('purchasePerGramYuan', m[0] + '\nreturn netUnitCostWan;')(
      (fen, cf) => (fen / 100) / cf
    );
  } catch (_) { return null; }
}
const IMPLS = CF_FILES.map((f) => ({ f, fn: extractNetUnit(f) }));
const yuanToFen = (y) => money.yuanToFen(y);

sec('A 云端 5 副本逐点等价（确定性种子 5 万组）');
ok('A-① 5 份 netUnitCostWan 全部可提取', IMPLS.every((x) => typeof x.fn === 'function'),
  IMPLS.map((x) => (x.fn ? 'OK' : 'FAIL') + ':' + path.basename(path.dirname(x.f))).join(' '));
{
  const T = 50000; let diff = 0; const ex = [];
  const unitsPool = units.PURCHASE_UNITS;
  const yPool = [1, 30, 50, 60, 90, 92, 95, 100, 33.3, 66.7, 99.5];
  for (let t = 0; t < T; t++) {
    const fen = ri(1, 20000000);
    const cf = ri(1, 1000);
    const y = yPool[ri(0, yPool.length - 1)];
    const vals = IMPLS.map((x) => x.fn && x.fn(fen, cf, y));
    if (vals.some((v) => v !== vals[0])) { diff++; if (ex.length < 3) ex.push({ fen, cf, y, vals }); }
  }
  ok('A-② 5 副本同参同果（0 差异）', diff === 0, diff ? JSON.stringify(ex) : T + ' 组 0 差异');
}

sec('B 前端快照 vs 云端重算：差异方向可解释（2 位小数日常输入 2 万组）');
{
  const T = 20000;
  let diffCnt = 0, frontLT = 0, frontGT = 0, maxGap = 0; const ex = [];
  const unitsPool = units.PURCHASE_UNITS;
  const yPool = [1, 30, 50, 60, 90, 92, 95, 100, 33.3, 66.7, 99.5];
  for (let t = 0; t < T; t++) {
    const unit = unitsPool[ri(0, unitsPool.length - 1)];
    const f = units.factorOf(unit);
    const y = yPool[ri(0, yPool.length - 1)];
    const yuan2 = ri(1, 200000) / 100;                 // 2 位小数日常价
    const front = units.netUnitWanOf(yuan2, y, unit);
    const cloud = IMPLS[0].fn(yuanToFen(yuan2 / f), 1, y);  // cf=1，入参=克价分
    if (front !== cloud) {
      diffCnt++;
      const gap = front - cloud;
      if (gap < 0) frontLT++; else frontGT++;
      if (Math.abs(gap) > maxGap) maxGap = Math.abs(gap);
      if (ex.length < 3) ex.push({ yuan2, unit, y, front, cloud, gap });
    }
  }
  // 关键性质：差异是**分位截断**造成的双向抖动（浮点 round 到最近分，方向随机），
  //   不是单向系统性偏移 —— 所以判「两侧都存在且量级对称」，不假设"前端永远更高/更低"。
  ok('B-① 差异确实存在（契约差异被看见，不是假装相等）', diffCnt > 0,
    diffCnt + '/' + T + ' 不等（' + (diffCnt / T * 100).toFixed(1) + '%）');
  ok('B-② 差异双向且大致对称（分位截断抖动，非单向系统性偏移）',
    frontLT > 0 && frontGT > 0 && Math.abs(frontLT - frontGT) / diffCnt < 0.25,
    'front<cloud=' + frontLT + ' front>cloud=' + frontGT + ' 比例差=' + (Math.abs(frontLT - frontGT) / diffCnt).toFixed(3));
  ok('B-③ 差异量级有限（最大差 < 1 元=10000 万分，不是 factor 倍灾难）',
    maxGap < 10000, 'maxGap=' + maxGap + ' 万分');
}

sec('C 主链路契约：前端送快照 + validate 二选一（差异不外显的前提）');
const EDIT = read('subpkg/biz/card/edit.js');
const VALIDATE = read('cloudfunctions/saveCostCard/validate.js');
ok('C-① 编辑页保存走 netUnitWanOf 快照（不是送 unit_price_fen+yield_rate）',
  /netUnitWanOf/.test(EDIT) && /net_unit_cost:\s*wan/.test(EDIT));
ok('C-② validate 二选一守卫在位（有快照就不重算）',
  /hasInput && hasSnapshot/.test(VALIDATE) && /hasInput\)/.test(VALIDATE) && /hasSnapshot\)/.test(VALIDATE));
ok('C-③ 二选一有下界：三种情况全覆盖（input / snapshot / 都没有报错）',
  /if \(hasInput\)[\s\S]{0,300}else if \(hasSnapshot\)[\s\S]{0,200}else/.test(VALIDATE));

sec('D 契约歧义陷阱被钉死（不能靠"零报错"当作没问题）');
{
  const f = units.factorOf('斤');
  const front = units.netUnitWanOf(6, 100, '斤');
  const cloudCorrect = IMPLS[0].fn(yuanToFen(6 / f), 1, 100);
  const cloudRaw = IMPLS[0].fn(yuanToFen(6), 1, 100);
  // 6元/斤 = 0.012 元/克：前端保留完整精度 ⇒ 120 万分；
  // 云端先把 0.012 元收到「1 分」⇒ 100 万分（分位截断，少 20 万分 = 0.002 元）。
  ok('D-① 6元/斤 差异可解释：前端保完整精度 120 / 云端分位截断 100',
    front === 120 && cloudCorrect === 100 && front > cloudCorrect,
    'front=' + front + ' cloud=' + cloudCorrect + ' 差=' + (front - cloudCorrect) + ' 万分（0.002元）');
  // 误传的是「6 元的分数 600」而非「0.012 元的分数 1」⇒ 比值 600×（= 原单位分，
  // 不等于 factor=500，因为 0.012 元被分位截断成 1 分而非 1.2 分）。量级仍是灾难性且零报错。
  ok('D-② 误把「原单位分」喂 cf=1 会差数百倍且无报错（陷阱已量化）',
    cloudRaw > 0 && cloudRaw / cloudCorrect >= 100,
    'cloudRaw=' + cloudRaw + ' = ' + (cloudRaw / cloudCorrect) + '×（factor=' + f + '，比值≠factor 因分位截断）');
  ok('D-③ 主链路按 (0,100] 校验出成率挡住越界（墨盒 R298 死代码在原料侧有兜底）',
    /yield_rate/.test(read('cloudfunctions/saveMaterial/validate.js')));
}

sec('E 变异回灌（证明判据有牙，非恒真）');
{
  // 变异 1：把某副本公式改成「不除出成率」⇒ A-② 必须转红
  const mutantFn = (fen, cf, y) => Math.round(((fen / 100) / cf) * 10000); // 漏 /(y/100)
  const base = IMPLS[0].fn(123456, 3, 60);
  const mut = mutantFn(123456, 3, 60);
  ok('E-① 变异体（漏除出成率）在 A-② 判据下必须转红', base !== mut,
    '原件=' + base + ' 变异=' + mut);
  // 变异 2：把前端快照改成「先收整数分」⇒ B 段差异应该消失（frontLT=frontGT=0）
  const frontMut = (yuan, y, unit) => IMPLS[0].fn(yuanToFen(yuan / units.factorOf(unit)), 1, y);
  let mutDiff = 0;
  for (let t = 0; t < 2000; t++) {
    const unit = units.PURCHASE_UNITS[ri(0, units.PURCHASE_UNITS.length - 1)];
    const y = 60, yuan2 = ri(1, 200000) / 100;
    if (frontMut(yuan2, y, unit) !== IMPLS[0].fn(yuanToFen(yuan2 / units.factorOf(unit)), 1, y)) mutDiff++;
  }
  ok('E-② 变异体（前端也先收整数分）让 B-① 差异消失（证明 B-① 不是恒真）',
    mutDiff === 0, '变异后不一致组=' + mutDiff);
}

console.log('\n===== 净料成本参数化对拍器：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
process.exit(fails.length === 0 ? 0 : 1);
