/**
 * R236 探针 —— M2 反推「翻台率」的底座敏感性（只读实跑，不改任何源码）
 *
 * 目的：回答李老师 2026-10-08 的问题 ——「翻台率指标可以不要吗？」
 *   他的理由：① 每店厨房占比不同 ⇒ 座位数变动特别大；② 翻台率前提是确定桌数，而桌数与面积无强关联（有包间）。
 *
 * 做法（仓内铁律：一切数字来自生产引擎真实输出，不手算、不照源码推演）：
 *   1) 用 r219 锚点的同一组入参（R=100,000 元）**只动 seats**，看 turn_rate / warn_keys 怎么走；
 *   2) 验证 `validate` 对 seats 的 fail-closed 约束（seats=0 直接拒）；
 *   3) 用 `utils/bizPreset.js::SEAT_DENSITY` 把「同一间 60㎡ 铺子」换算成不同业态的座位数区间；
 *   4) 结论：同一个营收目标下，**翻台率与红警完全由"猜出来的座位数"驱动**。
 *
 * 输出：stdout + 同目录 probe_turn.out.txt
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..'); // r236_m2_turn → evidence → review → 仓根
const SVC = path.join(ROOT, 'cloudfunctions/calcSandbox/service.js');
const VAL = path.join(ROOT, 'cloudfunctions/calcSandbox/validate.js');
const BP = path.join(ROOT, 'utils/bizPreset.js');

const lines = [];
function say(s) { lines.push(s); console.log(s); }

const svc = require(SVC);
const val = require(VAL);
let bp = null;
try { bp = require(BP); } catch (e) { bp = null; }

// ---- r219 锚点同源入参（B-① 已钉：R = 10,000,000 分 = 100,000 元）----
// 🔴 validate 收的是**前端 snake_case 原始 event**（shop_id / city_tier / biz_type / build_items /
//    fixed_items / var_items / gross_margin_pct / target_profit_fen + 反推五件），
//    返回 { error, clean }；clean 才是喂给 service 的形态（camelCase + snake 混合）。
const BASE = {
  shop_id: 'PROBE_R236',
  mode: 'reverse', city_tier: 'tier23', biz_type: 'dining', build_items: [],
  gross_margin_pct: 60, target_profit_fen: 2000000,
  rev_price_fen: 4500, target_rent_rate: 12, pixel_eff_fen: 0,
  fixed_items: [{ key: 'labor', fen: 2800000 }], var_items: [], open_days: 30,
};
function run(seats) {
  const src = Object.assign({}, BASE, { seats: seats });
  const v = val.validateInput(src);
  if (v.error) return { err: v.msg || v.error };
  return svc.calcSandboxReverse(v.clean);
}
const yuan = (fen) => (fen == null ? 'null' : (fen / 100).toFixed(2));

say('===== 0. 底座（只动 seats，其它入参全同）=====');
const r0 = run(20);
say('  R = ' + yuan(r0.target_monthly_fen) + ' 元 | 房租上限 = ' + yuan(r0.rent_cap_fen)
  + ' 元 | 日均客流 = ' + r0.daily_traffic + ' 人 | 客单价 45 元');
say('  ⇒ 月客流 = R/客单价 = ' + r0.monthly_traffic + ' 人；日均 = ' + r0.daily_traffic + ' 人（与 seats 无关）');
say('');

say('===== 1. seats 扫描：同一个店、同一个营收目标 =====');
say('  seats   日均客流   翻台率     warn_keys      红警?');
const SWEEP = [6, 8, 9, 12, 20, 26, 30, 37, 50, 60, 100];
const rows = [];
for (const s of SWEEP) {
  const r = run(s);
  if (r.err) { say('  ' + String(s).padEnd(7) + '被拒：' + r.err); continue; }
  const warn = JSON.stringify(r.warn_keys);
  const hot = r.warn_keys && r.warn_keys.indexOf('turnOverHigh') >= 0;
  rows.push({ seats: s, daily: r.daily_traffic, turn: r.turn_rate, warn: warn, hot: hot });
  say('  ' + String(s).padEnd(7) + String(r.daily_traffic).padEnd(11)
    + String(r.turn_rate).padEnd(10) + warn.padEnd(16) + (hot ? '★报红警' : '—'));
}
const hotRows = rows.filter((x) => x.hot);
const lo = rows[rows.length - 1], hi = rows[0];
say('');
say('  ⇒ 座位数 ' + hi.seats + ' ⇒ 翻台 ' + hi.turn + '（报红警）；座位数 ' + lo.seats + ' ⇒ 翻台 ' + lo.turn + '（不报）');
say('  ⇒ 同一个 R、同一个客单价、同一个营业天数，**只因"座位数"不同**：翻台率跨度 '
  + lo.turn + ' ~ ' + hi.turn + '（×' + (hi.turn / lo.turn).toFixed(2) + '）');
say('  ⇒ 红警只在 seats ≤ ' + Math.max.apply(null, hotRows.map((x) => x.seats)) + ' 时触发，即**红警由座位数假设决定**');
say('');

say('===== 2. validate 对 seats 的 fail-closed 约束 =====');
const vZero = val.validateInput(Object.assign({}, BASE, { seats: 0 }));
const vNone = val.validateInput(Object.assign({}, BASE, { seats: undefined }));
const shown = (v) => (v.error ? '拒：' + (v.msg || v.error) : '放行（异常！）');
say('  seats = 0    ⇒ ' + shown(vZero));
say('  seats 缺省    ⇒ ' + shown(vNone));
say('  ⇒ 反推模式下 seats 是**必填且必须 > 0**（规范 v1.1 §3.3 同款约束）');
say('');

say('===== 3. 「同一间 60㎡ 铺子」按现有密度表能推出多少座位 =====');
if (bp && bp.SEAT_DENSITY && bp.estimateSeats) {
  const AREA = 60;
  const keys = Object.keys(bp.SEAT_DENSITY);
  const est = [];
  for (const k of keys) {
    const s = bp.estimateSeats(k, AREA);
    est.push({ k: k, d: bp.SEAT_DENSITY[k], seats: Number(s) || 0 });
    say('  业态 ' + String(k).padEnd(10) + ' 密度 ' + String(bp.SEAT_DENSITY[k]).padEnd(5) + '㎡/座 ⇒ '
      + AREA + '㎡ 估 ' + s + ' 座');
  }
  const ss = est.map((x) => x.seats).filter((x) => x > 0);
  say('  ⇒ 同样 60㎡，座位数估到 ' + Math.min.apply(null, ss) + ' ~ ' + Math.max.apply(null, ss) + ' 座（跨度 ×'
    + (Math.max.apply(null, ss) / Math.min.apply(null, ss)).toFixed(2) + '）');
  say('');
  say('  把「估出来的座位数」代进上式（R = 100,000 元 不变）：');
  for (const e of est) {
    const r = run(e.seats);
    const hot = r.warn_keys && r.warn_keys.indexOf('turnOverHigh') >= 0;
    say('    60㎡/' + String(e.k).padEnd(10) + ' ⇒ ' + String(e.seats).padEnd(4) + ' 座 ⇒ 翻台 '
      + String(r.turn_rate).padEnd(7) + (hot ? '★报红警' : '—'));
  }
} else {
  say('  ⚠️ utils/bizPreset.js 无法 require 或未导出 SEAT_DENSITY ⇒ 本段跳过（不编造）');
}
say('');

say('===== 4. 「设了包间」的形态（座位更少、单座产值更高）=====');
say('  餐饮实况：同样 60㎡，设 2 个包间 ⇒ 散座被压缩，座位数可能掉到 20 以下。');
for (const s of [12, 16, 20]) {
  const r = run(s);
  const hot = r.warn_keys && r.warn_keys.indexOf('turnOverHigh') >= 0;
  say('    座位 ' + String(s).padEnd(4) + ' ⇒ 翻台 ' + String(r.turn_rate).padEnd(7)
    + (hot ? '★报红警（会被用户读成"这个铺子不现实"）' : '—'));
}
say('');

say('===== 5. 结论（一句话）=====');
say('  翻台的**分母（座位数）**在当前实现里是"猜的"，而它的**分子（客流）**才是从营收目标反推的硬量；');
say('  ⇒ 分母一错，指标就错，且会**误触/漏触红警**；');
say('  ⇒ 但**月客流 / 日均客流**完全不依赖座位数，是同一份数据里"不会骗人"的那部分。');

const OUT = path.join(__dirname, 'probe_turn.out.txt');
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log('\n[written] ' + OUT);
