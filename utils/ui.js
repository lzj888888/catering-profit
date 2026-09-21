// utils/ui.js —— 批次 4 · 前端通用小工具（月份、归档宽限、导航栏标题取词）
module.exports = {
  /** 当前月份 YYYY-MM */
  nowMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },
  /** 当月序号 +1 → 下月 YYYY-MM */
  nextMonth(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    const nn = new Date(Date.UTC(y, m - 1 + 1, 15, 12));
    return `${nn.getUTCFullYear()}-${String(nn.getUTCMonth() + 1).padStart(2, '0')}`;
  },
  /** 最近 n 个月（含当月、倒序、YYYY-MM）—— 月份下拉的滚动窗口 */
  // 🔴 为什么必须有（2026-09-21 李老师真机反馈「月份选择 只有两个月份」）：
  //    月度首页原实现只拿「已建档月份 ∪ 当月」，而 getMonthList 只返回 shop_monthly_account 有行的月份
  //    ⇒ 新店首次只剩当月，想补录上个月连选项都没有，月度录入被锁死在当月。
  //    月份下拉必须自带滚动窗口，再把「已建档月份」并进来（更早的历史月份也不会丢）。
  recentMonths(n) {
    const cnt = Number(n) > 0 ? Math.floor(Number(n)) : 24;
    const ym = this.nowMonth();
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    const out = [];
    for (let i = 0; i < cnt; i++) {
      // 取月中 12:00 UTC：避开月末天数差异与时区偏移导致的跳月/重月
      const d = new Date(Date.UTC(y, m - 1 - i, 15, 12));
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  },
  /** 归档后 7 天宽限是否仍可补录 */
  withinGrace(archivedAtMs, nowMs) {
    if (!archivedAtMs) return false;
    const GRACE = 7 * 24 * 3600 * 1000;
    return (Date.now() - archivedAtMs) < GRACE;
  },
  /** 设置导航栏标题（从 i18n/terms.js 取词，避免 .json 硬编码） */
  setTitle(text) { wx.setNavigationBarTitle({ title: text }); },
};