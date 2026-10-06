#!/usr/bin/env node
// review/evidence/r230_m2_v13/recalc_anchors_v13.js
//
// M2「业态参数包 + 回本卡」增量规范 v1.3 —— 锚点**独立复算**。
// 🔴 铁律：锚点必须 `require` **生产引擎**实跑，绝不手写一份等价公式（重写 = 第二个真相源）。
//
// 复算什么 / 为什么（对应规范 §十）：
//   ②-A 参数包承载 · 卤鸡火锅 —— 用 [P] 值装配 ⇒ 引擎算保本 ⇒ 复现 BP 自报 11.3 万
//   ②-B 参数包承载 · 火锅浇头面 —— 同上 ⇒ 复现 BP 自报 43,269
//        ⇒ 证明「参数包 + assembleItems 能无损承载真实业态 BP」（规范 §二 的设计基石）
//   ③-1 形态鉴别力 · 改面积 —— area_linear 项随面积重算（防"界面看 A、引擎算 B"）
//   ③-2 形态鉴别力 · 改人数 —— headcount_linear 项随人数重算
//   ③-3 反例 · 城市系数未生效 —— tier1 的固定成本必须 > tier23（labor 系数 > 1）
//   ④ 回本两口径 —— invest（引擎 payback_months）vs cash（后置派生），复现 R224 用例的 11.9 vs 16.4 月（BP 自报 11.8 系其截断）
//   ⑤ 边界不编造 —— target_profit_fen ≤ 0 ⇒ payback_months = null
//
// 运行：node review/evidence/r230_m2_v13/recalc_anchors_v13.js
// 输出：stdout + review/evidence/r230_m2_v13/recalc_anchors_v13.txt

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');                 // → 仓根
const SVC = path.join(ROOT, 'cloudfunctions', 'calcSandbox', 'service.js');
if (!fs.existsSync(SVC)) { console.error('❌ 找不到生产引擎：' + SVC); process.exit(2); }
const E = require(SVC);                                                 // 🔴 生产引擎（非副本）
const { calcSandbox, calcSandboxReverse } = E;
if (typeof calcSandbox !== 'function' || typeof calcSandboxReverse !== 'function') {
  console.error('❌ 生产引擎未导出 calcSandbox / calcSandboxReverse'); process.exit(2);
}

let pass = 0;
const fails = [];
const lines = [];
function say(s) { lines.push(s); console.log(s); }
function sec(t) { say('\n===== ' + t + ' ====='); }
function CHK(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; say(`  ✅ ${name}  = ${JSON.stringify(got)}`); }
  else { fails.push(name); say(`  ❌ ${name}  实得 ${JSON.stringify(got)} · 期望 ${JSON.stringify(want)}`); }
}
function CHK_TRUE(name, cond, extra) {
  if (cond) { pass++; say(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fails.push(name); say(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}
const y2f = (y) => Math.round(y * 100);      // 元 → 分
const f2y = (f) => Math.round(f / 100 * 100) / 100;

// ============================================================================
// 本次增量的**核心实现**：业态参数包 → 引擎入参（规范 §3.2 / §3.3 的落地形态）
// 🔴 这张实现 = 规范 §3.3 五形态的可执行化；**禁止另写保本公式**（保本一律问引擎要）。
// ============================================================================

// ---- 参数包（规范 §3.4 第一批预设的**最小可跑子集**，只用到锚点所需两项）----
const PRESETS = {
  hotpot_half_self: {
    bizKey: 'hotpot', paybackView: 'cash',
    params: { grossMarginPct: { v: 53, src: 'P' } },   // 卤鸡火锅：标准 60% → 实际 53%（自助浪费 ×1.25）
    costMeta: [
      { itemKey: 'rent',    form: 'fixed',        src: 'U' },                      // 用户填（src='U' ⇒ 无 defaultYuan）
      { itemKey: 'labor',   form: 'fixed',        defaultYuan: 25000, src: 'P' },  // BP：人工 2.5 万（固定制，非人头线性）
      { itemKey: 'utility', form: 'fixed',        defaultYuan: 7500,  src: 'P' },  // BP：水电 0.75 万
      { itemKey: 'other',   form: 'fixed',        defaultYuan: 6000,  src: 'P' },  // BP：其他 0.6 万
      { itemKey: 'manage',  form: 'revenue_rate', pct: 3, src: 'P' },              // 店铺管理费：营业额 3%
    ],
    // 🔴 建店投入参考（规范 §5-2）：折旧**必须**走 buildItems 让引擎算摊销，
    //    不在 costMeta 里塞月折旧额。BP：投资 26.2 万 · 折旧 0.61 万/月
    //    ⇒ 隐含年限 = 26200000 ÷ (610000 × 12) = 3.579234972677596（精确值，写足小数位
    //      —— 少写会因四舍五入把摊销算成 6101 元，连带保本漂 0.2 元）
    buildRef: [{ key: 'other', fen: 26200000, years: 3.579234972677596, src: 'P' }],
  },
  fastfood_hotpot_noodle: {
    bizKey: 'fastfood', paybackView: 'invest',
    params: { grossMarginPct: { v: 55, src: 'P' } },  // 火锅面：55%（扣 3% 管理费后有效 52%）
    costMeta: [
      { itemKey: 'rent',    form: 'fixed',        src: 'U' },
      { itemKey: 'labor',   form: 'fixed',        defaultYuan: 13500, src: 'P' },
      { itemKey: 'utility', form: 'fixed',        defaultYuan: 3600,  src: 'P' },
      { itemKey: 'other',   form: 'fixed',        defaultYuan: 2400,  src: 'P' },  // 员工餐 + 网费垃圾
      { itemKey: 'manage',  form: 'revenue_rate', pct: 3, src: 'P' },
    ],
  },
  // 面积线性（火锅面 BP 的另一段口径）：装饰 = 2600 + 20 × 面积  ⇒ 用于 ③-1 形态鉴别力
  fastfood_area_linear_demo: {
    bizKey: 'fastfood', paybackView: 'invest',
    params: { grossMarginPct: { v: 55, src: 'P' } },
    costMeta: [
      { itemKey: 'rent',    form: 'fixed',        src: 'U' },
      { itemKey: 'decor',   form: 'area_linear',  baseYuan: 2600, perSqmYuan: 20, src: 'P' },
    ],
  },
  // 人头线性（小面：人工 4500 元/人·月）⇒ 用于 ③-2 / ③-3
  fastfood_noodle: {
    bizKey: 'fastfood', paybackView: 'cash',
    params: { grossMarginPct: { v: 55, src: 'P' }, laborUnitYuan: { v: 4500, src: 'S' } },
    costMeta: [
      { itemKey: 'rent',    form: 'fixed',            src: 'U' },
      { itemKey: 'labor',   form: 'headcount_linear', src: 'S' },                  // 单价走 params.laborUnitYuan
      { itemKey: 'utility', form: 'revenue_rate',     pct: 5, src: 'P' },
      { itemKey: 'manage',  form: 'revenue_rate',     pct: 5, src: 'P' },
      { itemKey: 'other',   form: 'revenue_rate',     pct: 2, src: 'P' },          // 杂支损耗（规范 §1-5 A）
    ],
  },
};

// ---- 城市系数：🔴 **不硬编码**，从生产引擎的 bands_preview 实测反读（规范 §1-7）----
// 做法：同一业态取 tier1 / tier23 的 labor 参考带，其比值即 labor 系数的实测量。
function measureLaborCoef(bizKey) {
  const a = calcSandbox({ cityTier: 'tier1',  bizType: bizKey, buildItems: [], fixedItems: [], varItems: [], grossMarginPct: 50, targetProfitFen: 0, expectedRevenueFen: 0 });
  const b = calcSandbox({ cityTier: 'tier23', bizType: bizKey, buildItems: [], fixedItems: [], varItems: [], grossMarginPct: 50, targetProfitFen: 0, expectedRevenueFen: 0 });
  const pick = (bp) => {
    const row = (bp || []).find ? bp.find((r) => r && (r.key === 'labor' || r.indKey === 'labor')) : null;
    if (row) return (typeof row.lo === 'number') ? row.lo : (typeof row.loPct === 'number' ? row.loPct : null);
    if (bp && typeof bp === 'object' && bp.labor) {
      const L = bp.labor;
      return (typeof L.lo === 'number') ? L.lo : (typeof L.loPct === 'number' ? L.loPct : null);
    }
    return null;
  };
  const la = pick(a.bands_preview), lb = pick(b.bands_preview);
  if (la == null || lb == null) return { coef: null, raw: { la, lb } };
  return { coef: Math.round(la / lb * 1000) / 1000, raw: { la, lb } };
}

// ---- 🔴 唯一入参装配函数（规范 §2-3 界定 1 / §3.3 形态运算）----
// 输出**只有两种**：fixedItems:[{key,fen}] / varItems:[{key,pct}] —— 与引擎入参完全同形。
// 🔴 这里**不得**出现任何保本/毛利计算，也**不得**塞折旧（规范 §5-2）。
function assembleItems(preset, input, coef) {
  const c = coef || { rent: 1, labor: 1 };
  const fixedItems = [];
  const varItems = [];
  for (const m of preset.costMeta) {
    switch (m.form) {
      case 'fixed': {
        // 🔴 取值优先级（规范 §3.3）：用户填（input.fixedYuan）> 参数包 defaultYuan —— **二选一，不叠加**
        if (input.fixedYuan && typeof input.fixedYuan[m.itemKey] === 'number') {
          fixedItems.push({ key: m.itemKey, fen: y2f(input.fixedYuan[m.itemKey]) });   // src='U' ⇒ **不乘**系数
        } else if (typeof m.defaultYuan === 'number') {
          const k = c[m.itemKey] || 1;                                                 // 参数包供给 ⇒ 乘对应系数
          fixedItems.push({ key: m.itemKey, fen: y2f(m.defaultYuan * k) });
        }
        break;
      }
      case 'area_linear':
        fixedItems.push({ key: m.itemKey, fen: y2f(m.baseYuan + m.perSqmYuan * (input.area || 0)) });
        break;
      case 'headcount_linear': {
        const unit = (preset.params.laborUnitYuan ? preset.params.laborUnitYuan.v : 0) * (c.labor || 1);
        fixedItems.push({ key: m.itemKey, fen: y2f(unit * (input.headcount || 0)) });
        break;
      }
      case 'revenue_rate':
        varItems.push({ key: m.itemKey, pct: m.pct });
        break;
      case 'step':
        fixedItems.push({ key: m.itemKey, fen: y2f(stepLookup(m.steps, input)) });
        break;
      default:
        break;
    }
  }
  return { fixedItems, varItems };
}
function stepLookup(steps, input) {
  if (!Array.isArray(steps) || !steps.length) return 0;
  for (const s of steps) if ((input.rentYuan || 0) <= s.upToYuan) return s.yuan;
  return steps[steps.length - 1].yuan;
}

// 装配 → 引擎入参 clean（🔴 形状以 calcSandbox/validate.js 为准：混合命名）
function toClean(preset, input, coef, extra) {
  const asm = assembleItems(preset, input, coef);
  // 🔴 建店投入（规范 §5-2）：用户填了就用用户的；否则用参数包 buildRef ⇒ 折旧由**引擎**算摊销，
  //    绝不在 costMeta 里塞一笔月折旧（否则双计）。
  const buildItems = (input.buildItems && input.buildItems.length)
    ? input.buildItems
    : (preset.buildRef || []).map((b) => ({ key: b.key, fen: b.fen, years: b.years }));
  return Object.assign({
    cityTier: input.cityTier || 'tier23',
    bizType: preset.bizKey,
    buildItems,
    fixedItems: asm.fixedItems,
    varItems: asm.varItems,
    grossMarginPct: preset.params.grossMarginPct.v,
    targetProfitFen: 0,
    expectedRevenueFen: 0,
    rev_price_fen: 0, seats: 0, open_days: 30,
    target_rent_rate: 0, pixel_eff_fen: 0,
  }, extra || {});
}

// ============================================================================
say('M2 v1.3 业态参数包与回本卡 —— 锚点复算（require 生产引擎 ' + path.relative(ROOT, SVC) + '）');
say('引擎 ENGINE_VERSION = ' + (E.ENGINE_VERSION || '(未导出)'));

// ---------- ②-A 参数包承载 · 卤鸡火锅（[P] 卤鸡火锅 BP · 100㎡ 主力店）----------
sec('②-A 参数包承载 · 卤鸡火锅（BP 自报保本 11.3 万）');
const P_LUJI = PRESETS.hotpot_half_self;
// BP「主力店 100㎡」固定成本 5.66 万 = 房租 1.2 + 人工 2.5 + 水电 0.75 + 其他 0.6 + **折旧 0.61**
//   ⇒ 前四项走 fixedItems（5.05 万）；折旧走 buildItems（投资 26.2 万 @ 3.5792 年 ⇒ 摊销 6,100 元/月，
//     由**引擎**算 ⇒ 固定合计 5.66 万，与 BP 逐项吻合）
const IN_LUJI = {
  cityTier: 'tier23',
  fixedYuan: { rent: 12000 },   // 🔴 只有 rent 是用户填；labor/utility/other **由 defaultYuan 供给**（这才是"参数包承载"）
};
const R_LUJI = calcSandbox(toClean(P_LUJI, IN_LUJI, { rent: 1, labor: 1 }));
say(`  建店投入 = ${f2y(R_LUJI.build_total_fen)} 元 · 月摊销 = ${f2y(R_LUJI.build_amort_monthly_fen)} 元`);
say(`  固定成本合计 = ${f2y(R_LUJI.fixed_total_fen)} 元 · 综合变动率 = ${R_LUJI.composite_var_rate_pct}% · 边际贡献率 = ${(R_LUJI.margin_rate_ratio * 100).toFixed(1)}%`);
CHK('月摊销 = 6100 元（BP 折旧 0.61 万，经引擎摊销算出）', f2y(R_LUJI.build_amort_monthly_fen), 6100);
CHK('固定成本合计 = 56600 元（BP 5.66 万，逐项吻合）', f2y(R_LUJI.fixed_total_fen), 56600);
CHK('保本月营业额（元） = 113200（BP 自报 11.3 万，偏差 0.18%）', f2y(R_LUJI.break_even_monthly_fen), 113200);
CHK('综合变动成本率 = 50%（食材 47% + 扣点 3%）', R_LUJI.composite_var_rate_pct, 50);
CHK('保本日均（元） = 3773.33（113200 ÷ 30，引擎四舍五入到分）', f2y(R_LUJI.break_even_daily_fen), 3773.33);

// ---------- ②-B 参数包承载 · 火锅浇头面（[P] 火锅面 BP · 50㎡）----------
sec('②-B 参数包承载 · 火锅浇头面（BP 自报保本 43,269）');
const P_HGM = PRESETS.fastfood_hotpot_noodle;
const IN_HGM = {
  cityTier: 'tier23',
  // 租金 0.30 万（用户填）；人工 1.35 / 水电 0.36 / 员工餐网费垃圾 0.24 **由 defaultYuan 供给**
  fixedYuan: { rent: 3000 },
};
const R_HGM = calcSandbox(toClean(P_HGM, IN_HGM, { rent: 1, labor: 1 }));
say(`  固定成本合计 = ${f2y(R_HGM.fixed_total_fen)} 元 · 综合变动率 = ${R_HGM.composite_var_rate_pct}% · 边际贡献率 = ${(R_HGM.margin_rate_ratio * 100).toFixed(1)}%`);
CHK('固定成本合计 = 22500 元（BP 2.25 万）', f2y(R_HGM.fixed_total_fen), 22500);
// 22500 ÷ 0.52 = 43269.23… ⇒ BP 取整为 43,269
CHK('保本月营业额（元） = 43269（BP 自报 43,269，偏差 0.001%）', Math.round(f2y(R_HGM.break_even_monthly_fen)), 43269);

// ---------- ③-1 形态鉴别力 · 改面积（area_linear）----------
sec('③-1 形态鉴别力 · area_linear 项随面积重算（规范 §3.3 最高风险点）');
const P_AREA = PRESETS.fastfood_area_linear_demo;
const A50 = assembleItems(P_AREA, { area: 50, rentYuan: 3000, fixedYuan: { rent: 3000 } }, { rent: 1, labor: 1 });
const A80 = assembleItems(P_AREA, { area: 80, rentYuan: 3000, fixedYuan: { rent: 3000 } }, { rent: 1, labor: 1 });
const decor50 = (A50.fixedItems.find((x) => x.key === 'decor') || {}).fen;
const decor80 = (A80.fixedItems.find((x) => x.key === 'decor') || {}).fen;
say(`  面积 50㎡ ⇒ 装饰 ${f2y(decor50)} 元（2600 + 20×50）· 面积 80㎡ ⇒ ${f2y(decor80)} 元（2600 + 20×80）`);
CHK('50㎡ 装配值 = 3600 元', f2y(decor50), 3600);
CHK('80㎡ 装配值 = 4200 元', f2y(decor80), 4200);
CHK_TRUE('改面积后装配值**真的变了**（差额 = 600 元）', decor80 - decor50 === y2f(600), `Δ=${f2y(decor80 - decor50)} 元`);

// ---------- ③-2 形态鉴别力 · 改人数（headcount_linear）----------
sec('③-2 形态鉴别力 · headcount_linear 项随人数重算');
const P_N = PRESETS.fastfood_noodle;
const N2 = assembleItems(P_N, { area: 30, rentYuan: 5000, headcount: 2, fixedYuan: { rent: 5000 } }, { rent: 1, labor: 1 });
const N3 = assembleItems(P_N, { area: 30, rentYuan: 5000, headcount: 3, fixedYuan: { rent: 5000 } }, { rent: 1, labor: 1 });
const lab2 = (N2.fixedItems.find((x) => x.key === 'labor') || {}).fen;
const lab3 = (N3.fixedItems.find((x) => x.key === 'labor') || {}).fen;
say(`  2 人 ⇒ 人工 ${f2y(lab2)} 元 · 3 人 ⇒ 人工 ${f2y(lab3)} 元（单价 ${P_N.params.laborUnitYuan.v} 元/人）`);
CHK('2 人装配值 = 9000 元', f2y(lab2), 9000);
CHK('3 人装配值 = 13500 元', f2y(lab3), 13500);
CHK_TRUE('改人数后装配值**真的变了**（差额 = 4500 元 = 1 人人工）', lab3 - lab2 === y2f(4500), `Δ=${f2y(lab3 - lab2)} 元`);

// ---------- ③-3 反例 · 城市系数未生效（规范 §1-7 的鉴别力）----------
sec('③-3 反例 · 城市系数（labor）未生效 ⇒ 可鉴别');
const mc = measureLaborCoef('fastfood');
say(`  实测 labor 系数（从引擎 bands_preview 反读）= ${JSON.stringify(mc)}`);
CHK_TRUE('实测 labor 系数 > 1（一线高于基准）', mc.coef != null && mc.coef > 1, `coef=${mc.coef}`);
const coefT1 = { rent: 1.20, labor: mc.coef || 1.15 };
const coefT23 = { rent: 1.00, labor: 1.00 };
const IN_T1  = { cityTier: 'tier1',  area: 30, rentYuan: 5000, headcount: 3, fixedYuan: { rent: 5000 } };
const IN_T23 = { cityTier: 'tier23', area: 30, rentYuan: 5000, headcount: 3, fixedYuan: { rent: 5000 } };
const R_T1  = calcSandbox(toClean(P_N, IN_T1,  coefT1));
const R_T23 = calcSandbox(toClean(P_N, IN_T23, coefT23));
say(`  一线固定成本 = ${f2y(R_T1.fixed_total_fen)} 元 · 二三线 = ${f2y(R_T23.fixed_total_fen)} 元`);
CHK_TRUE('一线固定成本 > 二三线（labor 系数生效）', R_T1.fixed_total_fen > R_T23.fixed_total_fen,
  `Δ=${f2y(R_T1.fixed_total_fen - R_T23.fixed_total_fen)} 元（= 3 人 × 4500 × ${(coefT1.labor - 1).toFixed(2)}）`);
// 反例：漏乘 labor 系数（只乘 rent，而 rent 是用户填的实际值 ⇒ 实际等于完全没乘）
const R_BAD = calcSandbox(toClean(P_N, IN_T1, { rent: 1, labor: 1 }));
CHK_TRUE('反例 · 漏乘 labor ⇒ 一线固定成本**退回**与二三线相同 ⇒ 可鉴别',
  R_BAD.fixed_total_fen === R_T23.fixed_total_fen, `漏乘后 = ${f2y(R_BAD.fixed_total_fen)} 元`);

// ---------- ④ 回本两口径（R224 §二-2 的 11.8 vs 16.4）----------
sec('④ 回本两口径 · invest（引擎）vs cash（后置派生）—— R224 用例：卤鸡火锅 100㎡');
// R224 用例：投资 26.2 万 · 月净利 1.60 万；月折旧**取引擎实测**（BP 明写 0.61 万；
//   R224 NOTE 表里的 `0.620` 是「反推隐含折旧」列、由 11.8 倒推得来，**不是 BP 原值**）
const INV_FEN = y2f(262000);          // 建店总投入 26.2 万（分）
const NET_FEN = y2f(16000);           // 目标月利润 1.60 万（分）
// 🔴 年限写足小数位（= BP 反推隐含年限 26200000 ÷ (610000×12) = 3.579234972677596）
const R_PB = calcSandbox({
  cityTier: 'tier23', bizType: 'hotpot',
  buildItems: [{ key: 'other', fen: INV_FEN, years: 3.579234972677596 }],
  fixedItems: [], varItems: [], grossMarginPct: 53, targetProfitFen: NET_FEN, expectedRevenueFen: 0,
  rev_price_fen: 0, seats: 0, open_days: 30, target_rent_rate: 0, pixel_eff_fen: 0,
});
say(`  引擎 build_total_fen = ${f2y(R_PB.build_total_fen)} 元 · payback_months(invest) = ${R_PB.payback_months}`);
say(`  引擎 build_amort_monthly_fen = ${f2y(R_PB.build_amort_monthly_fen)} 元/月（≡ BP 明写的 0.61 万）`);
const AMORT_FEN = R_PB.build_amort_monthly_fen;   // 🔴 从**引擎出参**读，绝不硬编码
// cash 口径 = 投资 ÷ (月净利 + 月折旧) —— 规范 §5-1 唯一后置派生（实现 = utils/bizPreset.js::paybackCash）
const cashMonths = Math.round(INV_FEN / (NET_FEN + AMORT_FEN) * 10 + 1e-9) / 10;
say(`  cash 口径（后置派生）= ${cashMonths} 月`);
CHK('引擎月摊销 = 6,100 元（≡ BP 明写 0.61 万）', f2y(AMORT_FEN), 6100);
CHK('invest 回本 = 16.4 月（引擎 payback_months）', R_PB.payback_months, 16.4);
CHK('cash 回本 = 11.9 月（26.2 ÷ 2.21 = 11.855 ⇒ 11.9）', cashMonths, 11.9);
CHK_TRUE('两口径**不相等**且 cash < invest（38% 差）', cashMonths < R_PB.payback_months,
  `${cashMonths} < ${R_PB.payback_months}`);

// ---------- ⑤ 边界不编造 ----------
sec('⑤ 边界 · target_profit_fen ≤ 0 ⇒ payback_months = null（不编造）');
const R_NULL = calcSandbox({
  cityTier: 'tier23', bizType: 'dining', buildItems: [{ key: 'other', fen: INV_FEN, years: 3 }],
  fixedItems: [], varItems: [], grossMarginPct: 60, targetProfitFen: 0, expectedRevenueFen: 0,
  rev_price_fen: 0, seats: 0, open_days: 30, target_rent_rate: 0, pixel_eff_fen: 0,
});
CHK('目标利润 = 0 ⇒ payback_months', R_NULL.payback_months, null);

// ---------- 汇总 ----------
sec('汇总');
say(`  通过 ${pass} / 失败 ${fails.length}`);
if (fails.length) { say('  失败清单：'); fails.forEach((f) => say('   - ' + f)); }
fs.writeFileSync(path.join(__dirname, 'recalc_anchors_v13.txt'), lines.join('\n') + '\n', 'utf8');
process.exit(fails.length ? 1 : 0);
