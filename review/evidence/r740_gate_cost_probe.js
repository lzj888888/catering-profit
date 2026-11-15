#!/usr/bin/env node
// review/evidence/r740_gate_cost_probe.js —— R740 探针：时间闸门到底吃掉多少钱
//
// 背景：R736 定了 `AMORT_RULE_V2_FROM = '2026-11'`，11 月之前的月份摊销一律不计入利润。
// 李老师现在问：小程序还没上线，10 月/11 月这个边界怎么处理更好？
//
// 本探针不猜、不讲道理，只做一件事：**真跑引擎纯函数**（getAmortSchedule/service.js::amortizeForMonth），
// 逐月对比两种规则下「进利润的摊销」分别是多少，把差额摊开给人看。
//
//   规则 A（现状 · 带闸门）：month < '2026-11' ⇒ 0；否则 = 台账应摊
//   规则 B（全量按台账）：未归档月一律 = 台账应摊（归档月仍读落库快照，本探针不算归档）
//
// 运行：node review/evidence/r740_gate_cost_probe.js

const path = require('path');
const sched = require(path.resolve(__dirname, '../../cloudfunctions/getAmortSchedule/service.js'));

const Y = 100; // 元 → 分
const GATE = '2026-11';   // R740 已拆除闸门；此处保留原日期常量，用于给"如果闸门还在"算代价
const yuan = (fen) => (fen / Y).toFixed(2);

// 真库字段名 → 引擎字段名（R739 的 P0 根因就是这个映射，此处照 getAmortSchedule/index.js 的做法写）
const toEngine = (r) => ({
  asset_id: r.asset_id, name: r.name, mode: r.mode,
  start_month: r.start_month, total_months: r.total_months,
  terminate_month: r.terminate_month || '',
  total_value: r.value_fen,          // ← 库是 value_fen，引擎读 total_value
});

const monthsBetween = (a, b) => {
  const out = [];
  let i = sched.monthIndex(a), end = sched.monthIndex(b);
  for (; i <= end; i++) out.push(sched.fmtMonthIdx(i));
  return out;
};

function ruleA(assets, m) {
  return String(m) >= GATE ? sched.amortizeForMonth(assets, m).total_amount_fen : 0;
}
function ruleB(assets, m) {
  return sched.amortizeForMonth(assets, m).total_amount_fen;
}

// ============ 场景：李老师三种可能的起摊月 ============
const CASES = [
  {
    label: '情形① 8 月起摊（门店装修 36,000 / 36 期）',
    assets: [{ asset_id: 'a1', name: '门店装修', mode: 'amort', start_month: '2026-08', total_months: 36, value_fen: 36000 * Y }],
    span: ['2026-08', '2027-02'],
  },
  {
    label: '情形② 10 月起摊（上月刚录；装修 + 设备两笔叠加）',
    assets: [
      { asset_id: 'a1', name: '门店装修', mode: 'amort', start_month: '2026-10', total_months: 36, value_fen: 36000 * Y },
      { asset_id: 'a2', name: '厨房设备', mode: 'amort', start_month: '2026-10', total_months: 24, value_fen: 24000 * Y },
    ],
    span: ['2026-10', '2027-02'],
  },
  {
    label: '情形③ 11 月起摊（本月才录，闸门碰不到）',
    assets: [{ asset_id: 'a1', name: '门店装修', mode: 'amort', start_month: '2026-11', total_months: 36, value_fen: 36000 * Y }],
    span: ['2026-10', '2027-02'],
  },
  {
    label: '情形④ 长期使用（2026-08 起摊，一路到摊完 2029-07）',
    assets: [{ asset_id: 'a1', name: '门店装修', mode: 'amort', start_month: '2026-08', total_months: 36, value_fen: 36000 * Y }],
    span: ['2026-08', '2029-08'],
  },
];

let bad = 0;
function ck(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name}${detail ? '  ← ' + detail : ''}`); bad++; }
}

console.log('==============================================================');
console.log(' R740 · 时间闸门的实际代价（真跑 amortizeForMonth，不重写公式）');
console.log(` 闸门 = '${GATE}'  ⇒ 该月之前的月份，摊销一律 0`);
console.log('==============================================================\n');

for (const c of CASES) {
  const eng = c.assets.map(toEngine);
  const ms = monthsBetween(c.span[0], c.span[1]);
  let sumA = 0, sumB = 0;
  console.log(`【${c.label}】`);
  console.log('  月份     规则A(现状·带闸门)   规则B(全量按台账)    差额');
  for (const m of ms) {
    const a = ruleA(eng, m), b = ruleB(eng, m);
    sumA += a; sumB += b;
    const mark = a !== b ? '  ← 闸门扣着' : '';
    console.log(`  ${m}   ${yuan(a).padStart(12)}   ${yuan(b).padStart(14)}   ${yuan(b - a).padStart(9)}${mark}`);
  }
  const total = eng.reduce((s, x) => s + x.total_value, 0);
  const lost = sumB - sumA;
  console.log(`  ─── 区间内 A 合计 ${yuan(sumA)} / B 合计 ${yuan(sumB)} / 闸门挡掉 ${yuan(lost)}`);
  if (c.span[1] >= '2029-08') {
    console.log(`  ─── 资产原值合计 ${yuan(total)}；B 全程求和 ${yuan(sumB)}（应恰等于原值）`);
  }
  console.log('');
}

console.log('==============================================================');
console.log(' 判据');
console.log('==============================================================');

const c1 = CASES[0];
const e1 = c1.assets.map(toEngine);
ck('G-① 起摊月早于闸门 ⇒ 闸门把起摊月那一期直接吃掉（2026-08 规则A=0、规则B=1000）',
  ruleA(e1, '2026-08') === 0 && ruleB(e1, '2026-08') === 1000 * Y,
  `A=${yuan(ruleA(e1, '2026-08'))} B=${yuan(ruleB(e1, '2026-08'))}`);

ck('G-② 被吃掉的期数 = 起摊月到闸门前一月的月数（8 月起摊 ⇒ 8/9/10 三期全零）',
  ['2026-08', '2026-09', '2026-10'].every((m) => ruleA(e1, m) === 0)
  && ['2026-11'].every((m) => ruleA(e1, m) === 1000 * Y));

ck('G-③ 闸门生效后两规则完全一致（2026-11 起无差异，说明闸门只在历史月起作用）',
  monthsBetween('2026-11', '2029-08').every((m) => ruleA(e1, m) === ruleB(e1, m)));

const sumB1 = monthsBetween('2026-08', '2029-07').reduce((s, m) => s + ruleB(e1, m), 0);
ck('G-④ 全量按台账 ⇒ 36 期逐月求和恰等于原值 36,000（闭包平，一分不差）',
  sumB1 === 36000 * Y, `${yuan(sumB1)}`);

const sumA1 = monthsBetween('2026-08', '2029-07').reduce((s, m) => s + ruleA(e1, m), 0);
ck('G-⑤ 带闸门 ⇒ 全程少 3,000，且此后任何操作都补不回来（不是延后，是蒸发）',
  sumA1 === 33000 * Y, `${yuan(sumA1)} vs 36,000.00`);

const e2 = CASES[1].assets.map(toEngine);
ck('G-⑥ 两笔资产叠加时缺口等比放大（10 月起摊：装修 1000 + 设备 1000 ⇒ 10 月共缺 2000）',
  ruleB(e2, '2026-10') - ruleA(e2, '2026-10') === 2000 * Y,
  `差额 ${yuan(ruleB(e2, '2026-10') - ruleA(e2, '2026-10'))}`);

const e3 = CASES[2].assets.map(toEngine);
ck('G-⑦ 起摊月就在闸门当月（11 月）⇒ 两种规则无差别（此情形改规则零影响）',
  ruleA(e3, '2026-11') === ruleB(e3, '2026-11')
  && ruleA(e3, '2026-10') === ruleB(e3, '2026-10') && ruleA(e3, '2026-10') === 0);

// 一次性投入不该被摊销规则碰到
//   ⚠️ 引擎 `amortizeForMonth` **自己不看 mode** —— 过滤 `mode !== 'lump'` 是调用方的责任
//   （真链路见 getLedger/index.js 的 `.filter((a) => a.mode !== 'lump' && a.start_month)`）。
//   本探针照真链路的做法先过滤，再断言结果；同时把「不过滤会怎样」一并钉出来，
//   因为这是个真实的误用面：少写一句 filter，一次性投入会被当成 1 期摊销计入。
const lumpRaw = [toEngine({ asset_id: 'l1', name: '推广费', mode: 'lump', start_month: '2026-10', total_months: 1, value_fen: 5000 * Y })];
const lumpFiltered = lumpRaw.filter((a) => a.mode !== 'lump');
ck('G-⑧ 一次性投入按真链路过滤后不进摊销合计：十月两套规则都是 0',
  ruleA(lumpFiltered, '2026-10') === 0 && ruleB(lumpFiltered, '2026-10') === 0);
ck('G-⑨ （误用面）若调用方漏写 mode 过滤 ⇒ 5,000 一次性会被当成摊销算进利润',
  sched.amortizeForMonth(lumpRaw, '2026-10').total_amount_fen === 5000 * Y,
  `不过滤时 = ${yuan(sched.amortizeForMonth(lumpRaw, '2026-10').total_amount_fen)}`);

console.log('');
console.log(bad === 0 ? `✅ 全部通过（${9} 条）` : `❌ ${bad} 条失败`);
process.exit(bad === 0 ? 0 : 1);
