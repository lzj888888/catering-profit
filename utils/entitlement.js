// utils/entitlement.js —— 批次 5 · 权限判定工具
//
// ⚠️ 解耦铁律（§2.4）：前端**只读 shop_entitlement.expire_at 一个字段**判定权限；
//   空/过期 = 免费档；有效 = 付费档。不读 plan_id（套餐名/价/文案后端下发）。
//   有效期以服务端 UTC 为准（payQueryEntitlement 返回），前端只负责展示转北京时间。

const api = require('./api.js');

/**
 * 拉取当前权益（payQueryEntitlement）。
 * @returns {Promise<{expire_at:number, is_active:boolean, source:string, days_left:number}>}
 */
async function fetchEntitlement() {
  const shopId = (getApp && getApp().globalData && getApp().globalData.shop_id) || '';
  const d = await api.call('payQueryEntitlement', { shop_id: shopId });
  return {
    expire_at: Number(d.expire_at) || 0,
    is_active: !!d.is_active,
    source: d.source || '',
    days_left: Number(d.days_left) || 0,
  };
}

/**
 * 是否付费档（is_active）。调用方应在进入 M1 首页/结果页时拉一次。
 */
function isPaid(ent) {
  return !!(ent && ent.is_active);
}

/**
 * 展示用：服务端 UTC 毫秒 → 北京时间 YYYY-MM-DD（前端只负责展示转换，判定仍用服务端值）。
 */
function beijingDate(utcMs) {
  if (!utcMs) return '';
  const d = new Date(Number(utcMs));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 到期提醒：到期前 7 天内（双渠道①——结果页常驻提示条）。返回 days_left 或 0。
 */
function expireSoonDays(ent) {
  if (!ent || !ent.is_active) return 0;
  return (ent.days_left > 0 && ent.days_left <= 7) ? ent.days_left : 0;
}

module.exports = { fetchEntitlement, isPaid, beijingDate, expireSoonDays };