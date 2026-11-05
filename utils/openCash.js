// utils/openCash.js —— 开店资金测算（纯函数 · 只算数不取值）
//
// 🔴 为什么有这个文件（R324，李老师 2026-10-18 纠正）：
//   我原先设计的是「预算 → 能开多大」，被当场否掉，原话：
//     「能开多大这个指标完全不能和预算多少有关联，比如有 1000 万，那么店模型只需要 50 平，
//       你不能因为有钱就开 5000 平吧，你这个逻辑不是必然因果的闭环逻辑」
//   ⇒ 店的大小由**业态 / 商圈 / 经营模式**决定，钱只是"够不够"，不是"能多大"。
//
// 所以本文件只做**正向**测算（店 → 要花多少现金 → 预算够不够 → 还能撑几个月）：
//   开店现金需求 = 装修 + 设备 + 押金 + 预付租金 + 首批货款
//   剩余周转金   = 预算 − 开店现金需求
//   能撑几个月   = 剩余周转金 ÷ 每月固定支出
//
// 🔴 关键口径（都必须说清，否则会重复计成本）：
//   ① **押金不是成本**：它是可退的押金，只在现金需求里出现，不进月度损益。
//   ② **预付租金不是新增成本**：付 3 个月租金是现金流支出，月度房租已在固定费用里，
//      两者**不能相加**。本文件只算"开店那一刻要拿出多少现金"，不做损益。
//   ③ 设备**不设默认值**：业态不同设备差异极大（李老师口供「设备没办法固定」）⇒ 由调用方传入，
//      缺省按 0 处理并在结果里标 `equipMissing`，**绝不编一个"行业设备价"**。
//   ④ 首批货款同理：与营业额无稳定关系（「涉及到生意好与坏，很多不确定性」）⇒ 选填。
//
// 单位：**全部是分**（本仓铁律）。页面负责用 api.yuanToFen() 把用户填的元转成分再传进来。

/** 装修单价建议区间（元/㎡）—— 李老师 2026-10-18 口供「通常是 800~1000 这样 1 平米」 */
const DECOR_UNIT_YUAN = { lo: 800, hi: 1000 };

/** 押金/预付 常见组合（李老师口供：常见押 1 付 3，也有押 1 付 1、押 1 付 6） */
const DEPOSIT_PRESETS = [
  { key: 'p1f1', label: '押1付1', depositMonths: 1, prepayMonths: 1 },
  { key: 'p1f3', label: '押1付3', depositMonths: 1, prepayMonths: 3 },
  { key: 'p1f6', label: '押1付6', depositMonths: 1, prepayMonths: 6 },
];

/** 周转金判定线（月）—— 餐饮实务通说：**至少留 3 个月固定支出**，否则一次淡季/整改就断链 */
const SAFE_RUNWAY_MONTHS = 3;
const TIGHT_RUNWAY_MONTHS = 1;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * 开店现金需求 + 周转金能撑多久（正向测算，不做任何"预算→规模"的反推）。
 *
 * @param {object} o
 * @param {number} o.areaM2         面积（㎡，可小数）
 * @param {number} o.rentFen        月租金（分）
 * @param {number} [o.decorUnitFen] 装修单价（分/㎡）；缺省取 900 元/㎡ 的中值
 * @param {number} [o.depositMonths] 押金月数，默认 1
 * @param {number} [o.prepayMonths]  预付租金月数，默认 3
 * @param {number} [o.equipFen]      设备投入（分）；不传 = 未填（结果里 equipMissing=true）
 * @param {number} [o.stockFen]      首批货款（分）；不传 = 未填
 * @param {number} [o.budgetFen]     手里可用预算（分）
 * @param {number} [o.fixedMonthlyFen] 每月固定支出（分）—— 来自 assembleItems 的 fixedItems 合计
 * @returns {{
 *   ok:boolean, reason?:string,
 *   decorFen?:number, depositFen?:number, prepayFen?:number,
 *   equipFen?:number, stockFen?:number, cashNeedFen?:number,
 *   equipMissing?:boolean, stockMissing?:boolean,
 *   budgetFen?:number, remainFen?:number|null, runwayMonths?:number|null,
 *   level?:'safe'|'tight'|'danger'|'short'|'unknown'
 * }}
 */
function estimateOpenCash(o) {
  const c = o || {};
  const area = Number(c.areaM2) || 0;
  const rent = num(c.rentFen);
  if (!(area > 0)) return { ok: false, reason: 'noArea' };
  if (!(rent > 0)) return { ok: false, reason: 'noRent' };

  // 装修缺省取区间中值 900 元/㎡（区间本身在 DECOR_UNIT_YUAN 里，页面可让用户改）
  const decorUnit = num(c.decorUnitFen) || 90000; // 900 元 = 90000 分
  const decorFen = Math.round(area * decorUnit);

  const dm = c.depositMonths == null ? 1 : num(c.depositMonths);
  const pm = c.prepayMonths == null ? 3 : num(c.prepayMonths);
  const depositFen = Math.round(rent * dm);
  const prepayFen = Math.round(rent * pm);

  const equipMissing = !(num(c.equipFen) > 0);
  const stockMissing = !(num(c.stockFen) > 0);
  const equipFen = num(c.equipFen);
  const stockFen = num(c.stockFen);

  const cashNeedFen = decorFen + depositFen + prepayFen + equipFen + stockFen;

  const budgetFen = num(c.budgetFen);
  const hasBudget = budgetFen > 0;
  const remainFen = hasBudget ? budgetFen - cashNeedFen : null;

  const fixedMonthly = num(c.fixedMonthlyFen);
  const runwayMonths = (remainFen != null && fixedMonthly > 0)
    ? Math.round((remainFen / fixedMonthly) * 10) / 10
    : null;

  let level = 'unknown';
  if (remainFen != null) {
    if (remainFen < 0) level = 'short';
    else if (runwayMonths == null) level = 'unknown';
    else if (runwayMonths >= SAFE_RUNWAY_MONTHS) level = 'safe';
    else if (runwayMonths >= TIGHT_RUNWAY_MONTHS) level = 'tight';
    else level = 'danger';
  }

  return {
    ok: true,
    decorFen, depositFen, prepayFen, equipFen, stockFen, cashNeedFen,
    equipMissing, stockMissing,
    budgetFen: hasBudget ? budgetFen : 0,
    remainFen, runwayMonths, level,
  };
}

module.exports = {
  DECOR_UNIT_YUAN, DEPOSIT_PRESETS, SAFE_RUNWAY_MONTHS, TIGHT_RUNWAY_MONTHS,
  estimateOpenCash,
};
