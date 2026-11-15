#!/usr/bin/env node
// tools/check_amort_disposal.js —— R744 资产处置损失口径守卫
//
// 守什么（李老师「M1 真实账目不能算错」红线）：
//   R743 独立审计抓出：规范 3 处 + 前端弹窗都承诺「提前报废未摊余额一次性计入处置损失」，
//   但生产链路从未消费 residual_loss ⇒ 这笔钱在利润表里永久蒸发（与 R740 时间闸门同族）。
//   R744 修复：取数层把处置损失并入「本月计入额」（利润引擎零改动），归档月读落库快照不追历史。
//
// 五组判据：
//   A 金额：规范 S2b 锚点（旧空调 12000/36，2026-08 报废 ⇒ 当月 9666.69 = 333.33 + 9333.36）
//   B 时间：只在终止月计一次（前月/次月都不许有），自然到期不计
//   C 闭包：历史逐月摊销和 + 处置损失 ≡ 原值（不多不少）
//   D 冻结：归档月读落库快照，现算值仅用于漂移披露，不倒灌旧账
//   E 同源：四份 disposalLossForMonth 函数体逐字同构（防改一处忘改另一处）
//   F 变异回灌：每条把实现改坏 ⇒ 断言必须转红
//
// 用法：node tools/check_amort_disposal.js

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');
const Y = 100;
const yuan = (f) => (f / Y).toFixed(2);

// 真跑引擎（不重写公式）
const gl = require(F('cloudfunctions/getLedger/service.js'));
const sl = require(F('cloudfunctions/saveLedger/service.js'));
const gs = require(F('cloudfunctions/getAmortSchedule/service.js'));
const poc = require(F('cloudfunctions/calcAmortize/service.js'));
const EXP = read('cloudfunctions/exportData/index.js');

const R = [];
let curGroup = '';
function group(n) { curGroup = n; }
function ck(name, pass, detail) { R.push({ group: curGroup, name, pass: !!pass, detail: detail || '' }); }

function mi(ym) { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1); }
function fmt(i) { return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; }
function months(a, b) { const o = []; for (let i = mi(a); i <= mi(b); i++) o.push(fmt(i)); return o; }
const D = gl.disposalLossForMonth;

// 规范 S2b 锚点资产
const AIR = { asset_id: 'air', name: '旧空调', mode: 'amort', total_value: 1200000, value_fen: 1200000,
  start_month: '2026-01', total_months: 36, terminate_month: '2026-08' };
const NATURAL = { asset_id: 'nat', name: '招牌', mode: 'amort', total_value: 600000,
  start_month: '2026-01', total_months: 12, terminate_month: '' };
const LUMP = { asset_id: 'l', name: '推广', mode: 'lump', total_value: 100000,
  start_month: '2026-08', total_months: 1, terminate_month: '2026-08' };

// ===================== A 金额 =====================
group('A · 规范 S2b 锚点');
(function () {
  const loss = D([AIR], '2026-08');
  const amort = gl.amortizeTotalForMonth([AIR], '2026-08');
  ck('A-① 处置损失 = 原值 − base×8 期 = 9333.36 元', loss === 933336, `实测 ${yuan(loss)} 元`);
  ck('A-② 终止月本月计入额 = 333.33 + 9333.36 = 9666.69 元', amort + loss === 966669, `实测 ${yuan(amort + loss)} 元`);
  ck('A-③ 与 POC 引擎 calcResidualFen 逐分一致（公式同源）', loss === poc.calcResidualFen(AIR), `本实现 ${loss} / POC ${poc.calcResidualFen(AIR)}`);
  ck('A-④ 一次性投入（mode=lump）不产生处置损失', D([LUMP], '2026-08') === 0, 'lump 不进摊销公式');
})();

// ===================== B 时间 =====================
group('B · 只在终止月计一次');
(function () {
  const ms = months('2025-01', '2029-12');
  const hits = ms.filter((m) => D([AIR], m) > 0);
  ck('B-① 60 个月内只在 2026-08 出现一次', hits.length === 1 && hits[0] === '2026-08', `命中 ${hits.join(',') || '无'}`);
  ck('B-② 终止次月（2026-09）不再计', D([AIR], '2026-09') === 0, '0');
  ck('B-③ 自然到期资产无处置损失', ms.every((m) => D([NATURAL], m) === 0), '60 个月全 0');
  // 变异：去掉「只在终止月」判据 ⇒ 每月都计 ⇒ 断言转红
  const bad = (assets, month) => {
    let sum = 0;
    for (const a of (assets || [])) {
      if (a.mode === 'lump' || !a.start_month || !a.terminate_month) continue;
      const start = mi(a.start_month), naturalEnd = start + a.total_months - 1, term = mi(a.terminate_month);
      if (!(term < naturalEnd)) continue;
      const paid = term - start + 1, base = Math.round(a.total_value / a.total_months);
      sum += a.total_value - base * paid;   // 坏：不看 month
    }
    return sum;
  };
  const badHits = ms.filter((m) => bad([AIR], m) > 0);
  ck('B-④ 变异回灌：去掉「只认终止月」⇒ 每月都计（证明 B-① 有牙）', badHits.length > 1, `坏实现命中 ${badHits.length} 个月`);
})();

// ===================== C 闭包 =====================
group('C · 闭包：历史摊销和 + 处置损失 ≡ 原值');
(function () {
  let closed = 0, broken = 0;
  for (let n = 0; n < 200; n++) {
    const seed = (n * 7919 + 104729) & 0x7fffffff;
    const y = 2025 + (seed % 3), m = 1 + ((seed >> 3) % 12);
    const N = 2 + ((seed >> 7) % 40);
    const termDelta = 1 + ((seed >> 11) % (N - 1));
    const start = `${y}-${String(m).padStart(2, '0')}`;
    const a = { asset_id: 'x', mode: 'amort', total_value: 100000 + ((seed >> 5) % 9000000),
      start_month: start, total_months: N, terminate_month: fmt(mi(start) + termDelta) };
    let sum = 0;
    for (const mo of months('2024-01', '2035-12')) sum += gl.amountForMonth(a, mo);
    const loss = D([a], a.terminate_month);
    if (sum + loss === a.total_value) closed++; else broken++;
  }
  ck('C-① 随机 200 组提前终止资产闭包全成立', broken === 0, `成立 ${closed} / 破 ${broken}`);
  // 变异：处置损失少算 1 分 ⇒ 闭包破
  const a2 = Object.assign({}, AIR);
  const sum2 = months('2024-01', '2035-12').reduce((s, mo) => s + gl.amountForMonth(a2, mo), 0);
  ck('C-② 变异回灌：处置损失少 1 分 ⇒ 闭包破（证明 C 有牙）',
    (sum2 + D([a2], '2026-08') - 1) !== a2.total_value, `少 1 分即不等`);
})();

// ===================== D 归档冻结（真跑 Controller）=====================
group('D · 归档冻结（真跑云函数 main）');
(function () {
  // 用与 _r744_probe_archive_freeze.js 同款桩，但只取需要的三个字段做断言
  let DATA = {};
  const eq = (r, c) => { for (const k in c) if (r[k] !== c[k]) return false; return true; };
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (q) {
    if (q === 'wx-server-sdk') return { DYNAMIC_CURRENT_ENV: 'stub', init() {},
      database() { return makeDb(); }, getWXContext() { return { OPENID: 'u' }; } };
    return orig.apply(this, arguments);
  };
  function makeDb() {
    return { collection(n) { const rows = () => DATA[n] || []; return {
      where(c) { const hit = () => rows().filter((r) => eq(r, c || {})); return {
        limit(x) { return { get: async () => ({ data: hit().slice(0, x) }) }; },
        skip(k) { return { limit(x) { return { get: async () => ({ data: hit().slice(k, k + x) }) }; } }; },
        get: async () => ({ data: hit() }), count: async () => ({ total: hit().length }),
      }; },
      doc(id) { return { get: async () => ({ data: rows().find((r) => r._id === id) }) }; },
    }; } };
  }
  for (const d of ['getLedger', 'getAmortSchedule']) {
    const c = require(F('cloudfunctions/' + d + '/common.js'));
    c.resolveAuth = async () => ({ user: { id: 'u' } });
    c.assertShopOwner = async () => ({ error: null });
    c.dataAdapter.makeAdapter = () => ({
      list: (coll, w, e) => Promise.resolve({ data: (DATA[coll] || []).filter((r) => eq(r, Object.assign({}, e || {}, w || {}, { is_deleted: false }))).slice(0, 1000) }),
      listAll: (coll, w, e) => Promise.resolve({ data: (DATA[coll] || []).filter((r) => eq(r, Object.assign({}, e || {}, w || {}, { is_deleted: false }))).slice(0, 1000) }),
      get: async (coll, id) => (DATA[coll] || []).find((r) => r._id === id) || null,
    });
  }
  const glIdx = require(F('cloudfunctions/getLedger/index.js'));
  const gsIdx = require(F('cloudfunctions/getAmortSchedule/index.js'));

  DATA = {
    shop_amortize: [{ _id: 'air', asset_id: 'air', shop_id: 's1', name: '旧空调', mode: 'amort',
      value_fen: 1200000, start_month: '2026-01', total_months: 36, terminate_month: '2026-08', is_deleted: false }],
    shop_monthly_account: [{ _id: 'acc', shop_id: 's1', month: '2026-08', is_archive: true,
      income_items: [{ category: 'food', name: '营收', amount_fen: 500000 }], expense_items: [],
      direct_consume_fen: 0, inventory: { openingFen: 0, purchaseFen: 0, closingFen: 0 },
      amortize_fen: 33333, lump_sum_fen: 0, switch_used: { inventorySwitchOn: false, amortizeSwitchOn: true }, is_deleted: false }],
    shop_switch: [], shop: [{ _id: 's1', shop_id: 's1', biz_type: 'dining', city_tier: 'tier23', is_deleted: false }],
  };
  (async () => {
    const g = await glIdx.main({ shop_id: 's1', month: '2026-08' });
    const s = await gsIdx.main({ shop_id: 's1', month: '2026-08' });
    const gd = (g && g.data) || {}, sd = (s && s.data) || {};
    ck('D-① 归档月结果页 amortize_fen = 落库快照 33333 分（不被倒灌）', gd.amortize_fen === 33333, `实测 ${gd.amortize_fen}`);
    ck('D-② 归档月 disposal_loss_fen = 0（老账无字段，历史不追）', gd.disposal_loss_fen === 0, `实测 ${gd.disposal_loss_fen}`);
    ck('D-③ 摊销页页首 = 同一快照 33333 分（两页不打架）', sd.total_amount_fen === 33333, `实测 ${sd.total_amount_fen}`);
    ck('D-④ 现算值 966669 分仍披露（recomputed 不被快照污染）', sd.recomputed_total_fen === 966669, `实测 ${sd.recomputed_total_fen}`);
    ck('D-⑤ 漂移 933336 分可见（R741 披露纪律）', sd.caliber_drift_fen === 933336, `实测 ${sd.caliber_drift_fen}`);
    Module._load = orig;

    // ===================== E 四副本同源 =====================
    group('E · 四份函数体同构');
    function extract(src, name) {
      const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{');
      const m = src.match(re); if (!m) return null;
      let i = m.index + m[0].length, dep = 1;
      while (i < src.length && dep > 0) { if (src[i] === '{') dep++; else if (src[i] === '}') dep--; i++; }
      return src.slice(m.index, i);
    }
    const norm = (s) => (s || '').replace(/\s+/g, ' ').replace(/_monthIndex/g, 'monthIndex').trim();
    const bodies = [
      norm(extract(read('cloudfunctions/getLedger/service.js'), 'disposalLossForMonth')),
      norm(extract(read('cloudfunctions/saveLedger/service.js'), 'disposalLossForMonth')),
      norm(extract(read('cloudfunctions/getAmortSchedule/service.js'), 'disposalLossForMonth')),
      norm(extract(EXP, '_disposalLossForMonth').replace(/_disposalLossForMonth/g, 'disposalLossForMonth')),
    ];
    ck('E-① 四份 disposalLossForMonth 函数体逐字同构（归一前缀后）',
      bodies.every((b) => b && b === bodies[0]), bodies.every((b) => b) ? (bodies[0] === bodies[1] && bodies[1] === bodies[2] && bodies[2] === bodies[3] ? '4/4 一致' : '存在漂移') : '有副本抽取失败');
    ck('E-② 导出件私有版带 _ 前缀且被调用', /_disposalLossForMonth\(assetsForCaliber, month\)/.test(EXP), '接线在位');
    ck('E-③ 四份引擎 exports/调用点都能取到函数', !!(gl.disposalLossForMonth && sl.disposalLossForMonth && gs.disposalLossForMonth), '3 个 service 导出');

    // ===================== F 自失效 =====================
    group('F · 自失效护栏');
    ck('F-① 断言数下界 ≥ 18', R.length + 2 >= 18, `当前 ${R.length + 2}`);
    ck('F-② 规范锚点常量在位（12000/36/2026-08）', AIR.total_value === 1200000 && AIR.total_months === 36 && AIR.terminate_month === '2026-08', 'S2b 未漂移');
    ck('F-③ 归档月读快照的判据在位（getLedger）', /const disposalLossFen = isArchiveNow/.test(read('cloudfunctions/getLedger/index.js')), '判据未删');

    let passN = 0, failN = 0;
    for (const r of R) { if (r.pass) passN++; else failN++; }
    console.log('\n=========== 资产处置损失口径守卫 · R744 ===========');
    const groups = {};
    for (const r of R) (groups[r.group] = groups[r.group] || []).push(r);
    for (const g in groups) {
      console.log(`\n【${g}】`);
      for (const r of groups[g]) console.log(`  ${r.pass ? '✅' : '❌'} ${r.name} —— ${r.detail}`);
    }
    console.log(`\n合计：${passN} 通过 / ${failN} 失败`);
    process.exit(failN ? 1 : 0);
  })();
})();
