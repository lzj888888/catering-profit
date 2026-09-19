// utils/platform.js —— R45 · 端侧平台判定（**单源**）
//
// ⚠️ 为什么必须有这个文件（合规背景，勿删）：
//   本工具的付费内容是「开通真实利润」时效套餐 = 虚拟商品。按微信运营规范，
//   **iOS 端小程序不得提供虚拟商品的购买支付入口**。此前 iOS 过滤"零实现"，
//   只在 `payCreateOrder` 的注释里出现过 ⇒ 复审方登记为 R45（上线前必须收口）。
//
// ⚠️ 为什么只做展示层、后端不拦（与 `tools/check_compliance.js` 同源政策）：
//   客户端上报的 platform **不可信**，后端据此拦截等于把合规边界交给可被篡改的入参；
//   真正的约束是「iOS 用户**看不到**入口」，故由前端单源判定，后端保持不拦。
//
// ⚠️ fail-closed：拿不到平台信息时**按 iOS 处理**（宁可不卖，也不违规）。
//   —— 取不到 platform 只可能是 API 异常（概率极低）；此时放行会开出合规口子，
//      拦下最多损失一次转化。按项目「风险侧收敛」原则取后者。
//
// ⚠️ 新增任何支付/续费入口，都必须先过 `isIOS()`；守卫 `tools/check_ios_pay.js` 机器守。

let cached = null;

function readPlatform() {
  // 优先新 API（基础库 2.20.1+），回落旧 API（存量机型）
  try {
    if (typeof wx !== 'undefined' && wx.getDeviceInfo) {
      const d = wx.getDeviceInfo() || {};
      if (d.platform) return String(d.platform);
    }
  } catch (e) { /* 落旧 API */ }
  try {
    if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
      const info = wx.getSystemInfoSync() || {};
      if (info.platform) return String(info.platform);
    }
  } catch (e) { /* 取不到 → 走 fail-closed */ }
  return '';
}

/**
 * 当前是否 iOS 端。取不到平台信息时返回 true（fail-closed，见头注释）。
 * @returns {boolean}
 */
function isIOS() {
  if (cached !== null) return cached;
  const p = readPlatform().toLowerCase();
  cached = p === '' ? true : p === 'ios';
  return cached;
}

/** 仅测试用：清空缓存（生产代码不要调，否则判定结果会被时序污染） */
function _resetCache() { cached = null; }

module.exports = { isIOS, _resetCache };
