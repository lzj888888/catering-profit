#!/usr/bin/env node
// tools/check_three_cost.js —— A17（三项刚性成本率 V钱-4）+ A18（会员销售占比 V客²-1）守卫
//
// 为什么需要它（本仓第 N 例「写进文档 ≠ 有机器看护」）：
//   这两项都是**派生指标**，不新增任何输入。派生指标的典型失效不是算错，而是：
//     ① **阈值两处各写一份**（indicatorRef.THREE_COST 与 diagnosisEngine.BIZ_HARD.threeCostWarn）
//        ⇒ 改一处不改另一处，页面说"过警戒线"、诊断说"没超"，同一份数据两个结论；
//     ② **缺项按 0 补**（缺房租 ⇒ 三项和偏低 ⇒ 永远"健康"）—— 把"没数据"包装成"没问题"；
//     ③ **页面自己重算**（拿 indicators 里的 pct 再拼一遍）⇒ 出现第二个分母来源。
//   三条都是"数字看起来合法、门禁全绿"的形态，只能靠本守卫逐条钉住。
//
// 判据（A–E 五段，fail-closed）：
//   A 单源一致：THREE_COST ≡ diagnosisEngine.BIZ_HARD.threeCostWarn（5 业态逐项）/ 分业态不是一刀切
//   B 三项刚性行为：相加口径 / 三档边界 / 缺项不按 0 / 业态回落
//   C 会员占比行为：<20% 报警 / 边界 20% 不报 / 缺项 na
//   D 接线：getLedger 出参 + 页面真的渲染（配置了不等于生效）
//   E 防漂移：RENT_WARN_HI 必须由 BANDS 派生（A16 的手抄值过期事故就出在这里）
//
// 运行：node tools/check_three_cost.js   （由 verify_all.js 的 [three-cost] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const READ = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

const ir = require(path.join(ROOT, 'cloudfunctions/common/indicatorRef.js'));
const eng = require(path.join(ROOT, 'cloudfunctions/common/diagnosisEngine.js'));

// ============ A 单源一致 ============
sec('A 单源一致：THREE_COST ≡ 诊断引擎 BIZ_HARD.threeCostWarn');
{
  const bad = [];
  const keys = Object.keys(ir.THREE_COST);
  keys.forEach((k) => {
    const e = eng.BIZ_HARD[k];
    if (!e) { bad.push(`${k} 引擎无此业态`); return; }
    if (ir.THREE_COST[k].warn !== e.threeCostWarn) {
      bad.push(`${k} 页面警戒 ${ir.THREE_COST[k].warn} ≠ 引擎 ${e.threeCostWarn}`);
    }
  });
  ok('A-① 5 业态三项刚性警戒线两处逐项相等（页面/诊断同一条线）',
    bad.length === 0 && keys.length === 5, bad.length ? bad.join('；') : `68/75/74/71 全等（${keys.join('/')}）`);
}
{
  const d = ir.THREE_COST;
  ok('A-② 🔴 不是一刀切 70%：至少有两个业态警戒线不同（正餐 75 vs 快餐 68）',
    d.dining.warn !== d.fastfood.warn && d.dining.warn === 75 && d.fastfood.warn === 68,
    `fastfood=${d.fastfood.warn} dining=${d.dining.warn} hotpot=${d.hotpot.warn} cafe=${d.cafe.warn}`);
}
{
  const bad = Object.keys(ir.THREE_COST).filter((k) => ir.THREE_COST[k].danger !== 80);
  ok('A-③ 危险线统一 80（[D4]：三项吃掉八成流水 = 没有容错空间）', bad.length === 0, bad.join('/') || '5/5 = 80');
}
{
  const bad = Object.keys(ir.THREE_COST).filter((k) => {
    const t = ir.THREE_COST[k];
    return Math.abs(t.healthy - Math.round(t.warn * 0.93)) > 1;
  });
  ok('A-④ 健康线 ≈ 警戒 × 0.93（63/70/69/66，±1 容差）', bad.length === 0,
    bad.length ? bad.join('/') : Object.keys(ir.THREE_COST).map((k) => k + ':' + ir.THREE_COST[k].healthy).join(' '));
}
{
  const a = Object.keys(ir.THREE_COST).sort().join('/');
  const b = Object.keys(eng.BIZ_HARD).sort().join('/');
  ok('A-⑤ 业态键集合双向一致（少一个业态 ⇒ 该业态静默回落 other）', a === b, `THREE_COST=${a} · BIZ_HARD=${b}`);
}

// ============ B 三项刚性行为 ============
sec('B 三项刚性行为：相加口径 / 三档边界 / 缺项不按 0');
{
  const v = ir.threeCostOf('fastfood', { grossMarginPct: 63, rentPct: 8, laborPct: 18 });
  // 100−63 = 37（食材）+ 8 + 18 = 63
  ok('B-① 口径 = (100 − 毛利率) + 房租 + 人工', v.pct === 63, `pct=${v.pct}（应 63 = 37+8+18）`);
}
{
  const t = ir.THREE_COST.dining;
  const mk = (gm) => ir.threeCostOf('dining', { grossMarginPct: gm, rentPct: 10, laborPct: 20 });
  // dining warn=75 healthy=70 danger=80；pct = 100-gm+30
  const atHealthy = mk(100 - (t.healthy - 30));       // pct = healthy
  const overHealthy = mk(100 - (t.healthy + 1 - 30)); // pct = healthy+1
  const atWarn = mk(100 - (t.warn - 30));             // pct = warn
  const overWarn = mk(100 - (t.warn + 1 - 30));       // pct = warn+1
  const atDanger = mk(100 - (t.danger - 30));         // pct = danger
  ok('B-② 三档边界：≤健康=good / 健康+1=ok / =警戒 仍 ok（"到线"不算越线）/ 警戒+1=warn / ≥危险=bad',
    atHealthy.level === 'good' && overHealthy.level === 'ok' && atWarn.level === 'ok'
    && overWarn.level === 'warn' && atDanger.level === 'bad',
    [atHealthy.level, overHealthy.level, atWarn.level, overWarn.level, atDanger.level].join('/'));
}
{
  const v = ir.threeCostOf('dining', { grossMarginPct: 60, rentPct: null, laborPct: 20 });
  ok('B-③ 🔴 缺房租 ⇒ pct=null / level=na / missing 列出「rent」（绝不按 0 补）',
    v.pct === null && v.level === 'na' && v.missing.length === 1 && v.missing[0] === 'rent',
    `pct=${v.pct} level=${v.level} missing=[${v.missing.join(',')}]`);
}
{
  const v = ir.threeCostOf('dining', { grossMarginPct: null, rentPct: null, laborPct: 20 });
  ok('B-④ 缺两项 ⇒ missing 逐项列出（顺序稳定，前端按名字提示）',
    v.missing.join(',') === 'grossMargin,rent', `missing=[${v.missing.join(',')}]`);
}
{
  // 🔴 「填了 0%」与「没填」必须分得开：毛利率 0% 是荒谬但合法的输入，应算出 130%（真的危险）
  const v0 = ir.threeCostOf('dining', { grossMarginPct: 0, rentPct: 12, laborPct: 18 });
  const vn = ir.threeCostOf('dining', { grossMarginPct: null, rentPct: 12, laborPct: 18 });
  ok('B-⑤ 「填 0」≠「没填」：毛利率 0% 参与计算（130%），null 则不判',
    v0.pct === 130 && v0.level === 'bad' && vn.pct === null, `0%⇒${v0.pct}/${v0.level} · null⇒${vn.pct}`);
}
{
  const v = ir.threeCostOf('不存在的业态', { grossMarginPct: 60, rentPct: 12, laborPct: 18 });
  const o = ir.threeCostOf('other', { grossMarginPct: 60, rentPct: 12, laborPct: 18 });
  ok('B-⑥ 未知业态回落 other（不返回 undefined，不静默无阈值）',
    v.pct === o.pct && v.warn === o.warn, `未知=${v.pct}/${v.warn} other=${o.pct}/${o.warn}`);
}

// ============ C 会员占比行为 ============
sec('C 会员销售占比（V客²-1）：<20% 报警 / 边界不报 / 缺项不判');
{
  ok('C-① 19.9% ⇒ warn（报警）', ir.memberRatioOf(19.9).level === 'warn', ir.memberRatioOf(19.9).level);
  ok('C-② 恰好 20% ⇒ ok（"低于 20%"才报，到线不报）', ir.memberRatioOf(20).level === 'ok', ir.memberRatioOf(20).level);
  ok('C-③ 40% 以上 ⇒ good（做到位了要认）',
    ir.memberRatioOf(40).level === 'good' && ir.memberRatioOf(63.7).level === 'good',
    ir.memberRatioOf(40).level + '/' + ir.memberRatioOf(63.7).level);
}
{
  ok('C-④ 🔴 没填（null）⇒ na，不判 —— 不能罚一个没有会员体系的小店',
    ir.memberRatioOf(null).level === 'na' && ir.memberRatioOf(undefined).level === 'na',
    ir.memberRatioOf(null).level + '/' + ir.memberRatioOf(undefined).level);
}
{
  ok('C-⑤ 阈值单源可读（warnAt=20），页面不得自己写 20',
    ir.memberRatioOf(10).warnAt === 20 && ir.MEMBER_RATIO_WARN === 20, 'warnAt=' + ir.memberRatioOf(10).warnAt);
}

// ============ D 接线（配置了 ≠ 生效了）============
sec('D 接线：getLedger 出参 + 页面真的渲染');
{
  const gL = READ('cloudfunctions/getLedger/index.js');
  ok('D-① getLedger 出参含 three_cost', /three_cost:\s*threeCost/.test(gL), /three_cost/.test(gL) ? '已出参' : '缺出参');
  ok('D-② getLedger 调 indicatorRef.threeCostOf（不在云函数里自己拼 100−gm）',
    gL.indexOf('indicatorRef.threeCostOf(') >= 0 && gL.indexOf('(100 - ') < 0,
    gL.indexOf('indicatorRef.threeCostOf(') >= 0 ? '走单源' : '未调单源');
  ok('D-③ 客流块出参含 member_ratio_level 且走 memberRatioOf',
    gL.indexOf('member_ratio_level') >= 0 && gL.indexOf('indicatorRef.memberRatioOf(') >= 0,
    'member_ratio_level ' + (gL.indexOf('member_ratio_level') >= 0 ? '有' : '无'));
}
{
  const wxml = READ('subpkg/biz/month/result.wxml');
  ok('D-④ 结果页渲染三项刚性卡（threeView.has / bandText / missText）',
    wxml.indexOf('threeView.has') >= 0 && wxml.indexOf('threeView.bandText') >= 0 && wxml.indexOf('threeView.missText') >= 0,
    'threeView 已渲染');
  // 🔴 R614：会员占比从结果页迁到诊断结论页（录入页客流区整体下线，结果页不再有这张卡）。
  //   判据改成"新的地方必须有、旧的地方必须没有" —— 只查新地方会漏掉"两处都显示"的重复。
  const dwx = READ('subpkg/biz/diag/result.wxml');
  ok('D-⑤ 🔴 R614：会员占比改在诊断结论页渲染，且结果页已下线（防两处各显示一套）',
    dwx.indexOf('memberLine') >= 0 && wxml.indexOf('trView.memberRatioWarn') < 0,
    dwx.indexOf('memberLine') >= 0 ? '诊断页已渲染 / 结果页已下线' : '诊断页未渲染');
}
{
  const js = READ('subpkg/biz/month/result.js');
  ok('D-⑥ 结果页不重算占比（threeView 里不得出现加法式重算）',
    /threeView[\s\S]{0,900}?(rentPct\s*\+|100\s*-\s*gm)/.test(js) === false,
    '未发现前端重算');
  ok('D-⑦ 页面文案走 terms（threeTitle 在结果页 / memberRatio* 在诊断页，都是单源映射）',
    js.indexOf('TERMS.modules.m1.threeTitle') >= 0 &&
    READ('subpkg/biz/diag/result.js').indexOf('T.memberRatioNa') >= 0,
    '文案单源');
}

// ============ E 防漂移 ============
sec('E 防漂移：房租警戒必须由 BANDS 派生（A16 手抄值过期事故）');
{
  const src = READ('cloudfunctions/common/diagnosisEngine.js');
  ok('E-① RENT_WARN_HI 由 BANDS 派生（源码不再出现手抄的 5 业态字面量表）',
    /RENT_WARN_HI\s*=\s*BIZ_KEYS\.reduce/.test(src) && src.indexOf("const RENT_WARN_HI = { fastfood:") < 0,
    /RENT_WARN_HI\s*=\s*BIZ_KEYS\.reduce/.test(src) ? '派生' : '仍是手抄');
  const b = ir.BANDS;
  const bad = Object.keys(b).filter((k) => eng.RENT_WARN_HI[k] !== b[k].rent[1]);
  ok('E-② 运行时逐业态：RENT_WARN_HI ≡ BANDS[biz].rent[1]（改带值自动跟随）',
    bad.length === 0, bad.length ? bad.join('/') : Object.keys(b).map((k) => k + ':' + eng.RENT_WARN_HI[k]).join(' '));
}

console.log(`\n===== 三项刚性与会员占比守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
