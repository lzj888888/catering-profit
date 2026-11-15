'use strict';
// R745 只读实证探针 —— 数字链路 + 元审计。不修改任何现有文件。
// 复现: node review/evidence/_r745_probeG1.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const R = (rel) => require(path.join(ROOT, rel));

let _s = 0x9e3779b9;
function rnd() { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const line = (s) => console.log(s);

const units = R('utils/units.js');
const money = R('cloudfunctions/common/money.js');
const cb = R('cloudfunctions/calcBom/service.js');
const sc = R('cloudfunctions/saveCostCard/service.js');
const sy = R('cloudfunctions/syncCostCard/service.js');
const gm = R('cloudfunctions/getMaterial/service.js');
const sm = R('cloudfunctions/saveMaterial/service.js');
const apiYuanToFen = (y) => { const n = Number(y); if (!isFinite(n) || n < 0) return 0; return Math.round(Number((n * 100).toFixed(10))); };

line('R745 数字链路实证探针(只读) ROOT=' + ROOT);

// ---------- Part 1: 5 副本 netUnitCostWan 60万组 ----------
{
  const F = [cb, sc, sy, gm, sm].map((m) => m.netUnitCostWan);
  let diff = 0; const ex = [];
  const T = 600000;
  for (let t = 0; t < T; t++) {
    const p = ri(1, 5000000);
    const cfPool = [1, 50, 500, 1000, 24, 6, 2.5, 0, -3, NaN];
    const cf = cfPool[ri(0, cfPool.length - 1)];
    const yPool = [1, 50, 90, 100, 0, -5, 150, 1000, NaN, undefined, '', 'abc', 33.3, 99.99];
    const y = yPool[ri(0, yPool.length - 1)];
    const vals = F.map((f) => f(p, cf, y));
    const keys = vals.map((v) => (Number.isNaN(v) ? 'NaN' : String(v)));
    if (new Set(keys).size > 1) { diff++; if (ex.length < 3) ex.push({ p, cf, y, vals, keys }); }
  }
  line('\n[Part1] 5副本 netUnitCostWan 对拍 ' + T + ' 组 -> 不一致 ' + diff);
  ex.forEach((e) => line('  反例 ' + JSON.stringify(e)));
}

// ---------- Part 2: 前端 netUnitWanOf vs 云端 netUnitCostWan ----------
{
  const UNITS_POOL = units.PURCHASE_UNITS;
  let diff = 0; const ex = [];
  const T = 600000;
  for (let t = 0; t < T; t++) {
    const mode = ri(0, 2);
    let yuan;
    if (mode === 0) yuan = ri(1, 20000) / 100;         // 2位小数
    else if (mode === 1) yuan = ri(1, 200000) / 1000;  // 3位小数
    else yuan = ri(1, 500);                            // 整数元
    const unit = UNITS_POOL[ri(0, UNITS_POOL.length - 1)];
    const yPool = [1, 30, 50, 60, 90, 92, 95, 100, 33.3, 66.7, 99.5];
    const y = yPool[ri(0, yPool.length - 1)];
    const fe = units.netUnitWanOf(yuan, y, unit);
    const fen = apiYuanToFen(yuan);
    const cf = units.factorOf(unit);
    const be = cb.netUnitCostWan(fen, cf, y);
    if (fe !== be) {
      diff++;
      if (ex.length < 12) ex.push({ yuan, unit, y, yuanToFen: fen, factor: cf, front: fe, cloud: be, gap: fe - be });
    }
  }
  line('\n[Part2] 前端 netUnitWanOf vs 云端 netUnitCostWan(对齐 fen/factor/y) 对拍 ' + T + ' 组 -> 数字不一致 ' + diff);
  ex.forEach((e) => line('  反例 ' + JSON.stringify(e)));
}

// ---------- Part 2b: 越界出成率语义分歧 ----------
{
  const yBad = [0, -5, 150, 1000, 'abc', NaN, null, undefined, ''];
  line('\n[Part2b] 出成率越界: 前端 netUnitWanOf(6, y, "斤") vs 云端 netUnitCostWan(600,500,y)');
  for (const y of yBad) {
    const fe = units.netUnitWanOf(6, y, '斤');
    const be = cb.netUnitCostWan(600, 500, y);
    line('  y=' + JSON.stringify(y) + ' -> 前端=' + fe + ' / 云端=' + be + (fe !== be ? '  <== 分歧' : ''));
  }
}

// ---------- Part 3: calcCostCard 三副本 60万组 ----------
{
  const MODS = [cb, sc, sy];
  const KEYS = ['unit_cost_fen', 'material_total_fen', 'gross_profit_fen', 'gross_margin_pct', 'reverse_price_fen', 'batch_total_fen'];
  const sig = (o) => { if (!o || typeof o !== 'object') return JSON.stringify(o); return KEYS.map((k) => k + '=' + String(o[k])).join('|') + '||lines=' + JSON.stringify((o.lines || []).map((l) => [l.quantity, l.net_unit_cost, l.line_net_cost_fen])); };
  let diff = 0; const ex = [];
  const T = 600000;
  for (let t = 0; t < T; t++) {
    const nL = ri(1, 12);
    const lines = [];
    for (let i = 0; i < nL; i++) {
      const qty = (ri(0, 4) === 0) ? ri(1, 10000) / 10 : ri(1, 10000);
      const wan = (ri(0, 4) === 0) ? ri(1, 500000) / 10 : ri(1, 500000);
      lines.push({ material_id: 'm' + i, quantity: qty, net_unit_cost: wan, input_type: 1 });
    }
    const mode = rnd() < 0.3 ? 'B' : 'A';
    const p = { lines, mode, lossPct: (ri(0, 3) === 0) ? ri(0, 9999) / 100 : ri(0, 99), auxFen: ri(0, 500000), batchOutput: mode === 'B' ? ri(1, 50) : 0, priceFen: ri(0, 1000000), targetMarginPct: (ri(0, 3) === 0) ? ri(1, 9999) / 100 : ri(0, 99) };
    let base = null;
    for (let m = 0; m < MODS.length; m++) {
      let o; try { o = MODS[m].calcCostCard(p); } catch (e) { o = { __err: String(e && (e.msg || e)) }; }
      const s = sig(o);
      if (base === null) { base = s; continue; }
      if (s !== base) { diff++; if (ex.length < 3) ex.push({ t, p, base: base.slice(0, 180), oth: s.slice(0, 180) }); break; }
    }
  }
  line('\n[Part3] calcCostCard 三副本对拍 ' + T + ' 组(含小数用量/半步/损耗 99.99) -> 不一致 ' + diff);
  ex.forEach((e) => line('  反例 ' + JSON.stringify(e).slice(0, 400)));
}

// ---------- Part 4: 引擎换算 vs money.yuanToFen ----------
{
  let diff = 0; const T = 600000;
  for (let t = 0; t < T; t++) {
    const x = (ri(0, 2) === 0) ? ri(0, 10000000) / 100 : ri(0, 100000000) / 1000;
    const a = Math.round(Number((x * 100).toFixed(10)));
    const b = money.yuanToFen(x);
    if (a !== b) diff++;
  }
  line('\n[Part4] 引擎 Math.round(Number((x*100).toFixed(10))) vs common/money.yuanToFen ' + T + ' 组 -> 差异 ' + diff);
}

// ---------- Part 5: 元审计 —— P-⑥ 变异自证恒真 ----------
{
  const src = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
  const hasPromiseAll = /Promise\.all/.test(src);
  const mutated = src.replace(/Promise\.all/g, 'serialFallback');
  const P6_cond = !/Promise\.all/.test(mutated);
  const P1_tautology = () => true;
  line('\n[Part5] check_card_live_cost.js P-⑥ 变异自证');
  line('  源码含 Promise.all = ' + hasPromiseAll);
  line('  mutated 不含 Promise.all = ' + P6_cond + '  (P-⑥ 据此判绿)');
  line('  把 P-① 判据改为恒真 ()=>true 后，P-⑥ 仍判绿 = ' + (P6_cond && P1_tautology()));
  line('  => P-⑥ 只自证"字符串替换生效"，从不让变异体过 P-① 判据，属恒真/无效变异自证');
}

// ---------- Part 6: 导出件取数字段(只读核查) ----------
{
  const s = fs.readFileSync(path.join(ROOT, 'cloudfunctions/adminExport/service.js'), 'utf8');
  const fields = ['total_cost', 'unit_cost_fen', 'material_total_fen', 'gross_profit_fen', 'gross_margin_pct', 'reverse_price_fen', 'total_cost_fen', 'price_fen'];
  line('\n[Part6] adminExport/service.js 中金额字段出现次数:');
  fields.forEach((f) => { const n = (s.match(new RegExp('\\b' + f + '\\b', 'g')) || []).length; line('  ' + f + ': ' + n); });
}
