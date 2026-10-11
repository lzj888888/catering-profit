// pages/sandbox/compare/index.js —— M2 G2 多候选铺面横向对比（2026-10-11 改造）
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
      return {
        name: p.name,
        // 🔴 round273：对比表里也要看出场景（否则两行数字摆一起，读者不知道口径不同）
        sceneName: p.sceneName,
        breakMonthly: s.break_even_monthly_fen != null ? Math.round(s.break_even_monthly_fen / 100) : null,
        targetMonthly: s.target_monthly_fen != null ? Math.round(s.target_monthly_fen / 100) : null,
        payback: s.payback_months != null ? s.payback_months : null,
        varRate: s.composite_var_rate_pct != null ? s.composite_var_rate_pct : null,
        red: !!s.red_alert,
      };
    });
    // 结论：可行方案里保本营业额最低者最稳；有不可行的单列提示
    const feasible = rows.filter((r) => !r.red && r.breakMonthly != null);
    let verdict = '';
    if (feasible.length) {
      const best = feasible.reduce((a, b) => (a.breakMonthly <= b.breakMonthly ? a : b));
      verdict = `${best.name} 保本月营收最低（${best.breakMonthly} 元），相对最稳`;
    } else {
      verdict = this.data.t.red + '：所选方案均不可行，请调整成本结构';
    }
    this.setData({ compared: { rows, verdict }, mixedScene });
  },

  goSandbox() { wx.navigateBack({ delta: 1 }); },
});
