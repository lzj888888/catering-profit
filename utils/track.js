// utils/track.js —— 最小埋点（R646 · 会审 R638「点击埋点」）
//
// 为什么用 wx.reportAnalytics 而不是自建上报：
//   ① 项目此前**零埋点**，自建一套要新增集合/云函数/清理策略，成本远大于收益；
//   ② 微信官方接口零后端、零权限、零费用，后台「数据分析 → 自定义分析」直接看；
//   ③ 它只在开发者工具里报"事件未配置"警告，**线上不会打扰用户**。
//
// 🔴 三条硬约束：
//   1. **必须静默失败** —— 埋点绝不能让主流程报错。老板点"复制诊断包"时，
//      埋点失败不该影响复制，更不该弹任何提示。
//   2. **不许传敏感数据** —— 只传枚举值（事件名 + 包号/来源），不传金额、菜名、店名。
//   3. **事件名 ≤ 24 字符、最多 20 个字段**（微信限制），故本函数只做浅层透传，
//      复杂维度请在调用处**先收敛成枚举**再传。

/**
 * @param {string} event 事件名（建议 snake_case，如 'ai_pack_cta'）
 * @param {object} [props] 仅限枚举/短字符串，禁止金额、菜名等业务内容
 */
function track(event, props) {
  try {
    if (!event) return;
    if (typeof wx === 'undefined' || typeof wx.reportAnalytics !== 'function') return;
    wx.reportAnalytics(String(event).slice(0, 24), props || {});
  } catch (e) {
    // 静默：埋点是观测手段，不是业务流程
  }
}

module.exports = { track };
