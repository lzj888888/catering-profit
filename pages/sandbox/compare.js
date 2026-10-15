// pages/sandbox/compare.js —— M2 G2 多方案横向对比（2026-10-11 改造）
//
// ⚠️ 复用既有 savePlan / getPlan（cloudfunctions），不新增集合、引擎零改。
//   对比数据取各方案保存时的 result_snapshot_json（calcSandbox 出参快照），前端只做展示与结论文案，
//   不重算、不编公式。
const api = require('../../utils/api.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');

const M = TERMS.matrix;

Page({
  data: {
    t: {
      title: M.cmpTitle,
      planCol: M.cmpPlanCol,
      breakMonthly: M.cmpBreakMonthly,
      targetMonthly: M.cmpTargetMonthly,
      payback: M.cmpPayback,
      varRate: M.cmpVarRate,
      verdict: M.cmpVerdict,
      doCompare: M.cmpDoCompare,
      loading: M.cmpLoading,
      max: M.cmpMax,
      notEnough: M.cmpNotEnough,
      empty: M.cmpEmpty,
      red: M.cmpRed,
      // 🔴 round273：场景标签 + 跨场景混比提示（A/B 两种方案的数字口径不同，横着比会误导）
      sceneFwd: M.sceneFwd,
      sceneRev: M.sceneRev,
      mixedScene: M.cmpMixedScene,
      // 🔴 R297 第四轮（审计 B4）：结论文案改走术语单源（原为页内硬编码中文）
      verdictBest: M.cmpVerdictBest,
      verdictAllRed: M.cmpVerdictAllRed,
      backToSandbox: M.backToSandbox,
    },
    plans: [],        // [{ sandbox_id, name, snapshot, mode, sceneName }]
    selected: [],     // sandbox_id 列表（最多 3）
    loading: false,
    compared: null,   // { rows:[], verdict }
    mixedScene: false, // 🔴 round273：当前选中的方案是否**跨场景**（是 ⇒ 对比表上方给硬提示）
  },

  onLoad() {
    this.loadPlans();
  },

  async loadPlans() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const d = await api.call('getPlan', {});
      const list = (d && d.list) || [];
      const plans = list
        .filter((p) => p && p.result_snapshot_json)
        // 🔴 round273：把**场景**带上 —— 保存时 `param_json.mode` 已落库（forward=已有铺面 / reverse=寻找铺面）
        .map((p) => {
          const mode = (p.param_json && p.param_json.mode === 'reverse') ? 'reverse' : 'forward';
          return {
            sandbox_id: p.sandbox_id,
            name: p.name || '方案',
            snapshot: p.result_snapshot_json,
            mode,
            sceneName: mode === 'reverse' ? M.sceneRev : M.sceneFwd,
          };
        });
      this.setData({ plans, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    const selected = this.data.selected.slice();
    const i = selected.indexOf(id);
    if (i >= 0) selected.splice(i, 1);
    else {
      if (selected.length >= 3) { wx.showToast({ title: this.data.t.max, icon: 'none' }); return; }
      selected.push(id);
    }
    this.setData({ selected });
  },

  onCompare() {
    if (this.data.selected.length < 2) { wx.showToast({ title: this.data.t.notEnough, icon: 'none' }); return; }
    const chosen = this.data.plans.filter((p) => this.data.selected.indexOf(p.sandbox_id) >= 0);
    // 🔴 round273：跨场景检测 —— 选中的方案里同时出现 forward 与 reverse ⇒ 提示（不阻止，说清即可）
    const modes = {};
    for (const p of chosen) modes[p.mode] = 1;
    const mixedScene = Object.keys(modes).length > 1;
    const rows = chosen.map((p) => {
      const s = p.snapshot || {};
      // 🔴 R297 第四轮（M2 整体审计 B2）：反推方案的快照**同时含两份口径** ——
      //   顶层是 `calcSandbox(clean)`（房租按已知固定成本/或为 0 的**正向**口径），
      //   真正的反推答案在 `snapshot.reverse` 块（`savePlan/index.js` 只在 mode==='reverse' 时追加）。
      //   原实现只读顶层 ⇒ 反推方案拿的是正向数、却贴着「寻找铺面」标签，
      //   且与 `list.js`（读 `snapshot.reverse.target_monthly_fen`）**同一方案两个数**。
      //   ⚠️ 仅止血：只把「目标月营收」对齐到 reverse 块；两页是否合一属产品决策，另议。
      const revTargetFen = (s.reverse && s.reverse.target_monthly_fen != null)
        ? s.reverse.target_monthly_fen : null;
      return {
        // 🔴 R297 第四轮（审计 B5）：给行一个**唯一键** —— 方案名可重名，`wx:key="name"` 会撞键。
        id: p.sandbox_id,
        name: p.name,
        // 🔴 round273：对比表里也要看出场景（否则两行数字摆一起，读者不知道口径不同）
        sceneName: p.sceneName,
        breakMonthly: s.break_even_monthly_fen != null ? Math.round(s.break_even_monthly_fen / 100) : null,
        targetMonthly: revTargetFen != null
          ? Math.round(revTargetFen / 100)
          : (s.target_monthly_fen != null ? Math.round(s.target_monthly_fen / 100) : null),
        payback: s.payback_months != null ? s.payback_months : null,
        varRate: s.composite_var_rate_pct != null ? s.composite_var_rate_pct : null,
        red: !!s.red_alert,
      };
    });
    // 结论：可行方案里保本营业额最低者最稳；有不可行的单列提示
    // 🔴 R297 第四轮（审计 B4）：文案取自 terms 单源，页面不写死中文。
    const feasible = rows.filter((r) => !r.red && r.breakMonthly != null);
    let verdict = '';
    if (feasible.length) {
      const best = feasible.reduce((a, b) => (a.breakMonthly <= b.breakMonthly ? a : b));
      verdict = String(this.data.t.verdictBest)
        .replace('{name}', best.name).replace('{amount}', String(best.breakMonthly));
    } else {
      verdict = this.data.t.verdictAllRed;
    }
    this.setData({ compared: { rows, verdict }, mixedScene });
  },

  goSandbox() { wx.navigateBack({ delta: 1 }); },
});
