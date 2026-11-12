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
  if (app && app.globalData) {
    app.globalData.shop_id = shopId || '';
    // 🔴 R470：切店必须让**上下文缓存失效**。`api.ensureShop` 靠 `shopLoaded` 短路
    //   （api.js:110），不置 false 的话，切完返回上一页仍拿到旧店的 name/switches
    //   ⇒ 真机表现「提示已切换、店名不变」。
    app.globalData.shopLoaded = false;
  }
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

/**
 * 当前店铺 id —— **本地草稿隔离的唯一取法**（只认 app.globalData，与 card/edit.js::inputModeKey 同口径）。
 * ⚠️ node 单测环境没有 getApp ⇒ 返回 ''：此时草稿一律不恢复（fail-closed，宁丢草稿不串店）。
 */
function currentShopId() {
  try {
    if (typeof getApp !== 'function') return '';
    const app = getApp();
    return (app && app.globalData && app.globalData.shop_id) || '';
  } catch (e) { return ''; }
}

/**
 * 🔴 R720（李老师 2026-11-12「继续」）：本地 storage key 的**店铺维度唯一拼法**。
 *
 * 背景：R718/R719 两轮审计实锤 7 类全局 key 跨店串数据 / 覆盖丢失 ——
 *   DISH_IMPORT_BATCH（整批导入进度）、DISH_IMPORT_DRAFT_ONE（单菜预填）、
 *   m3_dish_cats（分类字典）、m3_materials_cache_v1（原料缓存）、
 *   draft_month_input_ / draft_month_inv_（月度草稿 / 盘点草稿）。
 *   根因：切店只改 globalData.shop_id，本地 key 却不带店 ⇒ 两店共用一格。
 *
 * 三条纪律：
 *   ① 单源 —— 本地业务缓存一律走这里拼 key，不许各页再写一遍 getApp()；
 *   ② fail-closed —— 拿不到店铺时落到 `__NO_SHOP__` 独立格，与任何真实店都不互串；
 *      旧缓存读不到就当没有，宁丢不串（与 currentShopId 同口径）；
 *   ③ 第二参 shopId **只给守卫/单测构造场景用**，产品代码一律只传 base
 *      （check_m3_storage_isolation.js A-⑧ 判产品源码里调用只传 1 个实参）。
 *
 * @param {string} base 原始 key（常量字面量，不带店）
 * @param {string} [shopId] 仅测试用；不传则取 currentShopId()
 */
function shopKey(base, shopId) {
  const sid = shopId === undefined ? currentShopId() : (shopId || '');
  if (!sid) return String(base) + '__NO_SHOP__';
  return String(base) + '_shop_' + sid;
}

module.exports = { fetchShopList, persistShopId, restoreShopId, switchShop, restoreLastShop, PERSIST_KEY, currentShopId, shopKey };