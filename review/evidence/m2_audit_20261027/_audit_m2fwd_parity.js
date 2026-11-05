// _audit_m2fwd_parity.js —— 只读取证：
// ① 前端「每月固定支出合计」(refreshFixedPreview) vs 引擎 fixed_ex_amort_fen 对拍（≥30 组）
// ② 单页 forward 的 fixedYuan 形状 vs 矩阵页 forward 的 fixedYuan 形状 ⇒ 管理费/水电口径对拍
const { makePage } = require('./_audit_m2fwd_harness.js');
const { run } = require('./_audit_m2fwd_engine.js');
const { assembleItems, findPreset, CITY_COEF } = require('./utils/bizPreset.js');

// ---- ① 前端 refreshFixedPreview vs 引擎 ----
const combos = [];
const RENT = ['', '3000', '8000', '20000'];
const LABOR = ['', '9000'];
const WEG = [
  { waterYuan: '', electricYuan: '', gasYuan: '' },
  { waterYuan: '200', electricYuan: '1500', gasYuan: '300' },
  { waterYuan: '200', electricYuan: '1500', gasYuan: '' },
  { waterYuan: '', electricYuan: '1500', gasYuan: '' },
  { waterYuan: '200', electricYuan: '', gasYuan: '' },
];
const MANAGE = ['', '2000'];
const HC = ['', '2'];
for (const rent of RENT) for (const labor of LABOR) for (const weg of WEG)
  for (const mg of MANAGE) for (const hc of HC) combos.push({ rent, labor, weg, mg, hc });

let mismatch = 0, total = 0;
const rows = [];
for (const c of combos) {
  const ov = Object.assign({
    presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0, areaNum: '60',
    rentYuan: c.rent, laborTotalYuan: c.labor, manageYuan: c.mg, headcountNum: c.hc,
    marginPct: 60, targetYuan: '20000',
  }, c.weg);
  const r = run(ov);
  if (r.err) continue;
  total++;
  // 复刻 refreshFixedPreview（index.js:1653-1663）：房租+人工总额+水+电+气+管理费
  const sum = (Number(c.rent) || 0) + (Number(c.labor) || 0) + (Number(c.weg.waterYuan) || 0)
    + (Number(c.weg.electricYuan) || 0) + (Number(c.weg.gasYuan) || 0) + (Number(c.mg) || 0);
  const eng = r.fixed_ex_amort;
  const diff = eng - sum;
  if (Math.abs(diff) > 1) {
    mismatch++;
    rows.push({ rent: c.rent || '空', labor: c.labor || '空', weg: JSON.stringify(c.weg),
      mg: c.mg || '空', hc: c.hc || '空', 前端合计: sum, 引擎固定: eng, 差: diff });
  }
}
console.log('=== ① 前端「每月固定支出合计」vs 引擎 fixed_ex_amort_fen ===');
console.log('   组合数=' + total + ' 不一致=' + mismatch);
const seen = {};
rows.slice(0, 40).forEach((x) => {
  const k = [x.rent, x.labor, x.weg, x.mg, x.hc].join('|');
  if (seen[k]) return; seen[k] = 1;
  console.log('   房租=' + x.rent + ' 人工=' + x.labor + ' 水电气=' + x.weg + ' 管理费=' + x.mg
    + ' 人数=' + x.hc + ' ⇒ 前端 ' + x.前端合计 + ' / 引擎 ' + x.引擎固定 + '（差 ' + x.差 + '）');
});

// ---- ② 单页 forward vs 矩阵页 forward：同一输入的 fixed_items ----
console.log('\n=== ② 单页 forward（fixedYuan 带 manage 键）vs 矩阵 forward（fixedYuan 只有 rent）===');
const PRESETS = ['fastfood_noodle', 'dining_sichuan', 'hotpot_half_self', 'cafe_tea', 'other'];
for (const pk of PRESETS) {
  const preset = findPreset(pk);
  const coef = CITY_COEF.tier23;
  const rentYuan = 8000, hc = 2, lt = 9000;
  // 单页（index.js:1822）：fixedYuan 恒带 manage 键
  const aIdx = assembleItems(preset, {
    area: 60, headcount: hc, laborTotalYuan: lt, laborUnitYuan: 0, rentYuan,
    waterYuan: 0, electricYuan: 0, gasYuan: 0,
    fixedYuan: { rent: String(rentYuan), manage: '' }, buildItems: [],
  }, coef);
  // 矩阵（matrix.js:674-682）：fixedYuan 只有 rent
  const aMtx = assembleItems(preset, {
    area: 60, headcount: hc, rentYuan,
    laborTotalYuan: lt > 0 ? lt : undefined, laborUnitYuan: undefined,
    fixedYuan: { rent: rentYuan }, buildItems: [],
  }, coef);
  const f = (a) => a.fixedItems.map((x) => x.key + ':' + (x.fen / 100)).join(', ');
  const same = JSON.stringify(aIdx.fixedItems) === JSON.stringify(aMtx.fixedItems);
  console.log('   ' + pk.padEnd(20) + (same ? '一致  ' : '★不一致'));
  console.log('      单页: ' + f(aIdx));
  console.log('      矩阵: ' + f(aMtx));
}
