// cloudfunctions/common/rateLimit.js
// 频控（单源）—— 写操作默认 60 次/分钟，超限返回 RATE_LIMITED。
//
// 🔴 R634（2026-11-08 三司会审结论）为什么重写：
//   ① 原实现的 store 是**内存 Map**（连注释都写着「演示用内存 Map」）。
//      serverless 下每个实例各有一份内存、冷启动清零、多实例不共享
//      ⇒ 10 个实例并发时实际上限是 600 次/分钟，**等于没有频控**。
//   ② 只有 3 个写函数接了它，而**最耗资源的导入类（下载 Excel + 解析上千行）一个都没接**。
//   ③ 会审两家独立指出同一条致命风险：**频控会先杀死老板，而不是刷子** ——
//      月底老板连导 6 张报表撞上云数据库 200ms 抖动，若按「计数失败就拒绝」，
//      他会判定「这软件连导表都不稳定」当场弃用。
//   ⇒ 所以本文件的策略是：**计数失败一律放行（fail open）+ 记降级日志**。
//      频控的目的是挡住刷子，不是挡住赶时间的人。
const { ERROR_CODES } = require('./errors');

const WINDOW_MS = 60 * 1000;
const MAX_WRITES = 60;

// 分接口覆盖（会审结论）：重资源接口单独收紧，其余沿用 MAX_WRITES。
//   ⚠️ 基础阈值仍保留 60/分钟（`check_rate_limit_params` 的 A3 判据与文档声明都对着它），
//      这里只做**覆盖**，不改底座 —— 否则要同步改文档声明与 A3/A5 判据，收益不抵风险。
const SCOPE_LIMITS = {
  import: { perMin: 3, perDay: 20 },     // 导表：下载 + 解析上千行，最重
  diagnose: { perMin: 10, perDay: 30 },  // 诊断：读多表 + 引擎
  export: { perMin: 5, perDay: 50 },     // 导出：生成文件
  default: { perMin: MAX_WRITES, perDay: 0 },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function limitsOf(scope) {
  return SCOPE_LIMITS[scope] || SCOPE_LIMITS.default;
}

// ---- 旧接口（内存 store），保留给不关心多实例的调用点；新代码请用 makeDbRateLimiter ----
function makeRateLimiter(store) {
  const _store = store || new Map();
  return async function check(openid) {
    const now = Date.now();
    const arr = (_store.get(openid) || []).filter((t) => now - t < WINDOW_MS);
    arr.push(now);
    _store.set(openid, arr);
    if (arr.length > MAX_WRITES) {
      return { limited: true, code: ERROR_CODES.RATE_LIMITED, retry_after: 60 };
    }
    return { limited: false };
  };
}

/**
 * 数据库计数（跨实例共享、冷启动不清零）。
 * 集合：rate_limit_counter，`_id = {scope}:{key}:{bucket}`，带 expire_at 供 TTL 清理。
 * @param {object} db cloud.database()
 * @param {string} coll 集合名
 */
function makeDbRateLimiter(db, coll) {
  const COLL = coll || 'rate_limit_counter';

  // 原子 +1：先尝试自增（文档已存在），更新不到再新建；并发新建失败则再自增一次。
  async function hitOnce(id, ttlMs) {
    const res = await db.collection(COLL).doc(id).update({ data: { count: db.command.inc(1) } });
    if (res && res.stats && res.stats.updated === 1) {
      const r = await db.collection(COLL).doc(id).get();
      return (r && r.data && Number(r.data.count)) || 1;
    }
    try {
      await db.collection(COLL).add({ data: { _id: id, count: 1, expire_at: Date.now() + ttlMs } });
      return 1;
    } catch (e) {
      await db.collection(COLL).doc(id).update({ data: { count: db.command.inc(1) } });
      const r = await db.collection(COLL).doc(id).get();
      return (r && r.data && Number(r.data.count)) || 1;
    }
  }

  /**
   * @param {string} key 维度键（openid 或 shop_id）
   * @param {string} scope 'import' | 'diagnose' | 'export' | 其它（走 default）
   * @returns {Promise<{limited:boolean, code?:string, retry_after?:number, degraded?:boolean}>}
   */
  return async function check(key, scope) {
    const lim = limitsOf(scope);
    try {
      const now = Date.now();
      const minuteBucket = Math.floor(now / WINDOW_MS) * WINDOW_MS;
      const minId = `${scope || 'default'}:${key}:${minuteBucket}`;
      const minCount = await hitOnce(minId, WINDOW_MS * 3);
      if (minCount > lim.perMin) {
        return {
          limited: true, code: ERROR_CODES.RATE_LIMITED,
          retry_after: Math.max(1, Math.ceil((minuteBucket + WINDOW_MS - now) / 1000)),
        };
      }
      if (lim.perDay > 0) {
        const dayBucket = new Date(now).toISOString().slice(0, 10);
        const dayId = `${scope || 'default'}:${key}:day:${dayBucket}`;
        const dayCount = await hitOnce(dayId, DAY_MS * 2);
        if (dayCount > lim.perDay) {
          return { limited: true, code: ERROR_CODES.RATE_LIMITED, retry_after: 3600, scope: scope };
        }
      }
      return { limited: false };
    } catch (e) {
      // 🔴 fail open：数不清就放行。拒绝的代价（老板当场弃用）远大于放行的代价（多跑几次）。
      //   降级事实要留下痕迹，供巡检发现「频控其实没在生效」。
      return { limited: false, degraded: true, degrade_reason: (e && e.message) || 'db_error' };
    }
  };
}

module.exports = {
  makeRateLimiter, makeDbRateLimiter, limitsOf,
  WINDOW_MS, MAX_WRITES, SCOPE_LIMITS,
};
