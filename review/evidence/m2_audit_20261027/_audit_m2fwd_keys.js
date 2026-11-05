// _audit_m2fwd_keys.js —— 只读取证：M2 forward 路径的「读到的键」vs「映射的键」差集扫描
//   读取方：index.wxml 里的 {{t.X}} / {{item...}}，index.js 里的 T.X / this.data.t.X / M.X
//   映射方：index.js data.t = { ... }（PAGE.data.t 的实际键）
const fs = require('fs');
const path = require('path');
const { PAGE } = require('./_audit_m2fwd_harness.js');

const DIR = path.join(__dirname, 'subpkg/tools/sandbox');
const wxml = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8');
const js = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');

// 1) data.t 实际映射的键
const tKeys = Object.keys(PAGE.data.t);
const tSet = new Set(tKeys);

// 2) wxml 里 t.X / T.X 的读取（含 {{t.x.y}} 只取首段）
const readWxml = new Map();
const re1 = /\bt\.([A-Za-z_][A-Za-z0-9_]*)/g;
let m;
while ((m = re1.exec(wxml)) !== null) {
  const k = m[1];
  const line = wxml.slice(0, m.index).split('\n').length;
  if (!readWxml.has(k)) readWxml.set(k, line);
}

// 3) js 里 T.X / this.data.t.X / t.X
const readJs = new Map();
const re2 = /\b(?:T|(?:\bt))\.(?:fixedItems|bizTypes|bizPresets|presetDisplay|indNames|indLevels|indLevelsGain|buildItems|buildItemNotes|varItems|verdictNoteByItem|cityTiers)\./g;
// （上面这些是"字典容器"，其下的二级键单独核；先收一级键）
const re3 = /\bT\.([A-Za-z_][A-Za-z0-9_]*)/g;
while ((m = re3.exec(js)) !== null) {
  const k = m[1];
  const line = js.slice(0, m.index).split('\n').length;
  if (!readJs.has(k)) readJs.set(k, line);
}
const re4 = /this\.data\.t\.([A-Za-z_][A-Za-z0-9_]*)/g;
while ((m = re4.exec(js)) !== null) {
  const k = m[1];
  const line = js.slice(0, m.index).split('\n').length;
  if (!readJs.has(k)) readJs.set(k, line);
}

const allRead = new Map();
for (const [k, v] of readWxml) if (!allRead.has(k)) allRead.set(k, 'wxml:' + v);
for (const [k, v] of readJs) if (!allRead.has(k)) allRead.set(k, 'js:' + v);

const missing = [];
for (const [k, where] of allRead) {
  if (!tSet.has(k)) missing.push([k, where]);
}

console.log('=== data.t 映射键数 = ' + tKeys.length + '；读取到的键数 = ' + allRead.size + ' ===');
console.log('\n--- 【差集】读取了但 data.t 里没有（恒 undefined ⇒ 静默空白）---');
if (!missing.length) console.log('   （无）');
missing.forEach(([k, w]) => console.log('   ' + k.padEnd(28) + w));

const unused = tKeys.filter((k) => !allRead.has(k));
console.log('\n--- 【反向差集】映射了但全页无读取（僵尸映射，仅供参考）---');
console.log('   共 ' + unused.length + ' 个');
console.log('   ' + unused.join(', '));

// 4) 二级字典键：t.fixedItems[x] / t.indNames[x] 等
console.log('\n--- 字典容器二级键核对 ---');
const containers = ['fixedItems', 'bizTypes', 'bizPresets', 'presetDisplay', 'indNames',
  'indLevels', 'indLevelsGain', 'buildItems', 'buildItemNotes', 'varItems', 'verdictNoteByItem', 'cityTiers'];
for (const c of containers) {
  const v = PAGE.data.t[c];
  if (!v) { console.log('   ★ t.' + c + ' 未映射（data.t 里没有该键）'); continue; }
  if (typeof v !== 'object') { console.log('   t.' + c + ' = ' + JSON.stringify(v) + '（非对象）'); continue; }
  console.log('   t.' + c + ' = ' + Object.keys(v).length + ' 键: ' + Object.keys(v).join(','));
}
