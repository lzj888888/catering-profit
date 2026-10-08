// utils/bizPreset.js —— M2v1.3 · 业态参数包 + 入参装配（纯数据 + 纯函数，仓根 utils/）
//
// 🔴 纯前端常量 / 纯函数：**零 `wx.*`、零网络、零 `getApp()`、零 require 云函数代码**。
//   本文件是「用户输入(5 个数) + 参数包 → 引擎入参(fixed_items/var_items)」的**唯一装配入口**。
//
// 🔴 分层边界（开发规范 v1.3 §二-3）：
//   · 本层做的是**入参装配**（用户输入 → 引擎入参），**不是结果计算** —— 输出只有
//     `{ fixedItems:[{key,fen}], varItems:[{key,pct}] }`，**绝不**出现保本 / 毛利 / 摊销算式。
//   · **展示数字一律直接读引擎出参**；唯一合法例外 = `paybackCash`（§五-2 的一次除法，只读展示、不回写）。
//   · 🔴 折旧/建店投入**只能**经 `buildRef` → 引擎 `buildItems`（引擎算摊销）；
//     **严禁**在 `costMeta` 里塞一笔月折旧进 `fixed_items`（会与 buildItems 摊销**双计**）。
//
// 🔴 命名口径：本文件是前端本地常量（**不入库**），用 **camelCase**；
//   一旦落进 `param_json` 必须转 **snake_case**（v1.2 §4.2 红线不变）。
// 🔴 城市系数：`coef` 从生产源 `cloudfunctions/common/indicatorRef.js::CITY_TIERS` 取
//   （tier1 {rent:1.20, labor:1.15} / tier23 {rent:1.00, labor:1.00} / county {rent:0.75, labor:0.85}）。
//   前端不便 require 云函数 ⇒ 以下 **CITY_COEF 是复刻**，单源出处已加注释（规范 §4.3 允许、且必须两键都带）。

// 🔴 城市系数（复刻自 `cloudfunctions/common/indicatorRef.js::CITY_TIERS`，仅此一处前端来源）。
//   三档都要带 **rent + labor 双键**（漏乘 labor ⇒ 一线固定成本退回与二三线相同，保本偏低）。
const CITY_COEF = {
  tier1:  { rent: 1.20, labor: 1.15 },   // 一线 / 新一线
  tier23: { rent: 1.00, labor: 1.00 },   // 二三线（基准）
  county: { rent: 0.75, labor: 0.85 },   // 县城 / 乡镇
};

// ===== 六个预设（🔴 照抄开发规范 v1.3 §3.4-bis，数值不得自创）=====
// 取值来源标记 src：P=项目方 BP · D1=权威参考带 · S=我方自定 · U=用户填
const BIZ_PRESETS = [
  // 1) 小面 / 米线 —— [P] 小面测算.xlsx；人工走人头线性 ⇒ 规模可伸缩
  {
    presetKey: 'fastfood_noodle', bizKey: 'fastfood', paybackView: 'cash',
    params: { grossMarginPct: { v: 55, src: 'P' }, laborUnitYuan: { v: 4500, src: 'S' },
      avgPriceYuan: { v: 12, src: 'P' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'headcount_linear', src: 'S' },              // 单价 = 4,500 × coef.labor
      { itemKey: 'utility', form: 'revenue_rate', pct: 5, src: 'P' },
      { itemKey: 'manage', form: 'revenue_rate', pct: 5, src: 'P' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'P', labelKey: 'costLoss' },
    ],
  },
  // 2) 火锅浇头面 —— [P] 火锅面 BP；固定制 ⇒ 全部走 defaultYuan
  {
    presetKey: 'fastfood_hotpot_noodle', bizKey: 'fastfood', paybackView: 'invest',
    params: { grossMarginPct: { v: 55, src: 'P' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'fixed', defaultYuan: 13500, src: 'P' },   // 1.35 万
      { itemKey: 'utility', form: 'fixed', defaultYuan: 3600, src: 'P' },  // 0.36 万
      { itemKey: 'other', form: 'fixed', defaultYuan: 2400, src: 'P' },    // 员工餐/网费/垃圾 0.24 万
      { itemKey: 'manage', form: 'revenue_rate', pct: 3, src: 'P' },
    ],
  },
  // 3) 火锅（半自助）/ 卤鸡火锅 —— [P] 卤鸡火锅 BP；含建店投入参考
  {
    presetKey: 'hotpot_half_self', bizKey: 'hotpot', paybackView: 'cash',
    params: { grossMarginPct: { v: 53, src: 'P' }, openDays: { v: 30, src: 'P' } },   // 标准 60% → 实际 53%（自助浪费）
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'fixed', defaultYuan: 25000, src: 'P' },   // 2.5 万
      { itemKey: 'utility', form: 'fixed', defaultYuan: 7500, src: 'P' },  // 0.75 万
      { itemKey: 'other', form: 'fixed', defaultYuan: 6000, src: 'P' },    // 0.60 万
      { itemKey: 'manage', form: 'revenue_rate', pct: 3, src: 'P' },
    ],
    // 🔴 折旧只能走这里：投资 26.2 万 ÷ (0.61 万 × 12) = 3.579234972677596 年，**小数位写足**
    buildRef: [{ key: 'other', fen: 26200000, years: 3.579234972677596, src: 'P' }],
  },
  // 4) 烧烤 —— [D1] 参考带（BANDS.hotpot；「烧烤」不新增第 5 类，属 hotpot）
  {
    presetKey: 'hotpot_barbecue', bizKey: 'hotpot', paybackView: 'cash',
    params: { grossMarginPct: { v: 59, src: 'D1' }, laborUnitYuan: { v: 5000, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'headcount_linear', src: 'S' },
      { itemKey: 'utility', form: 'revenue_rate', pct: 5, src: 'D1' },
      { itemKey: 'manage', form: 'revenue_rate', pct: 7, src: 'D1' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
  // 5) 川菜 / 中餐 —— [D1] 参考带
  {
    presetKey: 'dining_sichuan', bizKey: 'dining', paybackView: 'invest',
    params: { grossMarginPct: { v: 60, src: 'D1' }, laborUnitYuan: { v: 5500, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'headcount_linear', src: 'S' },
      { itemKey: 'utility', form: 'revenue_rate', pct: 4, src: 'D1' },
      { itemKey: 'manage', form: 'revenue_rate', pct: 7, src: 'D1' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
  // 6) 新式茶饮 —— [D1] 参考带
  {
    presetKey: 'cafe_tea', bizKey: 'cafe', paybackView: 'invest',
    params: { grossMarginPct: { v: 67, src: 'D1' }, laborUnitYuan: { v: 4500, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'headcount_linear', src: 'S' },
      { itemKey: 'utility', form: 'revenue_rate', pct: 2, src: 'D1' },
      { itemKey: 'manage', form: 'revenue_rate', pct: 7, src: 'D1' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
];

const FORMS = ['fixed', 'area_linear', 'headcount_linear', 'revenue_rate', 'step'];

// ===== R234 · 业态预设**平铺**所需的两张派生表 =====
//
// 🔴 背景（李老师 2026-10-07 原话）：「业态预设里面只有川菜 中餐。还有一个不确定 手填全部。」
//   根因不是数据少了 —— 6 个预设**都在**，而是 `syncPresetOptions()` 按上一级「经营类型」
//   （4 大类）过滤：**快餐 2 / 火锅 2 / 正餐 1 / 茶饮 1**，选「中式正餐」后下拉自然只剩 1 项。
//   ⇒ 治法：**大类只用于后端取 `BANDS`，不该让用户先答**（用户只想答「我开什么店」）。
//
// 🔴 `bizKeyOfPreset`：选完预设后由**系统**把它映射回 4 个大类之一，`BANDS` 零改动。
//   为什么必须留这张表：**指标参考带只有 4 套**（分业态），而预设是 6 个 ——
//   若删了映射，6 个预设就得写 6 套 BANDS，等于推翻单源。
function bizKeyOfPreset(presetKey) {
  const hit = BIZ_PRESETS.filter((p) => p.presetKey === presetKey)[0];
  return hit ? hit.bizKey : null;
}

// ===== R237 · 单桌座位数（业态默认）—— 「桌数 → 座位数」的**唯一换算系数** =====
//
// 🔴 背景（李老师 2026-10-08 原话）：「餐饮老板算账都是按桌数来算……桌数只能推论或者顾客自己选填最准」。
//   引擎入参 `seats`（座位数）**名字与形状一字不改** ⇒ 前端把用户填的「桌数」按本表换成座位数再送引擎，
//   **引擎零改动、锁定锚点零漂**（合计仍等于 20 ⇒ 输出仍 3.70）。
//
// 🔴 src='S' + 豆包第 4 轮同行经验估值（**待真实样本校准**）：这是"系统给初值、用户可改"的默认值，
//   **不承担任何计算口径**（用户改了就以用户的为准）。依据：火锅/正餐多为 4 人方桌圆桌；
//   快餐/小面是长条拼桌、单人居多；茶饮堂食位少且以外带为主。
const SEATS_PER_TABLE = {
  fastfood: 2,   // 小面 / 米线 / 快餐：长条拼桌，单人居多
  dining:   4,   // 川菜 / 中餐：4 人方桌圆桌为主（包间多可手动调大）
  hotpot:   4,   // 火锅 / 烧烤：4 人桌为主
  cafe:     2,   // 新式茶饮：堂食位少，以外带为主
};

// ===== R237 · 翻台口径分组（豆包第 4 轮裁定）=====
//
// 🔴 「翻台」= 翻**桌**（桌台），分母是桌数；「座位周转」= 翻**椅**，分母是座位数。
//   两者只在"每桌坐满"时数值相等 —— 豆包第 5 轮给了反例（2 桌 8 座、日客流 8 人全单人：
//   桌周转 4、座位周转 1）。M2 是**事前反推**（不是收银事后统计），豆包裁定：
//   「M2 使用【假设满座】简化模型是合理取舍，牺牲一部分真实经营的精细度，
//     换取小白能理解、引擎不动、锚点不漂移。M1 事后复盘才需要区分满座率。」
//   ⇒ 引擎只算一套，**前端按业态切话术 + 切阈值**。
//
// ⚠️ 因此：本表内的业态，前端才允许出现「翻台」二字（一律说「桌周转」）；
//   其余业态（快餐/小面/茶饮）**禁用「翻台」**，只说「座位周转」。
const TURN_BIZ_TABLE = ['hotpot', 'dining'];

// ===== R237 · 翻台难度阈值（**自定值，待校准**）=====
//
// 🔴 src='S'（我方自定 + 豆包同行经验估值）：豆包第 4 轮**自己标注**了「以下阈值属于餐饮一线
//   经验估值，作为系统自定值，非行业强制标准，可后续由你们微调」。⇒ 按 R225 第 5 条处理：
//   写明自定 + 理由 + 回退方法（改下面两行即可推翻），**不当权威源采信**。
//
// ⚠️ 这是**展示层分档**，不参与任何金额计算 ⇒ 误设也不会算错钱。
const TURN_THRESHOLD = {
  table: { easyMax: 1.8, okMax: 2.8 },   // 每日桌周转：≤1.8 轻松 / 1.8~2.8 有点难 / >2.8 很难
  seat:  { easyMax: 2.5, okMax: 4.0 },   // 每日座位周转：≤2.5 轻松 / 2.5~4.0 有点难 / >4.0 很难
};

/** 业态默认「一桌坐几人」。未知业态 ⇒ 4（餐饮通用中位）。 */
function seatsPerTableOf(bizKey) {
  const v = SEATS_PER_TABLE[bizKey];
  return v > 0 ? v : 4;
}

/** 翻台口径：'table'（桌周转，**可说「翻台」**）/ 'seat'（座位周转，**禁用「翻台」二字**）。 */
function turnModeOf(bizKey) {
  return TURN_BIZ_TABLE.indexOf(bizKey) >= 0 ? 'table' : 'seat';
}

/**
 * 翻台难度分档。**纯展示层**，不参与测算。
 * @param {'table'|'seat'} mode 口径
 * @param {number} value 每日周转值（引擎 `turn_rate`）
 * @returns {'easy'|'ok'|'hard'|''} 空串 = 无值 / 非有限数（**不编造**）
 */
function turnLevelOf(mode, value) {
  // 🔴 R237-锚点实测修掉的真缺陷：`Number(null) === 0`、`Number('') === 0` ⇒ 若不先挡空值，
  //   引擎红警时返回的 `turn_rate: null` 会被分档成 **'easy'**，页面渲染出
  //   「这个水平，正常做着就能到」—— 这是**最坏的一类静默错**（把"算不出来"说成"很轻松"）。
  //   ⇒ 空值一律返回空串（页面据此不渲染难度行）。
  if (value == null || value === '') return '';
  const v = Number(value);
  if (!isFinite(v)) return '';
  const t = TURN_THRESHOLD[mode] || TURN_THRESHOLD.seat;
  if (v <= t.easyMax) return 'easy';
  if (v <= t.okMax) return 'ok';
  return 'hard';
}

function fenOf(yuan) {
  const n = Number(yuan);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * 🔴 **唯一入参装配函数**（cost_meta 形态运算只准出现在这里）。
 * @param {object} preset 参数包预设（BIZ_PRESETS 的一项）
 * @param {object} input   用户输入：{ area, headcount, rentYuan, fixedYuan:{itemKey:yuan}, buildItems:[] }
 * @param {object} coef    城市系数：{ rent, labor }（来自 CITY_COEF，或云函数 CITY_TIERS 实读物）
 * @returns {{fixedItems:Array<{key,fen}>, varItems:Array<{key,pct}>}}
 *   —— 输出与引擎入参**完全同形**，本函数内**不得出现任何保本/毛利/摊销算式**。
 */
function assembleItems(preset, input, coef) {
  const p = preset || {};
  const in_ = input || {};
  const co = coef || {};
  const fixedItems = [];
  const varItems = [];
  const costMeta = Array.isArray(p.costMeta) ? p.costMeta : [];

  for (const m of costMeta) {
    const form = m.form;
    if (form === 'fixed') {
      // 用户填了 ⇒ 用它的（src='U'，**不乘** coef）；没填且有 defaultYuan ⇒ 参数包供给（**乘** coef[对应项]）
      const userVal = in_.fixedYuan ? in_.fixedYuan[m.itemKey] : undefined;
      if (userVal !== undefined && userVal !== null && userVal !== '') {
        fixedItems.push({ key: m.itemKey, fen: fenOf(userVal) });
      } else if (m.defaultYuan != null) {
        const c = co[m.itemKey] || 1;          // labor→co.labor / rent→co.rent；utility/manage/other 无对应键 ⇒ ×1
        fixedItems.push({ key: m.itemKey, fen: fenOf(Number(m.defaultYuan) * c) });
      }
      // src='U' 且用户没填 ⇒ 无 defaultYuan ⇒ 跳过（不编造）
    } else if (form === 'area_linear') {
      // 🔴 不乘 coef（参数已是元/㎡ 绝对成本；城市差异走分城参数包，乘系数 = 双重折算）
      const a = Number(in_.area) || 0;
      fixedItems.push({ key: m.itemKey, fen: fenOf(Number(m.baseYuan) + Number(m.perSqmYuan) * a) });
    } else if (form === 'headcount_linear') {
      // 单价只取 params.laborUnitYuan.v，乘 coef.labor × 人数
      const unit = p.params && p.params.laborUnitYuan ? Number(p.params.laborUnitYuan.v) : 0;
      const hc = Number(in_.headcount) || 0;
      fixedItems.push({ key: m.itemKey, fen: fenOf(unit * (co.labor || 1) * hc) });
    } else if (form === 'revenue_rate') {
      // 直接给 pct（不换算成金额），**不乘** coef（占比与城市无关）
      varItems.push({ key: m.itemKey, pct: Number(m.pct) });
    } else if (form === 'step') {
      // 按租金档查询命中的 yuan（**不乘** coef）
      const rentYuan = Number(in_.rentYuan) || 0;
      const steps = Array.isArray(m.steps) ? m.steps : [];
      let hit = null;
      for (const s of steps) { if (rentYuan <= Number(s.upToYuan)) { hit = s; break; } }
      if (!hit && steps.length) hit = steps[steps.length - 1];
      fixedItems.push({ key: m.itemKey, fen: fenOf(hit ? Number(hit.yuan) : 0) });
    }
  }
  return { fixedItems, varItems };
}

/**
 * 建店投入（buildItems）：用户填了真实建店投入 ⇒ 用用户的；没填 ⇒ 用 preset.buildRef（两条路二选一，不叠加）。
 * 输出形状 = 引擎 build_items：[{key, fen, years}]。
 * @returns {Array<{key,fen,years}>}
 */
function resolveBuild(preset, input) {
  const in_ = input || {};
  if (Array.isArray(in_.buildItems) && in_.buildItems.length > 0) return in_.buildItems;
  const ref = (preset && preset.buildRef) || [];
  return ref.map((b) => ({ key: b.key, fen: Number(b.fen), years: Number(b.years) }));
}

// 保留 1 位小数带十进制容差（与引擎 round1 同规；25×1.15 浮点陷阱）
function round1(n) { return Math.round(n * 10 + 1e-9) / 10; }

/**
 * 🔴 `cash` 回本口径 —— 本仓**唯一**允许的展示派生（一次除法，不回写、不参与引擎）。
 *   算式：buildTotalFen ÷ (targetProfitFen + buildAmortMonthlyFen)。
 *   `targetProfitFen ≤ 0` ⇒ 返回 null（**不编造**，与引擎 payback_months 同规）。
 * @returns {number|null} 月数（1 位小数）
 */
function paybackCash(buildTotalFen, targetProfitFen, buildAmortMonthlyFen) {
  if (!(Number(targetProfitFen) > 0)) return null;
  const denom = Number(targetProfitFen) + (Number(buildAmortMonthlyFen) || 0);
  if (!(denom > 0)) return null;
  const months = Number(buildTotalFen) / denom;
  return round1(months);
}

// 按 presetKey 取预设（页面用）
function findPreset(key) {
  return BIZ_PRESETS.filter((p) => p.presetKey === key)[0] || null;
}

module.exports = {
  BIZ_PRESETS, CITY_COEF, FORMS,
  assembleItems, resolveBuild, paybackCash, findPreset, round1,
  // R234：业态预设平铺（预设 → 4 大类反查）
  bizKeyOfPreset,
  // R237：桌数 ⇄ 座位数 换算 + 翻台口径/阈值（引擎零改的入参变换层）
  SEATS_PER_TABLE, TURN_BIZ_TABLE, TURN_THRESHOLD,
  seatsPerTableOf, turnModeOf, turnLevelOf,
};