// _m3/_probe_index_fields.js —— 探测：每条索引的字段，是否真的在该集合的代码用法里出现
// 目的：在写守卫前确认「判据是否可行且不会误伤」。不改任何文件。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { INDEXES } = require(path.join(ROOT, 'cloudfunctions/initDb/collections.js'));

const SKIP_DIRS = new Set(['node_modules', '.git', '_bak_r70', '_qr_archive', '.inscode', 'review', '_m3', 'specs', 'web-preview', 'admin-h5', 'pages', 'utils']);
const CF = path.join(ROOT, 'cloudfunctions');

function stripComments(src) {
  return String(src || '').split(/\r?\n/).map((l) => l.replace(/(^|[^:"'`])\/\/[^\n]*$/, '$1')).join('\n');
}

// 收集 cloudfunctions/**/*.js（排除 common 派生副本自身）
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (SKIP_DIRS.has(e.name)) continue; walk(p); }
    else if (/\.js$/.test(e.name) && !/^cx_/.test(e.name) && e.name !== 'common.js') files.push(p);
  }
})(CF);

// coll -> Set(字段名)
const used = new Map();
const addUsed = (coll, name) => {
  if (!used.has(coll)) used.set(coll, new Set());
  used.get(coll).add(name);
};

// 形态①：da.list/da.listAll/da.insert/da.listIncludingDeleted('coll', { a: ..., b: ... })
const RE_DA = /\.(?:list|listAll|listIncludingDeleted|insert|softDelete|get)\s*\(\s*['"]([a-z_]+)['"]\s*(?:,\s*([\s\S]{0,400}?))?\)/g;
// 形态②：db.collection('coll').where({...})
const RE_DB = /\.collection\s*\(\s*['"]([a-z_]+)['"]\s*\)\s*\.\s*(?:where|field)\s*\(\s*\{([\s\S]{0,400}?)\}/g;

function fieldsOf(objText) {
  const out = [];
  if (!objText) return out;
  const re = /(?:^|[{,\s])([a-z_][a-z0-9_]*)\s*:/g;
  let m;
  while ((m = re.exec(objText))) out.push(m[1]);
  return out;
}

let fileCount = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  if (!raw.includes('shop_')) continue;
  fileCount++;
  const src = stripComments(raw);
  let m;
  RE_DA.lastIndex = 0;
  while ((m = RE_DA.exec(src))) {
    const coll = m[1];
    if (!/^shop_|^audit_|^feature_|^subscription_/.test(coll)) continue;
    for (const fld of fieldsOf(m[2])) addUsed(coll, fld);
  }
  RE_DB.lastIndex = 0;
  while ((m = RE_DB.exec(src))) {
    for (const fld of fieldsOf(m[2])) addUsed(m[1], fld);
  }
}

console.log('扫描文件数（含 shop_ 的云函数源）=', fileCount);
console.log('集合用法表命中数 =', used.size);
console.log('');

let fossil = 0, alive = 0, noData = 0;
for (const coll of Object.keys(INDEXES)) {
  const set = used.get(coll);
  for (const ix of INDEXES[coll]) {
    for (const fld of Object.keys(ix.keys)) {
      const hit = set && set.has(fld);
      if (!set || set.size === 0) { noData++; console.log(`  ?  ${coll}.${ix.name} ← ${fld}  （该集合无用法样本）`); }
      else if (hit) { alive++; }
      else { fossil++; console.log(`  ✗  ${coll}.${ix.name} ← ${fld}  **该字段不在用法表里**（用法表：${[...set].join(', ')}）`); }
    }
  }
}
console.log('');
console.log(`索引字段合计：alive=${alive} / 化石=${fossil} / 无样本=${noData}`);
