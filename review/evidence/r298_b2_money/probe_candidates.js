/**
 * R298 · B2 候选修法验证探针
 * 目标：证明「十进制安全 yuanToFen」相对现状是【严格改进 + 两位小数零漂移】。
 */
'use strict';

// ---- 现状实现（前后端两份，逐字相同）----
const cur = (yuan) => Math.round(yuan * 100);

// ---- 候选 A1：toFixed 消浮点噪声 ----
const A1 = (yuan) => Math.round(Number((yuan * 100).toFixed(10)));

// ---- 候选 A3：十进制字符串解析（彻底）----
function A3(yuan) {
  if (typeof yuan !== 'number' || !isFinite(yuan)) throw new Error('bad');
  const s = String(yuan);                       // JS 最短往返表示 ⇒ "1.005" 而非 "1.0049999999999999"
  if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) {   // 科学计数法 → 退回 A1
    return Math.round(Number((yuan * 100).toFixed(10)));
  }
  const neg = s[0] === '-';
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const intPart = dot < 0 ? body : body.slice(0, dot);
  const frac = dot < 0 ? '' : body.slice(dot + 1);
  // 只保留 2 位以上所需：整体放大 100 ⇒ 小数左移 2 位
  const shifted = frac.length <= 2
    ? intPart + frac.padEnd(2, '0')
    : intPart + frac.slice(0, 2) + '.' + frac.slice(2);
  const v = Number(shifted);
  const r = Math.round(v);
  return neg ? -r : r;
}

// ---- 十进制真值（用 BigInt 精确算，作为裁判）----
function truth(yuan) {
  const s = String(yuan);
  const neg = s[0] === '-';
  const body = neg ? s.slice(1) : s;
  const [i, f = ''] = body.split('.');
  const scaled = BigInt(i + f.padEnd(3, '0').slice(0, 3));  // 到厘（3 位）足够判半步
  const moreFrac = f.length > 3 ? f.slice(3) : '';
  // 用「乘 100 后的十进制精确值」判断四舍五入：看第 3 位小数（厘）
  const iBig = BigInt(i) * 100n;
  const f2 = f.slice(0, 2).padEnd(2, '0');
  const cent = iBig + BigInt(f2);
  const third = f.length > 2 ? Number(f[2]) : 0;
  const rest = f.length > 2 ? f.slice(3) : '';
  const restNonZero = /[1-9]/.test(rest);
  let r;
  if (third > 5) r = cent + 1n;
  else if (third < 5) r = cent;
  else r = restNonZero ? cent + 1n : (cent % 2n === 0n ? cent : cent + 1n); // 半步：看是否有后继非零
  // 半步且无后继 ⇒ 真「.5」⇒ 四舍五入（away from zero 对正数 = up）
  if (third === 5 && !restNonZero) r = cent + 1n;
  const out = Number(r);
  return neg ? -out : out;
}

let bad = [];
const report = [];

/* ---------- 测试 1：两位小数全域（0.00 ~ 9999.99，步长 1 分，全穷举 100 万点）---------- */
let t1n = 0, curBad1 = 0, a1Bad1 = 0, a3Bad1 = 0;
for (let f = 0; f <= 999999; f++) {
  const y = f / 100;
  t1n++;
  if (cur(y) !== f) curBad1++;
  if (A1(y) !== f) a1Bad1++;
  if (A3(y) !== f) a3Bad1++;
}
report.push(['两位小数穷举 0.00~9999.99（' + t1n + ' 点）', 'cur=' + curBad1, 'A1=' + a1Bad1, 'A3=' + a3Bad1]);

/* ---------- 测试 2：三位小数全域（x.xx0 ~ x.xx9；用整数构造避免构造偏差）---------- */
let t2n = 0, curBad2 = 0, a1Bad2 = 0, a3Bad2 = 0;
const curDiff = [];
for (let mil = 0; mil <= 200000; mil++) {          // 0.000 ~ 200.000（千分位）
  if (mil % 10 === 0) continue;                     // 跳过两位小数整倍（已在测试 1 覆盖）
  const y = Number((mil / 1000).toFixed(3));
  const want = truth(y);
  t2n++;
  const c = cur(y), a = A1(y), b = A3(y);
  if (c !== want) { curBad2++; if (curDiff.length < 8) curDiff.push(y + ' cur=' + c + ' want=' + want); }
  if (a !== want) a1Bad2++;
  if (b !== want) a3Bad2++;
}
report.push(['三位小数穷举 0.000~200.000（' + t2n + ' 点）', 'cur=' + curBad2, 'A1=' + a1Bad2, 'A3=' + a3Bad2]);

/* ---------- 测试 3：四位小数（x.xxxx）---------- */
let t3n = 0, curBad3 = 0, a1Bad3 = 0, a3Bad3 = 0;
for (let w = 0; w <= 50000; w++) {
  if (w % 10 === 0) continue;
  const y = Number((w / 10000).toFixed(4));
  const want = truth(y);
  t3n++;
  if (cur(y) !== want) curBad3++;
  if (A1(y) !== want) a1Bad3++;
  if (A3(y) !== want) a3Bad3++;
}
report.push(['四位小数穷举 0.0000~5.0000（' + t3n + ' 点）', 'cur=' + curBad3, 'A1=' + a1Bad3, 'A3=' + a3Bad3]);

/* ---------- 测试 4：真正会踩的半步集合（人工列举）---------- */
const HALF = [1.005, 2.675, 8.575, 1.015, 4.015, 5.015, 1.115, 2.225, 3.335, 7.995, 12.345, 99.995,
  0.005, 0.015, 0.025, 0.035, 0.045, 0.055, 0.065, 0.075, 0.085, 0.095];
let t4cur = 0, t4a1 = 0, t4a3 = 0;
HALF.forEach((y) => {
  const want = truth(y);
  if (cur(y) !== want) { t4cur++; bad.push('半步 cur 错: ' + y + ' → ' + cur(y) + ' 真值 ' + want); }
  if (A1(y) !== want) t4a1++;
  if (A3(y) !== want) t4a3++;
});
report.push(['人工半步集合（' + HALF.length + ' 点）', 'cur错=' + t4cur, 'A1错=' + t4a1, 'A3错=' + t4a3]);

/* ---------- 测试 5：A1 vs A3 是否等价（若等价 ⇒ 选简单的 A1）---------- */
let eq = 0, neq = 0, neqSample = [];
for (let f = 0; f <= 300000; f++) {
  const y = f / 100;
  if (A1(y) !== A3(y)) { neq++; if (neqSample.length < 5) neqSample.push(y + ' A1=' + A1(y) + ' A3=' + A3(y)); }
  else eq++;
}
for (let m = 0; m <= 100000; m++) {
  const y = Number((m / 1000).toFixed(3));
  if (A1(y) !== A3(y)) { neq++; if (neqSample.length < 5) neqSample.push(y + ' A1=' + A1(y) + ' A3=' + A3(y)); }
  else eq++;
}
report.push(['A1 ≡ A3 对照（' + (eq + neq) + ' 点）', '相等=' + eq, '不等=' + neq, neqSample.join(' | ')]);

/* ---------- 测试 6：非数/边界 ---------- */
const EDGE = [0, -0, 1e-7, 1e-8, 0.1, 0.2, 0.3, 1 / 3, 2 / 3, 1e10, 1e15, 123456789.01];
console.log('\n=== 边界样本（A1 vs A3 vs cur）===');
EDGE.forEach((y) => {
  console.log('  y=' + String(y).padEnd(16) + ' cur=' + String(cur(y)).padEnd(18) + ' A1=' + String(A1(y)).padEnd(18) + ' A3=' + String(A3(y)));
});

/* ---------- 输出 ---------- */
console.log('\n' + '='.repeat(96));
console.log('测试项'.padEnd(44) + '现状(cur)'.padEnd(16) + '候选A1'.padEnd(16) + '候选A3');
console.log('-'.repeat(96));
report.forEach(([n, a, b, c]) => console.log(String(n).padEnd(42) + String(a).padEnd(16) + String(b).padEnd(16) + String(c)));

console.log('\n=== 现状实错样例（前 8）===');
curDiff.forEach((d) => console.log('  ' + d));
bad.forEach((d) => console.log('  ' + d));

const fail = curBad2 + curBad3 === 0 && a1Bad2 + a1Bad3 + a1Bad1 === 0;
console.log('\n结论：候选 A1 ' + (a1Bad1 + a1Bad2 + a1Bad3 === 0 ? '✅ 全域零错' : '❌ 仍有错 ' + (a1Bad1 + a1Bad2 + a1Bad3)) +
  '；现状 cur 在三位/四位小数上共错 ' + (curBad2 + curBad3) + ' 点');
process.exit(0);
