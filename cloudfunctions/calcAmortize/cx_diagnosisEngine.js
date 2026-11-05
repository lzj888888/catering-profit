// cloudfunctions/common/diagnosisEngine.js —— 深度诊断引擎（A5 · 2026-11-05）
//
// 结构：11 指标加权 100 分 + 6 条红线一票否决（红线优先于分数）。
// 依据：`review/REF_闭店决策模型_数据字段与M2对比_20261023.md` §二（评分细则原文）
//      + `review/收费与权益_总设计师规范_20261105.md` §12.3/§12.4（业态硬判定层）
//
// ============ 三条设计底线（违反即驳回）============
// 🔴 1. 取不到的分**不计入分母**，绝不估分、绝不按 0 分凑。
//    做法：只对 hasData 的指标求和，总分按剩余权重**归一化**到 100。
//    为什么不给 0：给 0 会让「经营正常但没填账面现金」的店被判低分，用户会觉得瞎判；
//    为什么不给中位数：那是编数。归一化是唯一不撒谎的做法。
//    ⚠️ 代价：数据越少越容易得高分 ⇒ 必须配覆盖率闸门（COVERAGE_MIN），不足则不出等级。
//
// 🔴 2. 红线**只认真实数据**。任何需要 A 数据才能判的红线，A 缺失时判「未判定」，
//    不许用近似量顶替（例：R1 现金枯竭必须用账面现金，不许用"当月净现金流为负"推断现金枯竭）。
//    理由：红线是"一票否决"级别的结论，用一个近似量触发它，等于用一个猜测否定一个人的生意。
//
// 🔴 3. 输出**不给行动指令**。给数字、给事实、给命中哪条线；不给"建议闭店"。
//    责任边界：给数字 ≠ 替他做决定。报告末尾必须由上层渲染免责兜底（规范 §12.7）。
//    另：§12.7 明令「食材成本率」对外禁用 ⇒ 本引擎对外 label 一律用「毛利率」，
//    食材成本率只作内部中间量（字段名保留 foodCostRatePct 以便与 M1 对账）。
//
// ⚠️ 新增符号必须在 common/index.js 聚合入口同步导出（genId 事故族；tools/check_requires.js §2）。

// ===== 一、业态硬判定层（§12.4 第一层，采 [D4] 单点；**与 BANDS 参考带并列，互不覆盖**）=====
// ⚠️ 这里的值是**闭卷拍板值**，不是从 BANDS 区间推出来的。
//   规范明令：「禁止用参考带区间下限去反推/替换红线单点值」（三司会诊结论）。
//   批次 3 校准 BANDS 时**不要顺手改这里**，两者是两层语义。
const BIZ_HARD = {
  fastfood: { laborWarn: 20, rentBase: 12, grossMarginHealthy: 64, threeCostWarn: 68 },
  dining: { laborWarn: 22, rentBase: 13, grossMarginHealthy: 60, threeCostWarn: 75 },
  hotpot: { laborWarn: 18, rentBase: 11, grossMarginHealthy: 55, threeCostWarn: 74 },
  cafe: { laborWarn: 18, rentBase: 18, grossMarginHealthy: 65, threeCostWarn: 71 },
  // 未细分行业：取四类最宽松值（避免误伤），上层须标注「未细分行业，仅供粗估」
  other: { laborWarn: 22, rentBase: 13, grossMarginHealthy: 55, threeCostWarn: 75 },
};
const BIZ_KEYS = Object.keys(BIZ_HARD);
// 房租警戒 = 参考带上沿（BANDS.rent[1]）× 城市系数。取上沿而非基准值：
// "基准"是行业中心，超过它只是"偏高"，超过**上沿**才是"不合理"。
const RENT_WARN_HI = { fastfood: 15, dining: 15, hotpot: 15, cafe: 18, other: 15 };
// 城市系数（§12.4 已拍板，闭卷不再议）：房租 [D4] 1.2/1.0/0.75；人工 [E1] 1.15/1.0/0.85
const RENT_COEF = { tier1: 1.2, tier2: 1.0, tier3: 0.75 };
const LABOR_COEF = { tier1: 1.15, tier2: 1.0, tier3: 0.85 };

// ===== 二、可扛上限与安全下限（原模型未给具体数，此处显式定义并标注为「本仓约定」）=====
// ⚠️ 这几个数字原表只写"超可扛上限"而未给值，不定义就无法计算。全部集中在此，便于日后校准。
const TUNABLE = {
  lossMonthsTolerable: 6,   // 连续亏损超过 6 个月视为"失血"，每多 1 月额外扣分
  cashSafeMonths: 3,        // 现金 ≥3 个月刚性支出视为安全（<1 个月触 R1 红线）
  trafficDropWarnPct: 20,   // 客流同比下滑 20% 视为"下滑警戒"
  ratingFloor: 4.0,         // 平台评分 4.0 以下封底
  ratingGood: 4.8,          // 4.8 以上满分
  coverageMin: 70,          // 权重覆盖率下限：低于它不出等级（只给「数据不足」）
};

/** 等级阈值（本仓约定，第一版试跑值，未做市场验证 —— 不许当行业标准对外宣称） */
const LEVEL_CUT = { good: 75, watch: 55, warn: 40 };

// ===== 二·bis：补录枚举的**单一真相源** =====
//   为什么放在引擎里而不是各校验文件各抄一份：这些 key 是**引擎打分的输入**（商圈五档直接映射分数、
//   借贷三档、差评趋势调整）。若校验层另抄一份，加一档就会出现「页面能选、引擎不认识」
//   ⇒ 选中了却不计分，且界面全绿。取数、校验、渲染三处必须认同一张表。
const DIAG_ENUM = {
  reviewTrend: ['better', 'slight', 'stable', 'worse'],
  businessDistrict: ['growing', 'stable', 'slight_down', 'clear_down', 'structural_loss'],
  debtLevel: ['none', 'light', 'heavy'],
};

// ===== 三、工具 =====
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** 线性插值：(x0→y0, x1→y1)，x 落在区间外自动取端值 */
function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return y0 + (y1 - y0) * t;
}
const pct = (part, whole) => {
  const a = num(part); const b = num(whole);
  if (a === null || b === null || b === 0) return null;
  return (a / b) * 100;
};

// ===== 四、11 个指标的评分函数 =====
// 每项返回 { score:0..100|null, note:string, basis:string }
// score === null ⇔ 数据不足（不计入分母）。

const METRICS = [
  // 1 盈利能力 15 —— 净利率 ≤−5% 得 0；−5%~12% 线性；≥12% 得 100（原表口径）
  {
    key: 'profit', label: '盈利能力', weight: 15, kind: 'auto',
    score: (i) => {
      const r = pct(i.netProfitFen, i.revenueFen);
      if (r === null) return { score: null, note: '缺当月营业额或利润', basis: '' };
      const s = r <= -5 ? 0 : (r >= 12 ? 100 : lerp(r, -5, 0, 12, 100));
      return { score: Math.round(s), note: `净利率 ${r.toFixed(1)}%`, basis: '净利率 −5%~12% 线性' };
    },
  },
  // 2 亏损持续性 10 —— 0 月 100；≤可扛上限内每多 1 月 −10；超上限后每多 1 月再 −10，封底 0
  {
    key: 'loss', label: '亏损持续性', weight: 10, kind: 'auto',
    score: (i) => {
      const m = num(i.lossMonths);
      if (m === null || m < 0) return { score: null, note: '缺连续亏损月数', basis: '' };
      const tol = TUNABLE.lossMonthsTolerable;
      const s = m <= tol ? 100 - m * 10 : Math.max(0, 40 - (m - tol) * 10);
      return { score: Math.round(s), note: `连续亏损 ${m} 个月`, basis: `可扛上限 ${tol} 个月` };
    },
  },
  // 3 现金流 15 —— 现金可撑月数 <1 得 0；≥3 得 100；中间线性
  //   🔴 必须用**账面现金**，不许用净现金流近似（见文件头底线 2）
  {
    key: 'cash', label: '现金流', weight: 15, kind: 'manual',
    score: (i) => {
      const cash = num(i.cashOnHandFen);
      const rigid = num(i.monthlyRigidFen);
      if (cash === null || rigid === null || rigid <= 0) {
        return { score: null, note: '缺账面现金或月刚性支出', basis: '' };
      }
      const months = cash / rigid;
      const safe = TUNABLE.cashSafeMonths;
      const s = months < 1 ? 0 : (months >= safe ? 100 : lerp(months, 1, 0, safe, 100));
      return { score: Math.round(s), note: `账面现金可撑 ${months.toFixed(1)} 个月`, basis: `安全线 ${safe} 个月` };
    },
  },
  // 4 客流与营收趋势 10 —— 同比 ≥0 得 100；达下滑警戒得 20
  {
    key: 'traffic', label: '客流趋势', weight: 10, kind: 'manual',
    score: (i) => {
      const a = num(i.trafficThisMonth); const b = num(i.trafficLastYear);
      if (a === null || b === null || b <= 0) return { score: null, note: '缺本月客流或去年同期客流', basis: '' };
      const yoy = ((a - b) / b) * 100;
      const warn = -TUNABLE.trafficDropWarnPct;
      let s;
      if (yoy >= 0) s = 100;
      else if (yoy >= warn) s = lerp(yoy, warn, 20, 0, 100);
      else s = Math.max(0, lerp(yoy, warn * 2.5, 0, warn, 20));
      return { score: Math.round(s), note: `客流同比 ${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`, basis: `下滑警戒 ${TUNABLE.trafficDropWarnPct}%` };
    },
  },
  // 5 毛利率 8 —— ≤健康线 100；健康线→红线 线性降；≥红线 0
  //   🔴 对外叫「毛利率」（§12.7 禁用「食材成本率」）；内部由食材率换算，字段仍读 foodCostRatePct
  {
    key: 'grossMargin', label: '毛利率', weight: 8, kind: 'auto',
    score: (i) => {
      const food = num(i.foodCostRatePct);
      if (food === null) return { score: null, note: '缺毛利率', basis: '' };
      const gm = 100 - food;                        // 内部中间量
      const hard = BIZ_HARD[i.bizType] || BIZ_HARD.other;
      const healthy = hard.grossMarginHealthy;
      // 红线 = 健康线 − 5pp 为本仓约定（原表"超红线降 0"未给值）
      const red = healthy - 5;
      const s = gm >= healthy ? 100 : (gm <= red ? 0 : lerp(gm, red, 0, healthy, 100));
      return { score: Math.round(s), note: `毛利率 ${gm.toFixed(1)}%`, basis: `本业态健康线 ${healthy}%` };
    },
  },
  // 6 人工成本率 7 —— ≤警戒 100；警戒→2 倍警戒 线性降 0（警戒乘城市系数）
  {
    key: 'labor', label: '人工成本率', weight: 7, kind: 'auto',
    score: (i) => {
      const v = num(i.laborCostRatePct);
      if (v === null) return { score: null, note: '缺人工成本率', basis: '' };
      const hard = BIZ_HARD[i.bizType] || BIZ_HARD.other;
      const coef = LABOR_COEF[i.cityTier] == null ? 1 : LABOR_COEF[i.cityTier];
      const warn = hard.laborWarn * coef;
      const s = v <= warn ? 100 : (v >= warn * 2 ? 0 : lerp(v, warn, 100, warn * 2, 0));
      return { score: Math.round(s), note: `人工成本率 ${v.toFixed(1)}%`, basis: `本业态警戒 ${warn.toFixed(1)}%（含城市系数 ${coef}）` };
    },
  },
  // 7 房租负担 10 —— ≤警戒 100；超警戒线性降（警戒 = 参考带上沿 × 城市系数）
  {
    key: 'rent', label: '房租负担', weight: 10, kind: 'auto',
    score: (i) => {
      const v = num(i.rentRatePct);
      if (v === null) return { score: null, note: '缺房租占比', basis: '' };
      const coef = RENT_COEF[i.cityTier] == null ? 1 : RENT_COEF[i.cityTier];
      const hi = (RENT_WARN_HI[i.bizType] || RENT_WARN_HI.other) * coef;
      const s = v <= hi ? 100 : Math.max(0, lerp(v, hi, 100, hi * 1.5, 0));
      return { score: Math.round(s), note: `房租占比 ${v.toFixed(1)}%`, basis: `本业态上沿 ${hi.toFixed(1)}%（含城市系数 ${coef}）` };
    },
  },
  // 8 口碑 5 —— ≥4.8 满分；4.0~4.8 线性 60→100；<4.0 → 0~60；再按差评趋势调整
  {
    key: 'rating', label: '口碑评分', weight: 5, kind: 'manual',
    score: (i) => {
      const r = num(i.rating);
      if (r === null) return { score: null, note: '缺平台评分', basis: '' };
      const good = TUNABLE.ratingGood; const floor = TUNABLE.ratingFloor;
      let s = r >= good ? 100 : (r <= floor ? lerp(r, 0, 0, floor, 60) : lerp(r, floor, 60, good, 100));
      // 趋势调整（原表：恶化 −20 / 略增 −8 / 改善 +）
      const t = String(i.reviewTrend || '');
      if (t === 'worse') s -= 20;
      else if (t === 'slight') s -= 8;
      else if (t === 'better') s += 5;
      return { score: Math.round(clamp(s, 0, 100)), note: `平台评分 ${r.toFixed(1)}${t ? `（差评趋势 ${t}）` : ''}`, basis: '4.8 满分 / 4.0 以下封底' };
    },
  },
  // 9 商圈与竞争 10 —— 增长 100 / 平稳 85 / 小降 70 / 明显降 45 / 结构性流失 0
  {
    key: 'district', label: '商圈环境', weight: 10, kind: 'manual',
    score: (i) => {
      const map = { growing: 100, stable: 85, slight_down: 70, clear_down: 45, structural_loss: 0 };
      const k = String(i.businessDistrict || '');
      if (!(k in map)) return { score: null, note: '缺商圈变化', basis: '' };
      return { score: map[k], note: `商圈 ${k}`, basis: '五档枚举（增长/平稳/小降/明显降/结构性流失）' };
    },
  },
  // 10 租约稳定性 5 —— ≥24 月 100；分段递减；<3 月 10
  {
    key: 'lease', label: '租约稳定性', weight: 5, kind: 'manual',
    score: (i) => {
      const m = num(i.leaseMonthsLeft);
      if (m === null || m < 0) return { score: null, note: '缺剩余租期', basis: '' };
      let s;
      if (m >= 24) s = 100;
      else if (m >= 12) s = lerp(m, 12, 70, 24, 100);
      else if (m >= 6) s = lerp(m, 6, 45, 12, 70);
      else if (m >= 3) s = lerp(m, 3, 25, 6, 45);
      else s = lerp(m, 0, 10, 3, 25);
      return { score: Math.round(s), note: `剩余租期 ${m} 个月`, basis: '≥24 月满分' };
    },
  },
  // 11 资金链独立性 5 —— 无借贷 100 / 少量 60 / 大量持续 10
  {
    key: 'debt', label: '资金链独立性', weight: 5, kind: 'manual',
    score: (i) => {
      const map = { none: 100, light: 60, heavy: 10 };
      const k = String(i.debtLevel || '');
      if (!(k in map)) return { score: null, note: '缺借贷情况', basis: '' };
      return { score: map[k], note: `借贷 ${k}`, basis: '无/少量/大量持续' };
    },
  },
];

// ===== 五、6 条红线（一票否决）=====
// 每条返回 { code, label, hit:boolean, judged:boolean, evidence:string }
// 🔴 judged=false = 数据不足**未判定**（不是"没命中"）。上层必须把这两者分开呈现：
//    把「没数据」显示成「安全」是这套模型最危险的谎 —— 老板会以为查过了没问题。
const REDLINES = [
  {
    code: 'R1', label: '现金枯竭',
    check: (i) => {
      const cash = num(i.cashOnHandFen); const rigid = num(i.monthlyRigidFen);
      if (cash === null || rigid === null || rigid <= 0) return { judged: false, evidence: '缺账面现金或月刚性支出，无法判定' };
      const months = cash / rigid;
      return { judged: true, hit: months < 1, evidence: `账面现金可撑 ${months.toFixed(1)} 个月（<1 个月即触发）` };
    },
  },
  {
    code: 'R2', label: '长期亏损仍失血',
    check: (i) => {
      const m = num(i.lossMonths); const r = pct(i.netProfitFen, i.revenueFen);
      if (m === null || r === null) return { judged: false, evidence: '缺连续亏损月数或净利率，无法判定' };
      const hit = m > TUNABLE.lossMonthsTolerable && r <= 0;
      return { judged: true, hit, evidence: `连续亏损 ${m} 个月（上限 ${TUNABLE.lossMonthsTolerable}），净利率 ${r.toFixed(1)}%` };
    },
  },
  {
    code: 'R3', label: '商圈结构性流失',
    check: (i) => {
      const k = String(i.businessDistrict || '');
      if (!k) return { judged: false, evidence: '缺商圈变化，无法判定' };
      // 结构性流失枚举：结构性流失 / 拆迁封路 / 商场明显空置
      const hit = k === 'structural_loss';
      return { judged: true, hit, evidence: `商圈 ${k}` };
    },
  },
  {
    code: 'R4', label: '食安重大事件',
    check: (i) => {
      if (i.foodSafetyEvent === undefined || i.foodSafetyEvent === null) return { judged: false, evidence: '未填报食安事件情况，无法判定' };
      return { judged: true, hit: !!i.foodSafetyEvent, evidence: i.foodSafetyEvent ? '填报存在食安处罚或重大客诉' : '未填报食安事件' };
    },
  },
  {
    code: 'R5', label: '借贷输血失控',
    check: (i) => {
      const d = String(i.debtLevel || ''); const cash = num(i.cashOnHandFen); const rigid = num(i.monthlyRigidFen);
      if (!d || cash === null || rigid === null || rigid <= 0) return { judged: false, evidence: '缺借贷情况或现金数据，无法判定' };
      const months = cash / rigid;
      return { judged: true, hit: d === 'heavy' && months < 3, evidence: `借贷 ${d}，现金可撑 ${months.toFixed(1)} 个月（<3 且大量持续即触发）` };
    },
  },
  {
    code: 'R6', label: '租约断崖',
    check: (i) => {
      const m = num(i.leaseMonthsLeft); const inc = num(i.renewIncreasePct); const r = pct(i.netProfitFen, i.revenueFen);
      if (m === null || inc === null || r === null) return { judged: false, evidence: '缺剩余租期/续租涨幅/净利率，无法判定' };
      const hit = m <= 3 && inc >= 20 && r < 0;
      return { judged: true, hit, evidence: `剩余 ${m} 个月，续租涨 ${inc}%，净利率 ${r.toFixed(1)}%` };
    },
  },
];

// ===== 六、主入口 =====
/**
 * 评估一次诊断（**纯函数**，零 IO）。
 * @param {object} input 指标输入（见上方各 score() 读取的字段）
 * @returns {{level:string, levelLabel:string, score:number|null, coverage:number,
 *            redlineHit:Array, redlineUnjudged:Array, metrics:Array, anchors:Array, missing:Array}}
 */
function evaluateDiagnosis(input) {
  const i = input || {};

  // ---- 红线先判（红线优先于分数）----
  const redlineAll = REDLINES.map((r) => {
    const res = r.check(i);
    return { code: r.code, label: r.label, judged: !!res.judged, hit: !!res.hit, evidence: res.evidence || '' };
  });
  const redlineHit = redlineAll.filter((r) => r.judged && r.hit);
  const redlineUnjudged = redlineAll.filter((r) => !r.judged);

  // ---- 11 指标打分 ----
  const metrics = METRICS.map((m) => {
    const r = m.score(i);
    return {
      key: m.key, label: m.label, weight: m.weight, kind: m.kind,
      score: r.score, hasData: r.score !== null,
      note: r.note || '', basis: r.basis || '',
    };
  });

  // ---- 动态权重归一化（缺项不计分、不凑分）----
  const totalWeight = METRICS.reduce((s, m) => s + m.weight, 0);          // 恒 100
  const usedWeight = metrics.filter((m) => m.hasData).reduce((s, m) => s + m.weight, 0);
  const rawSum = metrics.filter((m) => m.hasData).reduce((s, m) => s + m.score * m.weight, 0);
  const coverage = totalWeight > 0 ? Math.round((usedWeight / totalWeight) * 100) : 0;
  const score = usedWeight > 0 ? rawSum / usedWeight : null;

  // ---- 覆盖率闸门：不足则**不出等级**（否则"数据少反而高分"会误导）----
  let level;
  let levelLabel;
  if (coverage < TUNABLE.coverageMin) {
    level = 'insufficient';
    levelLabel = '数据不足';
  } else if (redlineHit.length > 0) {
    // 🔴 红线一旦命中，直接高危，不看总分（原模型口径）
    level = 'critical';
    levelLabel = '高危';
  } else if (score === null) {
    level = 'insufficient';
    levelLabel = '数据不足';
  } else if (score >= LEVEL_CUT.good) { level = 'good'; levelLabel = '健康'; }
  else if (score >= LEVEL_CUT.watch) { level = 'watch'; levelLabel = '需关注'; }
  else if (score >= LEVEL_CUT.warn) { level = 'warn'; levelLabel = '预警'; }
  else { level = 'critical'; levelLabel = '高危'; }

  // ---- 短板排序（只对 hasData 的项按 失分×权重 降序，前 3）----
  //   为什么乘权重：一项 5 分权重扣 20 分 = 丢 1 分，一项 15 分权重扣 20 分 = 丢 3 分。
  //   不乘权重会把"小权重指标"排到前面，给出抓错重点的改进建议。
  const anchors = metrics
    .filter((m) => m.hasData && m.score < 80)
    .map((m) => ({ key: m.key, label: m.label, lost: Math.round((100 - m.score) * m.weight / 100 * 10) / 10, note: m.note }))
    .sort((a, b) => b.lost - a.lost)
    .slice(0, 3);

  const missing = metrics.filter((m) => !m.hasData).map((m) => ({ key: m.key, label: m.label, weight: m.weight }));

  return {
    level,
    levelLabel,
    score: score === null ? null : Math.round(score * 10) / 10,
    coverage,
    usedWeight,
    redlineHit,
    redlineUnjudged,
    metrics,
    anchors,
    missing,
    // 免责兜底文案由上层渲染（规范 §12.7 强制），引擎只给键，不拼对外句子
    disclaimerKey: 'diagnosis.disclaimer',
  };
}

module.exports = {
  BIZ_HARD,
  BIZ_KEYS,
  RENT_WARN_HI,
  RENT_COEF,
  LABOR_COEF,
  TUNABLE,
  LEVEL_CUT,
  DIAG_ENUM,
  METRICS,
  REDLINES,
  evaluateDiagnosis,
};
