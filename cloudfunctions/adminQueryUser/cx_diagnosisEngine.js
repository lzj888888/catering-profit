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
// 🔴 3. 【R615 李老师授权总设计师拍板 · 划清边界】输出**给可执行选项，不给终局判决**。
//    旧版写「不给行动指令」，把两件事混为一谈：
//      ❌ 替老板做终局决定（「建议闭店」「该关了」「一定能救活」「保证不亏」）—— 仍然禁止；
//      ✅ 给带他自己数字的改善动作（「房租占 18%，降到 15% 每月约省 ¥X：谈降租或提坪效」）—— 放行。
//    回查规范 §12.7 原文：只禁算命类措辞 / 绝对化承诺 / 「食材成本率」对外，
//    **并未禁「给带数的改善动作」** ⇒ 旧版是扩大解释，本轮按李老师「老板要的是那我该干嘛」订正。
//    责任边界不变且更清楚：给的是选项 + 依据，决定权仍在老板手里；动作一律来自**预设规则表**
//    （`getDiagnosis/actions.js`），不是生成式自由发挥；报告末尾必须渲染合规兜底句。
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
// 🔴 A16（2026-11-05）教训：这里原是**手抄的数**（15/15/15/18/15），而 A16 把
//   other.rent 从 [5,15] 改成 [8,18] ⇒ 抄写值当场过期（other 实际 18 却按 15 判），
//   且不会报错（15 是合法数字）。现改为**从 BANDS 派生**：改带值即自动跟随，不可能漂。
//   ⚠️ 依赖方向：indicatorRef 不 require 本文件（单向），无循环依赖。
const _BANDS_FOR_WARN = require('./cx_indicatorRef').BANDS;
const RENT_WARN_HI = BIZ_KEYS.reduce((acc, k) => {
  const row = _BANDS_FOR_WARN[k] || _BANDS_FOR_WARN.other;
  acc[k] = row.rent[1];
  return acc;
}, {});
// 城市系数（§12.4 已拍板，闭卷不再议）：房租 [D4] 1.2/1.0/0.75；人工 [E1] 1.15/1.0/0.85
const RENT_COEF = { tier1: 1.2, tier2: 1.0, tier3: 0.75 };
const LABOR_COEF = { tier1: 1.15, tier2: 1.0, tier3: 0.85 };

// ===== 二、可扛上限与安全下限（**按智库分业态校准**）=====
// 🔴 R612（2026-11-06 李老师拍板）：原先这里是**全业态统一经验值**（连亏 6 月 / 现金 3 月 /
//   客流 −20% / 评分 4.0），而 `REVIEW_2026-09-23_闭店决策模型v1.0_与本仓口径对照.md` §5 末尾
//   明确记录原模型给的是**分业态值**：连亏可扛 4/5/4/5 月、现金安全 3/3/3/4 月、
//   客流下滑警戒 −20/−15/−20/−15%、综合评分警戒 3.8/3.9/3.9/3.8。
//   ⇒ 现改为按业态取值，**统一值只作兜底**（未知业态）。这是"按智库走"的具体落点。
//   ⚠️ 顺序与 BIZ_KEYS 一致：fastfood / dining / hotpot / cafe / other。
//
// 🔴 R615 方案③（李老师授权总设计师拍板）：**撤销「连续亏损可扛月数」这个固定上限**。
//   它与账上现金无关（4/5 月是拍出来的经验值），而现金流项用的是「现金 ÷ 月均净亏」；
//   真机可复现的冲突：账上 16 万、月亏 2 万、连亏 6 月的正餐店 ⇒ 现金流项 100 分「还能撑 8 个月」，
//   连亏项 30 分「超过可扛上限 5 个月」——同一页两个相反结论，工具当场失信。
//   ⇒ 连亏月数**降级为证据**（照常显示、进处方、进红线证据句），不再单独决定分数/红线/等级；
//   生死判定统一到「现金可撑月数」+「失血率（月均净亏 ÷ 营业额）」两个都用钱量纲的判据。
//   ⚠️ 不改 11 项数量、不改权重、不改覆盖率归一化口径 ⇒ 历史分数仍可比。
const TUNABLE = {
  // 失血率警戒（月均净亏 ÷ 月营业额）：**第一版试跑值，未做市场验证，不许当行业标准对外宣称**。
  //   与 LEVEL_CUT 同规格：可校准、单源、不许散落手写。
  bleedRateWarnPct: 20,
  // 现金安全下限（原模型：3/3/3/4；other 取 3）
  cashSafeMonthsByBiz: { fastfood: 3, dining: 3, hotpot: 3, cafe: 4, other: 3 },
  // 客流同比下滑警戒（原模型：−20/−15/−20/−15；other 取 −20）
  trafficDropWarnPctByBiz: { fastfood: 20, dining: 15, hotpot: 20, cafe: 15, other: 20 },
  // 综合评分警戒下限（原模型：3.8/3.9/3.9/3.8；other 取 3.8）
  ratingFloorByBiz: { fastfood: 3.8, dining: 3.9, hotpot: 3.9, cafe: 3.8, other: 3.8 },
  ratingGood: 4.8,          // 4.8 以上满分（原表口径，不分业态）
  coverageMin: 70,          // 权重覆盖率下限：低于它不出等级（只给「数据不足」）
};
/** 按业态取阈值的统一入口：未知业态/缺省一律走 other，**绝不回落到 0 或 undefined** */
function tOf(key, bizType) {
  const m = TUNABLE[key] || {};
  const k = (bizType && m[bizType] !== undefined) ? bizType : 'other';
  return m[k];
}

/** 等级阈值（本仓约定，第一版试跑值，未做市场验证 —— 不许当行业标准对外宣称） */
const LEVEL_CUT = { good: 75, watch: 55, warn: 40 };

// ===== 二·bis：补录枚举的**单一真相源** =====
//   为什么放在引擎里而不是各校验文件各抄一份：这些 key 是**引擎打分的输入**（商圈五档直接映射分数、
//   借贷三档、差评趋势调整）。若校验层另抄一份，加一档就会出现「页面能选、引擎不认识」
//   ⇒ 选中了却不计分，且界面全绿。取数、校验、渲染三处必须认同一张表。
const DIAG_ENUM = {
  reviewTrend: ['better', 'slight', 'stable', 'worse'],
  // 🔴 R614：营收趋势的**主观兜底**档（账不满 13 个月、算不出精确同比时才用）
  revenueFeel: ['better', 'same', 'worse'],
  businessDistrict: ['growing', 'stable', 'slight_down', 'clear_down', 'structural_loss'],
  debtLevel: ['none', 'light', 'heavy'],
};

// ===== 三、工具 =====
// 🔴 R612：`num()` 必须把 null/undefined/'' 判成 **null（缺数据）**，不能靠 Number() 强转。
//   踩过的坑：`Number(null) === 0` 且 Number.isFinite(0) === true ⇒ 改之前 `num(null)` 返回 0，
//   于是"没填账面现金/没有连亏月数"被当成"等于 0" —— 前者会让 R1 判成命中，
//   后者会让"连亏未知"显示成"连亏 0 个月、满分"。**缺项 ≠ 0** 是本仓贯穿始终的红线。
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
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
  // 2 失血速度 10 —— 🔴 R615 方案③：不再数「连亏几个月」，改看「每月亏掉营业额的百分之几」。
  //   为什么必须换：月亏 500 与月亏 5 万都记「连亏 1 个月」得同分；且固定 4/5 月上限与账上现金无关。
  //   连亏月数仍是**证据**（note 里照实写「已连亏 N 个月」），但不再独自决定分数。
  //   判据与 cash 项同源：都用「钱」的量纲 ⇒ 不会同页一个说没事一个说危险。
  {
    key: 'loss', label: '失血速度', weight: 10, kind: 'auto',
    score: (i) => {
      const m = num(i.lossMonths);
      if (m === null || m < 0) return { score: null, note: '缺连续亏损月数', basis: '' };
      const rev = num(i.revenueFen);
      let burn = num(i.avgMonthlyNetLossFen);
      let burnBasis = '近 3 个月平均净亏损';
      if (burn === null) {
        const np = num(i.netProfitFen);
        if (np !== null) { burn = -np; burnBasis = '仅按当月净利推算（单月波动大）'; }
      }
      if (burn === null || rev === null || rev <= 0) {
        return { score: null, note: '缺月均净亏损或营业额', basis: '' };
      }
      if (burn <= 0) {
        // 连亏是**历史**，近 3 月平均不亏是**现状**：不撒谎，也不把两者写成自相矛盾的一句话。
        return {
          score: 100,
          note: m > 0 ? `近 3 个月平均已不再失血（此前连亏 ${m} 个月）` : '当前不亏损，现金在积累',
          basis: burnBasis,
        };
      }
      const bleed = (burn / rev) * 100;                 // 失血率 = 月均净亏 ÷ 月营业额
      const warn = TUNABLE.bleedRateWarnPct;
      const s = bleed >= warn ? 0 : lerp(bleed, 0, 100, warn, 0);
      return {
        score: Math.round(s),
        note: `已连亏 ${m} 个月；每月亏掉营业额的 ${bleed.toFixed(1)}%`,
        basis: `${burnBasis} ÷ 营业额；警戒 ${warn}%`,
      };
    },
  },
  // 3 现金流 15 —— **失血速度**：现金可撑月数 = 账面现金 ÷ 月均净亏损
  //   🔴 R612（2026-11-06 李老师拍板）口径变更，这是本轮最重要的算法修正：
  //     旧口径 = 现金 ÷ 月刚性支出（房租+人工+水电），语义是「假如明天起一分钱不进账」的**断粮测试**。
  //       它对「突发停业」有意义，但对「还在营业、只是每月亏」的店**系统性高估危险**：
  //       账上 10 万、月固定支出 5 万、每月净亏 1 万 ⇒ 旧算法得「2 个月」（恐吓），
  //       真实答案是「10 个月」（照这个亏法还能撑十个月）。
  //     新口径 = 现金 ÷ 月均净亏损，回答的是老板真正问的那句「照现在这样还能撑几个月」。
  //     ⇒ 断粮测试**不再作为主指标展示**；需要极端情况时由上层另行提示，不进 15 分权重。
  //   🔴 分母优先用 `avgMonthlyNetLossFen`（近 3 个月平均净亏损，正数）；
  //     缺它才退回当月 `netProfitFen` 反推，且 note 必须标明「仅按当月」——
  //     单月波动大（年节/装修/一次进货），不标注就等于用一个偶然数当趋势。
  {
    key: 'cash', label: '现金流', weight: 15, kind: 'manual',
    score: (i) => {
      const cash = num(i.cashOnHandFen);
      if (cash === null) return { score: null, note: '缺账面现金', basis: '' };
      const avgLoss = num(i.avgMonthlyNetLossFen);
      const cur = pct(i.netProfitFen, i.revenueFen);
      // 分母：优先 3 月均净亏损；缺失则用当月净利反推（并标注）
      let burn = null; let burnBasis = '';
      if (avgLoss !== null) { burn = avgLoss; burnBasis = '近 3 个月平均净亏损'; }
      else if (i.netProfitFen !== null && i.netProfitFen !== undefined) {
        const np = num(i.netProfitFen);
        if (np !== null) { burn = -np; burnBasis = '仅按当月净利推算（单月波动大）'; }
      }
      if (burn === null) return { score: null, note: '缺月均净亏损或当月净利', basis: '' };
      // 不亏损（burn ≤ 0）：不存在"撑几个月"的问题，现金流项满分
      if (burn <= 0) {
        return { score: 100, note: '当前不亏损，现金在积累', basis: burnBasis };
      }
      const months = cash / burn;
      const safe = tOf('cashSafeMonthsByBiz', i.bizType);
      const s = months < 1 ? 0 : (months >= safe ? 100 : lerp(months, 1, 0, safe, 100));
      return { score: Math.round(s), note: `照当前亏损速度还能撑 ${months.toFixed(1)} 个月`, basis: `${burnBasis}；安全线 ${safe} 个月` };
    },
  },
  // 4 客流与营收趋势 10 —— 同比 ≥0 得 100；达下滑警戒得 20
  {
    key: 'traffic', label: '营收趋势', weight: 10, kind: 'manual',
    // 🔴 R614（2026-11-06 李老师拍板）**数据源整体更换**，这是本轮最重要的一处口径修正：
    //   旧输入 = 「本月客流人次 vs 去年同期客流人次」两个数。问题不是放哪填，是**老板答不出**：
    //     收银系统只给"单数/营业额"，一桌 3 个人算 3 人次还是 1 人次，没有正确答案。
    //     问一个填不准的数比不问更糟：空着只是不计分（覆盖率掉一点），
    //     填个估的数会判出「客流在流失」这种**错误结论**——那是拿假数据下判断。
    //   新口径 = **营业额同比**（= 客流 × 客单价的综合结果，对"店在不在退"更直接）：
    //     ① 有 13 个月以上的账 ⇒ assemble 自动算，**零输入**（老板什么都不用填）
    //     ② 不足 13 个月 ⇒ 问一句主观三档「和去年同期比生意怎么样」，他一定答得出
    //     ③ 两者都没有 ⇒ 该项不判（不计分，绝不按 0）
    //   ⚠️ 阈值沿用 `trafficDropWarnPctByBiz`（分业态 −20/−15/−20/−15）：
    //      语义从"客流下滑警戒"扩成"营收下滑警戒"，数值不动（同一批智库标定）。
    score: (i) => {
      const warn = -tOf('trafficDropWarnPctByBiz', i.bizType);
      // ① 精确：营业额同比（自动算出来的，优先）
      const yoy = num(i.revenueYoyPct);
      if (yoy !== null) {
        let s;
        if (yoy >= 0) s = 100;
        else if (yoy >= warn) s = lerp(yoy, warn, 20, 0, 100);
        else s = Math.max(0, lerp(yoy, warn * 2.5, 0, warn, 20));
        return {
          score: Math.round(s),
          note: `营业额同比 ${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%（自动对比去年同月）`,
          basis: `下滑警戒 ${-warn}%`,
        };
      }
      // ② 兜底：老板的主观三档。分数给得保守（better 封顶 100 / same 75 / worse 35），
      //   并在 note 里**明写"按你的判断"** —— 不能让主观估计冒充精确同比。
      const feel = String(i.revenueFeel || '');
      const FEEL = { better: 100, same: 75, worse: 35 };
      if (FEEL[feel] !== undefined) {
        return {
          score: FEEL[feel],
          note: `营业额趋势：${{ better: '比去年好', same: '和去年差不多', worse: '比去年差' }[feel]}（按你的判断）`,
          basis: '账不满 13 个月，暂无自动同比',
        };
      }
      return { score: null, note: '缺营业额同比（账不满 13 个月，也没填趋势判断）', basis: '' };
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
      const good = TUNABLE.ratingGood; const floor = tOf('ratingFloorByBiz', i.bizType);
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
      // 🔴 R612：与 15 分现金流项**同一口径**（现金 ÷ 月均净亏损），不再用刚性支出。
      //   若用旧口径会出现自相矛盾：页面说"还能撑 10 个月"，红线却判"现金枯竭"。
      const cash = num(i.cashOnHandFen);
      if (cash === null) return { judged: false, evidence: '缺账面现金，无法判定' };
      const avgLoss = num(i.avgMonthlyNetLossFen);
      let burn = avgLoss;
      if (burn === null) { const np = num(i.netProfitFen); burn = np === null ? null : -np; }
      if (burn === null) return { judged: false, evidence: '缺月均净亏损或当月净利，无法判定' };
      if (burn <= 0) return { judged: true, hit: false, evidence: '当前不亏损，现金在积累' };
      const months = cash / burn;
      return { judged: true, hit: months < 1, evidence: `照当前亏损速度还能撑 ${months.toFixed(1)} 个月（<1 个月即触发）` };
    },
  },
  {
    code: 'R2', label: '长期亏损仍失血',
    check: (i) => {
      // 🔴 R615 方案③：撤销「连亏超过固定 4/5 月上限」这个与现金无关的判据。
      //   ⚠️ 也不能留「连亏 ≥3 月」当判据 —— 首版这么写过，实测立刻暴露新矛盾：
      //     营收 10 万 / 月亏 2 万 / 连亏 6 月 / 账上 16 万 ⇒ 失血率 20% 触警戒 ⇒ R2 判高危，
      //     而现金流项说「还能撑 8 个月」⇒ 又是同页两个相反结论。根因是红线里还留着「月数」。
      //   ⇒ 连亏月数**彻底降级为证据**（只在 evidence 里如实带一句），
      //     判定统一走两个都用钱量纲、且方向一致的量：**失血率到警戒 且 现金撑不到安全线**。
      //     亏得凶但账上还撑得住 ⇒ 预警（给动作），不是高危；又凶又撑不住 ⇒ 才一票否决。
      //   底线 2 不变：任一数据缺失一律「未判定」，不许拿近似量顶替。
      const cash = num(i.cashOnHandFen);
      const rev = num(i.revenueFen);
      let burn = num(i.avgMonthlyNetLossFen);
      if (burn === null) { const np = num(i.netProfitFen); burn = np === null ? null : -np; }
      if (cash === null || burn === null || rev === null || rev <= 0) {
        return { judged: false, evidence: '缺现金/月均净亏损/营业额，无法判定' };
      }
      if (burn <= 0) return { judged: true, hit: false, evidence: '当前不亏损，不构成持续失血' };
      const bleed = (burn / rev) * 100;
      const months = cash / burn;
      const warn = TUNABLE.bleedRateWarnPct;
      const safe = tOf('cashSafeMonthsByBiz', i.bizType);
      const m = num(i.lossMonths);
      const hit = bleed >= warn && months < safe;
      return {
        judged: true, hit,
        evidence: `每月亏掉营业额 ${bleed.toFixed(1)}%（警戒 ${warn}%）、照当前亏损速度还能撑 ${months.toFixed(1)} 个月`
          + `（本业态安全线 ${safe}）${m === null ? '' : `；已连亏 ${m} 个月（仅作参考）`}`,
      };
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
    code: 'R4', label: '重大食安事件',
    check: (i) => {
      // 🔴 R612（李老师拍板）：**不拆档**。普通抽检不合格/内部整改这类"对经营没影响"的，按没事处理；
      //   只有「影响店铺经营的重大食安」——集体食物中毒、被媒体曝光、被通报停业整顿 —— 才算。
      //   理由（李老师原话）：对店铺没影响的，说白了即使有大家也认为没有；拆档拆不明白，还得来回记数。
      //   字段仍是布尔，语义收窄为「重大」。
      if (i.foodSafetyEvent === undefined || i.foodSafetyEvent === null) return { judged: false, evidence: '未填报食安情况，无法判定' };
      return { judged: true, hit: !!i.foodSafetyEvent, evidence: i.foodSafetyEvent ? '存在影响经营的重大食安事件' : '无重大食安事件' };
    },
  },
  {
    code: 'R5', label: '借贷输血失控',
    check: (i) => {
      // 🔴 R612：与 R1 同口径（现金 ÷ 月均净亏损）。"输血失控"的前提是**还在失血**，
      //   盈利的店借大量钱更可能是扩张，不该被判"失控"。
      const d = String(i.debtLevel || '');
      const cash = num(i.cashOnHandFen);
      if (!d || cash === null) return { judged: false, evidence: '缺借贷情况或现金数据，无法判定' };
      const avgLoss = num(i.avgMonthlyNetLossFen);
      let burn = avgLoss;
      if (burn === null) { const np = num(i.netProfitFen); burn = np === null ? null : -np; }
      if (burn === null) return { judged: false, evidence: '缺月均净亏损或当月净利，无法判定' };
      if (burn <= 0) return { judged: true, hit: false, evidence: `借贷 ${d}，但当前不亏损（不像输血维持）` };
      const months = cash / burn;
      return { judged: true, hit: d === 'heavy' && months < 3, evidence: `借贷 ${d}，照当前亏损速度还能撑 ${months.toFixed(1)} 个月（<3 且大量持续即触发）` };
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
  // 🔴 R612 新增闸门①：**没有当月营收/利润 ⇒ 一律「数据不足」**。
  //   原来只卡覆盖率（70%），而 diag_facts 填满时覆盖率能到 85% ⇒ 一个**一本账都没有**的店
  //   靠补录项也能凑出「健康」。这是比算错更坏的错：等于告诉没记账的人"你店挺好"。
  //   诊断的第一性数据是账，不是问卷。
  const hasCoreFinance = (num(i.revenueFen) !== null && num(i.netProfitFen) !== null);
  if (!hasCoreFinance) {
    level = 'insufficient';
    levelLabel = '数据不足';
  } else if (coverage < TUNABLE.coverageMin) {
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

  // 🔴 R612 新增闸门②：**亏损中的店，等级封顶**（不许判「健康」）。
  //   为什么必须加：11 项加权里「盈利能力」只占 15 分。实测一家快餐店连亏 3 个月、净利率 −6.7%，
  //   其余项（房租/人工/租约/借贷都正常）把总分拉到 76.2 ⇒ 判「健康」。
  //   对老板来说这是**一眼假**：我这三个月都在赔，你说我健康？—— 一次就毁掉整个工具的可信度。
  //   封顶规则（按业态阈值，与 R2 同源）：
  //     · 连亏已达本业态可扛上限，或净利率 ≤ −5%  ⇒ 最高只能「预警」
  //     · 有任何一个月在亏（连亏 ≥1），或净利率 < 0  ⇒ 最高只能「需关注」
  //   仅封顶、不抬升：本就判得更差的维持原判。
  if (level === 'good' || level === 'watch' || level === 'warn') {
    const nm = pct(i.netProfitFen, i.revenueFen);
    const lm = num(i.lossMonths);
    // 🔴 R615 方案③：severe 不再用「连亏达固定上限」，改用与 R2/loss 项同源的失血率。
    //   「连亏 6 月但账上能撑 8 个月」不该被封顶成预警；「月亏掉营业额 20%」才该。
    const revL = num(i.revenueFen);
    let burnL = num(i.avgMonthlyNetLossFen);
    if (burnL === null) { const npL = num(i.netProfitFen); burnL = npL === null ? null : -npL; }
    const bleedL = (burnL !== null && burnL > 0 && revL !== null && revL > 0) ? (burnL / revL) * 100 : null;
    const severe = (bleedL !== null && bleedL >= TUNABLE.bleedRateWarnPct) || (nm !== null && nm <= -5);
    // 🔴 R615 方案③：`losing` 也不再看历史连亏月数，只看**当月是不是还在亏**。
    //   实测反例：当月净利为正、近 3 月平均不亏，但账上有 6 个月连亏史 ⇒
    //   旧规则仍把它压成「需关注」（一眼假）。历史是证据，不是当下的病。
    const losing = (burnL !== null && burnL > 0) || (nm !== null && nm < 0);
    if (severe && (level === 'good' || level === 'watch')) { level = 'warn'; levelLabel = '预警'; }
    else if (losing && level === 'good') { level = 'watch'; levelLabel = '需关注'; }
  }

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
  tOf,
  LEVEL_CUT,
  DIAG_ENUM,
  METRICS,
  REDLINES,
  evaluateDiagnosis,
};
