// cloudfunctions/common/indicatorRef.js —— M2 餐饮指标参考库（分业态 × 分城市层级）· 口径单源
//
// ⚠️ 与 M1.6「经营红线阈值口径」是**两个口径**，职责不同，不得互相覆盖：
//   · M1.6 唯一声明处（specs/dev-specs/core/开发规范v1.0_ModuleM1_月度盈利核算.md）
//     = 通用**警戒线**，单一值，用于"越线预警"（房租 ≤15% / 人工 ≤20% / 毛利率 ≥55% / 损耗 ≤5%）。
//   · 本文件 = 分业态**参考带**，区间值，用于"你在行业里大概什么位置"。
//   展示时两者并列；警戒线数值**只在 M1.6 声明**，本文件 REDLINE 段是**引用副本**，
//   由守卫 tools/check_indicator_ref.js 双向校验两边数字一致（改任一侧都会判红）。
//
// ===== 口径铁律：对用户**一律用「毛利率」，不出现「食材成本率」（round111 李老师拍板）=====
//   客户是餐饮小白，"食材成本率"听不懂；"毛利率"是餐饮人日常语言。
//   ⇒ **对外一切展示面（参考带 / 你的值 / 术语 / 规范正文）全部是毛利率**，
//     本文件 BANDS 的 grossMargin 段就是**毛利率区间**（不是成本率）。
//   ⚠️ 引擎内部仍需"食材成本率"这一个**中间量**（`100 − 毛利率`，在 service.js 算
//     「综合变动成本率 = 食材成本率 + Σ 挂钩费率」用）—— 那是**数学必需**，但**不出前端**：
//     · service.js 的 `food_cost_pct` 出参保留（内部/对账用），前端页面**不再渲染它**；
//     · 前端曾有的"食材成本占售价 35%"小字已改为「每卖 100 元，毛利 X 元」。
//     改这一层时注意：删 `food_cost_pct` 会**算错保本点**（它是综合变动成本率的加数），勿删。
//
// 数据出处（勿删，后续换真实样本时要能溯源）：
//   [D1] TrueSight《连锁餐饮企业成本控制：餐饮费用占营业额比例》—— 四业态 × 六成本项区间表
//   [D2] 帆软 E 数通《餐饮店门店盈利诊断报表》—— 五大成本健康区间 + 警戒线
//   [D3] 餐赢计《餐饮连锁品牌单店盈利模型测算体系》—— 固定/可变成本分类、外卖抽佣 15%~25%
//   [D4] 用户既有交付件 deepseek空间/餐饮闭店决策模型 v1.0 —— **城市系数** + **食材/人工/房租基线**
//        （原文：一线 ×1.2、二三线 ×1.0、县城 ×0.75，用于房租警戒线；
//          参数库食材 快餐36/正餐40/火锅45/茶饮35（含损耗），人工+房租+食材=三项刚性）
//   [D5] round111 行业多源校准（毛利率口径 · 2026-09-23 查证）：
//        · 火锅 55%~68%（掌邦调味品 2026 口径 55-68 / 餐饮财税大全 60-68 / 外卖科技社 55-65）
//        · 烧烤 50%~65%（外卖科技社 50-60 / 爱企查 50-70 多数 50-60 / 中年急救包 60-70）
//        · 正餐 50%~65%（不动卷 60-65 / 餐饮财税大全 55-60 / 丝路资讯 50-65 / 爱企查 50-60）
//        · 快餐 50%~65%（餐饮财税大全 60-65 / 不动卷 55-60 / 丝路资讯 40-55 / 爱企查 50-60）
//        · 茶饮 60%~75%（不动卷 60-70 / 餐饮财税大全 65-75）
//        · 火锅人工 18%~24%（餐饮财税大全 20-24 / 外卖科技社 18-22 / [D4] 参数库 18）
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

// ===== 二、业态（[D1] 四类；hotpot 的**显示名**是"火锅烧烤"，覆盖两类，见带值说明）=====
const BIZ_KEYS = ['fastfood', 'dining', 'hotpot', 'cafe'];

// ===== 三、参考带（**毛利率口径** · **二三线基准** · 单位 %）=====
// 六项：grossMargin 菜品毛利率 / labor 人工占比 / rent 房租占比 /
//       mkt 平台推广费占比 / energy 能耗（水电气）占比 / manage 管理费用占比
//
// ⚠️ grossMargin 是**越高越好**（dir: 'gain'），其余五项**越低越好**（dir: 'cost'）。
//    这是本库唯一一个方向相反的指标 —— 展示时必须分区，不可与成本项混排判级。
//
// grossMargin 段的定法（round111）：以 [D4] 参数库基线为中心，用 [D5] 行业多源区间校准
//   · fastfood [58,68]：[D4] 64（食材36）居中；[D5] 快餐 50-65 上沿
//   · dining   [55,65]：[D4] 60（食材40）居中；[D5] 正餐 50-65 共识中段 ⇒ 与 [D1] 原带一致，未改
//   · hotpot   [52,67]：[D4] 55（食材45）在带内偏下；[D5] **火锅 55-68 与 烧烤 50-65 并集折中**
//                      ⚠️ 该业态名合并了火锅与烧烤两类，两者毛利率基准**不同**（火锅更高、烧烤更低），
//                         故带比单一业态宽（15pp）。**若将来要分列，新增 bbq 业态即可**，不要硬塞进本带。
//   · cafe     [62,72]：[D4] 65（食材35）在带内；[D5] 茶饮 60-75 中段
//   （原 [D1] 成本率带换算成毛利率后为 快餐65-75/正餐55-65/火锅60-70/茶饮70-80 ——
//     快餐、火锅、茶饮三项**偏高**，会把行业正常水平误判成"偏低"，故按 [D5] 校准下移。）
// ---- labor 段的定法（round113 · 2026-09-24）----
// 依据 [D4] 参数库「人工成本率-警戒上限」：fastfood 20% / dining 22% / hotpot 18% / cafe 18%
// 定法：**hi = 警戒线**（到达警戒即不再算"合理"）、**lo = floor(警戒 × 0.8)**（优秀线须显著优于警戒）
//   ⇒ fastfood [16,20] / dining [17,22] / hotpot [14,18] / cafe [14,18]
//
// 🔴 为什么改（原值的病）：原 dining [25,35]、cafe [20,30] 的 **lo 竟高于警戒线**（25>22 / 20>18）
//    ⇒ 人工 23% 的正餐店（[D4] 已判"警戒"）在本库被判 `good`；更硬的是 dining lo=25 还高于
//    本仓 REDLINE.labor=20 ⇒ 同一条指标会**同时** `level=good` 与 `redlineHit=true`（自相矛盾）。
//    同类隐患：fastfood [20,25] 与 hotpot [18,24] 的 lo 恰好**等于**警戒线（零余量）——
//    "优秀线 == 警戒线"在语义上不成立（若 20% 就是警戒，20% 不能叫"优秀"）⇒ 一并下移。
//    ⚠️ 病根：round111 只按 [D5] **行业常见区间**定 labor，**没与 [D4] 警戒线对表** ——
//       "行业常见区间"（宽）与"警戒线"（严）是两个不同的东西，不可混用。
// ⚠️ 城市系数会再放大（tier1 ×1.15）：dining.labor@tier1 = [19.6, 25.3]，其 hi 超通用警戒线 20
//    属**允许**（一线人工绝对成本高；系数本身是 [E1] 待校准项，见 CITY_TIERS 注）。
// ⚠️ 不变式（由 tools/check_indicator_ref.js C-⑫ 守）：基准档 cost 类 **lo ≤ REDLINE**、
//    gain 类 **hi ≥ REDLINE** —— 否则会出现「既优秀又命中警戒线」这种自相矛盾。
const BANDS = {
  fastfood: { grossMargin: [58, 68], labor: [16, 20], rent: [5, 10], mkt: [3, 8], energy: [2, 4], manage: [5, 10] },
  dining: { grossMargin: [55, 65], labor: [17, 22], rent: [8, 15], mkt: [5, 10], energy: [3, 5], manage: [5, 10] },
  hotpot: { grossMargin: [52, 67], labor: [14, 18], rent: [8, 15], mkt: [5, 10], energy: [4, 6], manage: [5, 10] },
  cafe: { grossMargin: [62, 72], labor: [14, 18], rent: [5, 12], mkt: [3, 8], energy: [1, 3], manage: [5, 10] },
};
const BAND_KEYS = ['grossMargin', 'labor', 'rent', 'mkt', 'energy', 'manage'];

// ===== 四、指标元数据 =====
// dir: 'cost' 越低越好 / 'gain' 越高越好
// citySensitive: true 才乘城市系数（毛利率**不乘** —— 一线采购贵约 15% 但售价同步高，
//   占比/毛利率不必然变，[D2]）
// from: 该指标由哪一类输入算出（'grossMargin' 直接取用户填的毛利率；'platform' 为派生
//   挂钩费率合计；'fixed:<key>' 为该月固定项 ÷ 营业额的占比）
const INDICATORS = [
  { key: 'grossMargin', band: 'grossMargin', dir: 'gain', citySensitive: false, from: 'grossMargin' },
  { key: 'rent', band: 'rent', dir: 'cost', citySensitive: true, from: 'fixed:rent' },
  { key: 'labor', band: 'labor', dir: 'cost', citySensitive: true, from: 'fixed:labor' },
  { key: 'energy', band: 'energy', dir: 'cost', citySensitive: false, from: 'fixed:utility' },
  { key: 'manage', band: 'manage', dir: 'cost', citySensitive: false, from: 'fixed:manage' },
  { key: 'mkt', band: 'mkt', dir: 'cost', citySensitive: false, from: 'var:platform' },
];
const IND_KEYS = INDICATORS.map((i) => i.key);

// ===== 五、红线警戒线（🔴 引用 M1.6 唯一声明处；本段是副本，勿顺手改数）=====
// 注：grossMargin 在此是**毛利率警戒线**（低于它才告警），与 BANDS.grossMargin 同向同义
//     ⇒ round111 起两侧语义已统一，不再有"100 − 毛利率"的换算桥。
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
 *   - grossMarginPct 菜品毛利率（%）—— **直接就是对照值**（round111 起不再换算成成本率）
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
      // 毛利率：直接用用户填的值对照毛利率带（口径统一，不做 100−x 换算）
      pct = isFinite(gm) ? gm : null;
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

/**
 * 列出某业态 × 城市下的**全项参考带**（供填表页"行业参考"预览）。
 * ⚠️ 与 evaluateIndicators 的关键区别：本函数**只依赖 业态 × 城市**，与用户填了什么（金额/毛利率）**无关**
 *    ⇒ 页面一打开、用户还没填任何数时就能显示"行业参考区间" —— 这正是 M2 的主要流失点
 *      （开店前用户手里没有任何数字，"不知道这项该填多少"⇒ 干脆不填、不用）。
 * @returns {Array<{key,dir,lo,hi,redline}>} 中文名由前端 terms 映射（本层不存中文）
 */
function listBands(bizKey, cityKey) {
  const out = [];
  for (const ind of INDICATORS) {
    const b = bandOf(bizKey, ind.key, cityKey);
    if (!b) continue;
    out.push({ key: ind.key, dir: ind.dir, lo: b.lo, hi: b.hi, redline: redlineOf(ind.key) });
  }
  return out;
}

/** 取某指标对应的警戒线（rent/labor/grossMargin 有值；其余返回 null）。 */
function redlineOf(indKey) {
  if (indKey === 'rent') return REDLINE.rent;
  if (indKey === 'labor') return REDLINE.labor;
  if (indKey === 'grossMargin') return REDLINE.grossMargin;
  return null;
}

module.exports = {
  CITY_TIERS, CITY_KEYS,
  BIZ_KEYS,
  BANDS, BAND_KEYS,
  INDICATORS, IND_KEYS,
  REDLINE, REDLINE_KEYS,
  FIXED_KEYS, VAR_KEYS, BUILD_KEYS, BUILD_DEFAULT_YEARS,
  bandOf, levelOf, evaluateIndicators, redlineOf, listBands,
};
