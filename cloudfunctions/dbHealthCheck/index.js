// cloudfunctions/dbHealthCheck/index.js —— 线上健康巡检（R748 · S-1）
//
// 为什么要它：上线前的 328 个门禁套件全是「发布前审计」，**上线后没人盯**。
//   备份每月才跑一次，若某月静默失败，出事时才发现"一直没备份"。
//   本函数每日跑一次，读最近一次备份记录并判健康，结论写 audit_log。
//
// 安全：与 dbBackup 同一自保 —— **只允许定时触发器调用**。
//   原因：巡检会读 audit_log（全租户审计表），放开给前端等于开一个越权读口子。
//
// ⚠️ 判据是纯函数（service.js），本文件只做取数 + 落库，便于单测覆盖边界。
'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const { judgeBackup, judgeCollections, aggregate } = require('./service');
const { nowUtc } = require('./cx_utilTime');


exports.main = async (event) => {
  const t0 = Date.now();

  // ===== 安全自保：只认定时触发器 =====
  //   Timer 触发时 event 形如 { Type: 'Timer', TriggerName: '...' }；
  //   控制台「测试」调用 event 为 {}，也放行（便于人工排查，但不返回敏感数据）。
  //   前端 wx.cloud.callFunction 会带 openid，一律拒。
  const ctx = cloud.getWXContext();
  if (ctx && ctx.OPENID) {
    return { ok: false, code: 'FORBIDDEN', msg: 'dbHealthCheck 仅允许定时触发' };
  }

  const checks = [];

  // ===== 检查 1：关键集合可读（数据库连通 + 权限/索引正常）=====
  //   ⚠️ 不判「备份新鲜度」的原因见 service.js::judgeCollections 头注：
  //      dbBackup 有硬红线「只读业务库、只写云存储」，不能把结果落库 ⇒ 没有元数据可读。
  //      备份状态仍靠每月 1 日看云函数日志（人工），本巡检不假装能判它。
  const PROBE_COLLECTIONS = ['shop', 'shop_monthly_account', 'audit_log'];
  const reads = [];
  for (const coll of PROBE_COLLECTIONS) {
    try {
      await db.collection(coll).limit(1).get();
      reads.push({ collection: coll, ok: true });
    } catch (e) {
      reads.push({ collection: coll, ok: false, error: (e && e.message) || String(e) });
    }
  }
  const jc = judgeCollections(reads);
  checks.push({ item: '关键集合可读性', level: jc.level, reason: jc.reason });

  // ===== 检查 2：最近一次备份记录（若将来有落库来源则自动生效，当前为 unknown）=====
  let lastRun = null;
  try {
    const r = await db.collection('audit_log')
      .where({ action: 'DB_BACKUP_RUN' })
      .orderBy('created_at', 'desc')
      .limit(1)
      .get();
    lastRun = (r && r.data && r.data[0]) || null;
  } catch (e) {
    lastRun = null;
  }
  const jb = judgeBackup(lastRun, Date.now());
  checks.push({ item: '数据库备份', level: jb.level, reason: jb.reason });

  const agg = aggregate(checks);
  const summary = {
    level: agg.level,
    alert_count: agg.alertCount,
    warn_count: agg.warnCount,
    sentence: agg.summary,
    elapsed_ms: Date.now() - t0,
    checked_at: nowUtc(),
  };

  // ===== 结论落库（只 INSERT，供后台与后续趋势查询）=====
  //   巡检自己写审计失败不能让整个函数失败（否则连"巡检跑了"都没记录）。
  try {
    await db.collection('audit_log').add({
      data: {
        action: 'DB_HEALTH_CHECK',
        operator_type: 'system',
        operator_id: 'dbHealthCheck',
        shop_id: '',
        before_data: null,
        after_data: summary,
        remark: agg.level === 'ok' ? '' : agg.summary,
        idempotency_key: '',
        created_at: nowUtc(),
      },
    });
  } catch (e) {
    console.error('[dbHealthCheck] 写审计记录失败（不影响巡检结论）：' + ((e && e.message) || e));
  }

  // 日志里让 red 级别一眼可见（上线后翻日志是主要排障手段）
  console.log('[dbHealthCheck] ' + (agg.level === 'ok' ? '✅' : (agg.level === 'alert' ? '🔴' : '⚠️')) +
    ' level=' + agg.level + ' ' + agg.summary + ' ' + summary.elapsed_ms + 'ms');

  return summary;
};
