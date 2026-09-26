// utils/units.js —— 「采购单位 / 用量单位」的单源（round149）
//
// 起因（李老师 2026-09-26 真机反馈 + 参考图）：店里的原料**采购按一种单位、做菜按另一种单位**
//   —— 牛腩按「斤/千克」买、菜谱按「克」写；油按「升」买、按「毫升」用。
//   参考产品的做法是：采购单位、用量单位**各自可选**，系统负责换算。
//
// 🔴 红线：**引擎口径一字不改**。
//   净料单位成本 = round4(采购单价 ÷ 换算系数 ÷ (出成率/100))（万分之一元/克），
//   明细成本 = Σ(用量 × 净料单位成本) —— 这两条公式在 5 份 service.js 里，本文件**不碰**。
//   本文件只做两件事：
//     ① 给出「采购单位 → 建议换算系数」的映射（换算系数仍是用户在原料档案页可改的一个数）；
//     ② 给出「用量单位 → 基准单位(克)」的倍率，供**录入层**做入参变换。
//   ⇒ 引擎拿到的永远是「克 + 万分/克」，单位切换只发生在录入层（入参变换，非引擎改动）。
//
// ⚠️ 数值单源：本文件是单位倍率的**唯一**声明处；页面不得再抄一份表。
//   守卫 tools/check_unit_convert.js 反查「页面里出现单位倍率字面量」即判红。

// 采购单位建议池（**只许追加，不许删改**：旧原料档案里存的是自由文本，
//   删掉一个值会让老数据在 chips 上找不到对应项 —— 与 dishCats 同族纪律）。
const PURCHASE_UNITS = ['斤', '千克', '克', '毫升', '升', '个', '只', '条', '瓶', '包', '份', '箱', '桶'];

// 1 采购单位 = ? 克（净料口径）。仅作**建议值**：选中单位后自动带出，用户可手改
//   （「箱/桶/件」这类没有通用换算，必须由老板按自家包装填）。
const CONVERT_SUGGEST = {
  '斤': 500,
  '千克': 1000,
  '公斤': 1000,
  '克': 1,
  '毫升': 1,
  '升': 1000,
};

// 用量单位枚举（与参考产品一致：克/千克/毫升/升）。基准单位恒为「克」（毫升按 1:1 视作克，
//   餐饮场景水/油/酱油密度≈1，够用；真要按密度换算属于另一个量级的需求，不在本轮）。
const QTY_UNITS = ['克', '千克', '毫升', '升'];

const QTY_FACTOR = { '克': 1, '千克': 1000, '毫升': 1, '升': 1000 };

const BASE_UNIT = '克';

// 用量单位 → 基准单位倍率（未知单位按 1 处理，fail-soft：宁可当克，也不能算成 1000 倍）
function factorOf(unit) {
  const f = QTY_FACTOR[String(unit == null ? '' : unit).trim()];
  return typeof f === 'number' && f > 0 ? f : 1;
}

// 数值 + 单位 → 基准单位(克) 的数量。提交/试算前一律走这里，禁止页面自己乘系数。
// ⚠️ 末位归一到 1e-6：`0.7 × 1000 = 700.0000000000001`（IEEE754），不归一会把这种毛刺
//   写进明细数量里（成本差 1e-13 元虽不影响分位，但落库值脏、且看日志时容易被当成 bug）。
function toBase(qty, unit) {
  const n = Number(qty);
  if (!isFinite(n)) return 0;
  return Math.round(n * factorOf(unit) * 1e6) / 1e6;
}

// 采购单位 → 建议换算系数；无建议时返回 null（页面据此决定是否覆盖用户已填的值）
function suggestConvert(unit) {
  const v = CONVERT_SUGGEST[String(unit == null ? '' : unit).trim()];
  return typeof v === 'number' && v > 0 ? v : null;
}

// 单位换算用于「换单位时保住物理量」：1000 克 → 1 千克。
// 返回字符串（与页面输入框的 string 值同型），末尾多余 0 去掉，整数不留小数点。
function convertQtyText(qtyText, fromUnit, toUnit) {
  const n = Number(qtyText);
  if (!isFinite(n) || n <= 0) return String(qtyText == null ? '' : qtyText);
  const base = n * factorOf(fromUnit);
  const out = base / factorOf(toUnit);
  const rounded = Math.round(out * 1e6) / 1e6;      // 去浮点毛刺（0.30000000000000004）
  return String(rounded);
}

module.exports = {
  PURCHASE_UNITS,
  CONVERT_SUGGEST,
  QTY_UNITS,
  QTY_FACTOR,
  BASE_UNIT,
  factorOf,
  toBase,
  suggestConvert,
  convertQtyText,
};
