// utils/diagnosisPack.js —— 「AI 诊断包」装配层（纯函数 · 零网络 · 零模型调用）
//
// 定位（`review/PLAN_2026-10-23_AI落地路标_v1.md` §四 / §五 P0-①）：
//   别人导出的是 Excel 表格；我们导出的是一份**能被任何 AI 直接读懂**的结构化事实包。
//   老板把它丢给豆包 / 元宝 / WorkBuddy，就能拿到针对性建议 —— 我们**不生成任何结论**。
//
// 为什么这条先做（而不是先做内嵌问答）：
//   · 零资质：我们不提供 AI 服务，只导出数据；
//   · 零成本：不调模型，一次生成 = 本地拼字符串；
//   · 零幻觉：包里全是引擎已经算好的数字 + 已经判好的结论，AI 只负责组织语言。
//
// 边界（改这个文件前先读）：
//   · **不做计算**：本模块只搬运字段、不改单位、不四舍五入、不补零。数字从哪来写在哪。
//   · **不编内容**：某个板块本次拿不到数据 ⇒ 进 `unavailable` 并写明原因，**绝不留空白让人以为没有**。
//   · 判断不在这里做：`verdicts` 直接取 `utils/interpretation.js` 的出参（机器码 + 参数）。
//   · 文案面向**外部 AI**，不面向小程序界面 ⇒ 不进 `terms.js`；界面上的按钮文案才进术语单源。
'use strict';

const interp = require('./interpretation.js');

const PACK_VERSION = 'ai-pack-1';

// 5 个现成问题（老板可直接复制）。
//   为什么固定 5 个而不是让 AI 自己想：老板不会提问，这才是他真正缺的东西。
//   为什么同时保留 code 与 text：code 给机器（守卫/埋点/未来内嵌问答按 code 取术语文案），
//   text 直接给老板复制 —— **只给 code 等于没给问题**（R464 样例实测：导出后是 Q_PROFIT_DROP）。
const QUESTION_CODES = [
  'Q_PROFIT_DROP',    // 这个月利润为什么变成这样，最该动哪一项？
  'Q_DISH_DRAG',      // 哪道菜在拖后腿（没有菜品数据时如实说没有）
  'Q_RENT_SAFE',      // 房租/固定成本占比安全吗，还要卖多少才保本？
  'Q_CHANNEL_MIX',    // 堂食/外卖/团购的到手结构有没有问题？
  'Q_NEXT_ACTION',    // 下个月想多赚一点，最省力的做法是什么？
];

const QUESTION_TEXT = {
  Q_PROFIT_DROP: '这个月利润为什么变成这样？按影响大小排，最该先动哪一项？',
  Q_DISH_DRAG: '哪道菜在拖后腿？如果包里没有菜品数据，请直接说缺数据，不要猜。',
  Q_RENT_SAFE: '房租和固定成本占比安全吗？还要卖多少才到保本线？',
  Q_CHANNEL_MIX: '堂食、外卖、团购的到手结构有没有问题？如果包里没有渠道数据，请直说。',
  Q_NEXT_ACTION: '下个月想多一些结余，按投入从小到大排，最省力的做法是什么？',
};

// 金额字段白名单：只搬这些，避免把整个 ledger 出参（含内部字段）原样泄给外部 AI。
const MONEY_FIELDS = [
  'income_total_fen',
  'expense_total_fen',
  'material_cost_fen',
  'direct_consume_fen',
  'real_consume_fen',
  'gross_profit_fen',
  'effective_amortize_fen',
  'effective_lump_sum_fen',
  'operation_ref_profit_fen',
  'total_factor_real_profit_fen',
  'profit_diff_fen',
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickMoney(ledger) {
  const out = {};
  const src = ledger || {};
  MONEY_FIELDS.forEach(function (k) {
    if (src[k] != null) out[k] = num(src[k]);
  });
  return out;
}

/**
 * 装配诊断包。
 *
 * @param {object} input
 *   · month      {string} 'YYYY-MM'
 *   · shop       {object} { bizText, cityText, bizKey, cityKey, openDays, areaSqm }
 *   · ledger     {object} `getLedger` 的 ok 出参（分）
 *   · breakeven  {object} `utils/breakeven.js::breakeven()` 出参
 *   · anomalies  {object} `utils/anomalyRules.js::buildChecklist()` 出参
 *   · dishes     {array|null} 菜品事实（本页未接则为 null）
 *   · channels   {object|null} 渠道事实（本页未接则为 null）
 * @returns {object}
 */
function buildDiagnosisPack(input) {
  const i = input || {};
  const ledger = i.ledger || {};
  const be = i.breakeven || {};
  const anom = i.anomalies || {};
  const shop = i.shop || {};
  const unavailable = [];

  if (!Array.isArray(i.dishes)) {
    unavailable.push({ section: 'dishes', reason: 'not_loaded_on_this_page' });
  }
  if (!i.channels) {
    unavailable.push({ section: 'channels', reason: 'not_loaded_on_this_page' });
  }

  const facts = {
    hasLedger: i.hasLedger !== false && !!ledger.account_id,
    profitFen: ledger.total_factor_real_profit_fen,
    revenueFen: ledger.income_total_fen,
    profitDiffFen: ledger.profit_diff_fen,
    breakeven: be,
    anomalies: anom,
  };

  return {
    pack_version: PACK_VERSION,
    // 单位必须显式写死：AI 最容易犯的错就是把「分」当「元」⇒ 差 100 倍。
    units: 'money=fen(分); percent=百分数(45 表示 45%); ratio_pct=百分点差',
    month: String(i.month || ''),
    shop: {
      biz_text: shop.bizText || '',
      city_text: shop.cityText || '',
      biz_key: shop.bizKey || '',
      city_key: shop.cityKey || '',
      open_days: shop.openDays != null ? num(shop.openDays) : null,
      area_sqm: shop.areaSqm != null ? num(shop.areaSqm) : null,
    },
    month_facts: pickMoney(ledger),
    gross_margin_pct: ledger.gross_margin_pct != null ? num(ledger.gross_margin_pct) : null,
    breakeven: {
      ok: !!be.ok,
      need_revenue: !!be.needRevenue,
      reason: be.reason || '',
      contribution_rate: be.contributionRate != null ? num(be.contributionRate) : null,
      breakeven_fen: be.breakevenFen != null ? num(be.breakevenFen) : null,
      low_fen: be.lowFen != null ? num(be.lowFen) : null,
      high_fen: be.highFen != null ? num(be.highFen) : null,
      safe_margin_pct: be.safeMarginPct != null ? num(be.safeMarginPct) : null,
    },
    // 引擎已判好的结论（不是 AI 判的）—— 机器码 + 参数
    verdicts: interp.buildInterpretation(facts),
    anomalies: {
      version: anom.version || '',
      basis: anom.basis || null,
      items: Array.isArray(anom.items) ? anom.items : [],
    },
    dishes: Array.isArray(i.dishes) ? i.dishes : null,
    channels: i.channels || null,
    questions: QUESTION_CODES.map(function (code) {
      return { code: code, text: QUESTION_TEXT[code] || '' };
    }),
    unavailable: unavailable,
  };
}

function money(fen) {
  if (fen == null) return '—';
  return String(num(fen)) + ' 分（' + (num(fen) / 100).toFixed(2) + ' 元）';
}

/**
 * 转成可直接粘贴给 AI 的纯文本。**只排版，不改任何数字**。
 * @param {object} pack `buildDiagnosisPack` 的出参
 */
function packToText(pack) {
  const p = pack || {};
  const L = [];
  const q = p.questions || [];

  L.push('# 店算 · AI 诊断包（' + (p.pack_version || PACK_VERSION) + '）');
  L.push('');
  L.push('## 0 给 AI 的说明（请先读这三条）');
  L.push('- 下面所有金额**单位是「分」**（100 分 = 1 元）。请勿当成元。');
  L.push('- 所有数字与「引擎判断」都已由店算引擎算好并判定，**请直接引用，不要重算、不要推测**。');
  L.push('- 缺失的板块在「未包含」里写明了原因，**不要当成"没有异常"**。');
  L.push('');
  L.push('## 1 门店口径');
  L.push('- 月份：' + (p.month || '—'));
  L.push('- 业态：' + ((p.shop && p.shop.biz_text) || '—'));
  L.push('- 城市层级：' + ((p.shop && p.shop.city_text) || '—'));
  if (p.shop && p.shop.open_days != null) L.push('- 营业天数：' + p.shop.open_days);
  if (p.shop && p.shop.area_sqm != null) L.push('- 面积：' + p.shop.area_sqm + ' ㎡');
  L.push('');

  L.push('## 2 本月事实（分）');
  const mf = p.month_facts || {};
  const LABEL = {
    income_total_fen: '营业收入',
    expense_total_fen: '费用合计',
    material_cost_fen: '食材成本',
    direct_consume_fen: '直接填的食材消耗',
    real_consume_fen: '真实消耗（含库存倒轧）',
    gross_profit_fen: '毛利',
    effective_amortize_fen: '当月摊销',
    effective_lump_sum_fen: '一次性投入',
    operation_ref_profit_fen: '经营参考利润',
    total_factor_real_profit_fen: '真钱利润（全要素）',
    profit_diff_fen: '两口径差异',
  };
  Object.keys(LABEL).forEach(function (k) {
    if (mf[k] != null) L.push('- ' + LABEL[k] + '：' + money(mf[k]));
  });
  if (p.gross_margin_pct != null) L.push('- 毛利率：' + p.gross_margin_pct + '%');
  L.push('');

  L.push('## 3 保本与安全边际');
  const be = p.breakeven || {};
  if (be.ok) {
    L.push('- 保本营收：' + money(be.breakeven_fen));
    L.push('- 敏感区间：' + money(be.low_fen) + ' ~ ' + money(be.high_fen));
    L.push('- 边际贡献率：' + be.contribution_rate);
    if (be.safe_margin_pct != null) L.push('- 安全边际：' + be.safe_margin_pct + '%');
  } else {
    L.push('- 保本线本期算不出来，原因码：' + (be.reason || 'unknown') + '（不要自行假设）');
  }
  L.push('');

  L.push('## 4 引擎判断（已判好，请勿推翻）');
  const v = p.verdicts || {};
  if (Array.isArray(v.items) && v.items.length) {
    v.items.forEach(function (it) {
      // 异常项明细在第 5 节给人话；这里只给条数 —— 否则 `key: 'result|gross_margin'`
      // 这类内部键会原样泄给 AI（R464 样例实测）。
      if (it.code === 'ANOMALY_ITEMS') {
        L.push('- [' + it.level + '] ANOMALY_ITEMS 共 ' + (it.params && it.params.count) + ' 项（明细见第 5 节）');
      } else {
        L.push('- [' + it.level + '] ' + it.code + ' ' + JSON.stringify(it.params));
      }
    });
  } else {
    L.push('- （无）');
  }
  L.push('');

  L.push('## 5 与你自己的历史比（异常项）');
  const an = p.anomalies || {};
  const items = Array.isArray(an.items) ? an.items : [];
  if (an.basis && an.basis.insufficient) {
    L.push('- 历史月数不足（' + (an.basis.history_months || 0) + ' 个月），本期不下结论。');
  } else if (items.length) {
    // 🔴 名称兜底：`result|gross_margin` 这类内部键**不能直接给 AI**（R464 样例实测泄出去了）。
    //   规则层对「整店毛利率」不给 name（它不属于某个费用项）⇒ 在这里补一个人话名。
    const labelOf = function (it) {
      if (it && it.name) return it.name;
      if (it && it.rule === 'r5_margin') return '整店毛利率';
      return (it && it.rule) || (it && it.key) || '未知项';
    };
    items.forEach(function (it) {
      L.push('- ' + labelOf(it) + '：' + it.direction +
        '，幅度 ' + (it.ratio_pct == null ? '—' : it.ratio_pct) + (it.ratio_unit === 'pt' ? ' 个百分点' : '%') +
        '，本月 ' + (it.amount_fen == null ? '—' : money(it.amount_fen)) +
        '，历史中位 ' + (it.history_median_fen == null ? '—' : money(it.history_median_fen)));
    });
  } else {
    L.push('- 本月没有偏离自店历史的项。');
  }
  L.push('');

  L.push('## 6 未包含的部分（缺失≠没有异常）');
  const un = Array.isArray(p.unavailable) ? p.unavailable : [];
  if (un.length) {
    un.forEach(function (u) { L.push('- ' + u.section + '：' + u.reason); });
  } else {
    L.push('- 无');
  }
  L.push('');

  L.push('## 7 可以直接问的问题');
  q.forEach(function (x, idx) { L.push((idx + 1) + '. ' + (x.text || x.code)); });

  return L.join('\n');
}

module.exports = { PACK_VERSION, QUESTION_CODES, QUESTION_TEXT, MONEY_FIELDS, buildDiagnosisPack, packToText };
