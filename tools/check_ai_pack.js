#!/usr/bin/env node
// tools/check_ai_pack.js —— 「AI 诊断包 + L0 判断」守卫（R462 · PLAN_AI P0-①/②）
//
// 为什么必须机器守：
//   这两件东西的价值全在「**数字不许重算、判断不许由 AI 编**」。
//   而它俩天然容易写成"看起来很对"的样子：包能生成、文本能打印、门禁全绿 ——
//   但里面可能①把分当元②把 AI 该说的话替引擎说了③缺板块时留空白让人以为没异常。
//   这些都不会报错，只会让老板拿一份**错的**诊断包去问 AI。
//
// 判据五组，方向不同、缺一不可：
//   ① 模块面：两个模块真 require 得到、导出齐全、问题码恰好 5 个且不重复。
//   ② 判断面：亏损/未到保本/安全边际薄/两口径差异/异常项/历史不足 六路**各自单独**命中；
//      并且**反面**用例必须不命中（防判据恒真）。
//   ③ 装配面：金额**原样搬运**（喂独特数比对，防重算）；白名单外字段不外泄；
//      缺板块必须进 `unavailable` 并写明原因（不许静默留空）。
//   ④ 纯度面：两模块源码不得出现 `wx.` / `wx.cloud` / `http(s)` / `Date.now` / `new Date`
//      —— 诊断包不允许联网、不允许调模型、不允许读时钟（否则同一个月两次跑结论不一致）。
//   ⑤ 反恒真：把判断条件改成 `false`、把金额白名单删一项，对应判据必须转红。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INTERP_REL = 'utils/interpretation.js';
const PACK_REL = 'utils/diagnosisPack.js';

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); return true; }
  problems.push(name + (detail ? '：' + detail : ''));
  console.log('❌ ' + name + (detail ? '：' + detail : ''));
  return false;
}

function stripComments(s) {
  return String(s || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// ================= ① 模块面 =================
let interp = null;
let packMod = null;
try { interp = require(path.join(ROOT, INTERP_REL)); } catch (e) { interp = null; }
try { packMod = require(path.join(ROOT, PACK_REL)); } catch (e) { packMod = null; }

ok('①-1 interpretation 可 require', !!interp, 'require 失败 ⇒ 后续判据无法执行');
ok('①-2 diagnosisPack 可 require', !!packMod, 'require 失败 ⇒ 后续判据无法执行');
if (!interp || !packMod) {
  console.log('');
  console.log('❌ AI 诊断包守卫：模块不可用，fail-closed');
  process.exit(1);
}

ok('①-3 buildInterpretation 是函数', typeof interp.buildInterpretation === 'function');
ok('①-4 buildDiagnosisPack / packToText 是函数',
  typeof packMod.buildDiagnosisPack === 'function' && typeof packMod.packToText === 'function');
ok('①-5 问题码恰好 5 个且互不重复',
  Array.isArray(packMod.QUESTION_CODES) && packMod.QUESTION_CODES.length === 5 &&
  new Set(packMod.QUESTION_CODES).size === 5,
  '实际=' + JSON.stringify(packMod.QUESTION_CODES));
ok('①-6 口径版本号存在（可回溯当时用的规则）',
  !!interp.RULES_VERSION && !!packMod.PACK_VERSION);
ok('①-7 5 个问题都带人话文本（只给机器码＝没给问题）',
  Array.isArray(packMod.QUESTION_CODES) && packMod.QUESTION_CODES.every(
    (c) => typeof (packMod.QUESTION_TEXT || {})[c] === 'string' && packMod.QUESTION_TEXT[c].length >= 8
  ), '缺文本的问题码会导出一个没人能问的英文码');

// ================= ② 判断面 =================
const BI = interp.buildInterpretation;
function codesOf(out) {
  return ((out && out.items) || []).map((x) => x.code);
}

const LOSS_FACTS = {
  hasLedger: true, profitFen: -123400, revenueFen: 900000, profitDiffFen: 0,
  breakeven: { ok: true, breakevenFen: 1000000, safeMarginPct: -11.1 },
  anomalies: { basis: { insufficient: false, history_months: 5 }, items: [] },
};
const lossOut = BI(LOSS_FACTS);
ok('②-1 亏损 ⇒ LOSS 且 level=red',
  codesOf(lossOut).indexOf('LOSS') >= 0 && lossOut.level === 'red',
  'codes=' + JSON.stringify(codesOf(lossOut)));
ok('②-2 未到保本 ⇒ BELOW_BREAKEVEN，且缺口 = 保本 − 营收',
  (function () {
    const it = (lossOut.items || []).find((x) => x.code === 'BELOW_BREAKEVEN');
    return !!it && it.params.gapFen === 100000;
  })(), '缺口应为 100000 分');

const GOOD_FACTS = {
  hasLedger: true, profitFen: 200000, revenueFen: 2000000, profitDiffFen: 0,
  breakeven: { ok: true, breakevenFen: 1500000, safeMarginPct: 25 },
  anomalies: { basis: { insufficient: false, history_months: 6 }, items: [] },
};
const goodOut = BI(GOOD_FACTS);
ok('②-3 盈利且安全 ⇒ NO_SIGNAL，且**不含** LOSS（反面证判据非恒真）',
  codesOf(goodOut).indexOf('NO_SIGNAL') >= 0 && codesOf(goodOut).indexOf('LOSS') < 0 &&
  codesOf(goodOut).indexOf('BELOW_BREAKEVEN') < 0,
  'codes=' + JSON.stringify(codesOf(goodOut)));
ok('②-4 安全边际 5% ⇒ THIN_SAFE_MARGIN；25% ⇒ 不含（双向）',
  (function () {
    const a = BI(Object.assign({}, GOOD_FACTS, { breakeven: { ok: true, breakevenFen: 1500000, safeMarginPct: 5 } }));
    const b = BI(Object.assign({}, GOOD_FACTS, { breakeven: { ok: true, breakevenFen: 1500000, safeMarginPct: 25 } }));
    return codesOf(a).indexOf('THIN_SAFE_MARGIN') >= 0 && codesOf(b).indexOf('THIN_SAFE_MARGIN') < 0;
  })());
ok('②-5 两口径差异 ≠0 ⇒ TWO_CALIBER_DIFF；=0 ⇒ 不含（双向）',
  (function () {
    const a = BI(Object.assign({}, GOOD_FACTS, { profitDiffFen: 50000 }));
    return codesOf(a).indexOf('TWO_CALIBER_DIFF') >= 0 && codesOf(goodOut).indexOf('TWO_CALIBER_DIFF') < 0;
  })());
ok('②-6 未建档 ⇒ 只出 NO_LEDGER，不冒充亏损',
  (function () {
    const o = BI({ hasLedger: false, profitFen: 0, revenueFen: 0, breakeven: {}, anomalies: {} });
    return codesOf(o).length === 1 && codesOf(o)[0] === 'NO_LEDGER' && o.level === 'info';
  })(), '未建档必须是正常态');
ok('②-7 历史不足 ⇒ HISTORY_SHORT；有异常项 ⇒ ANOMALY_ITEMS（互斥）',
  (function () {
    const short = BI(Object.assign({}, GOOD_FACTS, {
      anomalies: { basis: { insufficient: true, history_months: 1, thresholds: { minHistoryMonths: 3 } }, items: [] },
    }));
    const hasItems = BI(Object.assign({}, GOOD_FACTS, {
      anomalies: { basis: { insufficient: false, history_months: 6 }, items: [
        { key: 'a', rule: 'r1_up', direction: 'up', amount_fen: 100, ratio_pct: 50, band: 'high', attention: 2 },
        { key: 'b', rule: 'r2_down', direction: 'down', amount_fen: 50, ratio_pct: -40, band: 'mid', attention: 1 },
      ] },
    }));
    return codesOf(short).indexOf('HISTORY_SHORT') >= 0 && codesOf(short).indexOf('ANOMALY_ITEMS') < 0 &&
      codesOf(hasItems).indexOf('ANOMALY_ITEMS') >= 0 && codesOf(hasItems).indexOf('HISTORY_SHORT') < 0;
  })());
ok('②-8 异常项最多带 ' + interp.THRESHOLDS.maxAnomalyItems + ' 条（不是全搬）',
  (function () {
    const many = Array.from({ length: 9 }, (_, i) => ({
      key: 'k' + i, rule: 'r1_up', direction: 'up', amount_fen: 100 + i, ratio_pct: 10 + i, band: 'mid', attention: 1,
    }));
    const o = BI(Object.assign({}, GOOD_FACTS, {
      anomalies: { basis: { insufficient: false, history_months: 6 }, items: many },
    }));
    const it = (o.items || []).find((x) => x.code === 'ANOMALY_ITEMS');
    return !!it && it.params.count === 9 && it.params.top.length === interp.THRESHOLDS.maxAnomalyItems;
  })());

// ================= ③ 装配面 =================
const LEDGER = {
  account_id: 'acc_1',
  income_total_fen: 1234567,
  expense_total_fen: 700000,
  material_cost_fen: 300000,
  gross_profit_fen: 934567,
  gross_margin_pct: 75.73,
  total_factor_real_profit_fen: 234567,
  operation_ref_profit_fen: 234567,
  profit_diff_fen: 0,
  secret_fen: 999,
};
const PACK_IN = {
  month: '2026-10', shop: { bizText: '小面', cityText: '二线' }, ledger: LEDGER,
  breakeven: { ok: true, breakevenFen: 1000000, lowFen: 900000, highFen: 1100000, contributionRate: 0.7, safeMarginPct: 18.9 },
  anomalies: { version: 'anomaly-rules-1', basis: { insufficient: false, history_months: 5 }, items: [
    // 刻意放一条「整店毛利率」：规则层对它不给 name（不属于某个费用项），
    // 导出时必须补人话名，不能把 result|gross_margin 这个内部键泄给 AI（③-11 的靶子）。
    { key: 'result|gross_margin', scope: 'result', name: '', rule: 'r5_margin', direction: 'down',
      amount_fen: null, history_median_fen: null, ratio_pct: -6.2, ratio_unit: 'pt', band: 'mid', attention: 3 },
  ] },
};
const P = packMod.buildDiagnosisPack(PACK_IN);
ok('③-1 金额原样搬运（1234567 分不得被重算/换单位）',
  P.month_facts && P.month_facts.income_total_fen === 1234567,
  '实际=' + (P.month_facts && P.month_facts.income_total_fen));
ok('③-2 白名单外字段不外泄（secret_fen 不得出现）',
  !('secret_fen' in (P.month_facts || {})), '会把内部字段泄给外部 AI');
ok('③-3 pack 显式声明单位（防把分当元）',
  typeof P.units === 'string' && /fen/.test(P.units) && P.units.length > 0);
ok('③-4 缺菜品/渠道 ⇒ 进 unavailable 且写明原因（不许静默留空）',
  Array.isArray(P.unavailable) && P.unavailable.length === 2 &&
  P.unavailable.every((u) => !!u.section && !!u.reason) &&
  P.dishes === null && P.channels === null,
  '实际=' + JSON.stringify(P.unavailable));
ok('③-5 verdicts 与单独调用 buildInterpretation 一致（同一事实同一结论）',
  JSON.stringify(P.verdicts) === JSON.stringify(BI({
    hasLedger: true, profitFen: 234567, revenueFen: 1234567, profitDiffFen: 0,
    breakeven: PACK_IN.breakeven, anomalies: PACK_IN.anomalies,
  })));
ok('③-6 5 个问题码全部进包', Array.isArray(P.questions) && P.questions.length === 5);

const TXT = packMod.packToText(P);
ok('③-7 文本含单位声明，且 5 个问题的**中文问句**都在（不是只给机器码）',
  /单位是「分」/.test(TXT) && packMod.QUESTION_CODES.every(
    (c) => TXT.indexOf((packMod.QUESTION_TEXT || {})[c] || '\u0000') >= 0
  ));
ok('③-8 文本含「未包含」段并点明缺失=不等于没异常',
  /未包含/.test(TXT) && /缺失≠没有异常|缺失不等于没有异常/.test(TXT));
ok('③-9 文本里金额带「分」单位（100 分 = 1 元可自证）',
  /1234567 分/.test(TXT), '文本片段=' + TXT.slice(0, 40).replace(/\n/g, ' '));
ok('③-10 问题文本不含禁用词（金融/收益承诺类，同 TERMS.forbidden 口径）',
  (function () {
    const BAN = ['投资回报', 'ROI', '回本周期', '收益率', '利润率', '盈利', '赚钱', '躺赚', '投资', '理财', '付费', '订阅', '会员费'];
    const all = packMod.QUESTION_CODES.map((c) => (packMod.QUESTION_TEXT || {})[c] || '').join('');
    const hit = BAN.filter((w) => all.indexOf(w) >= 0);
    return hit.length === 0;
  })(), '问题文本命中禁用词 ⇒ 会被 T5 判红');
ok('③-11 异常项名称不得泄露内部键（result|gross_margin 这类）',
  !/result\|gross_margin/.test(TXT), '内部键直接给 AI 等于让它猜');

// ---- 菜品事实（R466 接入）----
const DISH_IN = {
  range: { from: '2026-10-01', to: '2026-10-31', days: 21 },
  dineIn: [
    { dish_key: 'k1', name: '红烧牛肉面', qty: 120, amountFen: 240000, totalCostFen: 96000, grossFen: 144000, marginPct: 60 },
    { dish_key: 'k2', name: '酸辣粉', qty: 300, amountFen: 300000, totalCostFen: 210000, grossFen: 90000, marginPct: 30 },
  ],
  totals: { qty: 420, amountFen: 540000 },
  unmatched: 2, truncated: false,
};
const PD = packMod.buildDiagnosisPack(Object.assign({}, PACK_IN, { dishes: DISH_IN }));
ok('③-12 菜品按毛利降序取前 N 道（不按销量、不按录入顺序）',
  (function () {
    const t = (PD.dishes && PD.dishes.top) || [];
    return t.length === 2 && t[0].name === '红烧牛肉面' && t[0].grossFen >= t[1].grossFen;
  })(), '实际=' + JSON.stringify((PD.dishes && PD.dishes.top || []).map((x) => x.name)));
ok('③-13 传了菜品就不得再登记「缺菜品」（只有渠道该缺）',
  Array.isArray(PD.unavailable) && PD.unavailable.length === 1 &&
  PD.unavailable[0].section === 'channels',
  '实际=' + JSON.stringify(PD.unavailable));
ok('③-14 文本含菜名与「未匹配成本卡」提醒（不能只给数字不给口径）',
  (function () {
    const t = packMod.packToText(PD);
    return t.indexOf('红烧牛肉面') >= 0 && t.indexOf('酸辣粉') >= 0 && /未匹配成本卡/.test(t);
  })());
ok('③-15 取数失败时，unavailable 里的原因必须是调用方给的那个（不许一律写成"未加载"）',
  (function () {
    const p = packMod.buildDiagnosisPack(Object.assign({}, PACK_IN, {
      dishes: null, dishesReason: 'fetch_failed_or_locked',
    }));
    const hit = (p.unavailable || []).filter((u) => u.section === 'dishes');
    return hit.length === 1 && hit[0].reason === 'fetch_failed_or_locked';
  })(), '原因被写死 ⇒ 老板/复审分不清「没权限」和「没数据」');
ok('③-16 文本显式说明「食材成本」不在「费用合计」里（防 AI 重复扣一次成本）',
  /「食材成本」不在「费用合计」里/.test(TXT), '不说 ⇒ AI 把两者相加，成本算两遍');
ok('③-17 文本显式区分两个利润口径（不许互相加减/平均）',
  /两个利润不是同一口径/.test(TXT) && /经营参考利润/.test(TXT) && /真钱利润/.test(TXT));

// ================= ④ 纯度面 =================
function srcOf(rel) { return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
const S_I = srcOf(INTERP_REL);
const S_P = srcOf(PACK_REL);
ok('④-1 两模块不联网 / 不调模型（无 wx. / http / fetch）',
  !/\bwx\./.test(S_I + S_P) && !/https?:/.test(S_I + S_P) && !/\bfetch\s*\(/.test(S_I + S_P));
ok('④-2 两模块不读时钟（同月两次跑结论必须一致）',
  !/Date\.now|new Date\s*\(/.test(S_I + S_P));
ok('④-3 判断层不把分换成元（不做展示换算）',
  !/\/\s*100\b/.test(S_I), '换成元是导出层的事');

// ================= ⑤ 反恒真 =================
function loadMut(rel, repls, reqOverride) {
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const r of repls) {
    if (src.indexOf(r[0]) < 0) return { err: 'anchor missing: ' + r[0] };
    src = src.split(r[0]).join(r[1]);
  }
  const mod = { exports: {} };
  try {
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', '__filename', '__dirname', src)(
      mod, mod.exports, reqOverride || require, path.join(ROOT, rel), path.dirname(path.join(ROOT, rel))
    );
  } catch (e) { return { err: (e && e.message) || String(e) }; }
  return { m: mod.exports, err: null };
}

ok('⑤-1 把「亏损」条件改成 false ⇒ 亏损用例必须不再出 LOSS（证②-1 非恒真）',
  (function () {
    const r = loadMut(INTERP_REL, [['profitFen < 0', 'false']]);
    if (r.err) return false;
    return codesOf(r.m.buildInterpretation(LOSS_FACTS)).indexOf('LOSS') < 0;
  })());

ok('⑤-2 把金额白名单删掉 income_total_fen ⇒ 该字段必须消失（证③-1 非恒真）',
  (function () {
    const r = loadMut(PACK_REL, [["  'income_total_fen',\n", '']], function (p) {
      return p === './interpretation.js' ? interp : require(p);
    });
    if (r.err) return false;
    const p2 = r.m.buildDiagnosisPack(PACK_IN);
    return !p2.month_facts || !('income_total_fen' in p2.month_facts);
  })());

// ================= 汇总 =================
console.log('');
// 🔴 汇总格式必须带「N 通过 / M 失败」——`tools/check_suite_assert_counts.js` 用
//   `/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/` 解析各套件的通过数；写成 `28/28 通过` 会解析不到
//   ⇒ 判成 A0「stdout 里解析不到通过数」⇒ suite-assert-counts 转红（R463 踩到）。
if (problems.length === 0) {
  console.log('✅ AI 诊断包守卫：' + pass + ' 通过 / 0 失败（L0 判断有鉴别力 · 金额原样搬运 · 缺失显式登记）');
  process.exit(0);
}
console.log('❌ AI 诊断包守卫：' + pass + ' 通过 / ' + problems.length + ' 失败');
problems.forEach((p) => console.log('   - ' + p));
process.exit(1);
