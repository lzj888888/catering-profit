// cloudfunctions/common/diagnosisEntitlement.js —— 深度诊断的**旁路**权益判定（A4 · 2026-11-05）
//
// 🔴 设计前提（不是风格问题，是硬约束）：
//   `common/entitlement.js::isPaid` 是全仓**唯一**付费判定口径，M1/M2/M3 全部已验付费墙都挂在它上面。
//   诊断要的是**另一个维度**（次数/去重/限流），与本文件之外的"付没付钱"并不是同一件事。
//   ⇒ 本文件**只读** entitlement 的 `loadExpireAt` / `isPaid`，**绝不修改它们**，也不往
//     `PAID_FEATURES` 里加诊断键（加了会让 `hasFeature('export')` 之类的既有语义被牵连）。
//
// 🔴 为什么门槛不在同一个开关上：
//   免费层给的是「免费简诊」（页面即时算，不落台账、不进本文件）；
//   本文件管的是「深度诊断」（落台账、可对比、永久可看、可能烧 AI 成本）。
//   两者是**两个产品**，不是一个产品的两个档 —— 所以免费简诊永远不看这个函数。
//
// 🔴 前置事实（实测，不是假设）：`shop_entitlement` 只有 `expire_at` + `source`，**不记 plan_id**。
//   `source` 是 'manual' / 订单来源，不是档位。⇒ 判定层**读不到用户买的是哪一档**。
//   当前唯一的可依赖事实：启用的订阅档（月/季/年）**全部** `diag_unlimited:true`（李老师 2026-11-05 拍板）。
//   ⇒ 判定简化为「isPaid ⇒ 期内不限次诊断」，并由 `tools/check_diag_entitlement.js` 的 S-③
//     断言「所有 enabled 订阅档都含 diag_unlimited」，防止**将来新增一档不含诊断的订阅**
//     时这条推导静默变成错的（那时必须改成读档位，不能靠注释提醒）。
//
// ⚠️ 新增符号必须在 common/index.js 聚合入口同步导出（genId 事故族；伴侣守卫 tools/check_requires.js §2）。

const { isPaid, loadExpireAt } = require('./entitlement');

/** 诊断类型：闭店 / 开店。**不混比**（定稿 §5：闭店 vs 开店的对比页无意义）。 */
const DIAG_TYPES = ['close', 'open'];
/** 报告标识：与 diag_type 一起构成「一类诊断」 */
const DIAG_REPORT_COLL = 'shop_diagnosis_report';
const DIAG_CREDIT_COLL = 'shop_diagnosis_credit';

// ===== 三道护栏的常量（定稿 §2.2 / §2.5）=====
/** 一级去重窗口：同店同类型同数据指纹，24h 内重复跑 ⇒ 返回上次结果，**不重算、不扣额度** */
const CACHE_WINDOW_MS = 24 * 3600 * 1000;
/** 限流（只拦脚本，真人一个月 3–5 次，远达不到）：同店同类型 5 次/小时、30 次/天 */
const LIMIT_PER_HOUR = 5;
const LIMIT_PER_DAY = 30;
/** 篇幅封顶（护栏二）：报告正文 ≤ 2500 字、图表 ≤ 6 张。**这里是常量，实施方不许在渲染层另立数字**。 */
const REPORT_MAX_CHARS = 2500;
const REPORT_MAX_CHARTS = 6;

/**
 * 判定本体（**纯函数**，零 IO，便于 selftest 直接构造边界）。
 *
 * 顺序是刻意定的，每一步都不能提前或推后：
 *   ① 参数非法 → 拒（fail-closed，不猜）
 *   ② 缓存命中 → 放行且 **useCache=true**。为什么排在权益之前：
 *      它**不产生新成本**；而且「已出的报告永久可看」是定稿 §3 的硬底线 ——
 *      订阅到期后用户仍应能打开自己买过的报告，这一步不该被权益判定拦住。
 *   ③ 限流 → 拒。为什么排在权益之前：
 *      限流保护的是算力，付费用户刷脚本同样烧钱；扣他自己买来的额度也不该被脚本刷掉。
 *   ④ 订阅有效 → 放行（期内不限次）
 *   ⑤ 单次额度 > 0 → 放行并**消费 1 次**（consumeCredit=true，由调用方做原子扣减）
 *   ⑥ 其余 → 拒（need_pay）。注意：拒的是**深度诊断**，不是免费简诊。
 *
 * @param {{argsOk:boolean, cache:object|null, hourCount:number, dayCount:number, paid:boolean, creditsLeft:number}} input
 * @returns {{allowed:boolean, reason:string, paySource:string, useCache:boolean, consumeCredit:boolean}}
 */
function judgeDiagnosis(input) {
  const i = input || {};
  // ① 参数
  if (!i.argsOk) return res(false, 'bad_args', '', false, false);
  // ② 缓存（不扣额度、不看权益 —— 报告永久可看）
  if (i.cache) return res(true, 'cache_hit', String(i.cache.pay_source || ''), true, false);
  // ③ 限流
  const hour = Number(i.hourCount || 0);
  const day = Number(i.dayCount || 0);
  if (hour >= LIMIT_PER_HOUR || day >= LIMIT_PER_DAY) return res(false, 'rate_limited', '', false, false);
  // ④ 订阅（期内不限次）
  if (i.paid) return res(true, 'ok', 'subscription', false, false);
  // ⑤ 单次额度
  if (Number(i.creditsLeft || 0) > 0) return res(true, 'ok', 'single', false, true);
  // ⑥ 无权益
  return res(false, 'need_pay', '', false, false);
}

function res(allowed, reason, paySource, useCache, consumeCredit) {
  return { allowed: !!allowed, reason, paySource: paySource || '', useCache: !!useCache, consumeCredit: !!consumeCredit };
}

/** 参数合法性（与 judgeDiagnosis 分离，便于单测与调用方复用） */
function isValidArgs(userId, shopId, diagType) {
  return !!(userId && shopId && DIAG_TYPES.indexOf(diagType) >= 0);
}

/**
 * 稳定序列化（递归、键排序）：对象/数组**必须递归展开**，不能塌成一个占位符。
 * 🔴 第一版实现把所有对象写成 `{obj}`，结果是 `{a:{x:1}}` 与 `{a:{y:2}}` 撞成同一指纹
 *    ⇒ 补录项对象（如 future 的嵌套指标）改了也不重算，用户看到旧结论（零报错）。
 *    本函数由 `tools/check_diag_engine.js` F-④ 守。
 */
function stable(v) {
  if (v === null || v === undefined) return '~';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => k + ':' + stable(v[k])).join(',') + '}';
  }
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  return String(v);
}

/**
 * 数据指纹：**只对参与计分的值做稳定序列化**，用于 24h 去重。
 * 🔴 不能用 `JSON.stringify(obj)` 直接拼：键顺序不稳 ⇒ 同一份数据算出两个指纹 ⇒ 去重永不命中（
 *    表现是"不报错，但每次都真重算"，成本翻倍且查不出来）。
 * 🔴 也不能只哈希月份：用户改了「补录 5 项」（客流/租约/月供）而月度数据没变时，
 *    结果会变，必须算作新快照 ⇒ 入参是**完整指标输入集合**，不是 month 字符串。
 */
function fingerprint(inputs) {
  const s = stable(inputs || {});
  // FNV-1a 32bit（与 indicatorRef._fnv1a 同族，但不跨文件复用：它是模块私有函数）
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return 'snap-' + ('0000000' + h.toString(16)).slice(-8);
}

/**
 * IO 编排：读状态 → 交给 judgeDiagnosis → 必要时消费额度。
 *
 * @param {object} db 云开发 db（可注入桩，供 selftest）
 * @param {{userId:string, shopId:string, diagType:string, snapshotHash:string, now?:number}} opts
 * @returns {Promise<{allowed:boolean, reason:string, paySource:string, useCache:boolean,
 *                    cacheReport:object|null, creditsLeft:number, retryAfterMs:number}>}
 */
async function canRunDiagnosis(db, opts) {
  const o = opts || {};
  const now = o.now == null ? Date.now() : o.now;
  const base = { allowed: false, reason: '', paySource: '', useCache: false, cacheReport: null, creditsLeft: 0, retryAfterMs: 0 };

  if (!isValidArgs(o.userId, o.shopId, o.diagType)) return Object.assign(base, { reason: 'bad_args' });

  // ---- 读：24h 内同指纹的历史报告（去重面）----
  let cache = null;
  try {
    const r = await db.collection(DIAG_REPORT_COLL).where({
      user_id: o.userId, shop_id: o.shopId, diag_type: o.diagType, snapshot_hash: o.snapshotHash,
    }).orderBy('created_at', 'desc').limit(1).get();
    const hit = r && r.data && r.data[0];
    // 只认窗口内的；窗口外的是"历史报告"，可看但不是这次的去重目标
    if (hit && Number(hit.created_at || 0) >= now - CACHE_WINDOW_MS) cache = hit;
  } catch (e) {
    // 🔴 读失败**不能**当成"没缓存"往下走：那会让限流失效、重复扣额度。
    //    也不能直接放行：算力闸门 fail-closed 的代价是一次提示，放行的代价是成本失控。
    return Object.assign(base, { reason: 'store_error' });
  }

  // ---- 读：限流计数（同店同类型）----
  let hourCount = 0;
  let dayCount = 0;
  try {
    const [hRes, dRes] = await Promise.all([
      db.collection(DIAG_REPORT_COLL).where({
        shop_id: o.shopId, diag_type: o.diagType, created_at: db.command.gte(now - 3600 * 1000),
      }).count(),
      db.collection(DIAG_REPORT_COLL).where({
        shop_id: o.shopId, diag_type: o.diagType, created_at: db.command.gte(now - 24 * 3600 * 1000),
      }).count(),
    ]);
    hourCount = (hRes && hRes.total) || 0;
    dayCount = (dRes && dRes.total) || 0;
  } catch (e) {
    return Object.assign(base, { reason: 'store_error' });
  }

  // ---- 读：权益与额度 ----
  const expireAt = await loadExpireAt(db, o.userId);
  const paid = isPaid(expireAt, now);
  const creditsLeft = await readCredits(db, o.userId);

  const verdict = judgeDiagnosis({ argsOk: true, cache, hourCount, dayCount, paid, creditsLeft });

  // ---- 写：单次额度消费（只有 ⑤ 分支会走到）----
  if (verdict.allowed && verdict.consumeCredit) {
    const okConsume = await consumeOneCredit(db, o.userId, now);
    if (!okConsume) {
      // 并发被抢（两个请求同时读到 creditsLeft=1）：如实拒绝，不假设成功
      return Object.assign(base, { reason: 'need_pay', creditsLeft: 0 });
    }
  }

  return Object.assign(base, {
    allowed: verdict.allowed,
    reason: verdict.reason,
    paySource: verdict.paySource,
    useCache: verdict.useCache,
    cacheReport: verdict.useCache ? cache : null,
    creditsLeft: verdict.consumeCredit ? Math.max(0, creditsLeft - 1) : creditsLeft,
    retryAfterMs: verdict.reason === 'rate_limited' ? 3600 * 1000 : 0,
  });
}

/** 读剩余额度（账号级）。无记录 = 0。读失败 ⇒ 0（宁可让用户看到"需购买"，也不放行未付费诊断）。 */
async function readCredits(db, userId) {
  try {
    const r = await db.collection(DIAG_CREDIT_COLL).where({ user_id: userId }).limit(1).get();
    const d = r && r.data && r.data[0];
    return d ? Math.max(0, Number(d.credits_left || 0)) : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * 原子消费 1 次额度。
 * 🔴 必须是**条件更新**（`credits_left >= 1` 才减），不能"先读后写"：
 *    两个并发请求都读到 1、都减 1 ⇒ 只买了一次却跑了两份诊断。
 *    这里返回 false 让上层如实拒绝，而不是假设成功。
 */
async function consumeOneCredit(db, userId, now) {
  try {
    const r = await db.collection(DIAG_CREDIT_COLL).where({ user_id: userId, credits_left: db.command.gte(1) })
      .update({ data: { credits_left: db.command.inc(-1), updated_at: now } });
    const updated = (r && (r.stats ? r.stats.updated : r.updated)) || 0;
    return updated > 0;
  } catch (e) {
    return false;
  }
}

module.exports = {
  DIAG_TYPES,
  DIAG_REPORT_COLL,
  DIAG_CREDIT_COLL,
  CACHE_WINDOW_MS,
  LIMIT_PER_HOUR,
  LIMIT_PER_DAY,
  REPORT_MAX_CHARS,
  REPORT_MAX_CHARTS,
  judgeDiagnosis,
  isValidArgs,
  fingerprint,
  canRunDiagnosis,
  readCredits,
  consumeOneCredit,
};
