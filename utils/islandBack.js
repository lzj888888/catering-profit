// utils/islandBack.js —— 「孤岛页」兜底返回出口的**单源判据**（R731 · 李老师 2026-11-14 真机）
//
// 🔴 为什么需要它（一句话：老板被困在页面里出不去）：
//   微信系统导航栏左上角的「←」返回箭头，**只在页面栈深度 > 1 时才渲染**。
//   当页面是「直接落地」打开时栈深 = 1 ⇒ 没有「←」，微信只给一个不直观的房子图标；
//   而本仓这些页面**自身也没有任何返回出口** ⇒ 老板不知道能返回，只能杀掉小程序重进。
//
// 🔴 什么情况下会「直接落地」到子页面（都不是 bug，是微信的正常行为）：
//   ① 点别人（或自己）分享的卡片 —— 落地页由 `utils/shareCard.js::PATH` 决定；
//   ② 从小程序「最近使用」进入，微信恢复上次离开的那一页；
//   ③ 小程序被微信后台回收后重新打开，恢复到原页面。
//
// 🔴 实测依据（不是推测）：`review/evidence/r731_navstack_probe.js` 用真实模拟器读 `getCurrentPages()`
//   · 配方 hub --navigateTo--> /subpkg/biz/card/index ⇒ 栈深 2 ⇒ 有「←」（正常点击路径本来就没问题）
//   · reLaunch/direct 落地 /subpkg/biz/card/index    ⇒ 栈深 1 ⇒ 无「←」（孤岛）
//   ⚠️ 所以「加这条」不是修一个假想问题，而是补一个真实存在的死角；正常路径栈深 ≥2 时**不渲染**，
//      零干扰（不做成常驻条，否则等于给每页加一条永远用不上的横杠）。
//
// 🤖 守卫：`tools/check_island_back.js`（判据行为面 + 三个落地页接线面 + 反恒真）

// 落回哪个首页：**按模块回到它自己的家**，不要一律踢回核算 tab（老板从配方点进去的，回去还在配方）
const HOME = {
  m1: '/pages/index/index', // 月度盈利核算 → 核算 tab
  m2: '/pages/index/index', // 经营盈亏沙盘 → 核算 tab
  m3: '/pages/m3/hub',      // 菜品成本毛利 → 配方 tab（hub 是 tabBar 页，switchTab 才合法）
};

const DEFAULT_HOME = '/pages/index/index';

/**
 * 当前页是否「孤岛」（没有任何上层可返回）。
 * 判据唯一：`getCurrentPages().length <= 1`。
 * fail-closed：判不出来（API 不可用 / 非页面环境）⇒ 返回 false，**不显示**。
 *   宁可少显示一条兜底（正常路径本来有系统箭头），也不要误挡内容。
 */
function need() {
  try {
    const ps = getCurrentPages();
    return Array.isArray(ps) && ps.length <= 1;
  } catch (e) {
    return false;
  }
}

/** 模块 → 首页路由（纯函数，守卫可直接喂 kind 断言，不经 wx）。 */
function homeOf(kind) {
  return HOME[kind] || DEFAULT_HOME;
}

/** 回首页。tabBar 页**只能用 switchTab**（navigateTo 会静默失败 —— 见 tools/check_tabbar.js B1）。 */
function goHome(kind) {
  wx.switchTab({
    url: homeOf(kind),
    // 兜底：个别基础库对 switchTab 失败不给回调，这里显式给 fail 以免静默
    fail: () => { wx.reLaunch({ url: homeOf(kind), fail: () => {} }); },
  });
}

module.exports = { need, homeOf, goHome, HOME, DEFAULT_HOME };
