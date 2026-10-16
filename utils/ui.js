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
  /** 当月序号 -1 → 上月 YYYY-MM（用于「一键归档上月」） */
  prevMonth(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    const pp = new Date(Date.UTC(y, m - 1 - 1, 15, 12));
    return `${pp.getUTCFullYear()}-${String(pp.getUTCMonth() + 1).padStart(2, '0')}`;
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
  /**
   * `YYYY-MM` → 该月首末日的日期区间 `{ from, to }`（均为 `YYYY-MM-DD`）。
   * 🔴 R301 · 为什么必须有：契约要求 `getDishReview` 按 `biz_date_from` / `biz_date_to` 取数
   *   （见 `cloudfunctions/getDishReview/index.js`），而页面是按**月**选的 ⇒ 必须有一处把"月"
   *   换算成"区间"，且**只能有一处**（各页各写必然漂，本仓既有红线）。
   * 口径：月末天数按**真实日历**算（2 月闰年 29 / 小月 30）——
   *   用 `Date.UTC(y, m, 0)` 取"下月的第 0 天"＝本月最后一天，**零月长硬编码表**。
   *   非法入参 ⇒ 回 `{from:'', to:''}`（调用方据此 fail-closed，**不许猜一个区间**）。
   */
  monthRange(ym) {
    const s = String(ym == null ? '' : ym);
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    if (!(y > 0) || !(m >= 1 && m <= 12)) return { from: '', to: '' };
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const p2 = (n) => String(n).padStart(2, '0');
    return { from: y + '-' + p2(m) + '-01', to: y + '-' + p2(m) + '-' + p2(last) };
  },
  /** 归档后 7 天宽限是否仍可补录 */
  withinGrace(archivedAtMs, nowMs) {
    // fail-closed：未知归档时间 ⇒ 视为已锁（与云端 saveLedger 归档守卫的 `|| 0` 同口径）。
    if (!archivedAtMs) return false;
    const GRACE = 7 * 24 * 3600 * 1000;
    // R298·C4：nowMs 原为**死参**（函数体写死 Date.now()）⇒ 时间不可注入、无法对宽限边界做变异测试。
    //   用 Number.isFinite 而非 `nowMs || …`（否则传入 0＝纪元会被当"未传"静默回退，测试假绿），
    //   也不止 typeof number（会放进 NaN/Infinity ⇒ 后续比较恒 false，语义含糊）。
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    return (now - archivedAtMs) < GRACE;
  },
  /** 设置导航栏标题（从 i18n/terms.js 取词，避免 .json 硬编码） */
  setTitle(text) { wx.setNavigationBarTitle({ title: text }); },
};