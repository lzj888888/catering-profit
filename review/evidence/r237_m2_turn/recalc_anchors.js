#!/usr/bin/env node
// review/evidence/r237_m2_turn/recalc_anchors.js
// R237「翻台口径与桌数输入」增量规范的**锚点复算脚本**（spec-increment-authoring 步骤 4）。
//
// 它要证明三件事（顺序不可换）：
//   A 旧锚点**先证没漂** —— 用生产引擎 `require` 实跑 J6 那组输入（座位 20 ⇒ 翻台 3.70）。
//   B 新锚点：桌数 × 单桌座位数 = 座位数 ⇒ 入参**逐字段相同** ⇒ 输出**逐字段相同**
//     （恒等性**由构造成立**，不是"看起来一样"：5×4 / 10×2 / 20×1 / 4×5 四组乘积为 20 全等）。
//   C 反例：漏乘（把桌数直接当座位数）⇒ 翻台 14.81 ≠ 3.70 —— 证明这一步换算**必要**；
//     并顺带证「旧阈值 8」在漏乘口径下会误报 ⇒ 它是旧座位口径的产物、理应废弃。
//
// ⚠️ 本脚本**只读**：require 生产引擎 + 前端纯函数，零写盘。
// 运行：node review/evidence/r237_m2_turn/recalc_anchors.js

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ENGINE = path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js');
const PRESET = path.join(ROOT, 'utils', 'bizPreset.js');

let pass = 0, failN = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ============ S 前置 ============
sec('S 前置：生产引擎与前端单源可 require（解析不到即判红，否则下面会静默恒绿）');
let svc = null, bp = null;
try { svc = require(ENGINE); } catch (e) { svc = null; }
try { bp = require(PRESET); } catch (e) { bp = null; }
chk('S-① 生产引擎 calcSandbox/service.js 可 require 且导出 calcSandboxReverse',
  !!(svc && typeof svc.calcSandboxReverse === 'function'));
chk('S-② 扫描面非退化：引擎源码 > 8000 字节（实测 9393 的保守下沿）',
  fs.readFileSync(ENGINE, 'utf8').length > 8000,
  fs.readFileSync(ENGINE, 'utf8').length + ' 字节');
chk('S-③ 前端单源 utils/bizPreset.js 可 require 且导出三个 R237 新函数',
  !!(bp && typeof bp.seatsPerTableOf === 'function'
    && typeof bp.turnModeOf === 'function' && typeof bp.turnLevelOf === 'function'));

// ============ A 旧锚点回归（先证没漂）============
sec('A 旧锚点回归：J6 那组输入（目标利润 2 万 / 客单 45 / 毛利 60% / 座位 20 / 30 天 / 租金率 12%）');
// 与 cloudfunctions/calcSandbox/selftest.js 的 revBase **逐字段一致**（不新造输入）。
const revBase = {
  mode: 'reverse',
  cityTier: 'tier23', bizType: 'dining',
  buildItems: [],
  fixedItems: [{ key: 'labor', fen: 2800000 }],
  varItems: [],
  grossMarginPct: 60,
  targetProfitFen: 2000000,
  rev_price_fen: 4500, seats: 20, open_days: 30, target_rent_rate: 12, pixel_eff_fen: 4000,
};
const A = svc ? svc.calcSandboxReverse(revBase) : {};
chk('A-① 目标月营收 = 10,000,000 分（= 10 万元）', A.target_monthly_fen === 10000000, '=' + A.target_monthly_fen);
chk('A-② 目标日均营收 = 333,333 分', A.target_daily_fen === 333333, '=' + A.target_daily_fen);
chk('A-③ 房租上限 = 1,200,000 分', A.rent_cap_fen === 1200000, '=' + A.rent_cap_fen);
chk('A-④ 月客流 = 2222.22', A.monthly_traffic === 2222.22, '=' + A.monthly_traffic);
chk('A-⑤ 日均客流 = 74.07', A.daily_traffic === 74.07, '=' + A.daily_traffic);
chk('A-⑥ 🔴 锁定锚点 翻台 = 3.70（引擎零改动 ⇒ 一字不漂）', A.turn_rate === 3.7, '=' + A.turn_rate);
chk('A-⑦ 面积上限 = 300 ㎡', A.area_cap_sqm === 300, '=' + A.area_cap_sqm);
chk('A-⑧ 无红警 red_alert === false', A.red_alert === false);
chk('A-⑨ `warn_keys` 恒空数组（R237 后不再由翻台产生任何软提示）',
  Array.isArray(A.warn_keys) && A.warn_keys.length === 0, JSON.stringify(A.warn_keys));

// ============ B 新锚点：桌数 → 座位数 是纯入参变换 ============
sec('B 新锚点：座位数 = 桌数 × 单桌座位数（恒等性由构造成立）');
// 复刻前端**唯一换算点** pages/sandbox/index.js::seatsNow() 的语义（正整数、无效即 0）。
function seatsNow(tables, perTable) {
  const t = Math.floor(Number(tables));
  if (!isFinite(t) || t < 1) return 0;
  const p = Math.floor(Number(perTable));
  const per = (isFinite(p) && p >= 1) ? p : 4;
  return t * per;
}
chk('B-① 换算：5 桌 × 4 座 = 20 座', seatsNow(5, 4) === 20, '=' + seatsNow(5, 4));

const COMBOS = [[5, 4], [10, 2], [20, 1], [4, 5]];
const outs = COMBOS.map(([t, p]) => {
  const r = svc ? svc.calcSandboxReverse(Object.assign({}, revBase, { seats: seatsNow(t, p) })) : {};
  return { t, p, seats: seatsNow(t, p), r };
});
const same = outs.every((o) => o.seats === 20
  && o.r.target_monthly_fen === A.target_monthly_fen
  && o.r.daily_traffic === A.daily_traffic
  && o.r.turn_rate === A.turn_rate
  && o.r.rent_cap_fen === A.rent_cap_fen);
chk('B-② 四组 (桌数,单桌座位数) 乘积皆为 20 ⇒ 出参**逐字段相同**（引擎零改动、锚点零漂）',
  same, COMBOS.map(([t, p]) => t + 'x' + p).join(' | ') + ' ⇒ turn_rate=' + outs.map((o) => o.r.turn_rate).join('/'));
chk('B-③ 入参变换的**唯一性**：出参 turn_rate 只依赖乘积，不依赖怎么拆',
  new Set(outs.map((o) => o.r.turn_rate)).size === 1, '取值集合大小 = ' + new Set(outs.map((o) => o.r.turn_rate)).size);

chk('B-④ 业态默认「一桌坐几人」：快餐 2 / 正餐 4 / 火锅 4 / 茶饮 2',
  bp && bp.seatsPerTableOf('fastfood') === 2 && bp.seatsPerTableOf('dining') === 4
  && bp.seatsPerTableOf('hotpot') === 4 && bp.seatsPerTableOf('cafe') === 2,
  bp ? ['fastfood', 'dining', 'hotpot', 'cafe'].map((k) => k + '=' + bp.seatsPerTableOf(k)).join(' ') : 'n/a');
chk('B-⑤ 未知业态兜底 4（不产生 0 / NaN）', bp && bp.seatsPerTableOf('nope') === 4, bp ? '=' + bp.seatsPerTableOf('nope') : 'n/a');

chk('B-⑥ 翻台口径分组：火锅/正餐 = table（可说「翻台」）/ 快餐/茶饮 = seat（禁用「翻台」）',
  bp && bp.turnModeOf('hotpot') === 'table' && bp.turnModeOf('dining') === 'table'
  && bp.turnModeOf('fastfood') === 'seat' && bp.turnModeOf('cafe') === 'seat',
  bp ? ['hotpot', 'dining', 'fastfood', 'cafe'].map((k) => k + '=' + bp.turnModeOf(k)).join(' ') : 'n/a');

chk('B-⑦ 三档难度边界（桌：≤1.8 轻松 / ≤2.8 有点难 / >2.8 很难）',
  bp && bp.turnLevelOf('table', 1.8) === 'easy' && bp.turnLevelOf('table', 1.81) === 'ok'
  && bp.turnLevelOf('table', 2.8) === 'ok' && bp.turnLevelOf('table', 2.81) === 'hard',
  bp ? [1.8, 1.81, 2.8, 2.81].map((v) => v + '=' + bp.turnLevelOf('table', v)).join(' ') : 'n/a');
chk('B-⑧ 三档难度边界（座位：≤2.5 / ≤4.0 / >4.0），且无值时返回空串（不编造）',
  bp && bp.turnLevelOf('seat', 2.5) === 'easy' && bp.turnLevelOf('seat', 2.51) === 'ok'
  && bp.turnLevelOf('seat', 4.0) === 'ok' && bp.turnLevelOf('seat', 4.01) === 'hard'
  && bp.turnLevelOf('seat', null) === '' && bp.turnLevelOf('seat', undefined) === '',
  bp ? [2.5, 2.51, 4.0, 4.01].map((v) => v + '=' + bp.turnLevelOf('seat', v)).join(' ') : 'n/a');

// ============ C 反例（证明换算必要 + 旧阈值不可用 + 无效值被拦）============
sec('C 反例：不换算会怎样 / 旧阈值为何该废 / 无效输入是否被拦');
const wrong = svc ? svc.calcSandboxReverse(Object.assign({}, revBase, { seats: 5 })) : {};
chk('C-① 反例：把「桌数 5」当座位数送（漏乘）⇒ turn_rate = 14.81 ≠ 3.70（换算这一步真改变结果）',
  wrong.turn_rate !== A.turn_rate && wrong.turn_rate === 14.81,
  '漏乘 = ' + wrong.turn_rate + ' vs 正确 = ' + A.turn_rate);
chk('C-② 反例：漏乘口径下**旧阈值 8 会误报**（14.81 > 8）⇒ 旧阈值是旧座位口径的产物，理应废弃',
  wrong.turn_rate > 8, '漏乘值 ' + wrong.turn_rate + ' > 8 ⇒ 旧规则会把它标红');
chk('C-③ 反例：漏乘口径下反推红警**仍然为空** ⇒ 「删红警」与「口径换算」是两件独立的事（都要做）',
  Array.isArray(wrong.warn_keys) && wrong.warn_keys.length === 0, JSON.stringify(wrong.warn_keys));
chk('C-④ 无效桌数一律归 0（不产生「半张桌子」这类数学成立、业务无效的数）：0 / -3 / 2.6 / 空',
  seatsNow(0, 4) === 0 && seatsNow(-3, 4) === 0 && seatsNow(2.6, 4) === 8 && seatsNow('', 4) === 0,
  [seatsNow(0, 4), seatsNow(-3, 4), seatsNow(2.6, 4), seatsNow('', 4)].join(' / '));
chk('C-⑤ 反例：座位数为 0 ⇒ 引擎数学上仍能算（÷0 得到 Infinity），故**必须由前端拦**（页面已加 needTables 前置）',
  svc ? !isFinite(svc.calcSandboxReverse(Object.assign({}, revBase, { seats: 0 })).turn_rate) : false,
  '引擎 seats=0 ⇒ turn_rate=' + (svc ? String(svc.calcSandboxReverse(Object.assign({}, revBase, { seats: 0 })).turn_rate) : 'n/a'));

// ============ D 下界 ============
sec('D 下界：断言数不得被悄悄删掉');
chk('D-① 本脚本断言数 ≥ 20（实测 25 的保守下沿）', (pass + failN) >= 20, '含本条共 ' + (pass + failN) + ' 条');

console.log('\n===== R237 锚点复算结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
