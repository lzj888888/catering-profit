// utils/marginAlert.selftest.js —— P1 毛利预警/成本漂移预警核心守卫（纯 node 直跑）
// 运行： node utils/marginAlert.selftest.js
//
// 🔴 本文件不只测「算得对」，还测**单源**：预警级别必须与 utils/marginBand.js 的档位一一对应，
//   否则同一道菜会在成本卡列表（色带）和预警里显示不同颜色 —— 那正是 R298Y 修过的同族病。
const { grossMarginPct, marginAlert, marginDrift, costDriftAlert, isLossMaking, LEVEL_OF_BAND } = require('./marginAlert.js');
const band = require('./marginBand.js');   // 单源：用于交叉核对，不在本文件写任何阈值

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// ===== 毛利率计算 =====
check('毛利率：售价1000分成本400分 = 60%', grossMarginPct(1000, 400) === 60);
check('毛利率：成本=售价 = 0%', grossMarginPct(1000, 1000) === 0);
check('毛利率：成本>售价 = 负数', grossMarginPct(1000, 1200) === -20);
check('毛利率：售价0 → null(防除零)', grossMarginPct(0, 400) === null);
check('毛利率：售价负数 → null', grossMarginPct(-5, 400) === null);
check('毛利率：成本负数 → null', grossMarginPct(1000, -10) === null);

// ===== 单品毛利预警：级别只由档位派生 =====
const a1 = marginAlert(1000, 400); // 60% ⇒ 高
check('高毛利(60%) → ok / band=high', a1.level === 'ok' && a1.band === 'high' && a1.marginPct === 60);
const a2 = marginAlert(1000, 450); // 55% ⇒ 中
check('中毛利(55%) → warn / band=mid', a2.level === 'warn' && a2.band === 'mid');
const a3 = marginAlert(1000, 600); // 40% ⇒ 中（边界：恰好 40 仍是中，与单源一致）
check('边界 40% → 仍是中(warn)，不提前判红', a3.level === 'warn' && a3.band === 'mid' && a3.marginPct === 40);
const a4 = marginAlert(1000, 610); // 39% ⇒ 低
check('低毛利(39%) → danger / band=low', a4.level === 'danger' && a4.band === 'low');
const a5 = marginAlert(1000, 1200); // -20% ⇒ 亏本
check('亏本(-20%) → danger 且提示亏本卖', a5.level === 'danger' && a5.marginPct < 0 && /亏本/.test(a5.msg));
const a6 = marginAlert(0, 400); // 未定价
check('未定价 → level=none / band=none（不误报红）', a6.level === 'none' && a6.band === 'none' && a6.marginPct === null);
const a7 = marginAlert(1000, 400);
check('毛利率达标文案含阈值(≥60%)', /≥60%/.test(a7.msg));

// ===== 单源交叉核对：级别 ≡ 档位（同一条菜在列表与预警里必须同色）=====
const SAMPLES = [[1000, 400], [1000, 450], [1000, 600], [1000, 610], [1000, 800], [2000, 500], [1500, 900]];
let bad = 0;
for (const [p, c] of SAMPLES) {
  const r = marginAlert(p, c);
  const expectBand = band.bandOf(r.marginPct);
  const expectLevel = (r.marginPct !== null && r.marginPct < 0) ? 'danger' : LEVEL_OF_BAND[expectBand];
  if (r.band !== expectBand || r.level !== expectLevel) bad++;
}
check('单源一致性：' + SAMPLES.length + ' 组样本的 band/level ≡ marginBand 派生值', bad === 0, bad ? bad + ' 组不符' : '全数一致');

// ===== 成本漂移预警 =====
const d1 = costDriftAlert(1000, 400, 500); // 60%→50%：高→中，降档
check('成本涨：60%→50% 高降中 → warn + downgraded', d1.level === 'warn' && d1.downgraded === true && d1.crossedLow === false && d1.dropPct === -10);
const d2 = costDriftAlert(1000, 400, 620); // 60%→38%：高→低，跌进低毛利
check('成本涨：60%→38% 跌进低毛利 → danger + crossedLow', d2.level === 'danger' && d2.crossedLow === true && d2.newBand === 'low');
const d3 = costDriftAlert(1000, 400, 600); // 60%→40%：高→中（边界仍中）
check('成本涨：60%→40% 边界 → warn + band=mid（不提前判红）', d3.level === 'warn' && d3.newBand === 'mid');
const d4 = costDriftAlert(1000, 400, 300); // 60%→70%：升毛利
check('成本降：60%→70% → ok 且非降档', d4.level === 'ok' && d4.downgraded === false && d4.dropPct === 10);
const d5 = costDriftAlert(1000, 500, 400); // 50%→60%：中升高
check('成本降：50%→60% 升档 → ok(不能因"有变动"就报警)', d5.level === 'ok' && d5.downgraded === false);
const d6 = costDriftAlert(1000, 400, 1100); // 60%→-10%：亏本
check('成本涨到亏本 → danger 且提示已亏本', d6.level === 'danger' && d6.newMargin < 0 && /亏本/.test(d6.msg));
const d7 = costDriftAlert(0, 400, 500);
check('售价缺失 → level=none（不误报）', d7.level === 'none');
const d8 = costDriftAlert(1000, 900, 950); // 10%→5%：本来就低，仍在低
check('低毛利内部继续下滑 → danger（按新档位判，非"没降档就放过"）', d8.level === 'danger' && d8.newBand === 'low');
const d9 = costDriftAlert(1000, 620, 400); // 38%→60%：低升高
check('低毛利修复到高毛利 → ok', d9.level === 'ok' && d9.downgraded === false);

// ===== 两函数同口径（同一条菜、同一目标状态必须同色）=====
check('一致性：终态 50% 在单品预警与漂移预警同判 warn',
  marginAlert(1000, 500).level === costDriftAlert(1000, 400, 500).level);
check('一致性：终态 38% 在两处同判 danger',
  marginAlert(1000, 620).level === costDriftAlert(1000, 400, 620).level);

// ===== 与成本引擎**真行为对拍**（不是抄公式：直接 require 生产引擎算一遍）=====
//   🔴 为什么这条腿必须有：毛利率公式在云端引擎里已有一份，本模块再算一次就是第二份。
//   若只测「我算的等于我以为的」，两份口径漂了也全绿 —— 本仓同族病第 3 型。
//   构造：单价成本 wan = costFen × 100（net_unit_cost 单位是万分之元），数量 1 ⇒ 单位成本恰为 costFen 分。
const engine = require('../cloudfunctions/syncCostCard/service.js');
function engineMargin(priceFen, costFen) {
  return engine.calcCostCard({
    mode: 'A', lines: [{ quantity: 1, net_unit_cost: costFen * 100 }],
    auxFen: 0, lossPct: 0, priceFen: priceFen,
  });
}
const PAIRS = [[1000, 400], [1000, 450], [1000, 610], [700, 300], [999, 333], [1234, 567], [1500, 1499], [2000, 1], [333, 111]];
let harnessBad = 0, parityBad = 0;
for (const [p, c] of PAIRS) {
  const r = engineMargin(p, c);
  if (r.unit_cost_fen !== c) harnessBad++;           // 夹具自检：构造出的成本必须恰为 c 分
  if (r.gross_margin_pct !== grossMarginPct(p, c)) parityBad++;
}
check('对拍夹具自检：引擎算出的单位成本 ≡ 样本成本', harnessBad === 0, harnessBad ? harnessBad + ' 组不符' : PAIRS.length + ' 组');
check('与成本引擎真行为对拍：' + PAIRS.length + ' 组毛利率逐位相等', parityBad === 0, parityBad ? parityBad + ' 组不符' : '全数相等');
check('精度须为两位小数（1/7 类舍入不可被截成一位）', grossMarginPct(700, 300) === 57.14);
check('未定价分叉是刻意的：引擎返回 0(哨兵)，本模块返回 null',
  engineMargin(0, 400).gross_margin_pct === 0 && grossMarginPct(0, 400) === null);

// ===== 已知毛利率直接判（影响面页：云端引擎已算好，不重算）=====
const m1 = marginDrift(60, 50); // 高→中
check('已知毛利率漂移 60→50：降档但不进低毛利 → warn', m1.level === 'warn' && m1.downgraded === true && m1.crossedLow === false);
const m2 = marginDrift(55, 38); // 中→低
check('已知毛利率漂移 55→38：跌进低毛利 → danger + crossedLow', m2.level === 'danger' && m2.crossedLow === true);
const m3 = marginDrift(null, 38); // 改前未定价
check('改前未定价(旧卡无价) → level=none（不臆造降档）', m3.level === 'none' && m3.downgraded === false);
const m4 = marginDrift(60, -5);
check('改后亏本 → danger 且提示已亏本', m4.level === 'danger' && /亏本/.test(m4.msg));
check('已知毛利率路径与成本路径同判（60→50 两处都是 warn）',
  marginDrift(60, 50).level === costDriftAlert(1000, 400, 500).level);

// ===== 亏本判定（列表页/详情页共用的单点）=====
check('isLossMaking(-0.1) = true（负毛利＝亏本）', isLossMaking(-0.1) === true);
check('isLossMaking(0) = false（保本不算亏）', isLossMaking(0) === false);
check('isLossMaking(39) = false（低毛利≠亏本）', isLossMaking(39) === false);
check('isLossMaking(null) = false（未定价不算亏）', isLossMaking(null) === false);

// ===== 接线面：核心必须**真被页面使用**（否则又是「写完没人用」的死代码，本仓高频坑）=====
//   ⚠️ 判据不能只 grep 词出现：页面注释里写着模块名也会命中（R299 的「被注释喂成恒真」）。
//   ⇒ 认「真 require + 真调用」：require 路径必须出现在 require(...) 里，调用必须是带实参的实调用。
const fs = require('fs');
const path = require('path');
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const impactSrc = readSrc('subpkg/tools/metrics/impact.js');
const cardSrc = readSrc('subpkg/biz/card/index.js');
check('接线：影响面页 require marginAlert 且真调用 marginDrift(oldM, newM)',
  /require\([^)]*utils\/marginAlert\.js/.test(impactSrc) && /marginDrift\(oldM,\s*newM\)/.test(impactSrc));
check('接线：成本卡列表 require marginAlert 且真调用 isLossMaking(c.margin)',
  /require\([^)]*utils\/marginAlert\.js/.test(cardSrc) && /isLossMaking\(c\.margin\)/.test(cardSrc));

console.log('\n==== 毛利/成本漂移预警核心自测：' + pass + ' 通过 / ' + failN + ' 失败 ====');
process.exit(failN === 0 ? 0 : 1);
