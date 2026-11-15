#!/usr/bin/env node
// R743 主审计探针 · 跨月份摊销边界性质（真跑生产引擎，不重写公式）
// 目标：找 R739（串月点断言）/ R742（不变量）都没覆盖的跨月性质缺陷。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const F = (p) => path.join(ROOT, p);
const Y = 100;

const eng = require(F('cloudfunctions/getLedger/service.js'));
const poc = require(F('cloudfunctions/calcAmortize/service.js'));
const sched = require(F('cloudfunctions/getAmortSchedule/service.js'));
const save = require(F('cloudfunctions/saveLedger/service.js'));
const A = eng.amountForMonth;
const T = eng.amortizeTotalForMonth;

function months(from, to) {
  const idx = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); };
  const fmt = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
  const out = []; for (let i = idx(from); i <= idx(to); i++) out.push(fmt(i)); return out;
}
const YM = months('2025-01', '2031-12');

console.log('===== R743 跨月边界性质探针 =====\n');

// ---------- 疑点 1：terminate_month < start_month ----------
console.log('【疑点1】终止月早于起摊月 ⇒ 区间为空？');
const bad = { asset_id: 'x', name: '手滑', total_value: 3600000, value_fen: 3600000,
  start_month: '2026-10', total_months: 36, terminate_month: '2025-10', mode: 'amort' };
const sumBad = YM.reduce((s, m) => s + A(bad, m), 0);
console.log(`  start=2026-10 terminate=2025-10 ⇒ 84 个月摊销总和 = ${(sumBad / Y).toFixed(2)} 元（原值 36000.00 元）`);
console.log(`  ⇒ ${sumBad === 0 ? '❌ 资产一分不摊、账面仍挂着，利润被高估整笔' : '有摊销'}`);
// validate 是否拦截？
const V = require(F('cloudfunctions/saveAsset/validate.js'));
const vr = V.validateInput({ shop_id: 's1', asset: {
  name: '手滑', value_fen: 3600000, start_month: '2026-10', total_months: 36,
  terminate_month: '2025-10', mode: 'amort' } });
console.log(`  saveAsset.validate 结果 = ${vr.error ? '拒绝 ' + vr.error : '✅ 通过（不校验先后）'}`);
// 归档锁是否受影响
const S = require(F('cloudfunctions/saveAsset/service.js'));
console.log(`  归档锁计划 = ${JSON.stringify(S.decideArchiveLock(null, null, 'amort', '2026-10'))}`);
console.log('  ⚠️ 终止月提前 ⇒ 资产实际不摊，但归档锁仍按 start_month 上区间锁（把不存在的摊销当存在）\n');

// ---------- 疑点 2：terminate_month == start_month（当月即终止） ----------
console.log('【疑点2】终止月 == 起摊月（当月摊完）');
const edge = { total_value: 3600000, start_month: '2026-10', total_months: 36, terminate_month: '2026-10' };
console.log(`  2026-10 = ${(A(edge, '2026-10') / Y).toFixed(2)} 元；2026-11 = ${(A(edge, '2026-11') / Y).toFixed(2)} 元`);
console.log(`  ⇒ 当月只摊 1 期 base=1000，剩余 35000 元成为残值（设计如此，但需确认处置损失有没有进利润）\n`);

// ---------- 性质 P1：平移不变（R739/R742 都没测） ----------
console.log('【性质 P1】时间平移不变：整组资产起点 +Δ 月 ⇒ 逐月曲线应整体平移、数值分毫不差');
function curve(assets, ms) { return ms.map((m) => T(assets, m)); }
function shiftYm(ym, d) {
  const [y, m] = ym.split('-').map(Number);
  const i = y * 12 + (m - 1) + d;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
const baseAssets = [
  { total_value: 3600000, start_month: '2026-10', total_months: 36, terminate_month: '' },
  { total_value: 1200000, start_month: '2026-12', total_months: 12, terminate_month: '' },
  { total_value: 5000000, start_month: '2027-01', total_months: 24, terminate_month: '2028-06' },
];
let p1ok = true, p1first = '';
const c0 = curve(baseAssets, YM);
for (const d of [1, 6, 12, 13, 24, -6]) {
  const shifted = baseAssets.map((a) => ({ ...a,
    start_month: shiftYm(a.start_month, d),
    terminate_month: a.terminate_month ? shiftYm(a.terminate_month, d) : '' }));
  const cs = curve(shifted, YM);
  // 比较：c0 在 [i] 的值应等于 cs 在 [i+d] 的值
  for (let i = 0; i < YM.length; i++) {
    const j = i + d;
    if (j < 0 || j >= YM.length) continue;
    if (c0[i] !== cs[j]) { p1ok = false; p1first = `Δ=${d} @${YM[i]} c0=${c0[i]} cs=${cs[j]}`; break; }
  }
  if (!p1ok) break;
}
console.log(`  ${p1ok ? '✅ 平移不变成立（6 个 Δ × 84 月）' : '❌ 平移不变被破坏：' + p1first}`);
console.log('  意义：任何隐藏的绝对日期常量（如 R736 的 2026-11 闸门）都会当场破坏这条性质\n');

// ---------- 性质 P2：叠加性（全时间轴，非单月） ----------
console.log('【性质 P2】叠加性：total(A∪B, m) ≡ total(A,m)+total(B,m) 对全部 84 个月');
const Aset = [baseAssets[0]];
const Bset = [baseAssets[1], baseAssets[2]];
let p2ok = true, p2first = '';
YM.forEach((m) => {
  const lhs = T([...Aset, ...Bset], m);
  const rhs = T(Aset, m) + T(Bset, m);
  if (lhs !== rhs && !p2first) { p2ok = false; p2first = `${m}: ${lhs} ≠ ${rhs}`; }
});
console.log(`  ${p2ok ? '✅ 全时间轴叠加性成立' : '❌ ' + p2first}`);
console.log('  意义：这条直接回答李老师「重叠摊销是否随月份变动」\n');

// ---------- 性质 P3：四副本逐月同源 ----------
console.log('【性质 P3】4 份引擎副本对随机 300 组资产 × 全月份，逐分相等');
let seed = 20261115;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
let p3bad = 0, p3first = '';
for (let n = 0; n < 300; n++) {
  const st = 2025 + Math.floor(rnd() * 4);
  const sm = 1 + Math.floor(rnd() * 12);
  const asset = {
    total_value: Math.floor(rnd() * 9000000) + 10000,
    start_month: `${st}-${String(sm).padStart(2, '0')}`,
    total_months: 1 + Math.floor(rnd() * 48),
    terminate_month: rnd() < 0.3 ? `${st + Math.floor(rnd() * 3)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}` : '',
  };
  const ms = months('2025-01', '2031-12');
  for (const m of ms) {
    const a = A(asset, m);
    const b = sched.amountForMonth(asset, m);
    const c = save.amountForMonth(asset, m);
    const d = poc.amountForMonthFen(asset, m);
    if (!(a === b && a === c && a === d)) {
      p3bad++;
      if (!p3first) p3first = `${m} asset=${JSON.stringify(asset)} => getLedger=${a} sched=${b} save=${c} poc=${d}`;
      break;
    }
  }
}
console.log(`  ${p3bad === 0 ? '✅ 300 组 × 84 月 = 25200 点全等' : '❌ ' + p3bad + ' 组漂移，首例 ' + p3first}\n`);

// ---------- 性质 P4：闭包（含残值）对随机资产 ----------
console.log('【性质 P4】闭包：逐月摊销和 + 提前终止残值 ≡ 原值（随机 300 组）');
let p4bad = 0, p4first = '';
for (let n = 0; n < 300; n++) {
  const st = 2025 + Math.floor(rnd() * 4);
  const sm = 1 + Math.floor(rnd() * 12);
  const asset = {
    total_value: Math.floor(rnd() * 9000000) + 10000,
    start_month: `${st}-${String(sm).padStart(2, '0')}`,
    total_months: 1 + Math.floor(rnd() * 48),
    terminate_month: rnd() < 0.35 ? `${st + Math.floor(rnd() * 3)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}` : '',
  };
  let sum = 0;
  for (const m of months('2025-01', '2033-12')) sum += A(asset, m);
  const residual = poc.calcResidualFen(asset);
  if (sum + residual !== asset.total_value) {
    p4bad++;
    if (!p4first) p4first = `sum=${sum} residual=${residual} total=${asset.total_value} asset=${JSON.stringify(asset)}`;
  }
}
console.log(`  ${p4bad === 0 ? '✅ 300 组闭包全成立' : '❌ ' + p4bad + ' 组破，首例 ' + p4first}\n`);

// ---------- 性质 P5：缩放性 ----------
console.log('【性质 P5】缩放性：原值 ×k ⇒ 每月摊销 ×k（含末月尾差）');
let p5bad = 0, p5first = '';
for (let n = 0; n < 200; n++) {
  const base = { total_value: Math.floor(rnd() * 5000000) + 10001,
    start_month: '2026-06', total_months: 1 + Math.floor(rnd() * 36), terminate_month: '' };
  const k = 2 + Math.floor(rnd() * 8);
  const scaled = { ...base, total_value: base.total_value * k };
  for (const m of YM) {
    if (A(scaled, m) !== A(base, m) * k) {
      p5bad++; if (!p5first) p5first = `k=${k} @${m} base=${A(base, m)} scaled=${A(scaled, m)}`; break;
    }
  }
}
console.log(`  ${p5bad === 0 ? '✅ 200 组缩放成立' : '❌ ' + p5bad + ' 组破（尾差非线性），首例 ' + p5first}`);
console.log('  说明：尾差倒挤使末月金额 = 原值 - base×(N-1)，base=round(原值/N) ⇒ ×k 后 round 未必等于 round×k\n');

console.log('===== 结论见 r743 报告 =====');
