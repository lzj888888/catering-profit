'use strict';
// R745 只读实证探针 2 —— 续 G1(精简样本,避免超时)。不修改任何现有文件。
// 复现: node review/evidence/_r745_probeG2.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const R = (rel) => require(path.join(ROOT, rel));
let _s = 0x1a2b3c4d;
function rnd() { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const line = (s) => console.log(s);
const units = R('utils/units.js');
const money = R('cloudfunctions/common/money.js');
const cb = R('cloudfunctions/calcBom/service.js');
const sc = R('cloudfunctions/saveCostCard/service.js');
const sy = R('cloudfunctions/syncCostCard/service.js');
const yuanToFen = (y) => { const n = Number(y); if (!isFinite(n) || n < 0) return 0; return Math.round(Number((n * 100).toFixed(10))); };

// ---------- Part 2c: 2位小数(日常输入)下 前端 vs 云端"正确折算 cf=1" ----------
{
  const UNITS_POOL = units.PURCHASE_UNITS;
  let diff2 = 0, diff3 = 0; const ex2 = [], ex3 = [];
  const T = 100000;
  for (let t = 0; t < T; t++) {
    const unit = UNITS_POOL[ri(0, UNITS_POOL.length - 1)];
    const f = units.factorOf(unit);
    const yPool = [1, 30, 50, 60, 90, 92, 95, 100, 33.3, 66.7, 99.5];
    const y = yPool[ri(0, yPool.length - 1)];
    // 2位小数采购价(元/采购单位)
    const yuan2 = ri(1, 200000) / 100;
    const front2 = units.netUnitWanOf(yuan2, y, unit);
    // 后端路径B: cf=1, 入参须已是"克价分" = yuanToFen(yuan2/f)
    const fenBase2 = yuanToFen(yuan2 / f);
    const cloud2 = cb.netUnitCostWan(fenBase2, 1, y);
    if (front2 !== cloud2) { diff2++; if (ex2.length < 6) ex2.push({ yuan2, unit, f, y, fenBase2, front2, cloud2, gap: front2 - cloud2 }); }
    // 3位小数采购价
    const yuan3 = ri(1, 2000000) / 1000;
    const front3 = units.netUnitWanOf(yuan3, y, unit);
    const fenBase3 = yuanToFen(yuan3 / f);
    const cloud3 = cb.netUnitCostWan(fenBase3, 1, y);
    if (front3 !== cloud3) { diff3++; if (ex3.length < 4) ex3.push({ yuan3, unit, f, y, fenBase3, front3, cloud3, gap: front3 - cloud3 }); }
  }
  line('[Part2c] 对齐真实路径B(cf=1, 入参已折算成克价分) 10万组:');
  line('  2位小数(日常): 前端 vs 云端 不一致 ' + diff2 + ' / ' + T);
  ex2.forEach((e) => line('    反例 ' + JSON.stringify(e)));
  line('  3位小数: 前端 vs 云端 不一致 ' + diff3 + ' / ' + T);
  ex3.forEach((e) => line('    反例 ' + JSON.stringify(e)));
}

// ---------- Part 2d: 后端 cf=1 但调用方传"未折算的原单位分" => 差 factor 倍 ----------
{
  const yuan = 6, unit = '斤', y = 100, f = units.factorOf(unit);
  const front = units.netUnitWanOf(yuan, y, unit);
  const cloudCorrect = cb.netUnitCostWan(yuanToFen(yuan / f), 1, y); // 已折算
  const cloudRaw = cb.netUnitCostWan(yuanToFen(yuan), 1, y);        // 未折算(误传)
  line('\n[Part2d] 6元/斤, y=100, factor=500:');
  line('  前端 netUnitWanOf(6,100,"斤") = ' + front);
  line('  后端 netUnitCostWan(克价分,1,100) 已折算 = ' + cloudCorrect);
  line('  后端 netUnitCostWan(600,1,100) 未折算 = ' + cloudRaw + '  => 相差 ' + (cloudRaw / (cloudCorrect || 1)) + ' 倍');
}

// ---------- Part 3: calcCostCard 三副本 10万组(含边界) ----------
{
  const MODS = [cb, sc, sy];
  const KEYS = ['unit_cost_fen', 'material_total_fen', 'gross_profit_fen', 'gross_margin_pct', 'reverse_price_fen', 'batch_total_fen'];
  const sig = (o) => { if (!o || typeof o !== 'object') return JSON.stringify(o); return KEYS.map((k) => k + '=' + String(o[k])).join('|') + '||lines=' + JSON.stringify((o.lines || []).map((l) => [l.quantity, l.net_unit_cost, l.line_net_cost_fen])); };
  let diff = 0; const ex = [];
  const T = 100000;
  for (let t = 0; t < T; t++) {
    const nL = ri(1, 8);
    const lines = [];
    for (let i = 0; i < nL; i++) {
      const qty = (ri(0, 3) === 0) ? ri(1, 10000) / 10 : ri(1, 10000);
      const wan = (ri(0, 3) === 0) ? ri(1, 500000) / 10 : ri(1, 500000);
      lines.push({ material_id: 'm' + i, quantity: qty, net_unit_cost: wan, input_type: 1 });
    }
    const mode = rnd() < 0.3 ? 'B' : 'A';
    const p = { lines, mode, lossPct: (ri(0, 3) === 0) ? ri(0, 9999) / 100 : ri(0, 99), auxFen: ri(0, 500000), batchOutput: mode === 'B' ? ri(1, 50) : 0, priceFen: ri(0, 1000000), targetMarginPct: (ri(0, 3) === 0) ? ri(1, 9999) / 100 : ri(0, 99) };
    let base = null;
    for (let m = 0; m < MODS.length; m++) {
      let o; try { o = MODS[m].calcCostCard(p); } catch (e) { o = { __err: String(e && (e.msg || e)) }; }
      const s = sig(o);
      if (base === null) { base = s; continue; }
      if (s !== base) { diff++; if (ex.length < 2) ex.push({ t, p, base: base.slice(0, 160), oth: s.slice(0, 160) }); break; }
    }
  }
  line('\n[Part3] calcCostCard 三副本对拍 ' + T + ' 组(小数用量/损耗99.99/半步) -> 不一致 ' + diff);
  ex.forEach((e) => line('  反例 ' + JSON.stringify(e).slice(0, 360)));
}

// ---------- Part 4: 引擎换算 vs money.yuanToFen ----------
{
  let diff = 0; const T = 100000;
  for (let t = 0; t < T; t++) {
    const x = (ri(0, 2) === 0) ? ri(0, 10000000) / 100 : ri(0, 100000000) / 1000;
    if (Math.round(Number((x * 100).toFixed(10))) !== money.yuanToFen(x)) diff++;
  }
  line('[Part4] 引擎 toFixed(10) 换算 vs common/money.yuanToFen ' + T + ' 组 -> 差异 ' + diff);
}

// ---------- Part 5: P-⑥ 恒真自证 ----------
{
  const src = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
  const mutated = src.replace(/Promise\.all/g, 'serialFallback');
  const P6 = !/Promise\.all/.test(mutated);
  line('\n[Part5] check_card_live_cost.js P-⑥: mutated 无 Promise.all = ' + P6);
  line('  把 P-① 判据改成 ()=>true 后 P-⑥ 仍绿 = ' + (P6 && (() => true)()));
  line('  => 变异体从未喂回 P-① 判据, 恒真/无效变异自证');
}

// ---------- Part 6: 导出件金额字段 ----------
{
  const s = fs.readFileSync(path.join(ROOT, 'cloudfunctions/adminExport/service.js'), 'utf8');
  const fields = ['total_cost', 'unit_cost_fen', 'material_total_fen', 'gross_profit_fen', 'gross_margin_pct', 'reverse_price_fen', 'total_cost_fen', 'price_fen', 'cost_card'];
  line('\n[Part6] adminExport/service.js 字段次数: ' + fields.map((f) => f + '=' + (s.match(new RegExp('\\b' + f + '\\b', 'g')) || []).length).join('  '));
  const idx = fs.readFileSync(path.join(ROOT, 'cloudfunctions/adminExport/index.js'), 'utf8');
  line('  adminExport/index.js 字段次数: ' + fields.map((f) => f + '=' + (idx.match(new RegExp('\\b' + f + '\\b', 'g')) || []).length).join('  '));
}

// ---------- Part 7: M3 守卫挂载 / 断言数受守面 ----------
{
  const va = fs.readFileSync(path.join(ROOT, 'verify_all.js'), 'utf8');
  const sac = fs.readFileSync(path.join(ROOT, 'tools/check_suite_assert_counts.js'), 'utf8');
  const m3 = ['check_m3_engine_parity', 'check_m3_card_roundtrip', 'check_m3_margin_bands', 'check_m3_decision', 'check_m3_page_behavior', 'check_m3_storage_isolation', 'check_m3_chain_clarity', 'check_m3_style_b', 'check_m3_entry_naming', 'check_m333_parse', 'check_card_live_cost', 'check_bill_realtables', 'check_bill_realworld', 'check_bill_import_gate'];
  line('\n[Part7] M3 守卫 在 verify_all.SUITES / 在 check_suite_assert_counts.CASES:');
  m3.forEach((k) => line('  ' + k.padEnd(30) + ' SUITES=' + (va.indexOf(k) >= 0) + '  CASES=' + (sac.indexOf('key: \'' + k + '\'') >= 0)));
}
