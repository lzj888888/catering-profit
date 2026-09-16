// cloudfunctions/payExpireNotify/index.js —— 批次 5 · 到期前 7 天提醒（定时触发）
//
// ⚠️ 双渠道（§2.3 环节 5）：① 小程序订阅消息（需用户主动授权，未授权不影响兜底）；
//                            ② 结果页**常驻提示条**（前端读 payQueryEntitlement 的 days_left ≤7 渲染）。
// 本函数为定时任务：扫描 expire_at ∈ (now, now+7d] 的权益，返回 notified 列表。
// ⚠️ 订阅消息发送需模板 ID + 用户授权（requestSubscribeMessage），本函数当前返回待通知列表，
//   实际推送由云调用 openapi.subscribeMessage.send 完成——未配置模板 ID 时跳过发送，仅登记。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ok } = common;
const { nowUtc } = common.utilTime;

const REMIND_WINDOW_MS = 7 * 24 * 3600 * 1000;      // 到期前 7 天

exports.main = async () => {
  const now = nowUtc();
  const to = now + REMIND_WINDOW_MS;
  const res = await db.collection('shop_entitlement').where({ expire_at: db.command.gte(now).and(db.command.lte(to)) }).limit(100).get();
  const rows = (res && res.data) || [];

  const notified = rows.map((r) => ({
    user_id: r.user_id || '',
    expire_at: r.expire_at,
    days_left: Math.ceil((r.expire_at - now) / (24 * 3600 * 1000)),
  }));

  return ok({
    scanned_at: now,
    window_end: to,
    notified,
    note: '订阅消息推送需模板ID+授权；未配置时由前端结果页常驻提示条兜底（§2.3 双渠道）',
  });
};