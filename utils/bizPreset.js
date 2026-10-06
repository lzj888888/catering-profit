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
};