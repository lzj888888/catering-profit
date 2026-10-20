// utils/anomalyRules.js —— 「异常核对清单」规则层（纯函数 · 不调模型 · 只比本店自己的历史）
//
// 为什么这么定（`review/PLAN_2026-10-20_AI路线与边界.md` §3 / §5 / §8-P0）：
//   在没有同业真实数据之前，「漏损率 / 挽损金额 / 行业对标」是**编出来的确定性**；
//   能站得住的只有一句：「这一项跟你自己过去几个月不一样，去核一下单据」。
//   所以本模块只输出 **偏离方向 + 偏离幅度（相对自店历史中位数）**，
//   绝不输出「本店损失多少钱」「行业均值多少」——既不编金额差，也不引外部基准。
//
// 输入契约（N 个月历史）—— 传输侧就是既有云函数，**不需要新造接口**：
//   · 月份列表：`getMonthList` → `{ list: [{ month, is_archive }] }`（R4 批次已上线，全量返回）
//   · 每月账本：`getLedger({ shop_id, month })` → 本节 `toSnapshot()` 认的字段（就是它的 ok 出参）
//   ⇒ 两者拼出的 `month_snapshot` 见 `toSnapshot`。**未建档月**（`account_id === ''`）必须被排除，
//     不能当成「这个月所有项都是 0」——那会把首月之前的所有项都误报成「断档」。
//
// 判据为什么取「中位数」而不是均值：
//   老板的账里天然有一次性支出（设备维修、年会），均值会被一个月拉高，
//   下个月正常的支出就全变成「异常」⇒ 误报一多，清单就没人看了（PLAN §7 指标 3「反悔率」）。
//
// 口径纪律（改动前先读）：
//   · 全部阈值集中在 `THRESHOLDS`，改口径只改这一处，并且必须同步 `tools/selftest_anomaly_rules.js` 的锚点。
//   · 历史不足 `minHistoryMonths` ⇒ **不出任何项**（fail-closed：宁可不说，也不拿一个月当"历史"）。
//   · 本模块**不读时钟**：目标月由调用方传入，否则 12 月跑的结论与 1 月复跑不一致。
'use strict';

// 规则版本：清单里的每一项都带它 ⇒ 同一句结论事后能指回「当时用的是哪套阈值」
// （PLAN §6-1 口径版本号；与 M2 的 bands_version / M3 的 ENGINE_VERSION 同一族）。
const RULES_VERSION = 'anomaly-rules-1';

const THRESHOLDS = {
  lookbackMonths: 6,      // 最多回看几个有效历史月（多了无意义：餐饮账季节性强，半年前的基线不再可比）
  minHistoryMonths: 2,    // 少于 2 个有效历史月 ⇒ 不出项（只有 1 个月不叫"历史"）
  minBaseFen: 20000,      // 历史中位数 ≥ 200 元才纳入比较（小额项噪声大，报了也没人核）
  minAbsDeltaFen: 20000,  // 本月与中位数的**绝对差** ≥ 200 元（防"翻倍但只差 10 块"的假警报）
  upFactor: 2.0,          // 突增：本月 ≥ 中位数 × 2
  downFactor: 0.5,        // 突降：本月 ≤ 中位数 × 0.5
  newItemMinFen: 20000,   // 新增项：历史从未出现、本月 ≥ 200 元
  marginDeltaPct: 8,      // 毛利率偏离 ≥ 8 个百分点才算异常（1~2 个点是正常波动）
  maxItems: 20,           // 清单上限：老板一次最多看 20 条，再多就等于没看
};

// 幅度档位：只用「相对自店历史中位数的偏离百分比」分档，不给金额差、不给外部基准。
//   lt50 = 偏离 <50% · ge50 = 50%~100% · ge100 = 100%~200% · ge200 = ≥200%
function bandOf(ratioPct) {
  if (ratioPct == null || !Number.isFinite(ratioPct)) return null;
  const a = Math.abs(ratioPct);
  if (a >= 200) return 'ge200';
  if (a >= 100) return 'ge100';
  if (a >= 50) return 'ge50';
  return 'lt50';
}
const BAND_RANK = { ge200: 4, ge100: 3, ge50: 2, lt50: 1, ge30pt: 4, ge15pt: 3, ge8pt: 2 };

// 毛利率的幅度用**百分点**，与上面的"相对中位数的百分比"不是同一量纲
// ⇒ 单独一套档位，绝不混用（混了就会出现「-15 个点」被标成 lt50 这种自相矛盾的标签）。
function marginBandOf(pt) {
  if (pt == null || !Number.isFinite(pt)) return null;
  const a = Math.abs(pt);
  if (a >= 30) return 'ge30pt';
  if (a >= 15) return 'ge15pt';
  return 'ge8pt';
}

// 「该不该马上去核」——语义判定，不是按规则名硬编码：
//   费用突增 / 收入突降 / 任一项消失 ⇒ 高；费用下降、收入上升 ⇒ 只是变化，不催。
function attentionOf(rule, scope) {
  if (rule === 'r3_missing') return 'high';
  if (rule === 'r1_up') return scope === 'expense' ? 'high' : 'normal';
  if (rule === 'r2_down') return scope === 'income' ? 'high' : 'normal';
  if (rule === 'r4_new') return 'normal';
  if (rule === 'r5_margin') return 'high';
  return 'normal';
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// getLedger 的出参 → 本模块认的快照。字段缺失一律按「没有这一项」处理（fail-closed，不猜）。
function toSnapshot(ledger) {
  const r = (ledger && ledger.result) || {};
  return {
    month: (ledger && ledger.month) || '',
    account_id: (ledger && ledger.account_id) || '',
    is_archive: !!(ledger && ledger.is_archive),
    income_items: (ledger && ledger.income_items) || [],
    expense_items: (ledger && ledger.expense_items) || [],
    gross_margin_pct: (r.gross_margin_pct == null) ? null : Number(r.gross_margin_pct),
  };
}

// 同月同名行合并（老板可能把「人工」录成两行：后厨 + 前厅）。
// 键 = 收入/费用 + 大类 + 名称 —— 不含大类的纯名称会跨类相撞（「其他」在四个大类里都有）。
function collectAmounts(snap) {
  const out = new Map();
  const put = (scope, rows) => {
    for (const it of rows) {
      const name = String((it && it.name) || '').trim();
      if (!name) continue;
      const key = scope + '|' + String(it.category || '') + '|' + name;
      out.set(key, (out.get(key) || 0) + num(it.amount_fen));
    }
  };
  put('income', snap.income_items);
  put('expense', snap.expense_items);
  return out;
}
function splitKey(key) {
  const p = String(key).split('|');
  return { scope: p[0] || '', category: p[1] || '', name: p.slice(2).join('|') };
}

function readThresholds(opts) {
  const o = (opts && opts.thresholds) || {};
  const t = Object.assign({}, THRESHOLDS);
  for (const k of Object.keys(THRESHOLDS)) if (Number.isFinite(Number(o[k]))) t[k] = Number(o[k]);
  return t;
}

/**
 * 生成异常核对清单（纯函数，无副作用、不读时钟、不调模型）。
 * @param {object} args
 * @param {string} args.month 目标月 'YYYY-MM'
 * @param {Array}  args.months 任意顺序的月快照数组（含目标月本身）
 * @param {object} [args.opts] { thresholds } —— 仅供自测改写阈值以证明判据非恒真
 * @returns {{version:string, month:string, basis:object, items:Array}}
 */
function buildChecklist(args) {
  const a = args || {};
  const t = readThresholds(a.opts);
  const month = String(a.month || '');
  const snaps = (Array.isArray(a.months) ? a.months : []).map(toSnapshot);
  const target = snaps.filter((s) => s.month === month && s.account_id)[0] || null;
  if (!target) {
    return {
      version: RULES_VERSION,
      month,
      basis: { insufficient: true, reason: 'no_target', history_months: 0, months: [], thresholds: t },
      items: [],
    };
  }

  // 历史面：排除未建档月（account_id 为空）、排除目标月自身；新在前，最多 lookbackMonths 个。
  const history = snaps
    .filter((s) => s.account_id && s.month && s.month !== month)
    .sort((x, y) => (x.month < y.month ? 1 : -1))
    .slice(0, t.lookbackMonths);
  const histMonths = history.map((s) => s.month);

  if (history.length < t.minHistoryMonths) {
    return {
      version: RULES_VERSION,
      month,
      basis: {
        insufficient: true, reason: 'history_too_short',
        history_months: history.length, months: histMonths,
        need_months: t.minHistoryMonths, thresholds: t,
      },
      items: [],
    };
  }

  const curMap = collectAmounts(target);
  const histMaps = history.map(collectAmounts);
  const allKeys = new Set(curMap.keys());
  for (const m of histMaps) for (const k of m.keys()) allKeys.add(k);

  const items = [];
  for (const key of allKeys) {
    const { scope, category, name } = splitKey(key);
    const cur = curMap.get(key) || 0;
    // 「历史上有这一项」的判据是「那个月金额 > 0 且真的录入过该行」——
    // 录了 0 元与没录是两件事：前者是"这个月没花"，后者是"没录"。
    const vals = [];
    let present = 0;
    for (const m of histMaps) {
      if (!m.has(key)) continue;
      present += 1;
      const v = m.get(key) || 0;
      if (v > 0) vals.push(v);
    }
    const med = vals.length ? median(vals) : null;

    if (present === 0) {
      if (cur >= t.newItemMinFen) {
        items.push({
          key, scope, category, name,
          rule: 'r4_new', direction: 'new', amount_fen: cur,
          history_median_fen: null, history_months: 0, ratio_pct: null, band: null,
          attention: attentionOf('r4_new', scope),
        });
      }
      continue;
    }
    // 历史里出现过、但**有金额**的月份不够 minHistoryMonths ⇒ 基线太薄，不比（fail-closed）
    if (vals.length < t.minHistoryMonths || med == null || med < t.minBaseFen) continue;

    if (cur === 0) {
      items.push({
        key, scope, category, name,
        rule: 'r3_missing', direction: 'missing', amount_fen: 0,
        history_median_fen: med, history_months: vals.length, ratio_pct: -100, band: bandOf(-100),
        attention: attentionOf('r3_missing', scope),
      });
      continue;
    }
    if (cur >= med * t.upFactor && (cur - med) >= t.minAbsDeltaFen) {
      const ratio = (cur / med - 1) * 100;
      items.push({
        key, scope, category, name,
        rule: 'r1_up', direction: 'up', amount_fen: cur,
        history_median_fen: med, history_months: vals.length, ratio_pct: ratio, band: bandOf(ratio),
        attention: attentionOf('r1_up', scope),
      });
      continue;
    }
    if (cur <= med * t.downFactor && (med - cur) >= t.minAbsDeltaFen) {
      const ratio = (cur / med - 1) * 100;
      items.push({
        key, scope, category, name,
        rule: 'r2_down', direction: 'down', amount_fen: cur,
        history_median_fen: med, history_months: vals.length, ratio_pct: ratio, band: bandOf(ratio),
        attention: attentionOf('r2_down', scope),
      });
    }
    // 其余（在阈值内）＝「跟你自己的历史一致」⇒ 不进清单。清单只装"要去看一眼"的东西。
  }

  // 毛利率：整店口径（M1 的毛利率含外卖，与 M3 的菜品毛利率不同义 —— 清单只说"整店"）
  const gms = history.map((s) => s.gross_margin_pct).filter((v) => v != null && Number.isFinite(v));
  if (target.gross_margin_pct != null && gms.length >= t.minHistoryMonths) {
    const gmed = median(gms);
    const d = target.gross_margin_pct - gmed;
    if (Math.abs(d) >= t.marginDeltaPct) {
      items.push({
        key: 'result|gross_margin', scope: 'result', category: '', name: '',
        rule: 'r5_margin', direction: d > 0 ? 'up' : 'down',
        amount_fen: null,
        history_median_fen: null, history_months: gms.length,
        // 毛利率用「百分点」，不是百分比 —— 45% → 30% 是 -15 个点，不是 -33%
        ratio_pct: d, ratio_unit: 'pt', band: marginBandOf(d),
        attention: attentionOf('r5_margin', 'result'),
      });
    }
  }

  // 排序：先按"要不要马上去看"，再按幅度档，最后按名字（稳定可比对，不依赖 Map 插入序）
  const rank = (it) => (it.attention === 'high' ? 2 : 1);
  items.sort((x, y) => {
    const r = rank(y) - rank(x);
    if (r) return r;
    const b = (BAND_RANK[y.band] || 0) - (BAND_RANK[x.band] || 0);
    if (b) return b;
    const m = Math.abs(y.ratio_pct == null ? 0 : y.ratio_pct) - Math.abs(x.ratio_pct == null ? 0 : x.ratio_pct);
    if (m) return m;
    return x.key < y.key ? -1 : (x.key > y.key ? 1 : 0);
  });

  return {
    version: RULES_VERSION,
    month,
    basis: {
      insufficient: false,
      history_months: history.length,
      months: histMonths,
      thresholds: t,
    },
    items: items.slice(0, t.maxItems),
  };
}

module.exports = { RULES_VERSION, THRESHOLDS, bandOf, toSnapshot, buildChecklist };
