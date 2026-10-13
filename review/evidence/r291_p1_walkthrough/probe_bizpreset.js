'use strict';
// R291 · P1-② 离线探针：直查 assembleItems 的输出形状是否符合引擎契约
// 判据：var_items 的 key 必须 ⊆ VAR_KEYS；fixed_items 的 key 必须 ⊆ FIXED_KEYS
// 附「变异对照」：把 utility/manage 还原成改前的 form:'revenue_rate' ⇒ 探针必须转红（证非假绿）
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const BP = require(path.join(ROOT, 'utils', 'bizPreset.js'));

// 契约单源：cloudfunctions/*/cx_indicatorRef.js:121-122
const FIXED_KEYS = ['rent', 'labor', 'utility', 'manage', 'other'];
const VAR_KEYS = ['takeawayComm', 'grouponComm', 'cardFee', 'other'];
const COEF = BP.CITY_COEF.tier23;

function runCase(preset, input, tag) {
  const r = BP.assembleItems(preset, input, COEF);
  const badVar = r.varItems.filter((v) => VAR_KEYS.indexOf(v.key) < 0).map((v) => v.key);
  const badFixed = r.fixedItems.filter((f) => FIXED_KEYS.indexOf(f.key) < 0).map((f) => f.key);
  const get = (k) => { const h = r.fixedItems.filter((f) => f.key === k)[0]; return h ? h.fen : null; };
  return {
    tag: tag,
    presetKey: preset.presetKey,
    bizKey: preset.bizKey,
    varKeys: r.varItems.map((v) => v.key),
    fixedKeys: r.fixedItems.map((f) => f.key),
    badVar: badVar,
    badFixed: badFixed,
    utilityFen: get('utility'),
    manageFen: get('manage'),
    pass: badVar.length === 0 && badFixed.length === 0,
  };
}

const WITH_RENT = { area: 60, headcount: 3, rentYuan: 8000, fixedYuan: { rent: 8000 }, buildItems: [{ key: 'other', fen: 26200000, years: 3 }] };
const NO_RENT = { area: 60, headcount: 3, rentYuan: 0, fixedYuan: {}, buildItems: [] };

const out = { cases: [], mutants: [], summary: {} };
for (const p of BP.BIZ_PRESETS) {
  out.cases.push(runCase(p, WITH_RENT, 'rent=8000'));
  out.cases.push(runCase(p, NO_RENT, 'rent=0(找店/反推)'));
}
// 变异对照：还原改前写法
for (const p of BP.BIZ_PRESETS) {
  const m = JSON.parse(JSON.stringify(p));
  m.costMeta = m.costMeta.map((cm) => (cm.itemKey === 'utility' || cm.itemKey === 'manage')
    ? { itemKey: cm.itemKey, form: 'revenue_rate', pct: (cm.rentPct || 5), src: 'MUTANT' }
    : cm);
  out.mutants.push(runCase(m, WITH_RENT, 'MUTANT-revenue_rate'));
}

out.summary = {
  presetCount: BP.BIZ_PRESETS.length,
  presetKeys: BP.BIZ_PRESETS.map((p) => p.presetKey),
  casesAllPass: out.cases.every((c) => c.pass),
  casesFailList: out.cases.filter((c) => !c.pass).map((c) => c.presetKey + '/' + c.tag + ' badVar=' + JSON.stringify(c.badVar)),
  mutantsAllCaught: out.mutants.every((m) => m.badVar.length > 0),
  mutantsMissed: out.mutants.filter((m) => m.badVar.length === 0).map((m) => m.presetKey),
  utilityAllNonZero: out.cases.every((c) => c.utilityFen === null || c.utilityFen > 0),
  manageAllNonZero: out.cases.every((c) => c.manageFen === null || c.manageFen > 0),
};

console.log(JSON.stringify(out.summary, null, 1));
console.log('--- 明细 ---');
out.cases.forEach((c) => console.log(c.presetKey.padEnd(20), c.tag.padEnd(16), 'pass=' + c.pass, 'var=' + JSON.stringify(c.varKeys), 'util=' + c.utilityFen, 'mgr=' + c.manageFen));
console.log('--- 变异对照（应 badVar 非空）---');
out.mutants.forEach((c) => console.log(c.presetKey.padEnd(20), 'badVar=' + JSON.stringify(c.badVar), 'pass=' + c.pass));

fs.writeFileSync(path.join(__dirname, 'probe_bizpreset_report.json'), JSON.stringify(out, null, 2));
