// _r128_parity.js —— 手工行净料成本「前后端双实现」对拍（round128 收码复核）
//
// 被测两式：
//   [前端] pages/card/edit.js::manualNetUnitWan(元, y) = Math.round((p*10000)/(y/100))
//   [后端] cloudfunctions/saveCostCard/service.js::netUnitCostWan(分, 1, y)
//          = Math.round((分/100)/1/(y/100)*10000)
//
// 对拍口径：前端输入「元」（两位小数，真实输入形态）→ 分 = Math.round(元*100)
//           ⇒ 比较 前端式(元,y) 与 后端式(分,y) 是否恒等。
// 判据：任何一组不等 即 报红并列反例（金额静默偏差属最高级缺陷）。
//
// 运行： node _r128_parity.js <repo_root>

const path = require('path');
const ROOT = process.argv[2] || 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const { netUnitCostWan } = require(path.join(ROOT, 'cloudfunctions', 'saveCostCard', 'service.js'));

// 前端实现（逐字复刻 pages/card/edit.js:24-29；若该文件改动，本函数须同步核对）
function manualNetUnitWan(unitPriceYuan, yieldRate) {
  const p = Number(unitPriceYuan) || 0;
  const y = Number(yieldRate) || 100;
  if (p <= 0) return 0;
  return Math.round((p * 10000) / (y / 100));
}

let n = 0, diff = 0;
const samples = [];
// 1) 穷举式：整数元 0.05..200.00 步长 0.05 × 出成率 1..100（全覆盖骨架）
for (let cents = 5; cents <= 20000; cents += 5) {
  const yuan = cents / 100;
  for (let y = 1; y <= 100; y++) {
    n++;
    const a = manualNetUnitWan(yuan, y);
    const b = netUnitCostWan(Math.round(yuan * 100), 1, y);
    if (a !== b) { diff++; if (samples.length < 8) samples.push({ yuan, y, front: a, back: b }); }
  }
}
// 2) 随机小数元（两位）+ 随机出成率
let seed = 20260925;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (let i = 0; i < 200000; i++) {
  const cents = 1 + Math.floor(rnd() * 100000);        // 0.01 ~ 1000.00 元
  const yuan = cents / 100;
  const y = 1 + Math.floor(rnd() * 100);
  n++;
  const a = manualNetUnitWan(yuan, y);
  const b = netUnitCostWan(Math.round(yuan * 100), 1, y);
  if (a !== b) { diff++; if (samples.length < 8) samples.push({ yuan, y, front: a, back: b }); }
}
// 3) 一位小数 / 整数元
for (let cents = 100; cents <= 50000; cents += 100) {
  for (const y of [1, 2, 3, 7, 33, 50, 66, 75, 80, 90, 95, 99, 100]) {
    const yuan = cents / 100;
    n++;
    const a = manualNetUnitWan(yuan, y);
    const b = netUnitCostWan(Math.round(yuan * 100), 1, y);
    if (a !== b) { diff++; if (samples.length < 8) samples.push({ yuan, y, front: a, back: b }); }
  }
}

console.log('=== 对拍结果 ===');
console.log('  总组数 =', n);
console.log('  不一致 =', diff);
if (diff) { console.log('  反例（前 8 组）：'); samples.forEach(s => console.log('   ', JSON.stringify(s))); }

// 4) 边界：出成率 0 / 负 / 超 100 —— 记录两式行为（不判红，只取证）
console.log('');
console.log('=== 边界行为取证（出成率非法值）===');
for (const y of [0, -5, 101, 150, 0.0001]) {
  const a = manualNetUnitWan(10, y);           // 前端有 || 100 兜底
  const b = netUnitCostWan(1000, 1, y);         // 后端无兜底
  console.log(`  y=${String(y).padEnd(7)} 前端=${a}  后端=${b}${Number.isFinite(b) ? '' : '  ⚠️ 非有限数'}`);
}

console.log('');
console.log('==== 双实现对拍：' + (diff === 0 ? '恒等 ✅' : '存在 ' + diff + ' 处不等 ❌') + ' ====');
process.exit(diff === 0 ? 0 : 1);
