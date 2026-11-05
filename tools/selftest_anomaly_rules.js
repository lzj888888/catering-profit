// tools/selftest_anomaly_rules.js —— 「异常核对清单」规则层行为自测（R396 · 队列 #13）
//
// 为什么必须立这条：规则层的**唯一价值**是「报出来的那几条真的是偏离」。
//   如果阈值写错（例如把 upFactor 写成 1.05），清单会项项都报 ⇒ 老板看两次就再也不看；
//   如果历史不足时也照算，首月用户会被自己的账吓一跳。
//   ⇒ 判据必须是**手算锚点 + 反恒真**（改阈值结论必须变），不能只验"函数能跑"。
//
// 判据全部是行为（真调 buildChecklist 验返回值），源码面只用于「红线词/单源」这两类静态事实。
// 文本处理一律 indexOf + 切片，**不用反斜杠转义的正则**（本机工具链会把反斜杠转成斜杠）。
'use strict';

const fs = require('fs');
const path = require('path');
const A = require('../utils/anomalyRules.js');

let pass = 0;
const bad = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log('✅ ' + name); return; }
  bad.push(name + (detail === undefined ? '' : '  [' + detail + ']'));
}
const fen = (yuan) => Math.round(yuan * 100);

// 造一个月快照（与 getLedger ok 出参同形；本模块认的字段见 toSnapshot）
function mk(month, expenses, incomes, gm) {
  const row = (c, n, v) => ({ category: c, name: n, amount_fen: v });
  return {
    month,
    account_id: 'acc_' + month,
    is_archive: false,
    income_items: (incomes || []).map((x) => row(x[0], x[1], fen(x[2]))),
    expense_items: (expenses || []).map((x) => row(x[0], x[1], fen(x[2]))),
    result: { gross_margin_pct: (gm === undefined ? null : gm) },
  };
}
const byKey = (r, key) => (r.items || []).filter((it) => it.key === key)[0] || null;

// ===== 锚点样本：7~9 月稳定，10 月五处偏离（每处都能手算）=====
//   人工 8000 → 20000（+150%）
//   水电 1000 → 0（断档）
//   堂食 30000 → 12000（−60%）
//   推广费 历史从未有 → 500（新增）
//   毛利率 45% → 30%（−15 个点）
//   房租 5000 → 5000（一致，不该报）
const MONTHS = [
  mk('2026-07', [['fixed', '房租', 5000], ['fixed', '人工', 8000], ['fixed', '水电', 1000]], [['dine', '堂食', 30000]], 45),
  mk('2026-08', [['fixed', '房租', 5000], ['fixed', '人工', 8000], ['fixed', '水电', 1000]], [['dine', '堂食', 30000]], 45),
  mk('2026-09', [['fixed', '房租', 5000], ['fixed', '人工', 8000], ['fixed', '水电', 1000]], [['dine', '堂食', 30000]], 45),
  mk('2026-10', [['fixed', '房租', 5000], ['fixed', '人工', 20000], ['mkt', '推广费', 500]], [['dine', '堂食', 12000]], 30),
];
const R = A.buildChecklist({ month: '2026-10', months: MONTHS });

// ===== S 组：前提自失效护栏 =====
check('S-① 模块可加载且导出 buildChecklist', typeof A.buildChecklist === 'function' && typeof A.RULES_VERSION === 'string');
check('S-② 锚点样本恰 4 个月（用例被删空即转红）', MONTHS.length === 4, MONTHS.length);
check('S-③ 阈值自洽：upFactor > 1 > downFactor 且 minHistoryMonths ≥ 2',
  A.THRESHOLDS.upFactor > 1 && A.THRESHOLDS.downFactor < 1 && A.THRESHOLDS.minHistoryMonths >= 2,
  JSON.stringify(A.THRESHOLDS));
check('S-④ 锚点样本算出了非空清单（否则下面的"某项不报"全是假绿）', R.items.length > 0, R.items.length);

// ===== A 组：手算锚点 =====
const labor = byKey(R, 'expense|fixed|人工');
check('A-① 人工 8000→20000 判为突增', !!labor && labor.rule === 'r1_up', labor && labor.rule);
check('A-② 幅度 = +150%（20000/8000 − 1）', !!labor && labor.ratio_pct === 150, labor && labor.ratio_pct);
check('A-③ 档位 ge100（100%~200% 区间）', !!labor && labor.band === 'ge100', labor && labor.band);
check('A-④ 人工属费用突增 ⇒ attention=high', !!labor && labor.attention === 'high', labor && labor.attention);
check('A-⑤ 历史中位数带出 800000 分（解释锚点）', !!labor && labor.history_median_fen === fen(8000), labor && labor.history_median_fen);

const water = byKey(R, 'expense|fixed|水电');
check('A-⑥ 水电 1000→0 判为断档', !!water && water.rule === 'r3_missing', water && water.rule);
check('A-⑦ 断档的幅度记为 −100% 且档位 ge100', !!water && water.ratio_pct === -100 && water.band === 'ge100',
  water && (water.ratio_pct + '/' + water.band));

const dine = byKey(R, 'income|dine|堂食');
check('A-⑧ 堂食 30000→12000 判为突降', !!dine && dine.rule === 'r2_down', dine && dine.rule);
check('A-⑨ 幅度 = −60%（12000/30000 − 1）', !!dine && dine.ratio_pct === -60, dine && dine.ratio_pct);
check('A-⑩ 收入突降 ⇒ attention=high', !!dine && dine.attention === 'high', dine && dine.attention);

const promo = byKey(R, 'expense|mkt|推广费');
check('A-⑪ 推广费历史从未出现 ⇒ 新增项', !!promo && promo.rule === 'r4_new', promo && promo.rule);
check('A-⑫ 新增项无幅度可算 ⇒ ratio_pct 必须为 null（不得填 0 冒充"没偏离"）', !!promo && promo.ratio_pct === null, promo && promo.ratio_pct);
check('A-⑬ 费用新增不催 ⇒ attention=normal', !!promo && promo.attention === 'normal', promo && promo.attention);

const gmItem = byKey(R, 'result|gross_margin');
check('A-⑭ 毛利率 45%→30% 判为偏离', !!gmItem && gmItem.rule === 'r5_margin', gmItem && gmItem.rule);
check('A-⑮ 毛利率按百分点记 −15（不是 −33%）', !!gmItem && gmItem.ratio_pct === -15 && gmItem.ratio_unit === 'pt',
  gmItem && (gmItem.ratio_pct + '/' + gmItem.ratio_unit));
check('A-⑯ 15 个点落在 ge15pt 档（与比例档不混用）', !!gmItem && gmItem.band === 'ge15pt', gmItem && gmItem.band);

check('A-⑰ 房租 5000→5000 与自店历史一致 ⇒ 不进清单', byKey(R, 'expense|fixed|房租') === null);
check('A-⑱ 清单恰 5 项（多报/漏报都算错）', R.items.length === 5, R.items.map((i) => i.key).join(','));
check('A-⑲ 排序：首项是 high 且末项是 normal 的新增项',
  R.items[0].attention === 'high' && R.items[R.items.length - 1].rule === 'r4_new',
  R.items.map((i) => i.attention + ':' + i.rule).join(' > '));
check('A-⑳ 出参带规则版本（事后可指回"当时用的哪套阈值"）', R.version === A.RULES_VERSION, R.version);

// ===== B 组：边界（阈值等号 / 小额 / 短历史 / 未建档月 / 回看窗）=====
const base3 = (laborFen) => [
  mk('2026-07', [['fixed', '人工', laborFen / 100]], [['dine', '堂食', 30000]], 45),
  mk('2026-08', [['fixed', '人工', laborFen / 100]], [['dine', '堂食', 30000]], 45),
  mk('2026-09', [['fixed', '人工', laborFen / 100]], [['dine', '堂食', 30000]], 45),
];
const r19 = A.buildChecklist({ month: '2026-10', months: base3(fen(8000)).concat([mk('2026-10', [['fixed', '人工', 15200]], [['dine', '堂食', 30000]], 45)]) });
check('B-① 1.9 倍（差 7200 元）不报 —— 阈值是 2 倍', byKey(r19, 'expense|fixed|人工') === null,
  byKey(r19, 'expense|fixed|人工') && byKey(r19, 'expense|fixed|人工').ratio_pct);
const r20 = A.buildChecklist({ month: '2026-10', months: base3(fen(8000)).concat([mk('2026-10', [['fixed', '人工', 16000]], [['dine', '堂食', 30000]], 45)]) });
check('B-② 恰好 2.0 倍算命中（">=" 不是 ">"）', !!byKey(r20, 'expense|fixed|人工'));
const rSmall = A.buildChecklist({ month: '2026-10', months: base3(fen(150)).concat([mk('2026-10', [['fixed', '人工', 900]], [['dine', '堂食', 30000]], 45)]) });
check('B-③ 中位数 150 元 < 200 元门槛 ⇒ 小额项不报', byKey(rSmall, 'expense|fixed|人工') === null);
const rDelta = A.buildChecklist({
  month: '2026-10',
  months: base3(fen(500)).concat([mk('2026-10', [['fixed', '人工', 620]], [['dine', '堂食', 30000]], 45)]),
  opts: { thresholds: { upFactor: 1.2 } },
});
check('B-④ 倍数够了但绝对差 120 元 < 200 元 ⇒ 不报（minAbsDelta 独立生效）',
  byKey(rDelta, 'expense|fixed|人工') === null,
  byKey(rDelta, 'expense|fixed|人工') && (byKey(rDelta, 'expense|fixed|人工').ratio_pct + '% / 差 120 元'));
const rShort = A.buildChecklist({ month: '2026-10', months: base3(fen(8000)).slice(2).concat([mk('2026-10', [['fixed', '人工', 80000]], [['dine', '堂食', 30000]], 45)]) });
check('B-⑤ 只有 1 个历史月 ⇒ 整体不出项（10 倍涨幅也不报）',
  rShort.items.length === 0 && rShort.basis.insufficient === true && rShort.basis.reason === 'history_too_short',
  rShort.basis.reason + '/' + rShort.items.length);
const noAcct = mk('2026-06', [['fixed', '人工', 8000]], [['dine', '堂食', 30000]], 45);
noAcct.account_id = '';   // 未建档月：不是"所有项都是 0"，是"没有这个月"
const rNoAcct = A.buildChecklist({ month: '2026-10', months: [noAcct].concat(base3(fen(8000))).concat([mk('2026-10', [['fixed', '人工', 8000]], [['dine', '堂食', 30000]], 45)]) });
check('B-⑥ 未建档月不计入 history_months（否则"首月之前"全成断档）', rNoAcct.basis.history_months === 3, rNoAcct.basis.history_months);

const many = [];
for (let i = 1; i <= 9; i++) many.push(mk('2026-0' + i, [['fixed', '人工', 8000]], [['dine', '堂食', 30000]], 45));
many.push(mk('2026-10', [['fixed', '人工', 8000]], [['dine', '堂食', 30000]], 45));
const rWin = A.buildChecklist({ month: '2026-10', months: many });
check('B-⑦ 回看窗上限 6 个月（9 个月历史只取最近 6 个）', rWin.basis.history_months === 6, rWin.basis.history_months);

// ===== C 组：fail-closed =====
const rNoTarget = A.buildChecklist({ month: '2026-11', months: MONTHS });
check('C-① 目标月未建档 ⇒ 不出项且 reason=no_target',
  rNoTarget.items.length === 0 && rNoTarget.basis.reason === 'no_target', rNoTarget.basis.reason);
check('C-② 空输入不抛错、返回空清单', (() => {
  const r = A.buildChecklist({});
  return r.items.length === 0 && r.basis.insufficient === true;
})());
const noGm = A.buildChecklist({
  month: '2026-10',
  months: [mk('2026-07', [], [], null), mk('2026-08', [], [], null), mk('2026-09', [], [], null),
    mk('2026-10', [], [], 10)],
});
check('C-③ 毛利率缺失（null）时不出毛利率项（不得把 null 当 0）', byKey(noGm, 'result|gross_margin') === null);
check('C-④ 无任何明细时清单为空但不报错', Array.isArray(noGm.items) && noGm.items.length === 0, noGm.items.length);

// ===== D 组：反恒真（改阈值，结论必须变）=====
const rUp = A.buildChecklist({ month: '2026-10', months: MONTHS, opts: { thresholds: { upFactor: 4 } } });
check('D-① upFactor 调大到 4 倍后，人工（2.5 倍）不再报', byKey(rUp, 'expense|fixed|人工') === null);
const rDown = A.buildChecklist({ month: '2026-10', months: MONTHS, opts: { thresholds: { downFactor: 0.1 } } });
check('D-② downFactor 调小到 0.1 后，堂食（0.4 倍）不再报', byKey(rDown, 'income|dine|堂食') === null);
const rHist = A.buildChecklist({ month: '2026-10', months: MONTHS, opts: { thresholds: { minHistoryMonths: 4 } } });
check('D-③ minHistoryMonths 调到 4 后整体不出项', rHist.items.length === 0 && rHist.basis.insufficient === true, rHist.items.length);
const rMargin = A.buildChecklist({ month: '2026-10', months: MONTHS, opts: { thresholds: { marginDeltaPct: 20 } } });
check('D-④ marginDeltaPct 调到 20 后，−15 个点不再报', byKey(rMargin, 'result|gross_margin') === null);
const altBase = [
  mk('2026-07', [['fixed', '人工', 15000]], [['dine', '堂食', 30000]], 45),
  mk('2026-08', [['fixed', '人工', 15000]], [['dine', '堂食', 30000]], 45),
  mk('2026-09', [['fixed', '人工', 15000]], [['dine', '堂食', 30000]], 45),
  mk('2026-10', [['fixed', '人工', 20000]], [['dine', '堂食', 30000]], 45),
];
check('D-⑤ 历史换成 15000 后人工不再报（20 万口径跟着基线走，不是写死金额）',
  byKey(A.buildChecklist({ month: '2026-10', months: altBase }), 'expense|fixed|人工') === null);

// ===== E 组：口径红线（只说偏离，不编金额/不对标行业）=====
const srcRaw = fs.readFileSync(path.join(__dirname, '..', 'utils', 'anomalyRules.js'), 'utf8');
// 剥行注释：沿 indexOf 逐行切，不用正则（避免反斜杠转义）
const srcCode = srcRaw.split('\n').map((line) => {
  const i = line.indexOf('//');
  return i >= 0 ? line.slice(0, i) : line;
}).join('\n');
// ⚠️ 判的是**代码**（剥注释后），不是注释：头注里必须写着"绝不输出挽损金额/行业对标"这条禁令，
//   拿带注释的原文去 grep ⇒ 禁令本身把判据喂红（正是"守卫被注释喂成恒假/恒真"的老坑）。
check('E-① 代码里不出现「挽损」（不编"损失了多少钱"）', srcCode.indexOf('挽损') < 0);
check('E-② 代码里不出现「行业对标」/「同业」/「基准值」（不引外部基准）',
  srcCode.indexOf('行业对标') < 0 && srcCode.indexOf('同业') < 0 && srcCode.indexOf('基准值') < 0,
  ['行业对标', '同业', '基准值'].filter((w) => srcCode.indexOf(w) >= 0).join(','));
check('E-③ 出参键里没有任何"金额差/损失"类字段',
  ['loss', 'saved', 'diff_fen', 'delta_fen'].every((k) => srcCode.indexOf(k) < 0),
  ['loss', 'saved', 'diff_fen', 'delta_fen'].filter((k) => srcCode.indexOf(k) >= 0).join(','));
check('E-④ 每一项都带 rule + attention + history_months（可回溯，不许黑盒打分）',
  R.items.every((it) => !!it.rule && !!it.attention && typeof it.history_months === 'number'),
  R.items.filter((it) => !it.rule || !it.attention).length);
check('E-⑤ 清单给出的是"方向"，且方向值在枚举内',
  R.items.every((it) => ['up', 'down', 'missing', 'new'].indexOf(it.direction) >= 0));

// ===== F 组：单源 =====
check('F-① 阈值表是唯一改动点：upFactor 只有一处赋值（其余都是引用）',
  srcCode.split('upFactor:').length - 1 === 1,
  srcCode.split('upFactor:').length - 1);
check('F-② 规则版本号只有一处定义并被出参引用',
  srcCode.split('anomaly-rules-1').length - 1 === 1 && R.version === 'anomaly-rules-1',
  srcCode.split('anomaly-rules-1').length - 1);

console.log('');
console.log('===== 异常核对规则层自测结果：' + pass + ' 通过 / ' + bad.length + ' 失败 =====');
if (bad.length) bad.forEach((b) => console.log('   · ' + b));
process.exit(bad.length === 0 ? 0 : 1);
