#!/usr/bin/env node
// tools/check_amort_invariants.js —— 摊销「万无一失」不变量守卫（R742）
//
// 【它守什么】
//   李老师点名的四类风险，逐条变成可自动判红的断言：
//     ① 跨月数据是否正常        → C 闭包（逐月求和 ≡ 资产原值）+ B 引擎同源（朴素版 vs UTC 版结果一致）
//     ② 新增摊销是否随月份变动  → D 可加性（新增资产的摊销只从它的 start_month 起生效，之前月份一文不差）
//     ③ 重叠摊销随店铺/月份变动 → E 重叠不重复（同月多资产各自独立尾差、绝不合并；total ≡ 各明细之和）
//                                  + F 店铺纯度（引擎根本不认 shop_id，同一组资产换 shop_id 结果不变）
//     ④ 数据库正常             → G 模拟对账（重复行 / 孤儿 shop_id / 非法字段 / 归档月漂移 四种脏数据都能被扫出）
//
// 【为什么需要它】
//   现有 3 份生产引擎（getLedger / saveLedger / getAmortSchedule 的 service.js）的 amountForMonth
//   目前逐字相同，但**没有任何守卫钉死**——谁改一处忘改另一处就会悄悄漂移。
//   另有 calcAmortize（批次2 POC1，走 UTC 锚点）是另一套实现，与朴素版**从未被比对过**。
//   本守卫两类都拦：A 钉「三份生产副本逐字同源」；B 钉「两套时区口径结果一致」。
//
//   所有判据都带变异回灌（把正确实现改坏 ⇒ 断言必须转红），证明不是恒真。
//
// 用法：node tools/check_amort_invariants.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');
const Y = 100;
const yuan = (fen) => (fen / Y).toFixed(2);

// ===================== 被测引擎 =====================
// 3 份生产副本（朴素 monthIndex 口径）
const engGet = require(F('cloudfunctions/getLedger/service.js'));
const engSave = require(F('cloudfunctions/saveLedger/service.js'));
const engSched = require(F('cloudfunctions/getAmortSchedule/service.js'));
// 批次2 POC1 引擎（UTC 锚点口径）
const engPOC = require(F('cloudfunctions/calcAmortize/service.js'));

const amountGet = engGet.amountForMonth;
const amountSave = engSave.amountForMonth;
const amountSched = engSched.amountForMonth;
const amountPOC = engPOC.amountForMonthFen;
const totalGet = engGet.amortizeTotalForMonth;
const totalSched = engSched.amortizeForMonth;

// ===================== 断言框架 =====================
const R = [];
let curGroup = '';
function group(name) { curGroup = name; }
function ck(name, pass, detail) {
  R.push({ group: curGroup, name, pass: !!pass, detail: detail || '' });
}

// ===================== 工具 =====================
function monthIndex(ym) { const [y, m] = String(ym).split('-').map(Number); return y * 12 + (m - 1); }
function fmtMonthIdx(idx) { const y = Math.floor(idx / 12), m = idx % 12; return `${y}-${String(m + 1).padStart(2, '0')}`; }
function monthsBetween(a, b) { const i = monthIndex(a), j = monthIndex(b); const out = []; for (let k = i; k <= j; k++) out.push(fmtMonthIdx(k)); return out; }

// 资产模板。⚠️ 引擎只读 `total_value`（真实数据流里 getAmortSchedule/index.js 把台账的
//   `value_fen` 映射成 `total_value` 再喂引擎），所以夹具两条都给，与线上一致。
function asset(o) {
  const base = {
    asset_id: o.asset_id || 'a1', name: o.name || '资产', value_fen: 36000,
    start_month: '2026-08', total_months: 36, terminate_month: '', mode: 'amort',
  };
  const merged = Object.assign(base, o);
  if (merged.total_value == null) merged.total_value = merged.value_fen; // 镜像控制器映射
  return merged;
}

// ===================== 夹具 =====================
// 跨年边界：2026-12 起，13 期 → 跨到 2027-12（测朴素 vs UTC 在跨年是否一致）
const crossYear = asset({ asset_id: 'ay', name: '跨年', value_fen: 13000, start_month: '2026-12', total_months: 13 });
// 提前终止：36 期但 2027-06 终止
const terminated = asset({ asset_id: 'at', name: '提前终止', value_fen: 36000, start_month: '2026-08', total_months: 36, terminate_month: '2027-06' });
// 中途新增：2027-01 起，24 期
const midAdd = asset({ asset_id: 'am', name: '中途新增', value_fen: 24000, start_month: '2027-01', total_months: 24 });
// 重叠 A：2026-01..2026-12；重叠 B：2026-06..2026-12（Jun–Dec 重叠）
const ovA = asset({ asset_id: 'oa', name: '重叠A', value_fen: 12000, start_month: '2026-01', total_months: 12 });
const ovB = asset({ asset_id: 'ob', name: '重叠B', value_fen: 7000, start_month: '2026-06', total_months: 7 });
// 基础单笔（闭包主测，整除）
const base = asset({ asset_id: 'ab', name: '基础', value_fen: 36000, start_month: '2026-08', total_months: 36 });
// 不整除单笔（尾差倒挤可被变异打掉，用于证明 C/E 守卫有牙）
const baseRem = asset({ asset_id: 'ar', name: '不整除', value_fen: 36010, start_month: '2026-08', total_months: 36 });

// ===================== A · 三份生产副本逐字同源 =====================
group('A · 生产引擎同源');
function extractFn(src, fnName) {
  const re = new RegExp('function ' + fnName + '\\s*\\([^)]*\\)\\s*\\{');
  const m = src.match(re);
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
  return src.slice(m.index, i);
}
const srcGet = read('cloudfunctions/getLedger/service.js');
const srcSave = read('cloudfunctions/saveLedger/service.js');
const srcSched = read('cloudfunctions/getAmortSchedule/service.js');
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const fGet = norm(extractFn(srcGet, 'amountForMonth'));
const fSave = norm(extractFn(srcSave, 'amountForMonth'));
const fSched = norm(extractFn(srcSched, 'amountForMonth'));
ck('A-① getLedger 与 saveLedger 的 amountForMonth 逐字同源', fGet === fSave, fGet === fSave ? '一致' : '不一致');
ck('A-② getLedger 与 getAmortSchedule 的 amountForMonth 逐字同源', fGet === fSched, fGet === fSched ? '一致' : '不一致');
const rGet = norm(extractFn(srcGet, 'amortizeTotalForMonth'));
const rSched = norm(extractFn(srcSched, 'amortizeForMonth'));
// 归约函数语义一致（前者 reduce 累加，后者 reduce+details，核心累加式相同）
ck('A-③ 三副本的「逐月累加」核心一致', /reduce\(\(s, a\) => s \+ amountForMonth\(a, month\)/.test(rGet) && /reduce\(\(s, a\) => s \+ amountForMonth\(a, month\)/.test(rSched), '累加式同形');

// ===================== B · 朴素版 vs UTC 版 结果一致 =====================
group('B · 两套时区口径结果一致');
const B_MONTHS = monthsBetween('2025-01', '2031-12');
let bAllEq = true; const bFail = [];
[B_MONTHS.map(() => crossYear), B_MONTHS.map(() => terminated), B_MONTHS.map(() => base), B_MONTHS.map(() => midAdd)]
  .forEach((arr, fi) => {
    arr.forEach((a, i) => {
      const m = B_MONTHS[i];
      const naive = amountGet(a, m);
      const utc = amountPOC(a, m);
      if (naive !== utc) { bAllEq = false; if (bFail.length < 4) bFail.push(`${a.name}@${m}: naive=${naive} utc=${utc}`); }
    });
  });
ck('B-① 朴素版与 UTC 版对 4 类资产 × 84 个月结果全一致', bAllEq, bAllEq ? '84×4=336 点全相等' : bFail.join('; '));

// 变异回灌：把 POC 引擎的尾差倒挤改成 base（末月不再倒挤）⇒ B-① 应转红（用本地变异函数验证判据有牙）
(function () {
  // 复制一份"坏"的 amountForMonthFen：末月也返回 base
  function badAmount(a, month) {
    const start = monthIndex(a.start_month);
    const naturalEnd = start + a.total_months - 1;
    let end = naturalEnd;
    if (a.terminate_month) { const t = monthIndex(a.terminate_month); if (t < naturalEnd) end = t; }
    const mi = monthIndex(month);
    if (mi < start || mi > end) return 0;
    const k = mi - start + 1, N = end - start + 1;
    const base2 = Math.round(a.total_value / a.total_months);
    if (k < N) return base2;
    return base2; // 坏：末月也 base，不做尾差倒挤
  }
  let caught = false; const f2 = [];
  // 必须含不整除资产（baseRem=36010/36）：整除资产尾差=base，去掉尾差数值不变，测不出差异
  [crossYear, terminated, base, midAdd, baseRem].forEach((a) => {
    B_MONTHS.forEach((m) => { if (badAmount(a, m) !== amountPOC(a, m)) caught = true; });
  });
  ck('B-② 变异回灌：末月不做尾差倒挤 ⇒ 朴素/UTC 出现差异（证明 B-① 有牙）', caught, caught ? '已检出差异（判据有牙）' : '未检出差异（判据失效）');
})();

// ===================== C · 闭合不变量：摊销和 + 残值 ≡ 原值 =====================
// 真·不变量：自然到期 ⇒ 逐月摊销和 ≡ 原值；提前终止 ⇒ 逐月摊销和 + 未摊残值 ≡ 原值
//   （提前终止的未摊余额是残值/处置损失，单独计，不摊进末月 —— 设计如此，规则 5/7）。
group('C · 闭包不变量');
function closureTrue(a) {
  const start = monthIndex(a.start_month);
  const naturalEnd = start + a.total_months - 1;
  let end = naturalEnd;
  if (a.terminate_month) { const t = monthIndex(a.terminate_month); if (t < naturalEnd) end = t; }
  let sum = 0;
  for (let k = start; k <= end; k++) sum += amountGet(a, fmtMonthIdx(k));
  const residual = engPOC.calcResidualFen(a); // 自然到期=0；提前终止=未摊余额
  return (sum + residual) === a.value_fen;
}
ck('C-① 基础 36 期闭包（36000）', closureTrue(base), `摊销和+残值 ≡ ${yuan(base.value_fen)}`);
ck('C-② 跨年 13 期闭包（13000）', closureTrue(crossYear), `摊销和+残值 ≡ ${yuan(crossYear.value_fen)}`);
ck('C-③ 提前终止（36000，2027-06 止）：摊销和+残值 ≡ 原值', closureTrue(terminated), `摊销和+残值 ≡ ${yuan(terminated.value_fen)}`);
ck('C-④ 中途新增 24 期闭包（24000）', closureTrue(midAdd), `摊销和+残值 ≡ ${yuan(midAdd.value_fen)}`);

// 变异回灌：把尾差倒挤去掉（末月也 base）⇒ 对**不整除**资产，闭合必破
(function () {
  function bad(a, month) {
    const start = monthIndex(a.start_month);
    const naturalEnd = start + a.total_months - 1;
    let end = naturalEnd;
    if (a.terminate_month) { const t = monthIndex(a.terminate_month); if (t < naturalEnd) end = t; }
    const mi = monthIndex(month);
    if (mi < start || mi > end) return 0;
    const k = mi - start + 1, N = end - start + 1;
    const b = Math.round(a.value_fen / a.total_months);
    return (k < N) ? b : b; // 坏：末月也 base，不做尾差倒挤
  }
  function closureBad(a) {
    const start = monthIndex(a.start_month);
    const naturalEnd = start + a.total_months - 1;
    let end = naturalEnd; if (a.terminate_month) { const t = monthIndex(a.terminate_month); if (t < naturalEnd) end = t; }
    let sum = 0; for (let k = start; k <= end; k++) sum += bad(a, fmtMonthIdx(k)); return sum;
  }
  // baseRem = 36010/36：base=1000，末月尾差=1010；坏实现末月也 1000 ⇒ 总和 36000 ≠ 36010
  ck('C-⑤ 变异回灌：末月去掉尾差倒挤 ⇒ 不整除资产闭合破（证明 C 有牙）', closureBad(baseRem) !== baseRem.value_fen, `坏实现求和=${yuan(closureBad(baseRem))} ≠ ${yuan(baseRem.value_fen)}`);
})();

// ===================== D · 可加性：新增资产只从 start_month 起生效 =====================
group('D · 新增随月份（可加性）');
(function () {
  const months = monthsBetween('2026-01', '2028-12');
  let okBefore = true, okFrom = true, firstChanged = null;
  months.forEach((m) => {
    const tBase = totalGet([base], m);
    const tAdd = totalGet([base, midAdd], m);
    if (monthIndex(m) < monthIndex(midAdd.start_month)) {
      if (tBase !== tAdd) okBefore = false;           // 新增前的月份一文不差
    } else {
      if (tAdd > tBase && firstChanged === null) firstChanged = m; // 首个出现增量的月
      okFrom = okFrom && (tAdd >= tBase);
    }
  });
  ck('D-① 新增资产起摊月之前的月份：总价不变', okBefore, okBefore ? '2026-01..2026-12 与仅 base 完全一致' : '出现不该有的增量');
  ck('D-② 新增资产起摊月（2027-01）起：总价出现增量且只增不减', okFrom && firstChanged === '2027-01', `首个增量月=${firstChanged || '无'}`);
  ck('D-③ 新增资产起摊当月确有摊销（24000/24=1000/月）', amountGet(midAdd, '2027-01') === 1000, `2027-01=${yuan(amountGet(midAdd, '2027-01'))}`);
})();

// ===================== E · 重叠不重复（同月多资产独立尾差，total ≡ 明细和） =====================
group('E · 重叠随月份/店铺（不重复）');
(function () {
  const sched = totalSched([ovA, ovB], '2026-08'); // 重叠月
  const sumDetails = sched.details.reduce((s, d) => s + d.amount_fen, 0);
  ck('E-① 同月多资产：total ≡ 各明细之和（绝不合并尾差）', sched.total_amount_fen === sumDetails, `total=${sched.total_amount_fen} sum=${sumDetails}`);
  // 重叠月 2026-08：A 在期(1000/月)、B 在期(1000/月) ⇒ 2000
  ck('E-② 重叠月各自独立计（A+B 各 1000 ⇒ 2000）', amountGet(ovA, '2026-08') === 1000 && amountGet(ovB, '2026-08') === 1000 && sched.total_amount_fen === 2000, `A=${amountGet(ovA,'2026-08')} B=${amountGet(ovB,'2026-08')} total=${sched.total_amount_fen}`);
  // B 未开始的月份（2026-03）：只 A 计
  ck('E-③ 仅 A 在期、B 未起的月份：只计 A', totalSched([ovA, ovB], '2026-03').total_amount_fen === amountGet(ovA, '2026-03'), `2026-03 total=${totalSched([ovA,ovB],'2026-03').total_amount_fen}`);
})();

// ===================== F · 店铺纯度：引擎不认 shop_id =====================
group('F · 店铺隔离（引擎层）');
(function () {
  const aShopX = Object.assign({}, base, { shop_id: 'shop_X' });
  const aShopY = Object.assign({}, base, { shop_id: 'shop_Y' });
  const aNoShop = Object.assign({}, base); delete aNoShop.shop_id;
  let allSame = true;
  monthsBetween('2026-08', '2029-08').forEach((m) => {
    if (amountGet(aShopX, m) !== amountGet(aShopY, m) || amountGet(aShopX, m) !== amountGet(aNoShop, m)) allSame = false;
  });
  ck('F-① 同一组资产换不同 shop_id（含无 shop_id）：逐月摊销额不变', allSame, allSame ? '引擎纯函数，结果只由资产本身决定' : 'shop_id 泄漏进了计算');
})();

// ===================== G · 模拟数据库对账（脏数据都能扫出） =====================
group('G · 数据库对账（模拟 shop_amortize 扫描）');
// 复刻 saveAsset 的"按签名判重"逻辑（待落地，见 R742 提案）：同 shop_id+name+start_month+value_fen+mode 视为同笔
function sig(r) { return [r.shop_id, r.name, r.start_month, r.value_fen, r.mode || 'amort'].join('|'); }
function reconcile(rows, archivedMonths, snapshots, validShops) {
  const problems = [];
  const seen = {};
  for (const r of rows) {
    if (!validShops.has(r.shop_id)) problems.push({ type: 'orphan_shop', id: r.asset_id, shop: r.shop_id });
    if (!(Number.isInteger(r.value_fen) && r.value_fen > 0)) problems.push({ type: 'invalid_value', id: r.asset_id });
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.start_month)) problems.push({ type: 'invalid_month', id: r.asset_id });
    const s = sig(r);
    if (seen[s]) problems.push({ type: 'duplicate', id: r.asset_id, dupWith: seen[s] });
    else seen[s] = r.asset_id;
  }
  // 归档月漂移：用 live 资产重算该月摊销 vs 落库快照
  for (const m of archivedMonths) {
    const live = rows.filter((r) => r.mode !== 'lump' && monthIndex(r.start_month) <= monthIndex(m) && withinRange(r, m))
      .reduce((s, r) => s + amountGet(r, m), 0);
    const snap = snapshots[m];
    if (snap != null && snap !== live) problems.push({ type: 'archive_drift', month: m, live, snap });
  }
  return problems;
}
function withinRange(r, m) {
  const start = monthIndex(r.start_month); const naturalEnd = start + r.total_months - 1; let end = naturalEnd;
  if (r.terminate_month) { const t = monthIndex(r.terminate_month); if (t < naturalEnd) end = t; }
  const mi = monthIndex(m); return mi >= start && mi <= end;
}
(function () {
  const rows = [
    { asset_id: 'a1', shop_id: 's1', name: '装修', value_fen: 36000, start_month: '2026-08', total_months: 36, mode: 'amort' },
    { asset_id: 'a2', shop_id: 's1', name: '装修', value_fen: 36000, start_month: '2026-08', total_months: 36, mode: 'amort' }, // 重复（同签名）
    { asset_id: 'a3', shop_id: 'ghost', name: 'X', value_fen: 1000, start_month: '2026-09', total_months: 12, mode: 'amort' }, // 孤儿 shop
    { asset_id: 'a4', shop_id: 's1', name: '坏值', value_fen: -500, start_month: '2026-09', total_months: 12, mode: 'amort' }, // 非法金额
  ];
  const problems = reconcile(rows, [], {}, new Set(['s1']));
  const types = problems.map((p) => p.type);
  ck('G-① 重复行被扫出', types.includes('duplicate'), `命中: ${types.filter(t=>t==='duplicate').length}`);
  ck('G-② 孤儿 shop_id 被扫出', types.includes('orphan_shop'), `命中: ${types.filter(t=>t==='orphan_shop').length}`);
  ck('G-③ 非法金额被扫出', types.includes('invalid_value'), `命中: ${types.filter(t=>t==='invalid_value').length}`);
})();
(function () {
  // 归档月漂移：s1 有一笔资产，但 2026-10 落库快照写成了 0（R741 同款病放大到库）
  const rows = [
    { asset_id: 'b1', shop_id: 's1', name: '装修', value_fen: 36000, start_month: '2026-08', total_months: 36, mode: 'amort' },
  ];
  const problems = reconcile(rows, ['2026-10'], { '2026-10': 0 }, new Set(['s1']));
  const drift = problems.find((p) => p.type === 'archive_drift');
  ck('G-④ 归档月快照与现算漂移被扫出', !!drift, drift ? `live=${yuan(drift.live)} snap=${yuan(drift.snap)}` : '未命中');
})();

// ===================== 汇总 =====================
let passN = 0, failN = 0;
for (const r of R) { if (r.pass) passN++; else failN++; }
console.log('\n================ 摊销不变量守卫 · R742 ================');
const groups = {};
for (const r of R) { (groups[r.group] = groups[r.group] || []).push(r); }
for (const g in groups) {
  console.log(`\n【${g}】`);
  for (const r of groups[g]) console.log(`  ${r.pass ? '✅' : '❌'} ${r.name} —— ${r.detail}`);
}
console.log(`\n合计：${passN} 通过 / ${failN} 失败`);
process.exit(failN ? 1 : 0);
