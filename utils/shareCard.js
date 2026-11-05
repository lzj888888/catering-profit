// utils/shareCard.js —— 分享卡片标题 / 落地路径的**唯一装配口**（R395 · 队列 #11）
//
// 🔴 为什么要有它（而不是每页各写一段 onShareAppMessage）：
//   分享卡片是老板把「店算」发给朋友时，对方看到的**唯一一句话**。此前全仓零 `onShareAppMessage`
//   ⇒ 微信一律拿小程序名当标题，对方看不出这工具能干什么（PLAN_AI §2「页面可被读懂」的落点）。
//   三个入口若各写一遍拼装，必然漂成三套口径（本仓最贵的病：同一语义多份实现）⇒ 收敛成纯函数模块。
//
// 🔴 口径边界（不许越界）：
//   · 只拼**页面已经算出的数字**（原始「分」由页面传进来），本模块不重算任何业务公式、不改利润口径；
//   · 缺数（无账本 / 还没算 / 没定价）⇒ 退回一句「这工具能干什么」的话，**绝不编 0**
//     （编 0 会说出「最后剩下 0 元」这种假结论，与 R298「无账本月恒真判据」同族）；
//   · 措辞不得出现 `TERMS.forbidden` 的禁词（盈利 / 赚钱 / 投资 / 回本周期 / 收益率…）—— 守 `check_terms_forbidden`；
//   · **不承诺被微信推荐**（PLAN_AI §2：微信没有公开接口，写进宣传就是骗人）。
//
// 🤖 守卫：`tools/check_share_card.js`（行为面 + 页面接线面 + 反恒真 + 禁词回归）

const api = require('./api.js');
const { TERMS } = require('../miniprogram/i18n/terms.js');

const S = TERMS.share;

// 落地页（分享点进来落在哪一页）—— 写死成常量，避免三处各写一遍路径而漂移
const PATH = {
  m1: '/subpkg/biz/month/result',
  m2: '/subpkg/tools/sandbox/index',
  m3: '/subpkg/biz/card/index',
};

/**
 * 把模板占位符 `{a}` / `{b}` / `{c}` 换掉。
 * ⚠️ 不用正则替换：模板里全是字面量，`split/join` 语义更硬（也不受本机反斜杠转义坑影响）。
 */
function fill(tpl, map) {
  let out = String(tpl == null ? '' : tpl);
  const ks = map || {};
  for (const k in ks) {
    if (!Object.prototype.hasOwnProperty.call(ks, k)) continue;
    out = out.split('{' + k + '}').join(String(ks[k]));
  }
  return out;
}

/** 分 → 「元」整数串（复用 api 的单源实现，不在这里重写四舍五入）。 */
function yuan(fen) {
  return api.fenToYuanInt(fen);
}

/** 有效月份才拼进 query（`YYYY-MM`，纯字符判断，不用正则）。 */
function monthOf(m) {
  const s = String(m == null ? '' : m);
  if (s.length !== 7 || s.charAt(4) !== '-') return '';
  for (let i = 0; i < 7; i++) {
    if (i === 4) continue;
    const c = s.charAt(i);
    if (c < '0' || c > '9') return '';
  }
  return s;
}

function withMonth(base, month) {
  const m = monthOf(month);
  return m ? base + '?month=' + m : base;
}

/**
 * M1 月度结果页分享卡片。
 * @param {object} o
 * @param {boolean} o.hasLedger  本月是否真的建了账本（`getLedger` 的 `account_id`，R298 定下的单源判据）
 * @param {number}  o.breakEvenFen 保本营业额（分）—— 后端/纯函数 breakeven 的 `breakevenFen`
 * @param {number}  o.profitFen    真利润（分）—— `total_factor_real_profit_fen`
 * @param {string}  o.month        `YYYY-MM`，带进 query 让点进来的人落在同一个月
 */
function m1Share(o) {
  const x = o || {};
  const be = Number(x.breakEvenFen);
  const pf = Number(x.profitFen);
  const path = withMonth(PATH.m1, x.month);
  // 没账本 / 保本线算不出来 ⇒ 不编数字，只说这工具能干什么
  if (x.hasLedger !== true || !Number.isFinite(be) || be <= 0) {
    return { title: S.m1Empty, path };
  }
  if (Number.isFinite(pf) && pf < 0) {
    // 亏损月：说「还亏多少」比说「保本要卖多少」更贴近老板当月的痛感
    return { title: fill(S.m1Loss, { a: yuan(be), b: yuan(-pf) }), path };
  }
  if (Number.isFinite(pf)) {
    return { title: fill(S.m1Win, { a: yuan(be), b: yuan(pf) }), path };
  }
  return { title: fill(S.m1NeedOnly, { a: yuan(be) }), path };
}

/**
 * M2 开店测算页分享卡片（已有铺面 / 找铺面两种场景都落在同一页）。
 * @param {object} o
 * @param {boolean} o.ready       本次是否真的算出了结果（`data.result` 非空且非 red_alert）
 * @param {number}  o.breakEvenFen 月保本营业额（分）
 */
function m2Share(o) {
  const x = o || {};
  const be = Number(x.breakEvenFen);
  if (x.ready !== true || !Number.isFinite(be) || be <= 0) {
    return { title: S.m2Empty, path: PATH.m2 };
  }
  return { title: fill(S.m2Ready, { a: yuan(be) }), path: PATH.m2 };
}

/**
 * M3 菜品成本列表分享卡片。
 * @param {object} o
 * @param {number} o.priced  已定价（毛利率算得出）的卡数
 * @param {number} o.low     其中毛利率低于 `band` 档位线的张数
 * @param {number} o.band    档位线（来自 `utils/marginBand.js::MID`，页面传，不在这里写死阈值）
 */
function m3Share(o) {
  const x = o || {};
  const total = Number(x.priced);
  const low = Number(x.low);
  const band = Number(x.band);
  if (!Number.isFinite(total) || total <= 0) {
    return { title: S.m3Empty, path: PATH.m3 };
  }
  const tag = Number.isFinite(band) ? band : '';
  // ⚠️ 这两个是**张数**不是金额 ⇒ 不能过 `yuan()`（那是分→元，会把 12 张写成 0.12 元）
  const n = (v) => String(Math.round(v));
  if (!tag) {
    // 档位线缺失（页面没传）⇒ 只报张数，不编一个百分比
    return { title: fill(S.m3Count, { a: n(total) }), path: PATH.m3 };
  }
  if (Number.isFinite(low) && low > 0) {
    return { title: fill(S.m3Low, { a: n(total), b: n(low), c: tag }), path: PATH.m3 };
  }
  return { title: fill(S.m3Ok, { a: n(total), c: tag }), path: PATH.m3 };
}

module.exports = { PATH, fill, m1Share, m2Share, m3Share };
