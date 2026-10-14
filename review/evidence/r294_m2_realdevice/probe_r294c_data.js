// R294-C · 第三轮数据：把 P0 / P1 / P2 三条缺陷从「定性」跑成「可拍板的数字」
// 🔴 不采信 R294 上一轮的自述结论 —— 用引擎真实出参重新量化（军规 §1.2）。
// 纯本地跑（不依赖 IDE 自动化通道）：装配器 + 校验 + 引擎 全链路直调。
// 只打印真实出参与偏差，判读留给人。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');

const bp = require(path.join(ROOT, 'utils/bizPreset.js'));
const svc = require(path.join(ROOT, 'cloudfunctions/calcSandbox/service.js'));
const val = require(path.join(ROOT, 'cloudfunctions/calcSandbox/validate.js'));

const Y = (yuan) => Math.round(Number(yuan) * 100);
const fmt = (fen) => (fen == null ? 'null' : '¥' + Math.round(fen / 100).toLocaleString('zh-CN'));
const pctDiff = (now, base) => (base == null || now == null || base === 0) ? null
  : ((now - base) / base * 100);

// 结论卡术语（来源 specs/dev-specs/i18n/terms.js:1078-1087，此处只抄文本用于关键词判串台）
const NOTE = {
  good: '租金在安全区间，可以谈',
  ok: '还在合理范围，能拿',
  warn: '偏高了，压价或换铺',
  bad: '房租吃掉了太多流水',
  na: '填了上面几项就能判',
};
// 房租口径关键词：note 里出现这些词，但最差项不是 rent ⇒ 串台
const RENT_WORDS = ['压价', '换铺', '房租'];

// ===== 老板场景（沿用 R292 六个真实门店量级，非编造）=====
const CASES = [
  { name: 'A · 县城小面馆', presetKey: 'fastfood_noodle', cityKey: 'county',
    area: 60, headcount: 2, laborUnitYuan: 3200, rentYuan: 3000,
    utilityYuan: 800, manageYuan: 900, targetYuan: 8000, expectYuan: 60000, tables: 8 },
  { name: 'B · 二线火锅半自助', presetKey: 'hotpot_half_self', cityKey: 'tier23',
    area: 120, headcount: 8, laborUnitYuan: 4000, rentYuan: 12000,
    utilityYuan: 3500, manageYuan: 4000, targetYuan: 30000, expectYuan: 250000, tables: 20 },
  { name: 'C · 一线快餐', presetKey: 'fastfood_noodle', cityKey: 'tier1',
    area: 50, headcount: 4, laborUnitYuan: 6000, rentYuan: 15000,
    utilityYuan: 1500, manageYuan: 2000, targetYuan: 20000, expectYuan: 180000, tables: 8 },
  { name: 'D · 三线川菜正餐', presetKey: 'dining_sichuan', cityKey: 'tier23',
    area: 200, headcount: 6, laborUnitYuan: 4500, rentYuan: 8000,
    utilityYuan: 3000, manageYuan: 3500, targetYuan: 25000, expectYuan: 200000, tables: 18 },
  { name: 'E · 二线新式茶饮', presetKey: 'cafe_tea', cityKey: 'tier23',
    area: 30, headcount: 2, laborUnitYuan: 4200, rentYuan: 6000,
    utilityYuan: 1200, manageYuan: 1500, targetYuan: 10000, expectYuan: 60000, tables: 4 },
  { name: 'F · 二线烧烤', presetKey: 'hotpot_barbecue', cityKey: 'tier23',
    area: 100, headcount: 5, laborUnitYuan: 4200, rentYuan: 10000,
    utilityYuan: 2500, manageYuan: 3000, targetYuan: 25000, expectYuan: 160000, tables: 16 },
];

// ===== 三条装配路径 =====
// pathA = 「选了业态预设」现状：buildPresetParam() ⇒ 只读首屏 rentYuan，明细表 fixedRows 一律不读
// pathB = 「没选预设 · 手填」现状：buildParam() ⇒ 只读 fixedRows 手填值，不做任何派生
// pathC = 理想态（修好后的装配）：手填优先，没填才由房租派生 —— 用于算「偏差基准」
function assemble(k, mode) {
  const preset = bp.findPreset(k.presetKey);
  const coef = Object.assign({ rent: 1, labor: 1 }, bp.CITY_COEF[k.cityKey] || {});
  const marginPct = preset.params && preset.params.grossMarginPct ? preset.params.grossMarginPct.v : 60;
  let input, fixedItems;
  if (mode === 'A') {
    input = { area: k.area, headcount: k.headcount, laborUnitYuan: k.laborUnitYuan,
      rentYuan: k.rentYuan, fixedYuan: { rent: k.rentYuan }, buildItems: [] };
    fixedItems = bp.assembleItems(preset, input, coef).fixedItems;
  } else if (mode === 'B') {
    // 手填态：只有用户真的在明细表里填的四项，全进；没有派生
    fixedItems = [
      { key: 'rent', fen: Y(k.rentYuan) },
      { key: 'labor', fen: Y(k.laborUnitYuan * k.headcount) },
      { key: 'utility', fen: Y(k.utilityYuan) },
      { key: 'manage', fen: Y(k.manageYuan) },
    ].filter((x) => x.fen > 0);
    input = { area: k.area, headcount: k.headcount, laborUnitYuan: k.laborUnitYuan,
      rentYuan: k.rentYuan, fixedYuan: {}, buildItems: [] };
  } else {
    // 理想态：手填优先；房租来自首屏（与 A 同源），utility/manage 用手填值覆盖派生
    input = { area: k.area, headcount: k.headcount, laborUnitYuan: k.laborUnitYuan,
      rentYuan: k.rentYuan,
      fixedYuan: { rent: k.rentYuan, utility: k.utilityYuan, manage: k.manageYuan },
      buildItems: [] };
    fixedItems = bp.assembleItems(preset, input, coef).fixedItems;
  }
  const asm = bp.assembleItems(preset, input, coef);
  const buildItems = bp.resolveBuild(preset, input);
  const wire = {
    shop_id: 'r294c-probe', mode: 'forward',
    city_tier: k.cityKey, biz_type: preset.bizKey,
    build_items: buildItems.map((b) => ({ key: b.key, fen: b.fen, years: b.years })),
    fixed_items: fixedItems,
    var_items: asm.varItems,
    gross_margin_pct: marginPct,
    target_profit_fen: Y(k.targetYuan),
    expected_revenue_fen: Y(k.expectYuan),
    valid_days: 30,
  };
  const v = val.validateInput(wire);
  if (v.error) return { err: v.msg || v.error };
  return { preset, fixedItems, d: svc.calcSandbox(v.clean) };
}

// 复刻 verdictOf()：取 6 项里最差 level，note 按 level 取固定一句（这就是 P2 的成因）
const RANK = { na: 0, good: 1, ok: 2, warn: 3, bad: 4 };
function verdict(d) {
  const rows = d.indicators_at_target || [];
  if (!rows.length) return { level: 'na', key: '-', note: NOTE.na };
  let worst = 'good';
  rows.forEach((x) => { if ((RANK[x.level] || 0) > RANK[worst]) worst = x.level; });
  const worstRow = rows.filter((x) => x.level === worst)[0] || rows[0];
  return { level: worst, key: worstRow.key, pct: worstRow.pct, note: NOTE[worst] || '' };
}
function isMismatch(vd) {
  const hit = RENT_WORDS.some((w) => vd.note.indexOf(w) >= 0);
  return hit && vd.key !== 'rent';
}

// ============ 实验 1 · P0 边界与量级 ============
console.log('════════════════════════════════════════════════════════════════');
console.log(' R294-C 实验1 · P0「明细表不进引擎」的三路径对账（基准 = pathC 理想态）');
console.log('════════════════════════════════════════════════════════════════');
const t1 = [];
for (const k of CASES) {
  const A = assemble(k, 'A'), B = assemble(k, 'B'), C = assemble(k, 'C');
  console.log('\n──── ' + k.name + '（' + k.presetKey + ' / ' + k.cityKey + '）────');
  console.log('  老板真实想填：房租 ' + fmt(Y(k.rentYuan)) + ' · 人工 ' + fmt(Y(k.laborUnitYuan * k.headcount))
    + ' · 水电 ' + fmt(Y(k.utilityYuan)) + ' · 管理费 ' + fmt(Y(k.manageYuan))
    + '  ⇒ 合计 ' + fmt(Y(k.rentYuan + k.laborUnitYuan * k.headcount + k.utilityYuan + k.manageYuan)));
  const rec = { name: k.name };
  for (const [tag, r] of [['A', A], ['B', B], ['C', C]]) {
    if (r.err) { console.log('  path' + tag + ' ❌ ' + r.err); continue; }
    const vd = verdict(r.d);
    console.log('  path' + tag + ' 固定合计 ' + fmt(r.d.fixed_total_fen).padStart(10)
      + ' | 保本月营业额 ' + fmt(r.d.break_even_monthly_fen).padStart(10)
      + ' | 目标利润月营收 ' + fmt(r.d.target_monthly_fen).padStart(10)
      + ' | 结论 ' + vd.level + '（最差项 ' + vd.key + ' ' + vd.pct + '%）');
    console.log('        fixed_items: ' + r.fixedItems.map((x) => x.key + '=' + fmt(x.fen)).join(' · '));
    rec[tag] = { fixed: r.d.fixed_total_fen, be: r.d.break_even_monthly_fen, tgt: r.d.target_monthly_fen, level: vd.level };
  }
  if (rec.A && rec.C) {
    rec.dFixed = pctDiff(rec.A.fixed, rec.C.fixed);
    rec.dBE = pctDiff(rec.A.be, rec.C.be);
    rec.dTgt = pctDiff(rec.A.tgt, rec.C.tgt);
    console.log('  ⇒ 预设态(A) 相对理想态(C)：固定合计 ' + (rec.dFixed == null ? '-' : rec.dFixed.toFixed(1) + '%')
      + ' · 保本营业额 ' + (rec.dBE == null ? '-' : rec.dBE.toFixed(1) + '%')
      + ' · 目标利润月营收 ' + (rec.dTgt == null ? '-' : rec.dTgt.toFixed(1) + '%'));
  }
  t1.push(rec);
}

// ============ 实验 2 · 房租档位扫描（看清 FLOOR 兜底造成的偏差方向）============
console.log('\n\n════════════════════════════════════════════════════════════════');
console.log(' R294-C 实验2 · 房租档位扫描（场景 A 县城小面馆，其余不变，只动房租）');
console.log('════════════════════════════════════════════════════════════════');
const t2 = [];
for (const rent of [1500, 3000, 6000, 12000, 20000, 30000]) {
  const k = Object.assign({}, CASES[0], { rentYuan: rent });
  const A = assemble(k, 'A'), C = assemble(k, 'C');
  if (A.err || C.err) { console.log('  房租 ' + fmt(Y(rent)) + ' ❌ ' + (A.err || C.err)); continue; }
  const dBE = pctDiff(A.d.break_even_monthly_fen, C.d.break_even_monthly_fen);
  console.log('  房租 ' + fmt(Y(rent)).padStart(8)
    + ' | A(预设态) 保本 ' + fmt(A.d.break_even_monthly_fen).padStart(10)
    + ' | C(理想态) 保本 ' + fmt(C.d.break_even_monthly_fen).padStart(10)
    + ' | 偏差 ' + (dBE == null ? '-' : (dBE >= 0 ? '+' : '') + dBE.toFixed(1) + '%')
    + ' | A 的 fixed: ' + A.fixedItems.map((x) => x.key + '=' + fmt(x.fen)).join(' · '));
  t2.push({ rent, beA: A.d.break_even_monthly_fen, beC: C.d.break_even_monthly_fen, dBE });
}

// ============ 实验 2b · 首屏房租「留空」、只在明细表填（R294 的 g2 档）============
// 关键：房租留空 ⇒ rent 项被跳过（不进 fixed_items），utility/manage 改由 RATE_COST_FLOOR 派生。
// ⇒ 后果方向取决于「真实房租 vs FLOOR」，不能一概说偏高/偏低。
console.log('\n\n════════════════════════════════════════════════════════════════');
console.log(' R294-C 实验2b · 首屏房租留空（只填明细表）＝ R294 g2 档');
console.log('════════════════════════════════════════════════════════════════');
const t2b = [];
for (const k of CASES) {
  const kEmpty = Object.assign({}, k, { rentYuan: '' });   // 首屏房租留空
  const A2 = assemble(kEmpty, 'A'), C = assemble(k, 'C');
  if (A2.err || C.err) { console.log('  ' + k.name + ' ❌ ' + (A2.err || C.err)); continue; }
  const hasRent = A2.fixedItems.some((x) => x.key === 'rent');
  const dBE = pctDiff(A2.d.break_even_monthly_fen, C.d.break_even_monthly_fen);
  console.log('  ' + k.name.padEnd(16) + ' 真实房租 ' + fmt(Y(k.rentYuan)).padStart(9)
    + ' | rent 进引擎？ ' + (hasRent ? '是' : '否 ← 丢失')
    + ' | 保本 ' + fmt(A2.d.break_even_monthly_fen).padStart(9) + ' vs 真实 ' + fmt(C.d.break_even_monthly_fen).padStart(9)
    + ' | 偏差 ' + (dBE == null ? '-' : (dBE >= 0 ? '+' : '') + dBE.toFixed(1) + '%'));
  console.log('       fixed_items: ' + A2.fixedItems.map((x) => x.key + '=' + fmt(x.fen)).join(' · '));
  t2b.push({ name: k.name, rent: k.rentYuan, hasRent, beA2: A2.d.break_even_monthly_fen, beC: C.d.break_even_monthly_fen, dBE });
}

// ============ 实验 3 · P1「切预设冲掉工资」的量级 ============
console.log('\n\n════════════════════════════════════════════════════════════════');
console.log(' R294-C 实验3 · P1 切业态预设后「员工月均工资」被覆盖的影响');
console.log('════════════════════════════════════════════════════════════════');
const t3 = [];
for (const k of CASES) {
  const before = assemble(k, 'A');
  const preset = bp.findPreset(k.presetKey);
  const pv = preset.params && preset.params.laborUnitYuan ? preset.params.laborUnitYuan.v : null;
  if (pv == null) { console.log('\n──── ' + k.name + '：预设无 laborUnitYuan，跳过'); continue; }
  const k2 = Object.assign({}, k, { laborUnitYuan: pv });
  const after = assemble(k2, 'A');
  if (before.err || after.err) { console.log('\n──── ' + k.name + ' ❌ ' + (before.err || after.err)); continue; }
  const dLabor = pctDiff(after.d.fixed_total_fen, before.d.fixed_total_fen);
  const dBE = pctDiff(after.d.break_even_monthly_fen, before.d.break_even_monthly_fen);
  console.log('\n──── ' + k.name + '（预设 ' + k.presetKey + '）────');
  console.log('  用户填 ' + k.laborUnitYuan + ' 元/人·月 → 切预设后变 ' + pv + ' 元/人·月'
    + '（× ' + k.headcount + ' 人 ⇒ 人工 ' + fmt(Y(k.laborUnitYuan * k.headcount)) + ' → ' + fmt(Y(pv * k.headcount)) + '）');
  const sLabor = (dLabor == null ? '-' : (dLabor >= 0 ? '+' : '') + dLabor.toFixed(1) + '%');
  const sBE = (dBE == null ? '-' : (dBE >= 0 ? '+' : '') + dBE.toFixed(1) + '%');
  console.log('  固定合计 ' + fmt(before.d.fixed_total_fen) + ' -> ' + fmt(after.d.fixed_total_fen)
    + ' (' + sLabor + ') | 保本月营业额 ' + fmt(before.d.break_even_monthly_fen)
    + ' -> ' + fmt(after.d.break_even_monthly_fen) + ' (' + sBE + ')');
  const vb = verdict(before.d), va = verdict(after.d);
  console.log('  结论 ' + vb.level + '（最差 ' + vb.key + '） → ' + va.level + '（最差 ' + va.key + '）');
  t3.push({ name: k.name, from: k.laborUnitYuan, to: pv, dLabor, dBE, lvFrom: vb.level, lvTo: va.level });
}

// ============ 实验 4 · P2 结论卡串台枚举 ============
console.log('\n\n════════════════════════════════════════════════════════════════');
console.log(' R294-C 实验4 · P2 结论卡文案 vs 最差项（note 只按 level 取 ⇒ 串台枚举）');
console.log('════════════════════════════════════════════════════════════════');
const t4 = [];
for (const k of CASES) {
  for (const mode of ['A', 'C']) {
    const r = assemble(k, mode);
    if (r.err) continue;
    const vd = verdict(r.d);
    const mm = isMismatch(vd);
    t4.push({ name: k.name, mode, level: vd.level, key: vd.key, pct: vd.pct, note: vd.note, mismatch: mm });
  }
}
for (const x of t4) {
  console.log('  ' + (x.mismatch ? '❌串台' : '✅一致') + ' | ' + x.name.padEnd(16) + ' path' + x.mode
    + ' | 最差项 ' + String(x.key).padEnd(8) + ' ' + String(x.pct) + '%'
    + ' | ' + x.level.padEnd(4) + ' | 「' + x.note + '」');
}
const mmCount = t4.filter((x) => x.mismatch).length;
console.log('\n  串台命中 ' + mmCount + ' / ' + t4.length + ' 组');

const fs = require('fs');
fs.writeFileSync(path.join(__dirname, 'r294c_data.json'),
  JSON.stringify({ t1, t2, t3, t4 }, null, 2), 'utf-8');
console.log('\n（明细已落盘 r294c_data.json）');
