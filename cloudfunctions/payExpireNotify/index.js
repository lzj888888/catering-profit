// cloudfunctions/payExpireNotify/index.js —— 批次 5 · 到期前 7 天提醒（定时触发）
//
// ⚠️ 双渠道（§2.3 环节 5）：① 小程序订阅消息（需用户主动授权，未授权不影响兜底）；
//                            ② 结果页**常驻提示条**（前端读 payQueryEntitlement 的 days_left ≤7 渲染）。
// 本函数为定时任务：扫描 expire_at ∈ (now, now+7d] 的权益，返回 notified 列表。
// ⚠️ 订阅消息发送需模板 ID + 用户授权（requestSubscribeMessage），本函数当前返回待通知列表，
//   实际推送由云调用 openapi.subscribeMessage.send 完成——未配置模板 ID 时跳过发送，仅登记。
// 🔴 R215 加固：exports.main 加来源校验（有用户 OPENID 即拒）—— 此前它可被任意已登录用户
//   从小程序端直接调用，拉走 shop_entitlement 全表（user_id + expire_at）。
//   守卫 = tools/check_fn_public_surface.js 的 C-②（逐条点名本函数必须自保）。
// 🔴 R215 触发器：同目录 config.json 声明 triggers（每天 10:00）—— ⚠️ 触发器要在部署后
//   **单独「上传触发器」**才生效（普通部署不带它）；未接订阅消息前，本函数只把扫描结果
//   写进云端日志（不推送），供上线后核对触发器是否真的跑起来。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ok, fail, ERROR_CODES } = common;
const { nowUtc } = common.utilTime;

const REMIND_WINDOW_MS = 7 * 24 * 3600 * 1000;      // 到期前 7 天

exports.main = async () => {
  // 🔴 R215：本函数是**定时任务**，绝不是业务接口 —— 此前 exports.main 无任何来源校验，
  //   而它扫的是 shop_entitlement **全表**并回 user_id + expire_at ⇒ 任意已登录用户
  //   在小程序端 callFunction({ name: 'payExpireNotify' }) 即可拉到别人的付费状态。
  //   判据 = **有用户 OPENID 即客户端调用 ⇒ 拒绝**；定时触发器与控制台「测试」都没有
  //   用户上下文（OPENID 为空）⇒ 运维面不受影响。
  const ctx = cloud.getWXContext();
  if (ctx && ctx.OPENID) return fail(ERROR_CODES.FORBIDDEN);

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