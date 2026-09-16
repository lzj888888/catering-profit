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
  /** 归档后 7 天宽限是否仍可补录 */
  withinGrace(archivedAtMs, nowMs) {
    if (!archivedAtMs) return false;
    const GRACE = 7 * 24 * 3600 * 1000;
    return (Date.now() - archivedAtMs) < GRACE;
  },
  /** 设置导航栏标题（从 i18n/terms.js 取词，避免 .json 硬编码） */
  setTitle(text) { wx.setNavigationBarTitle({ title: text }); },
};