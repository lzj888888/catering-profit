// pages/sandbox/matrix.js —— M2 G1 场景矩阵生成器（2026-10-11 改造）
//
// ⚠️ 计算下沉（铁律不变）：每一行的测算全部由云函数 calcSandbox 算（经新增 matrix action 批量调），
//   本页只做「维度组合 → assembleItems 装配 clean 参数 → 整批送云 → 展示分整数」。
//   前端不编任何保本/摊销/占比公式：占比等展示量要么取自引擎出参，要么是两个已返回数值的简单比值（展示用）。
//
// ⚠️ 免费引流：本页矩阵与导出均免费（G4 李老师拍板），不触发付费墙、不要求先开店铺。
const api = require('../../utils/api.js');
const { TERMS } = require('../../miniprogram/i18n/terms.js');
const {
  BIZ_PRESETS, CITY_COEF, assembleItems, resolveBuild, findPreset, bizKeyOfPreset,
  // R297：全局开店投入的年限兜底（与云端 indicatorRef 同口径，不再硬写 1）
  BUILD_DEFAULT_YEARS, buildYearsOf,
} = require('../../utils/bizPreset.js');
const { deliver } = require('../../utils/exportFile.js');

const M = TERMS.matrix;

// 🔴 round279 · 模板替换（术语单源：文案在 terms.js，数字在此填，避免 wxml 里拼字符串）
function fmt(tpl, map) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (map[k] != null ? map[k] : ''));
}

// 默认扫维度档位（照搬小面表 + 毛利率 4 档，即「升级」核心）
const DEFAULT_DIMS = {
  rent: [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000],
  labor: [2, 3],
  margin: [45, 55, 60, 65],
  target: [0, 10000, 15000], // 0=保本
};

Page({
  data: {
    t: {
      title: M.title,
      subtitle: M.subtitle,
      presetLabel: M.presetLabel,
      cityLabel: TERMS.m2.cityLabel,
      cityTiers: TERMS.m2.cityTiers,
      bizLabel: TERMS.m2.bizLabel,
      bizTypes: TERMS.m2.bizTypes,
      dimRent: M.dimRent,
      advDimsShow: M.advDimsShow,
      advDimsHide: M.advDimsHide,
      dimLabor: M.dimLabor,
      dimMargin: M.dimMargin,
      dimTarget: M.dimTarget,
      // 🔴 round276：屏幕表头短名（见 terms.js 同名注释块）—— 只改显示用列，导出 Excel 仍用长名
      colRent: M.colRent,
      colLabor: M.colLabor,
      colMargin: M.colMargin,
      colTarget: M.colTarget,
      addDim: M.addDim,
      delDim: M.delDim,
      buildLabel: M.buildLabel,
      buildTotalLabel: M.buildTotalLabel,
      buildYearsLabel: M.buildYearsLabel,
      areaLabel: M.areaLabel,
      generate: M.generate,
      generating: M.generating,
      detail: M.detail,
      pivot: M.pivot,
      pivotFixMargin: M.pivotFixMargin,
      pivotFixLabor: M.pivotFixLabor,
      exportXlsx: M.exportXlsx,
      exporting: M.exporting,
      empty: M.empty,
      count: M.count,
      rentPct: M.rentPct,
      payback: M.payback,
      unfeasible: M.unfeasible,
      colBreakMonthly: M.colBreakMonthly,
      colBreakDaily: M.colBreakDaily,
      colTargetMonthly: M.colTargetMonthly,
      colTargetDaily: M.colTargetDaily,
      redAlertHint: M.redAlertHint,
      // 🔴 round273：透视表首列表头 + A 场景的"固定月租金"输入标签（初值按默认场景 reverse 给，
      //   进入时 onLoad 会按 `?mode=` 覆盖成对应场景的那一份）
      pivotRowLabel: M.pivotRowLabelRev,
      pivotFixRent: M.pivotFixRent,
      pivotCellBreak: M.pivotCellBreak,
      pivotCellTarget: M.pivotCellTarget,
      backToSandbox: M.backToSandbox,
      toCompare: M.toCompare,
      yuan: M.yuan,
      pct: M.pct,
      person: M.person,
      // 🔴 round279 · #9 矩阵杠杆术语（纯展示增强，引擎零改）
      insightTitle: M.insightTitle,
      insightNone: M.insightNone,
      leverRule: M.leverRule,
      colLever: M.colLever,
      colCushion: M.colCushion,
      colLeverExport: M.colLeverExport,
      colCushionExport: M.colCushionExport,
      cushionBreakEven: M.cushionBreakEven,
    },
    presets: BIZ_PRESETS.map((p) => ({ key: p.presetKey, name: TERMS.m2.bizTypes.find((b) => b.key === p.bizKey) ? TERMS.m2.bizTypes.find((b) => b.key === p.bizKey).name + '·预设' : p.presetKey })),
    presetIdx: 0,
    cityIdx: 1, // tier23
    dims: {
      rent: DEFAULT_DIMS.rent.slice(),
      labor: DEFAULT_DIMS.labor.slice(),
      margin: DEFAULT_DIMS.margin.slice(),
      target: DEFAULT_DIMS.target.slice(),
    },
    global: { area: 60, buildTotalYuan: 0, buildYears: 3 },
    // 🔴 round273：多一个 `rent` —— A 场景透视主轴是毛利率 ⇒ 被固定住的是月租金（反之亦然）
    pivotFix: { margin: 55, labor: 2, rent: 5000 },
    // 🔴 round273 · 场景：'forward' 已有铺面（店已开，扫毛利率）/ 'reverse' 寻找铺面（扫租金档位）。
    //   ⚠️ 默认 reverse：本页最初就是按「扫租金档位」造的（G1），**保持原行为不回退**；
    //      只有从沙盘页带 `?mode=forward` 进来才切成 A 场景口径。
    // 🔴 R322：高级维度（毛利率/人工）默认收起 —— 小白只填租金与目标利润
    advOpen: false,
    advNote: '',
    mode: 'reverse',
    pivotRowDim: 'rent',   // 透视表**行**维度：forward ⇒ margin，reverse ⇒ rent
    loading: false,
    exporting: false,
    result: null, // { rows:[], view, count, pivot }
  },

  onLoad(options) {
    const mode = (options && options.mode === 'forward') ? 'forward' : 'reverse';
    // 🔴 round273：按进来的场景切「透视行维度」与标题/引导语（维度**全保留**，只是透视主轴不同 ——
    //   A 也可以扫租金做敏感性分析，故不删维度，只换默认主轴）。
    const pivotRowDim = mode === 'forward' ? 'margin' : 'rent';
    this.setData({
      mode,
      pivotRowDim,
      't.title': mode === 'forward' ? M.titleFwd : M.titleRev,
      't.subtitle': mode === 'forward' ? M.subtitleFwd : M.subtitleRev,
      't.pivotRowLabel': mode === 'forward' ? M.pivotRowLabelFwd : M.pivotRowLabelRev,
    });
    // 🔴 R322：收起态下要显示「按毛利率 X% · 人工 N 人测算」，进页就先把这句算好
    this.setData({ advNote: this.buildAdvNote() });
    this.syncBuildDefault();
  },

  // 切换业态预设时，把「开店一次性投入」默认值带出来（有 buildRef 才带，否则留空让用户填）
  syncBuildDefault() {
    const p = findPreset(BIZ_PRESETS[this.data.presetIdx].presetKey);
    const ref = (p && p.buildRef && p.buildRef[0]) || null;
    this.setData({
      global: {
        area: this.data.global.area,
        buildTotalYuan: ref ? Math.round(ref.fen / 100) : 0,
        buildYears: ref ? buildYearsOf('other', ref.years) : BUILD_DEFAULT_YEARS.other,
      },
    });
  },

  onPresetChange(e) {
    this.setData({ presetIdx: Number(e.detail.value) }, () => this.syncBuildDefault());
  },
  onCityChange(e) {
    this.setData({ cityIdx: Number(e.detail.value) });
  },

  // ===== 维度档位编辑 =====
  onDimInput(e) {
    const { dim, idx } = e.currentTarget.dataset;
    const val = e.detail.value;
    const dims = this.data.dims;
    dims[dim][idx] = val;
    this.setData({ dims });
  },
  addDim(e) {
    const dim = e.currentTarget.dataset.dim;
    const dims = this.data.dims;
    dims[dim] = dims[dim].concat(['']);
    this.setData({ dims });
  },
  delDim(e) {
    const { dim, idx } = e.currentTarget.dataset;
    const dims = this.data.dims;
    if (dims[dim].length <= 1) return; // 至少保留一档
    dims[dim].splice(idx, 1);
    this.setData({ dims });
  },

  onGlobalInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const global = this.data.global;
    global[key] = val;
    this.setData({ global });
  },

  // ===== 装配单行的 clean 参数（与单测口径一致，走 assembleItems 唯一入口）=====
  buildClean(preset, coef, rentYuan, laborN, marginPct, targetYuan, cityTier) {
    const buildItems = this.buildItems();
    const input = {
      area: Number(this.data.global.area) || 0,
      headcount: laborN,
      rentYuan,
      fixedYuan: { rent: rentYuan },
      buildItems,
    };
    const { fixedItems, varItems } = assembleItems(preset, input, coef);
    return {
      cityTier,
      bizType: bizKeyOfPreset(preset.presetKey),
      fixedItems,
      varItems,
      buildItems,
      grossMarginPct: marginPct,
      targetProfitFen: api.yuanToFen(targetYuan),
      expectedRevenueFen: 0,
    };
  },
  // 全局开店投入 → buildItems（与 bizPreset.resolveBuild 同形：[{key,fen,years}]）
  buildItems() {
    const yuan = Number(this.data.global.buildTotalYuan) || 0;
    // 🔴 R297：原 `|| 1` / `years > 0 ? years : 1` 双重硬兜 1 年 —— 清空年限即按 1 年摊，
    //   月摊销虚高 3 倍 ⇒ 整张矩阵的保本点系统性偏高。改走同口径归一。
    const years = buildYearsOf('other', this.data.global.buildYears);
    return [{ key: 'other', fen: api.yuanToFen(yuan), years }];
  },

  // ===== R297 第二轮：四档维度体检（越界即人话，绝不静默送云）=====
  //   dims 是自由文本数组；空档由 onGenerate 自己跳过（不在这里判），只管**填了却越界**。
  badDimOf() {
    const d = this.data.dims || {};
    const chk = (arr, name, min, max) => {
      const list = arr || [];
      for (let i = 0; i < list.length; i++) {
        const raw = String(list[i] === undefined || list[i] === null ? '' : list[i]).trim();
        if (raw === '') continue;                 // 空档 = 没填，不算越界
        const v = Number(raw);
        if (!isFinite(v)) continue;               // 非数字由 onGenerate 跳过
        if (v < min || v > max) return `第 ${i + 1} 档${name}要在 ${min}~${max}（现在填了 ${raw}）`;
      }
      return '';
    };
    return chk(d.margin, '毛利率', 0, 100)
      || chk(d.rent, '房租', 0, 100000000)
      || chk(d.labor, '人数', 0, 999)
      || chk(d.target, '目标利润', 0, 100000000);
  },

  // ===== 生成矩阵（批量送云）=====
  // 🔴 R322：展开/收起「高级维度（毛利率 / 人工）」。
  //   收起时两维各取第 1 档（= 参数包默认/行业值），矩阵只剩「租金 × 目标利润」。
  //   为什么必须给一句「按毛利率 X% · 人工 N 人测算」：收起的维度**仍然是测算输入**，
  //   不写明等于让老板以为只按租金算 —— 那是另一种假精确。
  onToggleAdv() {
    const open = !this.data.advOpen;
    this.setData({ advOpen: open, advNote: this.buildAdvNote() });
  },

  buildAdvNote() {
    const m = (this.data.dims.margin || [])[0];
    const l = (this.data.dims.labor || [])[0];
    const tpl = (TERMS.matrix && TERMS.matrix.advDimsUsed) || '';
    return String(tpl).replace('{m}', String(m == null ? '' : m)).replace('{l}', String(l == null ? '' : l));
  },

  async onGenerate() {
    if (this.data.loading) return;
    const presetKey = BIZ_PRESETS[this.data.presetIdx].presetKey;
    const preset = findPreset(presetKey);
    if (!preset) { api.toastError({ msg: '请选择经营类型' }); return; }
    const tiers = ['tier1', 'tier23', 'county'];
    const cityTier = tiers[this.data.cityIdx] || 'tier23';
    const coef = CITY_COEF[cityTier] || CITY_COEF.tier23;
    // 🔴 R297 第二轮：四档维度是**自由文本**（onDimInput 只管存、onGenerate 只判 isFinite）
    //   ⇒ 老板把「毛利率」填 150 / 房租填 -8000 时，旧码照发不误；云端矩阵分支当年又**零校验**
    //   ⇒ 保本 46111→18444 元、房租负数→19444 元，**零提示**（静默错账，方向还是"更好看"）。
    //   这里先挡一道：省一次云调用，且当场说清"第几档、哪一项、超了什么范围"。
    const badDim = this.badDimOf();
    if (badDim) { api.toastError({ msg: badDim }); return; }
    const { rent, labor, margin, target } = this.data.dims;
    // 🔴 R322：高级维度收起 ⇒ 人工/毛利率各只取第 1 档。
    //   不这么做：默认 2 个人工档 × 4 个毛利率档 ⇒ 行数被撑到 8 倍，小白看到的是一张噪声表。
    const laborUse = this.data.advOpen ? labor : (labor || []).slice(0, 1);
    const marginUse = this.data.advOpen ? margin : (margin || []).slice(0, 1);
    const cleanArr = [];
    const meta = []; // 与 cleanArr 对齐的维度标注
    for (const r of rent) for (const l of laborUse) for (const m of marginUse) for (const tg of target) {
      const rv = Number(r), lv = Number(l), mv = Number(m), tgv = Number(tg);
      if (![rv, lv, mv, tgv].every((x) => isFinite(x))) continue;
      cleanArr.push(this.buildClean(preset, coef, rv, lv, mv, tgv, cityTier));
      meta.push({ rent: rv, labor: lv, marginPct: mv, targetYuan: tgv });
    }
    if (!cleanArr.length) { api.toastError({ msg: '维度档位不能为空' }); return; }
    this.setData({ loading: true });
    try {
      const d = await api.call('calcSandbox', { action: 'matrix', clean_array: cleanArr });
      const rows = (d.rows || []).map((res, i) => this.toRow(meta[i], res));
      const pivot = this.buildPivot(rows);
      const insight = this.buildInsight(rows);
      // 🔴 R297：云端拒掉的档位（rejected）**必须让人看见** —— 静默丢档 = 老板以为算过了。
      const rejected = d.rejected || [];
      this.setData({
        loading: false,
        result: { rows, view: 'detail', count: rows.length, pivot, insight, rejected },
      });
      if (rejected.length) {
        wx.showToast({
          title: `有 ${rejected.length} 档算不出来：${rejected[0].msg}`,
          icon: 'none', duration: 3000,
        });
      }
    } catch (e) {
      this.setData({ loading: false });
      api.toastError(e);
    }
  },

  toRow(meta, res) {
    // 🔴 R297：云端把「算不出的那一档」返回 **null**（不是编一个数顶上）⇒ 这里给占位行。
    //   旧码直接解引用 res ⇒ TypeError ⇒ 整张矩阵崩成一句「出错」，老板连哪一档都不知道。
    if (!res) {
      return {
        rent: meta.rent, labor: meta.labor, marginPct: meta.marginPct, targetYuan: meta.targetYuan,
        breakMonthly: null, breakDaily: null, targetMonthly: null, targetDaily: null,
        rentPct: null, leverYuan: null, cushionPct: null, payback: null,
        red: false, invalid: true,
      };
    }
    const rentFen = Math.round(Number((meta.rent * 100).toFixed(10)));   // R298-B2：原式**连取整都没有** ⇒ 分不是整数，违约铁律
    const targetMonthlyFen = res.target_monthly_fen;
    // 房租占比：两个引擎返回数值的简单比值（展示用，非测算公式）
    const rentPct = (targetMonthlyFen && targetMonthlyFen > 0)
      ? Math.round((rentFen / targetMonthlyFen) * 1000) / 10
      : null;
    const breakMonthly = res.break_even_monthly_fen != null ? res.break_even_monthly_fen / 100 : null;
    const breakDaily = res.break_even_daily_fen != null ? res.break_even_daily_fen / 100 : null;
    const targetMonthly = targetMonthlyFen != null ? targetMonthlyFen / 100 : null;
    const targetDaily = res.target_daily_fen != null ? res.target_daily_fen / 100 : null;
    // 🔴 round279 · #9 派生（纯展示，引擎零改）：
    //   ① 房租杠杆：房租每涨 ¥1000，需多做到手营收 = 1000 ÷ 毛利率（按本行毛利率计）
    const mRate = meta.marginPct > 0 ? meta.marginPct / 100 : 0;
    const leverYuan = mRate > 0 ? Math.round(1000 / mRate) : null;
    //   ② 淡季安全垫：目标营收相对保本线的缓冲百分比（营收可跌这么多才到保本；
    //      目标利润=0 即保本线本身 ⇒ 缓冲为 0，前端标「保本线」而非 0%）
    let cushionPct = null;
    if (meta.targetYuan > 0 && targetMonthly != null && breakMonthly != null && targetMonthly > 0) {
      cushionPct = Math.round((targetMonthly - breakMonthly) / targetMonthly * 100);
    }
    return {
      rent: meta.rent,
      labor: meta.labor,
      marginPct: meta.marginPct,
      targetYuan: meta.targetYuan,
      breakMonthly,
      breakDaily,
      targetMonthly,
      targetDaily,
      rentPct,
      leverYuan,
      cushionPct,
      payback: res.payback_months != null ? res.payback_months : null,
      red: !!res.red_alert,
    };
  },

  // ===== #9 结论高亮：在「当前透视固定维度」下从已算 rows 抽可行子集，给出扛租/杠杆/淡季安全垫 =====
  // 🔴 round279 · 纯前端派生，引擎零改。结论跟着透视固定维度走：
  //   reverse（寻找铺面，扫租金档位）→ 固定毛利率/人工 ⇒ 结论「可承受最高月租」
  //   forward（已有铺面，扫毛利率）  → 固定月租金/人工 ⇒ 结论「最低可行毛利率」
  buildInsight(rows) {
    if (!rows || !rows.length) return { has: false };
    const dim = this.data.pivotRowDim;                 // 'rent' | 'margin'
    const fixKey = dim === 'margin' ? 'rent' : 'margin'; // 被固定的另一个维度
    const fixVal = Number(this.data.pivotFix[fixKey]);
    const fixLabor = Number(this.data.pivotFix.labor);
    // 目标利润锚点：取维度里最大的目标利润档（最紧张、最有参考意义）
    const targetDims = this.data.dims.target.map(Number).filter(isFinite);
    const targetAnchor = targetDims.length ? Math.max(...targetDims) : 0;
    let filtered = rows.filter((r) => !r.red
      && Number(r[fixKey === 'rent' ? 'rent' : 'marginPct']) === fixVal
      && Number(r.labor) === fixLabor
      && (targetAnchor === 0 || r.targetYuan === targetAnchor));
    if (!filtered.length) {
      // 退一步：放宽目标利润约束，只看固定维度 + 人工
      filtered = rows.filter((r) => !r.red
        && Number(r[fixKey === 'rent' ? 'rent' : 'marginPct']) === fixVal
        && Number(r.labor) === fixLabor);
    }
    if (!filtered.length) return { has: false };

    let bestLabel, bestVal, bestText;
    if (dim === 'rent') {
      bestVal = Math.max(...filtered.map((r) => r.rent));
      bestText = fmt(M.insightMaxRent, { rent: bestVal, target: targetAnchor, margin: fixVal });
    } else {
      bestVal = Math.min(...filtered.map((r) => r.marginPct));
      bestText = fmt(M.insightMinMargin, { margin: bestVal, rent: fixVal, target: targetAnchor });
    }
    // 房租杠杆：按锚定毛利率计（reverse=fixVal 毛利率；forward=最低可行毛利率本身）
    const leverMargin = dim === 'rent' ? fixVal : bestVal;
    const leverYuan = Math.round(1000 / (leverMargin / 100));
    const leverText = fmt(M.insightLever, { lever: leverYuan, margin: leverMargin });
    // 淡季安全垫：取最优档那一行
    const bestRow = filtered.find((r) => (dim === 'rent' ? r.rent === bestVal : r.marginPct === bestVal));
    let cushionText = null;
    if (bestRow && bestRow.targetMonthly != null && bestRow.breakMonthly != null && bestRow.targetMonthly > 0) {
      const cushion = Math.round((bestRow.targetMonthly - bestRow.breakMonthly) / bestRow.targetMonthly * 100);
      cushionText = fmt(M.insightCushion, { cushion });
    }
    return { has: true, bestLabel: dim === 'rent' ? 'maxRent' : 'minMargin', bestText, leverText, cushionText };
  },

  // ===== 透视表：行=月租金档，列=目标利润档，单元格=目标日均(元) =====
  // 顶部固定 毛利率 / 人工，从已算结果里筛出对应子集（无需重新调云）
  buildPivot(rows) {
    // 🔴 round273：透视**主轴**按场景走 —— A（forward）扫毛利率、B（reverse）扫租金档位。
    //   被"固定住"的则是另一个成本维度（A 固定月租金 / B 固定毛利率），人工两边都固定。
    //   维度**一个都没删**（rent/labor/margin/target 全在），只是换默认主轴 ⇒ 旧行为零回退。
    const dim = this.data.pivotRowDim;                    // 'rent' | 'margin'
    const FIELD = { rent: 'rent', margin: 'marginPct' };  // 维度 → toRow 里的字段名
    const fixKey = dim === 'margin' ? 'rent' : 'margin';  // 固定住的**另一个**维度
    const fixVal = Number(this.data.pivotFix[fixKey]);
    const fixLabor = Number(this.data.pivotFix.labor);
    const filtered = rows.filter((r) => !r.red
      && Number(r[FIELD[fixKey]]) === fixVal
      && Number(r.labor) === fixLabor);
    const cells = {};
    for (const r of filtered) cells[r[FIELD[dim]] + '|' + r.targetYuan] = r.targetDaily;
    return {
      fixMargin: Number(this.data.pivotFix.margin),
      fixLabor,
      fixRent: Number(this.data.pivotFix.rent),
      rows: this.data.dims[dim].slice(),
      cols: this.data.dims.target.slice(),
      cells,
    };
  },
  // 🔴 R297 第四轮（审计 B6）：原 `onPivotFixChange` 与下面的 `onPivotFixInput` **函数体完全等价**，
  //   且 wxml 只绑了 `onPivotFixInput`（matrix.wxml 三处）⇒ 前者不可达（死代码），已删。
  onPivotFixInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = Number(e.detail.value);
    const pivotFix = this.data.pivotFix;
    pivotFix[key] = val;
    this.setData({ pivotFix }, () => {
      if (this.data.result) {
        this.setData({
          'result.pivot': this.buildPivot(this.data.result.rows),
          'result.insight': this.buildInsight(this.data.result.rows),
        });
      }
    });
  },

  onViewChange(e) {
    const view = e.currentTarget.dataset.view;
    if (this.data.result) this.setData({ 'result.view': view });
  },

  // ===== 导出 Excel（免费引流，G4）=====
  async onExport() {
    const rows = this.data.result && this.data.result.rows;
    if (!rows || !rows.length || this.data.exporting) return;
    const t = this.data.t;
    const header = [
      t.dimRent, t.dimLabor, t.dimMargin, t.dimTarget,
      t.colBreakMonthly, t.colBreakDaily, t.colTargetMonthly, t.colTargetDaily,
      t.rentPct, t.payback, t.colLeverExport, t.colCushionExport,
    ];
    const body = rows.map((r) => [
      r.rent, r.labor, r.marginPct, r.targetYuan,
      r.breakMonthly != null ? r.breakMonthly : '—',
      r.breakDaily != null ? r.breakDaily : '—',
      r.targetMonthly != null ? r.targetMonthly : '—',
      r.targetDaily != null ? r.targetDaily : '—',
      r.rentPct != null ? r.rentPct : '—',
      r.payback != null ? r.payback : '—',
      r.leverYuan != null ? r.leverYuan : '—',
      r.cushionPct != null ? r.cushionPct : '—',
    ]);
    this.setData({ exporting: true });
    try {
      const d = await api.call('exportData', {
        export_type: 'm2_matrix',
        shop_name: '',
        table: { header, rows: body },
      });
      deliver(d);
    } catch (e) {
      api.toastError(e);
    } finally {
      this.setData({ exporting: false });
    }
  },

  goSandbox() { wx.navigateBack({ delta: 1 }); },
  goCompare() { wx.navigateTo({ url: '/pages/sandbox/compare' }); },
});
