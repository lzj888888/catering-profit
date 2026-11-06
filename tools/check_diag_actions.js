// tools/check_diag_actions.js —— R615 处方层守卫
//
// 为什么立：李老师定调「老板要的不是『你房租高』，是『那我该干嘛』」。
//   智库三元组里每条规则都有「动作」列，但引擎此前一个都不输出。
//   R615 把它接进结论页之后，最怕三种静默退化：
//     ① 接线断了（云函数不调 buildActions / 前端不渲染）⇒ 页面看着正常，动作没了；
//     ② 动作退化成通用鸡汤（不带他自己的数）⇒ 又变成「正确的废话」；
//     ③ 有人把「生成式自由发挥 / 终局判决」放回来 ⇒ 合规红线 + 责任边界同时破。
//   ⇒ 判据必须**判行为**（真 require、真跑纯函数、真比对出参），不判「有没有这个词」。
//
// 覆盖：A 接线面 / B 五条硬标准 / C 事实缺失 fail-closed / D 合规红线 / E 反证变异 / F S1 口径不倒退
// 运行：node tools/check_diag_actions.js

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const ACTIONS = require(path.join(ROOT, 'cloudfunctions/getDiagnosis/actions.js'));
const ENG = require(path.join(ROOT, 'cloudfunctions/common/diagnosisEngine.js'));

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
function sec(t) { console.log(`\n── ${t} ──`); }

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IDX = read('cloudfunctions/getDiagnosis/index.js');
const WXML = read('subpkg/biz/diag/result.wxml');
const RJS = read('subpkg/biz/diag/result.js');
const TERMS = read('miniprogram/i18n/terms.js');

// 满数据样本：正餐、营收 10 万、月亏 2 万、账上 16 万、房租 18%（超警戒）
const INPUT = {
  bizType: 'dining', cityTier: 'tier2',
  revenueFen: 10000000, netProfitFen: -2000000, avgMonthlyNetLossFen: 2000000,
  lossMonths: 6, cashOnHandFen: 16000000,
  foodCostRatePct: 38, laborCostRatePct: 18, rentRatePct: 18, monthlyRigidFen: 4000000,
  revenueYoyPct: -12, rating: 3.9, reviewTrend: 'worse', businessDistrict: 'slight_down',
  leaseMonthsLeft: 8, renewIncreasePct: 15, debtLevel: 'light', foodSafetyEvent: false,
};
const diag = ENG.evaluateDiagnosis(INPUT);
const d = { diagnosis: diag, derived: { monthsUsed: 6, lossMonths: 6 }, input: INPUT };
const plan = ACTIONS.buildActions(d);

// ===================== A 接线面 =====================
sec('A 接线面（防「写了不用」）');
{
  ok('A-① 云函数真 require 了 actions.js（剥注释后仍命中）',
    /require\(['"]\.\/actions['"]\)/.test(IDX.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
  ok('A-② 云函数真调用 buildActions，且结果进 ok() 出参',
    /buildActions\s*\(/.test(IDX) && /\bplan\s*,/.test(IDX));
  ok('A-③ 前端 wxml 真渲染处方段（不是只写在 js 里）',
    /planActions/.test(WXML) && /a\.text/.test(WXML) && /dg-act/.test(WXML));
  ok('A-④ 前端 buildView 真装配 plan（不是只声明 data 初值）',
    /planRaw\s*=\s*\(d\s*&&\s*d\.plan\)/.test(RJS) && /planActions\s*,/.test(RJS));
  ok('A-⑤ data 顶层声明了 planActions（防顶层绑定静默空白，与 check_page_top_bindings 同族坑）',
    /planActions:\s*\[\]/.test(RJS));
  ok('A-⑥ terms 双副本 md5 一致（文案单源）',
    fs.readFileSync(path.join(ROOT, 'miniprogram/i18n/terms.js')).equals(
      fs.readFileSync(path.join(ROOT, 'specs/dev-specs/i18n/terms.js'))));
  // 🔴 技能 §6.1「自测吃 A 路、云端跑 B 路」盲区：
  //   actions.js 用 require('./common')（云端扁平聚合入口）取诊断引擎阈值，
  //   而本地 self-test 常 require('cloudfunctions/common/diagnosisEngine.js')（单源）。
  //   ⇒ 必须**真 require 云端那份 common.js**，证明 diagnosisEngine 子对象确实被导出，
  //     否则真机上 actions.js 一加载就 undefined 崩，而本地守卫全绿。
  const CLOUD_COMMON = require(path.join(ROOT, 'cloudfunctions/getDiagnosis/common.js'));
  const CLOUD_ACTIONS = require(path.join(ROOT, 'cloudfunctions/getDiagnosis/actions.js'));
  ok('A-⑦ 🔴 云端 require 路径真跑通：getDiagnosis/common.js 导出了 diagnosisEngine，且 actions.js 能产出处方',
    !!CLOUD_COMMON.diagnosisEngine
    && CLOUD_ACTIONS.buildActions(d).actions.length > 0,
    `cloud diagnosisEngine=${!!CLOUD_COMMON.diagnosisEngine} / 云端处方 ${CLOUD_ACTIONS.buildActions(d).actions.length} 条`);
}

// ===================== B 五条硬标准 =====================
sec('B 五条硬标准（防退化成正确的废话）');
{
  ok('B-① 规则表恰好覆盖 11 项指标（每项都有归宿，不许留空档）',
    ACTIONS.RULES.length === 11 && ENG.METRICS.every((m) => ACTIONS.RULES.some((r) => r.key === m.key)),
    `规则 ${ACTIONS.RULES.length} / 指标 ${ENG.METRICS.length}`);
  ok('B-② 每条规则都有 needs / when / text / ruleId（可机读、可追溯）',
    ACTIONS.RULES.every((r) => Array.isArray(r.needs) && typeof r.when === 'function'
      && typeof r.text === 'function' && typeof r.ruleId === 'string' && r.ruleId.length > 0));
  ok('B-③ 【带数】动作句里真的出现了老板自己的数（20.0% / 20,000 元 / 8.0 个月之一）',
    (() => {
      const all = plan.actions.map((a) => a.text).join(' ');
      return /20\.0%|20,000|8\.0/.test(all);
    })(), plan.actions.map((a) => a.text.slice(0, 30)).join(' | '));
  ok('B-④ 【分级】三档真生效且文案互不相同（防只改了标签没改处方）',
    ACTIONS.survivalTier(2) === 'urgent' && ACTIONS.survivalTier(4) === 'cautious'
    && ACTIONS.survivalTier(8) === 'steady'
    && new Set([ACTIONS.TIER_TEXT.urgent, ACTIONS.TIER_TEXT.cautious, ACTIONS.TIER_TEXT.steady]).size === 3);
  ok('B-⑤ 【分级反证】同一短板在 urgent / steady 两档下，允许的动作条数与级别集合不同',
    ACTIONS.TIER_LIMIT.urgent.max < ACTIONS.TIER_LIMIT.steady.max
    && ACTIONS.TIER_LIMIT.urgent.levels.length < ACTIONS.TIER_LIMIT.steady.levels.length);
  ok('B-⑥ 【有边界】至少 4 条规则带业态/场景不适用说明（火锅误判、季节因素等）',
    ACTIONS.RULES.filter((r) => r.boundary && r.boundary.length >= 10).length >= 4,
    `${ACTIONS.RULES.filter((r) => r.boundary).length} 条带边界`);
  ok('B-⑦ 【可追溯】每条动作都带智库 ruleId 回参',
    plan.actions.every((a) => a.ruleId && /^V|^R\d/.test(a.ruleId)));
  ok('B-⑧ 【条数封顶】一次最多 3 条，不把 11 项全倒给老板',
    plan.actions.length <= 3, `实出 ${plan.actions.length} 条`);
  ok('B-⑧b 【顺序】第一条必须是「先做」级（页面桩实测：净利率项丢分最多却是 later，不重排会让老板第一眼看到最不急的那条）',
    plan.actions.length === 0 || plan.actions[0].level === 'now',
    plan.actions.map((a) => a.level).join(' > ') || '无动作');
  ok('B-⑨ 【房租警戒单源】处方层不得硬编码 15，必须取引擎 RENT_WARN_HI × 城市系数',
    !/rentWarnPct\s*=\s*15/.test(read('cloudfunctions/getDiagnosis/actions.js'))
    && /RENT_WARN_HI/.test(read('cloudfunctions/getDiagnosis/actions.js')));
}

// ===================== C fail-closed =====================
sec('C 事实缺失必须闭嘴（防 undefined% / NaN 元）');
{
  const noRent = ACTIONS.buildActions(Object.assign({}, d, {
    input: Object.assign({}, INPUT, { rentRatePct: undefined }),
  }));
  ok('C-① 缺房租数 ⇒ 不输出 rent 那条（needs 真生效，不是只声明）',
    !noRent.actions.some((a) => a.key === 'rent'));
  const noBurn = ACTIONS.buildActions(Object.assign({}, d, {
    input: Object.assign({}, INPUT, { avgMonthlyNetLossFen: undefined, netProfitFen: undefined }),
  }));
  ok('C-② 缺月均净亏 ⇒ 不输出带「undefined / NaN」的动作句',
    noBurn.actions.every((a) => !/undefined|NaN|Infinity/.test(a.text)));
  const insuff = ACTIONS.buildActions({ diagnosis: ENG.evaluateDiagnosis({ bizType: 'dining' }), derived: {}, input: {} });
  ok('C-③ 数据不足 ⇒ 一条处方都不给（不给半本账开药方）',
    insuff.actions.length === 0 && insuff.tier === 'insufficient');
  ok('C-④ 数据不足时前端有明确出路文案，不是空卡片',
    /planInsufficient/.test(WXML) && /actInsufficient/.test(TERMS));
}

// ===================== D 合规红线 =====================
sec('D 合规红线（旧底线「划清边界」后仍然禁止的部分）');
{
  const ACT = read('cloudfunctions/getDiagnosis/actions.js');
  const body = ACT.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''); // 剥注释，只看可执行/字符串
  ok('D-① 规则表文本里零「建议闭店 / 该关了 / 关店清算」等终局判决',
    !/建议闭店|该关了|关店清算|必须闭店|立即止损/.test(body));
  ok('D-② 零绝对化承诺（一定能救活 / 保证不亏 / 保证盈利）',
    !/一定能救活|保证不亏|保证盈利|肯定能/.test(body));
  ok('D-③ 每条动作都是**预设 text 函数**产出，不是运行时自由生成（无 LLM/AI 调用）',
    !/require\(['"](wx-server-sdk|openai|@volc)/.test(ACT) && !/cloud\.callFunction/.test(ACT));
  ok('D-④ 前端兜底句写明「预设经营规则自动匹配、不构成生成式 AI 建议」',
    /预设经营规则自动匹配/.test(TERMS) && /不构成生成式 AI 建议/.test(TERMS));
  // ⚠️ 只在 `return ok({...})` 的**返回值切片**里判，且先剥注释：
  //   `buildActions({ ... input: out.input })` 是服务端内部合法入参，不是回传；
  //   首版在全文裸扫把它误判成泄密。判据必须落在「出参」这一个面上。
  const outSlice = IDX.slice(IDX.indexOf('return ok(')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  ok('D-⑤ 不回传 out.input 原始敏感值（处方层只在服务端填空）',
    /\bplan\s*,/.test(IDX) && !/input\s*:\s*out\.input\b/.test(outSlice)
    && !/\binput\s*:\s*input\b/.test(outSlice));
}

// ===================== E 变异反证 =====================
sec('E 反证变异（证明判据不是恒绿）');
{
  // 变异 1：把 needs 全部清空 ⇒ 缺房租数时 rent 动作必须「冒出来」，证明 needs 真在拦截。
  // 🔴 首版用满数据样本做变异**没有鉴别力**：rent 本来就不在 anchors 前 3，清不清 needs 都不输出。
  //   正解：构造一个 anchors 恰好是 rent 的诊断对象，让 rent 规则真的走到 when/needs 那一步。
  const RULES_SAVE = ACTIONS.RULES.map((r) => r.needs);
  const rentOnly = Object.assign({}, d, {
    diagnosis: Object.assign({}, diag, {
      anchors: [{ key: 'rent', label: '房租负担', note: '房租占 18%' }],
    }),
    input: Object.assign({}, INPUT, { rentRatePct: undefined }),
  });
  ok('E-⓪ 前置：正常 needs 下，缺房租数 ⇒ rent 动作不输出',
    !ACTIONS.buildActions(rentOnly).actions.some((a) => a.key === 'rent'));
  ACTIONS.RULES.forEach((r) => { r.needs = []; });
  const mutated = ACTIONS.buildActions(rentOnly);
  ok('E-① 变异：清空 needs 后，缺房租数仍输出 rent ⇒ 证明 needs 判据真有拦截力',
    mutated.actions.some((a) => a.key === 'rent'),
    `变异后动作=${mutated.actions.map((a) => a.key).join(',') || '无'}`);
  ACTIONS.RULES.forEach((r, i) => { r.needs = RULES_SAVE[i]; });

  // 变异 2：直接改坏 text ⇒ 带数判据必须消失
  const textSave = ACTIONS.RULES.find((r) => r.key === 'loss').text;
  ACTIONS.RULES.find((r) => r.key === 'loss').text = () => '注意控制成本。';
  const flat = ACTIONS.buildActions(d).actions.map((a) => a.text).join(' ');
  ok('E-② 变异：把动作句换成通用鸡汤 ⇒ 带数特征必须消失（证明 B-③ 不是恒绿）',
    !/20\.0%|20,000/.test(flat), flat.slice(0, 40));
  ACTIONS.RULES.find((r) => r.key === 'loss').text = textSave;

  ok('E-③ 恢复后重新真跑，动作数仍 ≤3 且带数（守卫不留副作用）',
    ACTIONS.buildActions(d).actions.length <= 3
    && /20\.0%|20,000|8\.0/.test(ACTIONS.buildActions(d).actions.map((a) => a.text).join(' ')));
}

// ===================== F S1 口径不倒退 =====================
sec('F S1 口径不倒退（方案③防回潮）');
{
  ok('F-① 引擎已无「连亏可扛固定上限」常量', ENG.TUNABLE.lossMonthsTolerableByBiz === undefined);
  ok('F-② 失血率阈值单源存在', typeof ENG.TUNABLE.bleedRateWarnPct === 'number');
  ok('F-③ loss 项 label 已改为「失血速度」（不再叫亏损持续性）',
    ENG.METRICS.find((m) => m.key === 'loss').label === '失血速度');
  ok('F-④ 🔴 反证：连亏 6 月但账上撑 8 个月 ⇒ 不命中 R2、等级非高危（旧口径会打架）',
    !diag.redlineHit.some((r) => r.code === 'R2') && diag.level !== 'critical',
    `level=${diag.level} hits=${diag.redlineHit.map((r) => r.code).join(',') || '无'}`);
  ok('F-⑤ 🔴 反证：同样连亏 6 月、现金只够撑 2 个月 ⇒ 命中 R2 且高危',
    (() => {
      const s = ENG.evaluateDiagnosis(Object.assign({}, INPUT, { cashOnHandFen: 4000000 }));
      return s.redlineHit.some((r) => r.code === 'R2') && s.level === 'critical';
    })());
  ok('F-⑥ 11 项 / 权重 100 / 覆盖率口径未破坏（历史分数仍可比）',
    ENG.METRICS.length === 11 && ENG.METRICS.reduce((s, m) => s + m.weight, 0) === 100
    && diag.coverage === 100);
}

console.log(`\n===== 处方层守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
