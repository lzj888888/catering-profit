// cloudfunctions/dbHealthCheck/service.js —— 线上健康巡检判据（纯函数，零依赖，可单测）
//
// 为什么要有这个函数（R748 / S-1）：
//   上线前有一堆"发布前审计"，但**上线后没人盯着**。备份每月才跑一次，
//   如果某个月静默失败，下一次出事时才发现"原来一直没备份"——那时已经晚了。
//   本函数把「怎么算健康」变成可测的纯判断，index.js 只负责取数与落库。
//
// 判据为什么是 35 天而不是 36 小时：
//   dbBackup 的触发器是 `0 0 10 1 * * *`（**每月 1 日 10:00**），不是每日。
//   所以「最近一次备份距今 > 35 天」才叫断档（31 天 + 几天缓冲，避免月末误报）。
'use strict';

const BACKUP_MAX_AGE_DAYS = 35;
const DAY_MS = 86400000;

/**
 * 判断最近一次备份是否健康。
 * @param {object|null} lastRun audit_log 里最近一条 DB_BACKUP_RUN（{created_at, after_data}）
 * @param {number} nowMs 当前毫秒
 * @returns {{level:'ok'|'warn'|'alert'|'unknown', reason:string, ageDays:number|null}}
 */
function judgeBackup(lastRun, nowMs) {
  if (!lastRun) {
    // 🔴 新环境首次巡检必然没有记录 —— 判 unknown 而不是 alert，
    //   否则上线第一天就报"备份失败"，会造成告警疲劳（真出问题反而没人看）。
    return { level: 'unknown', reason: '尚未有备份记录（新环境首次巡检属正常）', ageDays: null };
  }
  const t = Date.parse(String(lastRun.created_at || ''));
  if (!isFinite(t)) {
    return { level: 'warn', reason: '最近备份记录的时间不可解析', ageDays: null };
  }
  const ageDays = Math.floor((nowMs - t) / DAY_MS);
  const ad = lastRun.after_data || {};

  // 备份自己报了失败 —— 最高优先级，比"时间新"更重要（跑了但没跑成）
  if (ad.ok === false) {
    return {
      level: 'alert',
      reason: '最近一次备份未完全成功：done=' + (ad.done || 0) +
        ' failed=' + (ad.failed || 0) + ' pending=' + (ad.pending || 0) +
        '（' + ageDays + ' 天前）',
      ageDays: ageDays,
    };
  }
  if (ageDays > BACKUP_MAX_AGE_DAYS) {
    return {
      level: 'alert',
      reason: '备份已断档 ' + ageDays + ' 天（触发器为每月 1 日 10:00，超过 ' +
        BACKUP_MAX_AGE_DAYS + ' 天即视为漏跑）',
      ageDays: ageDays,
    };
  }
  return { level: 'ok', reason: ageDays + ' 天前备份成功（' + (ad.total_rows || 0) + ' 行）', ageDays: ageDays };
}

/**
 * 判断一组集合的读取结果是否健康。
 * ⚠️ 为什么巡检不判「备份是否新鲜」：dbBackup 有一条硬红线「只读业务库、只写云存储」，
 *   任何 db 写（含写 audit_log）都被 check_db_backup B-⑨ 判红 —— 因为备份这个动作本身
 *   改变数据会导致「备份写自己正在备的表」的递归问题。所以我**不能**让备份把结果落库，
 *   也就没有可自动读取的备份元数据。备份状态仍靠每月 1 日看云函数日志（人工）。
 *   巡检改做**能自动判且真有用**的那部分：数据库连通性 + 关键集合可读。
 * @param {Array<{collection:string, ok:boolean, error?:string}>} reads
 * @returns {{level:string, reason:string}}
 */
function judgeCollections(reads) {
  const list = reads || [];
  if (!list.length) return { level: 'warn', reason: '未配置检查项（巡检面为空）' };
  const bad = list.filter((r) => !r.ok);
  if (!bad.length) return { level: 'ok', reason: list.length + ' 个关键集合可读' };
  return {
    level: 'alert',
    reason: '读取失败：' + bad.map((r) => r.collection + '(' + (r.error || 'unknown') + ')').join('；'),
  };
}

/**
 * 汇总巡检结论。
 * @param {Array<{item:string, level:string, reason:string}>} checks
 * @returns {{level:string, alertCount:number, warnCount:number, summary:string}}
 */
function aggregate(checks) {
  const list = checks || [];
  const alerts = list.filter((c) => c.level === 'alert').length;
  const warns = list.filter((c) => c.level === 'warn').length;
  const level = alerts > 0 ? 'alert' : (warns > 0 ? 'warn' : 'ok');
  const bad = list.filter((c) => c.level === 'alert' || c.level === 'warn');
  const summary = bad.length
    ? bad.map((c) => c.item + '：' + c.reason).join('；')
    : '全部正常（' + list.length + ' 项）';
  return { level: level, alertCount: alerts, warnCount: warns, summary: summary };
}

module.exports = { judgeBackup, judgeCollections, aggregate, BACKUP_MAX_AGE_DAYS };
