/**
 * R298 · B2「金额精度」行为级探针
 * 真跑 cloudfunctions/common/money.js（不静态推断），穷举浮点边界。
 */
'use strict';
const path = require('path');
const fs = require('fs');
// ROOT：向上找 `verify_all.js`（仓根哨兵）—— 本件位于 review/evidence/** 下，
//   按固定层数回退会算错（_probe_tmp/ 是 1 层、本目录是 3 层）。
function findRoot(start) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, 'verify_all.js'))) return d;
    const p = path.dirname(d);
    if (p === d) throw new Error('未找到仓根（缺 verify_all.js 哨兵）');
    d = p;
  }
}
const ROOT = findRoot(__dirname);
const M = require(path.join(ROOT, 'cloudfunctions/common/money.js'));

let bad = [];
const chk = (label, got, want) => {
  const ok = Object.is(got, want);
  if (!ok) bad.push({ label, got, want });
  console.log('  ' + (ok ? 'OK  ' : 'FAIL') + '  ' + label.padEnd(52) + ' got=' + String(got).padEnd(22) + ' want=' + want);
};

console.log('=== 1) yuanToFen：半步边界（x.xx5）—— IEEE754 经典坑 ===');
// 这些数在十进制下「恰好是半步」，Math.round 应向上进位
const HALF = [1.005, 2.675, 8.575, 1.015, 4.015, 5.015, 0.005, 0.015, 0.025, 0.035, 1.115, 2.225, 3.335];
HALF.forEach((y) => {
  const exact = Math.round(Number((y * 100).toFixed(10)));   // 十进制真值
  const real = M.yuanToFen(y);
  chk('yuanToFen(' + y + ')', real, exact);
});

console.log('\n=== 2) 两位小数输入（老板日常输入形态）—— 应当 100% 正确 ===');
let r2bad = 0, r2n = 0;
for (let f = 0; f <= 2000; f++) {
  const y = Number((f / 100).toFixed(2));   // 0.00 .. 20.00
  r2n++;
  if (M.yuanToFen(y) !== f) { r2bad++; if (r2bad <= 5) console.log('   FAIL  y=' + y + ' got=' + M.yuanToFen(y) + ' want=' + f); }
}
console.log('  两位小数往返 ' + r2n + ' 点：失败 ' + r2bad);
if (r2bad) bad.push({ label: '两位小数往返 ' + r2bad + '/' + r2n, got: r2bad, want: 0 });

console.log('\n=== 3) 三位小数输入（用户可能粘贴/计算得来）—— 观察方向 ===');
[0.001, 0.004, 0.005, 0.006, 0.009, 1.001, 1.005, 1.009, 19.999, 19.995].forEach((y) => {
  const exact = Math.round(Number((y * 100).toFixed(10)));
  const real = M.yuanToFen(y);
  const mark = real === exact ? 'OK  ' : 'FAIL';
  console.log('  ' + mark + '  yuanToFen(' + String(y).padEnd(8) + ') got=' + String(real).padEnd(6) + ' 十进制真值=' + exact + (real !== exact ? '   ← 浮点截断' : ''));
  if (real !== exact) bad.push({ label: 'yuanToFen(' + y + ')', got: real, want: exact });
});

console.log('\n=== 4) fenToYuan ∘ yuanToFen 往返恒等性 ===');
let rtbad = 0;
for (let f = 0; f <= 100000; f += 7) {
  if (M.yuanToFen(M.fenToYuan(f)) !== f) { rtbad++; if (rtbad <= 3) console.log('   FAIL  fen=' + f + ' → ' + M.fenToYuan(f) + ' → ' + M.yuanToFen(M.fenToYuan(f))); }
}
console.log('  往返 ' + Math.floor(100000 / 7) + ' 点（步长 7）：失败 ' + rtbad);
if (rtbad) bad.push({ label: 'fen→yuan→fen 往返', got: rtbad, want: 0 });

console.log('\n=== 5) fenToYuan 返回值本身是否"表面二位、实际长尾" ===');
[1, 10, 1234, 99999, 3, 7, 101, 123456].forEach((f) => {
  const y = M.fenToYuan(f);
  const s = String(y);
  const long = s.length > String(Math.round(f / 100 * 100) / 100).length && /\.\d{3,}/.test(s);
  console.log('   fen=' + String(f).padEnd(8) + ' → ' + s + (s.includes('.') && s.split('.')[1].length > 2 ? '   ← 长尾' : ''));
});

console.log('\n=== 6) tailDifference 尾差倒挤：sum(out) === totalFen 是否恒等 ===');
let tdbad = 0;
for (let n = 1; n <= 12; n++) {
  for (let t = 0; t <= 500; t++) {
    const alloc = new Array(n).fill(Math.floor(t / n));
    const out = M.tailDifference(alloc, t);
    const s = out.reduce((a, b) => a + b, 0);
    if (s !== t || out.length !== n) { tdbad++; if (tdbad <= 3) console.log('   FAIL  n=' + n + ' total=' + t + ' sum=' + s); }
  }
}
console.log('  尾差倒挤 12×501 组：失败 ' + tdbad);
if (tdbad) bad.push({ label: 'tailDifference 恒等', got: tdbad, want: 0 });

console.log('\n=== 7) tailDifference 边界：空数组 / 非数字元素 ===');
console.log('   空数组 → ' + JSON.stringify(M.tailDifference([], 100)));
console.log('   null   → ' + JSON.stringify(M.tailDifference(null, 100)));
console.log('   [0,"5",null] total=100 → ' + JSON.stringify(M.tailDifference([0, '5', null], 100)));

console.log('\n=== 8) fenRound：非整数分的行为 ===');
[1.4, 1.5, 2.5, -1.5, -2.5, 0.5, -0.5].forEach((f) => {
  console.log('   fenRound(' + String(f).padEnd(5) + ') = ' + M.fenRound(f));
});

console.log('\n' + '='.repeat(70));
console.log(bad.length === 0 ? '结论：全部如期（无差异）' : ('结论：发现 ' + bad.length + ' 处差异：'));
bad.forEach((b) => console.log('  · ' + b.label + '  got=' + b.got + ' want=' + b.want));
process.exit(bad.length ? 1 : 0);
