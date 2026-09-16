// utils/loading.js —— 批次 7 · 加载状态 + 防重复提交
//
// ⚠️ 批次 7 §2.2：计算/提交显示 loading；按钮点击后立即 disabled，响应返回后恢复；
//   配合 client_request_id 幂等，防网络慢时重复提交导致云函数暴增。
//
// 用法（页面内）：
//   this.setData(loading.set('btnSave', true));          // 置忙
//   ... await 调用 ...
//   this.setData(loading.set('btnSave', false));         // 恢复
//   loading.withLock(this, 'btnSave', fn)                // 包装：忙时不重复执行

/**
 * 生成 setData 片段：{ ['loading_btnSave']: true/false }。
 * 页面 data 需含 loading_btnSave（wxml 用 disabled="{{loading_btnSave}}"）。
 */
function set(key, on) {
  return { ['loading_' + key]: !!on };
}

/**
 * 包装异步函数：busy 时不重复执行（防连点）。
 * @param {object} page Page 实例
 * @param {string} key 按钮 key（data.loading_<key>）
 * @param {function} fn async 函数（内部应自行在末尾恢复 loading）
 * @returns {Promise} fn 的返回值或 undefined（busy 时）
 */
async function withLock(page, key, fn) {
  const flag = 'loading_' + key;
  if (page.data[flag]) return undefined;         // busy → 直接忽略（防连点）
  page.setData({ [flag]: true });
  try {
    return await fn();
  } finally {
    page.setData({ [flag]: false });
  }
}

module.exports = { set, withLock };