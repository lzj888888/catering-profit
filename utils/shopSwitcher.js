// utils/shopSwitcher.js —— 批次 7 · 店铺切换器（列表 + 持久化 + 配额）
//
// ⚠️ §2.3/§2.7：
//   · 列表**仅含 is_deleted=false**（软删店铺不进入列表、不占配额——由 getShopList 后端过滤）；
//   · 选中 shop_id **持久化到本地缓存**，下次进入默认打开上次访问的店铺；
//   · 切换店铺**永不触发付费弹窗**（仅「保存超限」触发，见 getShopList.hit_free_limit 使用方）；
//   · 切换后所有请求自动带新 shop_id（写 app.globalData，api.js 统一注入）。
const api = require('./api.js');

const PERSIST_KEY = 'shop_switcher_shop_id';

/**
 * 拉取店铺列表（getShopList，后端过滤软删 + 返回免费配额）。
 * @returns {Promise<{list:Array, used:number, free_limit:number, hit_free_limit:boolean}>}
 */
async function fetchShopList() {
  const d = await api.call('getShopList', {});
  return {
    list: (d.list || []).map((s) => ({ shop_id: s.shop_id, name: s.name || '' })),
    used: d.used || 0,
    free_limit: d.free_limit || 1,
    hit_free_limit: !!d.hit_free_limit,
  };
}

/** 持久化当前选中店铺（本地缓存）。 */
function persistShopId(shopId) {
  if (shopId) wx.setStorageSync(PERSIST_KEY, shopId);
}

/** 读取持久化的店铺 id（可能已被软删/不存在，由调用方校验）。 */
function restoreShopId() {
  return wx.getStorageSync(PERSIST_KEY) || '';
}

/** 切换店铺：写入 globalData（api.js 自动带新 shop_id）+ 持久化。 */
function switchShop(shopId) {
  const app = getApp();
  if (app && app.globalData) app.globalData.shop_id = shopId || '';
  persistShopId(shopId);
}

/**
 * 启动时恢复上次店铺：若持久化 id 在列表中则切回；否则保持默认。
 * 供首页/月度页 bootstrap 调用。
 */
async function restoreLastShop(list) {
  const saved = restoreShopId();
  if (!saved) return false;
  const hit = (list || []).some((s) => s.shop_id === saved);
  if (hit) { switchShop(saved); return true; }
  return false; // 上次店铺已软删/不存在 → 保持当前（默认）
}

module.exports = { fetchShopList, persistShopId, restoreShopId, switchShop, restoreLastShop, PERSIST_KEY };