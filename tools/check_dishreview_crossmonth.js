// 跨月区间分摊守卫（R748 · 2026-11-17 交叉审计 G1）
//
// 守的是什么事故：堂食《菜品销售统计》是 **7 天区间汇总表**，落库 `biz_date` = 区间**末日**
//   （`importSalesBill/service.js::extractBizDate`，为幂等刻意如此）。
//   `getDishReview::filterByRange` 曾经**只按 `biz_date` 单点过滤** ⇒
//   一张 `2026-10-28 ~ 2026-11-03` 的表在 **10 月查不到**、在 **11 月整段计入**：
//     实测（修复前）：查 10 月 ⇒ rows=0 ；查 11 月 ⇒ rows=1 / qty=700
//   ⇒ 每月约一张跨月表，那 4~6 天的堂食销量与毛利**静默错月**，零报错零提示。
//   而同仓 `getSalesBills` 用的是**区间双端**判定 ⇒ 两处口径分叉（本仓最忌的两份真相）。
//
// 判据（三层，缺一层就会被"改回去也不报红"蒙过去）：
//   A 跨月正确：10 月拿 4/7、11 月拿 3/7；B 跨年正确；C 守恒（各月相加 ≡ 原值）；
//   D 零回归（整月内区间 / 逐日行必须与改动前**逐字等价**）；
//   E 覆盖天数不重复（切段后 period 收窄 ⇒ 两个月各算各的天数，不把 7 天算两次）；
//   F 判据有牙（用"旧实现"复算一遍，证明本守卫能区分新旧的差异，而不是恒真）。
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const S = require(path.join(ROOT, 'cloudfunctions/getDishReview/service.js'));

let pass = 0;
let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function mkRow(o) {
  return Object.assign({
    platform: 'pos', dish_key: 'D1', name: '红烧肉', qty: 700, amount: 70000,
    granularity: 'interval',
  }, o);
}
function sumQty(rows) { return (rows || []).reduce((s, r) => s + (Number(r.qty) || 0), 0); }
function sumAmt(rows) { return (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0); }

// ===================== A 组：跨月分摊 =====================
console.log('\n=== A 组 跨月区间分摊（10-28 ~ 11-03，共 7 天）===');
const cross = mkRow({ biz_date: '2026-11-03', period_from: '2026-10-28', period_to: '2026-11-03' });
const oct = S.filterByRange([cross], '2026-10-01', '2026-10-31');
const nov = S.filterByRange([cross], '2026-11-01', '2026-11-30');

ok('A-① 10 月不再为 0（旧行为 rows=0）', oct.rows.length > 0, 'rows=' + oct.rows.length);
ok('A-② 10 月只拿 4/7 的量（700×4/7=400）', sumQty(oct.rows) === 400, 'qty=' + sumQty(oct.rows));
ok('A-③ 11 月只拿 3/7 的量（700×3/7=300）', sumQty(nov.rows) === 300, 'qty=' + sumQty(nov.rows));
ok('A-④ 金额同步分摊（70000 → 40000 / 30000）',
  sumAmt(oct.rows) === 40000 && sumAmt(nov.rows) === 30000,
  'oct=' + sumAmt(oct.rows) + ' nov=' + sumAmt(nov.rows));
ok('A-⑤ 两月相加 ≡ 原值（守恒）',
  sumQty(oct.rows) + sumQty(nov.rows) === 700 && sumAmt(oct.rows) + sumAmt(nov.rows) === 70000);

// ===================== B 组：跨年 =====================
console.log('\n=== B 组 跨年区间（2026-12-29 ~ 2027-01-04，共 7 天）===');
const yr = mkRow({ biz_date: '2027-01-04', period_from: '2026-12-29', period_to: '2027-01-04' });
const dec = S.filterByRange([yr], '2026-12-01', '2026-12-31');
const jan = S.filterByRange([yr], '2027-01-01', '2027-01-31');
ok('B-① 2026-12 拿到 3 天（12-29~12-31）', sumQty(dec.rows) === 300, 'qty=' + sumQty(dec.rows));
ok('B-② 2027-01 拿到 4 天（01-01~01-04）', sumQty(jan.rows) === 400, 'qty=' + sumQty(jan.rows));
ok('B-③ 跨年两月相加 ≡ 原值', sumQty(dec.rows) + sumQty(jan.rows) === 700);

// ===================== C 组：守恒（随机 200 组，含除不尽的尾差） =====================
console.log('\n=== C 组 守恒性质（200 组随机区间，含除不尽尾差）===');
let bad = 0;
let checked = 0;
const seeds = [1, 7, 13, 29, 31, 47, 59, 71, 83, 97];
for (let i = 0; i < 200; i++) {
  const len = 2 + (i % 12);                                  // 区间 2~13 天
  const qty = seeds[i % seeds.length] * (1 + (i % 9));       // 常见除不尽
  const amt = qty * 97 + (i % 7);
  const startMonth = 1 + (i % 12);
  const startDay = 20 + (i % 9);
  const from = '2026-' + String(startMonth).padStart(2, '0') + '-' + String(startDay).padStart(2, '0');
  const toMs = Date.parse(from + 'T00:00:00Z') + (len - 1) * 86400000;
  const to = new Date(toMs).toISOString().slice(0, 10);
  const row = mkRow({ biz_date: to, period_from: from, period_to: to, qty: qty, amount: amt });
  // 逐月查询，把每月的量加起来
  let sumQ = 0;
  let sumA = 0;
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let k = 0; k < 24; k++) {
    const ym = y + '-' + String(m).padStart(2, '0');
    const mb = S.monthBounds(ym);
    const r = S.filterByRange([row], mb[0], mb[1]);
    sumQ += sumQty(r.rows);
    sumA += sumAmt(r.rows);
    if (ym >= to.slice(0, 7)) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  checked++;
  if (sumQ !== qty || sumA !== amt) bad++;
}
ok('C-① 逐月相加恒 ≡ 原值（' + checked + ' 组，尾差倒挤生效）', bad === 0, '不守恒 ' + bad + ' 组');

// ===================== D 组：零回归（改动前逐字等价） =====================
console.log('\n=== D 组 零回归（不该被改到的地方一个数都不许动）===');
const inside = mkRow({ biz_date: '2026-11-07', period_from: '2026-11-01', period_to: '2026-11-07' });
const r1 = S.filterByRange([inside], '2026-11-01', '2026-11-30');
ok('D-① 区间整段落在查询内 ⇒ 原样（qty 不变、biz_date 不变、无 prorated 标记）',
  r1.rows.length === 1 && r1.rows[0].qty === 700 && r1.rows[0].biz_date === '2026-11-07'
  && !r1.rows[0].prorated);

const daily = [];
for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) {
  daily.push(mkRow({ biz_date: d, granularity: 'daily', platform: 'meituan', qty: 100, amount: 10000 }));
}
const r2 = S.filterByRange(daily, '2026-11-01', '2026-11-30');
ok('D-② 逐日行不受影响（3 行 / 300）', r2.rows.length === 3 && sumQty(r2.rows) === 300);

const legacy = mkRow({ biz_date: '2026-11-05', granularity: 'unknown', qty: 500, amount: 50000 });
const r3 = S.filterByRange([legacy], '2026-11-01', '2026-11-30');
ok('D-③ 历史行（granularity 缺失）仍按单日计，不参与分摊',
  r3.rows.length === 1 && r3.rows[0].qty === 500);

const r4 = S.filterByRange([cross], '2026-12-01', '2026-12-31');
ok('D-④ 完全不相交 ⇒ 剔除（不许留 0 值行）', r4.rows.length === 0);

// ===================== E 组：覆盖天数不重复计 =====================
console.log('\n=== E 组 覆盖天数（切段后 period 收窄，7 天不许被算两次）===');
const csOct = S.coverageStats(oct.rows);
const csNov = S.coverageStats(nov.rows);
ok('E-① 10 月 coveredDays=4（不是 7）', csOct.coveredDays === 4, JSON.stringify(csOct));
ok('E-② 11 月 coveredDays=3（不是 7）', csNov.coveredDays === 3, JSON.stringify(csNov));
ok('E-③ 两个月 coveredDays 相加 = 7（不重复、不丢失）',
  csOct.coveredDays + csNov.coveredDays === 7);

// ===================== F 组：判据有牙（用旧实现复算，证明能区分） =====================
console.log('\n=== F 组 判据有牙（旧实现 = 只按 biz_date 单点）===');
function legacyFilter(rows, f, t) {
  return (rows || []).filter((s) => {
    const d = (s && s.biz_date == null ? '' : String(s.biz_date)).trim();
    return !!d && d >= f && d <= t;
  });
}
const oldOct = legacyFilter([cross], '2026-10-01', '2026-10-31');
ok('F-① 旧实现在 10 月确实返回 0 行（若判据恒真就不会有这条差异）', oldOct.length === 0,
  'oldRows=' + oldOct.length);
ok('F-② 新实现 ≠ 旧实现（本守卫能抓住"改回去"这种回归）',
  sumQty(oct.rows) !== sumQty(oldOct), 'new=' + sumQty(oct.rows) + ' old=' + sumQty(oldOct));

// ===================== G 组：极端与非法输入 fail-closed =====================
console.log('\n=== G 组 非法输入不许崩、不许瞎算 ===');
const noFrom = mkRow({ biz_date: '2026-11-03', period_from: '', period_to: '2026-11-03' });
const g1 = S.filterByRange([noFrom], '2026-10-01', '2026-10-31');
ok('G-① interval 但缺 period_from ⇒ 按单日（biz_date）处理，不猜', g1.rows.length === 0);

const reversed = mkRow({ biz_date: '2026-11-03', period_from: '2026-11-05', period_to: '2026-11-01' });
ok('G-② period 反了 ⇒ splitIntervalByMonth 返回空（不崩、不瞎切）',
  S.splitIntervalByMonth(reversed).length === 0);

ok('G-③ 单日区间（from==to）⇒ 一整段、不做除法',
  (() => {
    const p = S.splitIntervalByMonth(mkRow({ period_from: '2026-11-02', period_to: '2026-11-02', qty: 5, amount: 500 }));
    return p.length === 1 && p[0].qty === 5 && p[0].amount === 500 && p[0].days === 1;
  })());

console.log('\n===== 跨月区间分摊守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
