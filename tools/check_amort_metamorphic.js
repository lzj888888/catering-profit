#!/usr/bin/env node
// tools/check_amort_metamorphic.js —— 摊销「跨月数学性质」常驻守卫（R743）
//
// 【它跟既有 322 个套件有什么不同 —— 这就是李老师问的「更合适的验证」】
//   既有套件（含 R739 串 38 个月、R742 不变量）大多是**点断言**：钉「2026-11 应该等于 1000.00」。
//   点断言的盲区：换个起摊月、换组资产、换个资产组合就覆盖不到；隐藏的绝对日期常量
//   （R736 的 `month >= '2026-11'` 闸门）在固定 fixture 上甚至可能恰好全绿。
//
//   本守卫改为**性质断言（metamorphic / property-based）**：不钉某个数，钉「对任意输入都成立的恒等式」，
//   随机 300 组资产 × 84 个月自动覆盖 ⇒ 一条断言等价于几万个点断言，且**不需要人手写新用例**。
//     ① 平移不变：整组资产起点 +Δ 月 ⇒ 逐月曲线整体平移、数值分毫不差（抓任何隐藏日期常量）
//     ② 叠加性：total(A∪B, m) ≡ total(A,m) + total(B,m) 全时间轴（抓「重叠摊销随月份变动」）
//     ③ 副本对拍：4 份生产引擎对随机资产逐分相等（抓「改一处忘改另一处」）
//     ④ 闭包：逐月摊销和 + 提前终止残值 ≡ 原值（抓「永久蒸发」，R740 同族病）
//     ⑤ 边界可达：终止月早于起摊月必须被 validate 挡住（R743 新修的 P0-1）
//
//   每条带变异回灌：把正确实现改坏 ⇒ 断言必须转红，证明不是恒真。
//
// 用法：node tools/check_amort_metamorphic.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const F = (p) => path.join(ROOT, p);

// ===================== 被测引擎（真身，不重写公式） =====================
const engGet = require(F('cloudfunctions/getLedger/service.js'));
const engSave = require(F('cloudfunctions/saveLedger/service.js'));
const engSched = require(F('cloudfunctions/getAmortSchedule/service.js'));
const engPOC = require(F('cloudfunctions/calcAmortize/service.js'));
const engExpSrc = fs.readFileSync(F('cloudfunctions/exportData/index.js'), 'utf8');
const validateAsset = require(F('cloudfunctions/saveAsset/validate.js')).validateInput;

const A = engGet.amountForMonth;
const T = engGet.amortizeTotalForMonth;

// ===================== 断言框架 =====================
const R = [];
let curGroup = '';
function group(name) { curGroup = name; }
function ck(name, pass, detail) {
  R.push({ group: curGroup, name, pass: !!pass, detail: detail || '' });
}

// ===================== 工具 =====================
function monthIndex(ym) { const [y, m] = String(ym).split('-').map(Number); return y * 12 + (m - 1); }
function fmtMonthIdx(i) { return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; }
function months(from, to) {
  const out = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) out.push(fmtMonthIdx(i));
  return out;
}
function shiftYm(ym, d) { return fmtMonthIdx(monthIndex(ym) + d); }

// 确定性伪随机（seed 固定 ⇒ 可复现；不依赖 Math.random，跑一百次结果一样）
let seed = 20261115;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function randAsset(allowTerminate) {
  const y = 2025 + Math.floor(rnd() * 4);
  const m = 1 + Math.floor(rnd() * 12);
  const start = `${y}-${String(m).padStart(2, '0')}`;
  const totalMonths = 1 + Math.floor(rnd() * 48);
  let terminate = '';
  if (allowTerminate && rnd() < 0.35) {
    // 只生成「合法」终止月（>= start 且 <= 自然到期），保证闭包性质成立
    const d = Math.floor(rnd() * totalMonths);
    terminate = shiftYm(start, d);
  }
  return {
    asset_id: 'r' + Math.floor(rnd() * 1e9),
    name: '随机资产',
    value_fen: Math.floor(rnd() * 9000000) + 10001,
    get total_value() { return this.value_fen; },
    start_month: start,
    total_months: totalMonths,
    terminate_month: terminate,
    mode: 'amort',
  };
}
const MONTHS = months('2025-01', '2031-12');
const WIDE = months('2025-01', '2033-12');

// ===================== ① 平移不变 =====================
group('① 平移不变（抓隐藏日期常量）');
(function () {
  const assets = [
    { total_value: 3600000, start_month: '2026-10', total_months: 36, terminate_month: '' },
    { total_value: 1200000, start_month: '2026-12', total_months: 12, terminate_month: '' },
    { total_value: 5000000, start_month: '2027-01', total_months: 24, terminate_month: '2028-06' },
  ];
  const c0 = MONTHS.map((m) => T(assets, m));
  let ok = true, first = '';
  for (const d of [1, 6, 12, 13, 24, -6]) {
    const shifted = assets.map((a) => ({
      ...a,
      start_month: shiftYm(a.start_month, d),
      terminate_month: a.terminate_month ? shiftYm(a.terminate_month, d) : '',
    }));
    const cs = MONTHS.map((m) => T(shifted, m));
    for (let i = 0; i < MONTHS.length; i++) {
      const j = i + d;
      if (j < 0 || j >= MONTHS.length) continue;
      if (c0[i] !== cs[j]) { ok = false; first = `Δ=${d} @${MONTHS[i]} ${c0[i]}≠${cs[j]}`; break; }
    }
    if (!ok) break;
  }
  ck('①-a 6 个平移量 × 84 个月，曲线整体平移且逐分相等', ok, ok ? '全等' : first);

  // 变异回灌：塞回 R736 的绝对日期闸门 ⇒ 平移不变必须破
  const gated = (assets2, month) => (String(month) >= '2026-11' ? T(assets2, month) : 0);
  const g0 = MONTHS.map((m) => gated(assets, m));
  const gShift = assets.map((a) => ({ ...a, start_month: shiftYm(a.start_month, 12),
    terminate_month: a.terminate_month ? shiftYm(a.terminate_month, 12) : '' }));
  const g1 = MONTHS.map((m) => gated(gShift, m));
  let broken = false;
  for (let i = 0; i < MONTHS.length; i++) {
    const j = i + 12;
    if (j < MONTHS.length && g0[i] !== g1[j]) { broken = true; break; }
  }
  ck('①-b 变异回灌：塞回 `month>=2026-11` 闸门 ⇒ 平移不变当场破（证明①不是恒真）', broken,
    broken ? '已检出' : '未检出（判据失效）');
})();

// ===================== ② 叠加性 =====================
group('② 叠加性（重叠摊销随月份变动）');
(function () {
  let ok = true, first = '';
  for (let n = 0; n < 200; n++) {
    const Aset = [randAsset(true), randAsset(true)];
    const Bset = [randAsset(true), randAsset(true), randAsset(true)];
    for (const m of MONTHS) {
      const lhs = T([...Aset, ...Bset], m);
      const rhs = T(Aset, m) + T(Bset, m);
      if (lhs !== rhs) { ok = false; first = `第${n}组 @${m}: ${lhs} ≠ ${rhs}`; break; }
    }
    if (!ok) break;
  }
  ck('②-a 随机 200 组双资产集 × 84 月：total(A∪B) ≡ total(A)+total(B)', ok, ok ? '16800 点全成立' : first);

  // 变异回灌：把归约写成「只算第一笔」⇒ 叠加性必破
  const badT = (assets, month) => assets.length ? A(assets[0], month) : 0;
  const a1 = { total_value: 3600000, start_month: '2026-10', total_months: 36, terminate_month: '' };
  const a2 = { total_value: 1200000, start_month: '2026-10', total_months: 12, terminate_month: '' };
  const broken = badT([a1, a2], '2026-10') !== badT([a1], '2026-10') + badT([a2], '2026-10');
  ck('②-b 变异回灌：归约只算第一笔 ⇒ 叠加性当场破（证明②不是恒真）', broken,
    broken ? '已检出' : '未检出（判据失效）');
})();

// ===================== ③ 四副本对拍 =====================
group('③ 四副本逐分对拍（抓漂移）');
(function () {
  let bad = 0, first = '';
  for (let n = 0; n < 300; n++) {
    const a = randAsset(true);
    for (const m of MONTHS) {
      const vals = [A(a, m), engSave.amountForMonth(a, m), engSched.amountForMonth(a, m), engPOC.amountForMonthFen(a, m)];
      if (!vals.every((v) => v === vals[0])) {
        bad++; if (!first) first = `${m} ${JSON.stringify({ start: a.start_month, N: a.total_months, term: a.terminate_month })} => ${vals.join('/')}`;
        break;
      }
    }
  }
  ck('③-a 随机 300 组 × 84 月 = 25200 点，4 份引擎逐分相等', bad === 0, bad === 0 ? '零漂移' : `${bad} 组漂移，首例 ${first}`);
  ck('③-b 导出件字段优先级与页面同向（value_fen 优先）',
    /total_value:\s*a\.value_fen\s*!=\s*null\s*\?\s*a\.value_fen\s*:\s*nz\(a\.total_value\)/.test(engExpSrc),
    'R743 P0-2 修复在位');
})();

// ===================== ④ 闭包（含残值） =====================
group('④ 闭包：摊销和 + 残值 ≡ 原值');
(function () {
  let bad = 0, first = '';
  for (let n = 0; n < 300; n++) {
    const a = randAsset(true);
    let sum = 0;
    for (const m of WIDE) sum += A(a, m);
    const residual = engPOC.calcResidualFen(a);
    if (sum + residual !== a.total_value) {
      bad++;
      if (!first) first = `sum=${sum} residual=${residual} total=${a.total_value}`;
    }
  }
  ck('④-a 随机 300 组（含提前终止）闭包全成立', bad === 0, bad === 0 ? '零蒸发' : `${bad} 组破，首例 ${first}`);

  // 变异回灌：末月不做尾差倒挤（用不整除资产）
  const notDiv = { total_value: 36010, start_month: '2026-08', total_months: 36, terminate_month: '' };
  function badAmount(a, month) {
    const start = monthIndex(a.start_month), naturalEnd = start + a.total_months - 1;
    let end = naturalEnd;
    if (a.terminate_month) { const t = monthIndex(a.terminate_month); if (t < naturalEnd) end = t; }
    const mi = monthIndex(month);
    if (mi < start || mi > end) return 0;
    const b = Math.round(a.total_value / a.total_months);
    return b; // 坏：末月也 base
  }
  let badSum = 0;
  for (const m of WIDE) badSum += badAmount(notDiv, m);
  ck('④-b 变异回灌：末月去掉尾差倒挤 ⇒ 不整除资产闭包破（证明④不是恒真）',
    badSum !== notDiv.total_value, `坏实现求和=${badSum} ≠ ${notDiv.total_value}`);
})();

// ===================== ⑤ 边界可达性（终止月早于起摊月） =====================
group('⑤ 边界校验（R743 P0-1）');
(function () {
  const mk = (term) => validateAsset({ shop_id: 's1', asset: {
    name: '资产', value_fen: 3600000, start_month: '2026-10', total_months: 36,
    terminate_month: term, mode: 'amort' } });
  ck('⑤-a 终止月早于起摊月 ⇒ validate 拒绝', !!mk('2025-10').error, mk('2025-10').error || '未拒绝');
  ck('⑤-b 终止月 == 起摊月 ⇒ 允许（当月摊完，合法）', !mk('2026-10').error, '合法边界不误伤');
  ck('⑤-c 终止月晚于起摊月 ⇒ 允许', !mk('2027-06').error, '正常中途终止不误伤');
  ck('⑤-d 不填终止月 ⇒ 允许', !mk('').error, '自然到期不误伤');
})();

// ===================== ⑥ 自失效护栏 =====================
group('⑥ 自失效护栏');
ck('⑥-a 断言数下界 ≥ 12（防本文件被掏空后仍报全绿）', R.length + 4 >= 12, `当前 ${R.length + 4}`);
ck('⑥-b 随机样本数 ≥ 300（防样本被调小后覆盖塌缩）',
  /for \(let n = 0; n < 300; n\+\+\)/.test(fs.readFileSync(__filename, 'utf8')), '300 组在位');
ck('⑥-c 月份跨度 ≥ 84（防时间轴被缩到测不到跨年）', MONTHS.length >= 84, `${MONTHS.length} 个月`);
ck('⑥-d 四份引擎模块都成功加载', !!(engGet && engSave && engSched && engPOC), '4/4');

// ===================== 汇总 =====================
let passN = 0, failN = 0;
for (const r of R) { if (r.pass) passN++; else failN++; }
console.log('\n=========== 摊销跨月数学性质守卫 · R743 ===========');
const groups = {};
for (const r of R) (groups[r.group] = groups[r.group] || []).push(r);
for (const g in groups) {
  console.log(`\n【${g}】`);
  for (const r of groups[g]) console.log(`  ${r.pass ? '✅' : '❌'} ${r.name} —— ${r.detail}`);
}
console.log(`\n合计：${passN} 通过 / ${failN} 失败`);
process.exit(failN ? 1 : 0);
