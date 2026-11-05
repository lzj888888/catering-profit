// _audit_m2fwd_dead.js —— 只读取证：hasFixed 恒真 / 死分支 / 恒假判据
const { makePage } = require('./_audit_m2fwd_harness.js');
const { BIZ_PRESETS, findPreset, CITY_COEF } = require('./utils/bizPreset.js');
const { assembleItems } = require('./utils/bizPreset.js');

console.log('=== ① hasFixed = p.fixed_items.length > 0 是否恒真？13 个预设 × 3 城市 × 全空输入 ===');
const tiers = ['tier1', 'tier23', 'county'];
let always = true;
for (const raw of BIZ_PRESETS) {
  const pk = raw.presetKey;
  const preset = findPreset(pk);
  for (const t of tiers) {
    const { fixedItems } = assembleItems(preset, {
      area: 0, headcount: 0, laborTotalYuan: 0, laborUnitYuan: 0, rentYuan: 0,
      waterYuan: 0, electricYuan: 0, gasYuan: 0,
      fixedYuan: { rent: '', manage: '' }, buildItems: [],
    }, CITY_COEF[t]);
    if (fixedItems.length === 0) { always = false; console.log('   ★ ' + pk + ' @' + t + ' → 空'); }
  }
  const { fixedItems } = assembleItems(preset, {
    area: 0, headcount: 0, laborTotalYuan: 0, laborUnitYuan: 0, rentYuan: 0,
    waterYuan: 0, electricYuan: 0, gasYuan: 0,
    fixedYuan: { rent: '', manage: '' }, buildItems: [],
  }, CITY_COEF.tier23);
  console.log('   ' + pk.padEnd(20) + ' 全空 ⇒ fixed_items = '
    + fixedItems.map((x) => x.key + ':' + (x.fen / 100)).join(', '));
}
console.log('   ⇒ hasFixed 恒真？ ' + (always ? '是（needFixed / calcError 分支为死代码）' : '否'));

console.log('\n=== ② 首屏（全空）页面派生状态实际值 ===');
const p = makePage({});
const prm = p.buildPresetParam('forward');
const hasFixed = prm.fixed_items.length > 0;
console.log('   hasFixed = ' + hasFixed + ' ⇒ calcError = ' + (hasFixed ? "''（不提示）" : 'M.needFixed'));
p.refreshFixedPreview();
p.refreshMissing();
console.log('   fixedPreviewText = ' + JSON.stringify(p.data.fixedPreviewText));
console.log('   missingHint      = ' + JSON.stringify(p.data.missingHint));
p.refreshStick();
console.log('   stickKpi/stickLbl/stickVal = ' + p.data.stickKpi + ' / '
  + JSON.stringify(p.data.stickLbl) + ' / ' + JSON.stringify(p.data.stickVal));

console.log('\n=== ③ 「还差」提示 vs 引擎是否真的缺 ===');
const cases = [
  ['人工总额留空 + 人数 2（引擎兜底出 9000）', { laborTotalYuan: '', headcountNum: '2' }],
  ['人工总额留空 + 人数留空（引擎出 0）', { laborTotalYuan: '', headcountNum: '' }],
  ['水电气只填电（引擎丢弃、走派生）', { waterYuan: '', electricYuan: '1500', gasYuan: '' }],
  ['水电气全填', { waterYuan: '200', electricYuan: '1500', gasYuan: '300' }],
];
for (const [name, ov] of cases) {
  const q = makePage(Object.assign({ presetKey: 'fastfood_noodle', cityIdx: 1, bizIdx: 0,
    rentYuan: '8000', marginPct: 60 }, ov));
  q.refreshMissing();
  const pr = q.buildPresetParam('forward');
  const labor = (pr.fixed_items.filter((x) => x.key === 'labor')[0] || {}).fen / 100;
  const util = (pr.fixed_items.filter((x) => x.key === 'utility')[0] || {}).fen / 100;
  console.log('   ' + name.padEnd(40) + ' missingHint=' + JSON.stringify(q.data.missingHint)
    + ' 引擎 labor=' + labor + ' utility=' + util);
}
