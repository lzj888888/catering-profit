// cloudfunctions/common/indicatorRef.js —— M2 餐饮指标参考库（分业态 × 分城市层级）· 口径单源
//
// ⚠️ 与 M1.6「经营红线阈值口径」是**两个口径**，职责不同，不得互相覆盖：
//   · M1.6 唯一声明处（specs/dev-specs/core/开发规范v1.0_ModuleM1_月度盈利核算.md）
//     = 通用**警戒线**，单一值，用于"越线预警"（房租 ≤15% / 人工 ≤20% / 毛利率 ≥55% / 损耗 ≤5%）。
//   · 本文件 = 分业态**参考带**，区间值，用于"你在行业里大概什么位置"。
//   展示时两者并列；警戒线数值**只在 M1.6 声明**，本文件 REDLINE 段是**引用副本**，
//   由守卫 tools/check_indicator_ref.js 双向校验两边数字一致（改任一侧都会判红）。
//
// 数据出处（勿删，后续换真实样本时要能溯源）：
//   [D1] TrueSight《连锁餐饮企业成本控制：餐饮费用占营业额比例》—— 四业态 × 六成本项区间表
//   [D2] 帆软 E 数通《餐饮店门店盈利诊断报表》—— 五大成本健康区间 + 警戒线
//   [D3] 餐赢计《餐饮连锁品牌单店盈利模型测算体系》—— 固定/可变成本分类、外卖抽佣 15%~25%
//   [D4] 用户既有交付件 deepseek空间/餐饮闭店决策模型 v1.0 —— **城市系数**
//        （原文：一线 ×1.2、二三线 ×1.0、县城 ×0.75，用于房租警戒线）
//   [E1] 经验推算（无直接出处）—— 标注处须在真实样本校准后替换
//
// 契约：金额一律「分」整数；占比一律**百分数**（65 表示 65%），展示保留 1 位小数。

// ===== 一、城市层级（[D4] 房租系数为原值；labor 为 [E1] 推算）=====
// [E1] 依据：一线城市服务员税前月薪突破 7000 元 vs 全国均值 4884 元（约 1.43 倍），
//      但占比受营收基数同步抬高影响，故取保守值 1.15（下沉取 0.85），待真实样本校准。
const CITY_TIERS = [
  { key: 'tier1', coef: { rent: 1.20, labor: 1.15 } },   // 一线 / 新一线
  { key: 'tier23', coef: { rent: 1.00, labor: 1.00 } },  // 二三线（基准）
  { key: 'county', coef: { rent: 0.75, labor: 0.85 } },  // 县城 / 乡镇
];
const CITY_KEYS = CITY_TIERS.map((t) => t.key);

// ===== 二、业态（[D1] 四类）=====
const BIZ_KEYS = ['fastfood', 'dining', 'hotpot', 'cafe'];

// ===== 三、参考带（[D1] 原表，**二三线基准**，单位 %）=====
// 六项：food 食材成本率 / labor 人工成本率 / rent 房租成本率 / mkt 营销（含平台抽成）
//       energy 能耗（水电气）/ manage 管理费用率
const BANDS = {
  fastfood: { food: [25, 35], labor: [20, 25], rent: [5, 10], mkt: [3, 8], energy: [2, 4], manage: [5, 10] },
  dining: { food: [35, 45], labor: [25, 35], rent: [8, 15], mkt: [5, 10], energy: [3, 5], manage: [5, 10] },
  hotpot: { food: [30, 40], labor: [30, 40], rent: [8, 15], mkt: [5, 10], energy: [4, 6], manage: [5, 10] },
  cafe: { food: [20, 30], labor: [20, 30], rent: [5, 12], mkt: [3, 8], energy: [1, 3], manage: [5, 10] },
};
const BAND_KEYS = ['food', 'labor', 'rent', 'mkt', 'energy', 'manage'];

// ===== 四、指标元数据 =====
// dir: 'cost' 越低越好 / 'gain' 越高越好
// citySensitive: true 才乘城市系数（食材**不乘** —— 一线采购贵约 15% 但售价同步高，占比不必然变，[D2]）
// amountKey: 该指标由哪一类输入算出（'grossMargin' / 'platform' 为派生，非金额项）
const INDICATORS = [
  { key: 'food', band: 'food', dir: 'cost', citySensitive: false, from: 'grossMargin' },
  { key: 'rent', band: 'rent', dir: 'cost', citySensitive: true, from: 'fixed:rent' },
  { key: 'labor', band: 'labor', dir: 'cost', citySensitive: true, from: 'fixed:labor' },
  { key: 'energy', band: 'energy', dir: 'cost', citySensitive: false, from: 'fixed:utility' },
  { key: 'manage', band: 'manage', dir: 'cost', citySensitive: false, from: 'fixed:manage' },
  { key: 'mkt', band: 'mkt', dir: 'cost', citySensitive: false, from: 'var:platform' },
];
const IND_KEYS = INDICATORS.map((i) => i.key);

// ===== 五、红线警戒线（🔴 引用 M1.6 唯一声明处；本段是副本，勿顺手改数）=====
const REDLINE = { rent: 15, labor: 20, grossMargin: 55, loss: 5 };
const REDLINE_KEYS = ['rent', 'labor', 'grossMargin', 'loss'];

// ===== 六、对外参数（供 validate 白名单复用，避免两处枚举漂移）=====
const FIXED_KEYS = ['rent', 'labor', 'utility', 'manage', 'other'];
const VAR_KEYS = ['takeawayComm', 'grouponComm', 'cardFee', 'other'];
const BUILD_KEYS = ['franchise', 'decor', 'equip', 'other'];
// 摊销年限默认值（[E1] 经验值：加盟按合同期、装修按翻新周期、设备按直线折旧）
const BUILD_DEFAULT_YEARS = { franchise: 3, decor: 3, equip: 5, other: 3 };

// ⚠️ 保留 1 位小数必须带**十进制容差** —— 纯 Math.round(n*10)/10 会栽在浮点表示上：
//    25 × 1.15 = 28.749999999999996（不是 28.75）⇒ 裸 round 得 28.7，与手算 28.8 差 0.1。
//    加 1e-9（远小于 0.1 的精度步长、远大于双精度误差 3.6e-15）即可修正方向，且不误伤正常值。
//    本坑由 selftest E3 实测抓出（2026-09-23）。
const round1 = (n) => Math.round(n * 10 + 1e-9) / 10;

/** 取某业态某指标在指定城市层级下的参考带（已乘城市系数）。 */
function bandOf(bizKey, indKey, cityKey) {
  const row = BANDS[bizKey] || BANDS.dining;
  const raw = row[indKey];
  if (!raw) return null;
  const ind = INDICATORS.find((i) => i.key === indKey);
  let c = 1;
  if (ind && ind.citySensitive) {
    const t = CITY_TIERS.find((x) => x.key === cityKey) || CITY_TIERS[1];
    c = tickCity(indKey, t);
  }
  return { lo: round1(raw[0] * c), hi: round1(raw[1] * c), coef: c };
}
function tickCity(indKey, tier) {
  if (!tier || !tier.coef) return 1;
  return indKey === 'rent' ? tier.coef.rent : indKey === 'labor' ? tier.coef.labor : 1;
}

/**
 * 评级。cost（成本类）：低于下限=good、带内=ok、超上限 25% 内=warn、再高=bad。
 * gain（毛利率类）：高于上限=good、带内=ok、低于下限 15% 内=warn、再低=bad。
 */
function levelOf(pct, lo, hi, dir) {
  if (pct == null || !isFinite(pct)) return 'na';
  if (dir === 'gain') {
    if (pct >= hi) return 'good';
    if (pct >= lo) return 'ok';
    if (pct >= lo * 0.85) return 'warn';
    return 'bad';
  }
  if (pct <= lo) return 'good';
  if (pct <= hi) return 'ok';
  if (pct <= hi * 1.25) return 'warn';
  return 'bad';
}

/**
 * 生成指标对照表。
 * @param {object} o
 *   - bizKey / cityKey
 *   - revenueFen   分母（分）—— 由调用方给定（保本营业额 / 目标利润营业额各调一次）
 *   - fixedFen     { rent|labor|utility|manage|other: 分 }
 *   - grossMarginPct 菜品毛利率（%）
 *   - platformPct  「跟营业额挂钩」合计费率（%）
 * @returns {Array<{key,pct,lo,hi,level,redline,redlineHit}>}
 */
function evaluateIndicators(o) {
  const opt = o || {};
  const rev = Number(opt.revenueFen);
  const fixed = opt.fixedFen || {};
  const gm = Number(opt.grossMarginPct);
  const plat = Number(opt.platformPct);
  const out = [];
  for (const ind of INDICATORS) {
    let pct = null;
    if (ind.from === 'grossMargin') {
      pct = isFinite(gm) ? 100 - gm : null;
    } else if (ind.from === 'var:platform') {
      pct = isFinite(plat) ? plat : null;
    } else if (ind.from.indexOf('fixed:') === 0) {
      const k = ind.from.slice(6);
      const fen = Number(fixed[k]);
      pct = (isFinite(rev) && rev > 0 && isFinite(fen)) ? (fen / rev) * 100 : null;
    }
    const band = bandOf(opt.bizKey, ind.key, opt.cityKey);
    const p = pct == null ? null : round1(pct);
    const lv = band ? levelOf(p, band.lo, band.hi, ind.dir) : 'na';
    const rl = redlineOf(ind.key);
    out.push({
      key: ind.key,
      pct: p,
      lo: band ? band.lo : null,
      hi: band ? band.hi : null,
      level: lv,
      redline: rl,
      // 命中警戒线：成本类"超过"、毛利率类"低于"
      redlineHit: rl == null || p == null ? false
        : (ind.dir === 'gain' ? p < rl : p > rl),
    });
  }
  return out;
}

/** 取某指标对应的警戒线（仅 rent/labor 有；其余返回 null）。 */
function redlineOf(indKey) {
  if (indKey === 'rent') return REDLINE.rent;
  if (indKey === 'labor') return REDLINE.labor;
  if (indKey === 'food') return 100 - REDLINE.grossMargin; // 食材成本率警戒线 = 100 − 毛利率警戒线
  return null;
}

module.exports = {
  CITY_TIERS, CITY_KEYS,
  BIZ_KEYS,
  BANDS, BAND_KEYS,
  INDICATORS, IND_KEYS,
  REDLINE, REDLINE_KEYS,
  FIXED_KEYS, VAR_KEYS, BUILD_KEYS, BUILD_DEFAULT_YEARS,
  bandOf, levelOf, evaluateIndicators, redlineOf,
};
