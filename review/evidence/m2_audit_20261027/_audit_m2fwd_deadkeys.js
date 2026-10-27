// _audit_m2fwd_deadkeys.js —— 只读取证：index.js `data.t` 里「映射了但无人读」的死键判定
const fs = require('fs');
const path = require('path');
const { PAGE } = require('./_audit_m2fwd_harness.js');

const DIR = path.join(__dirname, 'subpkg/tools/sandbox');
const wxml = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8');
const js = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
const tKeys = Object.keys(PAGE.data.t);

// ---- 读取方：wxml 的 t.X / js 的 T.X、this.data.t.X、t.X ----
const read = new Set();
let m;
const re1 = /\bt\.([A-Za-z_][A-Za-z0-9_]*)/g;
while ((m = re1.exec(wxml)) !== null) read.add(m[1]);
const re2 = /\bT\.([A-Za-z_][A-Za-z0-9_]*)/g;
while ((m = re2.exec(js)) !== null) read.add(m[1]);
const re3 = /this\.data\.t\.([A-Za-z_][A-Za-z0-9_]*)/g;
while ((m = re3.exec(js)) !== null) read.add(m[1]);
const re4 = /(^|[^A-Za-z0-9_.])t\.([A-Za-z_][A-Za-z0-9_]*)/g;
while ((m = re4.exec(js)) !== null) read.add(m[2]);

// ---- 动态取值排查（wxml 的 t[...]、js 的 t[xxx]）----
const dynWxml = (wxml.match(/\bt\s*\[/g) || []).length;
const dynJs = (js.match(/\b(?:T|t)\s*\[/g) || []).length;
console.log('=== 动态取值排查 ===');
console.log('   index.wxml 里 `t[` 出现次数 = ' + dynWxml);
console.log('   index.js   里 `T[`/`t[` 出现次数 = ' + dynJs);

const dead = tKeys.filter((k) => !read.has(k));
console.log('\n=== data.t 映射键 ' + tKeys.length + ' 个；被读取 ' + (tKeys.length - dead.length)
  + ' 个；疑似死键 ' + dead.length + ' 个 ===');

// ---- 分类：术语在别处是否仍被使用 ----
const { TERMS } = require('./miniprogram/i18n/terms.js');
const M = TERMS.m2;
// index.js 里 M.X 引用 —— ⚠️ 必须**剔除 data.t 映射块**本身（那一行 `xxx: M.xxx` 不是"使用"）
const lines = js.split('\n');
const tStart = lines.findIndex((l) => /^\s{4}t:\s*\{/.test(l));
let tEnd = -1;
if (tStart >= 0) {
  for (let i = tStart + 1; i < lines.length; i++) {
    if (/^\s{4}\},?\s*$/.test(lines[i])) { tEnd = i; break; }
  }
}
const jsNoT = (tStart >= 0 && tEnd > tStart)
  ? lines.slice(0, tStart).concat(lines.slice(tEnd + 1)).join('\n') : js;
console.log('（已剔除 data.t 映射块：index.js 第 ' + (tStart + 1) + '~' + (tEnd + 1) + ' 行）');
const mRead = new Set();
const reM = /\bM\.([A-Za-z_][A-Za-z0-9_]*)/g;
while ((m = reM.exec(jsNoT)) !== null) mRead.add(m[1]);
// 全前端仓（pages/ + subpkg/）是否引用该术语字符串（按 terms 值反查太宽，按 key 名在别处出现计数）
const allSrc = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(js|wxml)$/.test(f)) allSrc.push([p, fs.readFileSync(p, 'utf8')]);
  }
};
walk(path.join(__dirname, 'pages'));
walk(path.join(__dirname, 'subpkg'));

const A = [], B = [];
for (const k of dead) {
  const usedByM = mRead.has(k);                    // index.js 里用 M.<k> 直接取（术语仍在用）
  let usedElsewhere = false;
  const re = new RegExp('\\b' + k + '\\b');
  for (const [p, src] of allSrc) {
    if (p.indexOf('sandbox/index') >= 0) continue;
    if (re.test(src)) { usedElsewhere = true; break; }
  }
  (usedByM || usedElsewhere ? A : B).push(k + (usedByM ? '（M. 直取）' : '（别页引用）'));
}
console.log('\n--- A 类：t 映射是死的，但**术语本身仍在用**（只删 index.js 里的 t 映射，terms.js 保留）---');
console.log('   共 ' + A.length + ' 个：\n   ' + A.join(', '));
console.log('\n--- B 类：术语全仓无人用（t 映射 + terms.js 定义可一并清理）---');
console.log('   共 ' + B.length + ' 个：\n   ' + (B.length ? B.join(', ') : '（无）'));

// 按前缀归组，便于判断"哪个已下线功能的残留"
const group = {};
for (const k of dead) {
  const g = k.replace(/(Title|Note|Label|Lbl|Text|Hint|Unit|Ph|Sub|Name|Pre|Suf|Head|Body|Good|Ok|Warn|Bad|Na|Options|Opts|Label2|Note2)$/, '');
  const key = k.match(/^(verdict|turn|revTurn|revRent|rev[A-Z]|fwd|stick|promo|channel|sens|l1|l2|preset|ind|plan|fee|safe|draft|sec|band|target|fixed|build|other|missing|biz)/);
  const gk = key ? key[1] : k.slice(0, 6);
  (group[gk] = group[gk] || []).push(k);
}
console.log('\n--- 死键按功能族归组 ---');
for (const g of Object.keys(group).sort()) console.log('   ' + g.padEnd(10) + group[g].length + ' 个：' + group[g].join(', '));
