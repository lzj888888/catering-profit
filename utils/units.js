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
// round151：追加「两」（调料按两买很常见；与参考产品实测池对齐）。顺序 = chips 展示序，按计量族聚拢。
const PURCHASE_UNITS = ['斤', '两', '千克', '克', '毫升', '升', '个', '只', '条', '瓶', '包', '份', '箱', '桶'];

// 1 采购单位 = ? 基准单位（净料口径）。仅作**建议值**：选中单位后自动带出，用户可手改
//   （「箱/桶/件」这类没有通用换算，必须由老板按自家包装填）。
// round151：补「两」= 50。⚠️ 计数族（个/只/条/瓶/包/份/箱/桶）**故意不给建议值** ——
//   一箱装 24 个还是一箱装 6 瓶，只有老板知道，程序不许瞎猜。
const CONVERT_SUGGEST = {
  '斤': 500,
  '两': 50,
  '千克': 1000,
  '公斤': 1000,
  '克': 1,
  '毫升': 1,
  '升': 1000,
};

// 用量单位枚举 = **与采购单位同池**（round151）。
//   ⚠️ 为什么改成同池：原实现只有 ['克','千克','毫升','升'] 4 项 ⇒ 老板「按个买鸡蛋、按个用」
//   「按斤买肉、按斤腌」时**选不出来**，只能被迫换算成克再心算（第 149 轮真机反馈 + 第 151 轮
//   参考产品实测：它就是同一池）。改成 `PURCHASE_UNITS.slice()` 后，两池在**构造上**不可能漂移
//   —— 比"加一条守卫断言两池一致"更强（守卫只能查出漂移，同源则无从漂移）。
const QTY_UNITS = PURCHASE_UNITS.slice();

// 单位 → 基准单位倍率。⚠️ 缺项 fail-soft 返回 1（宁可当基准，也不能算成 1000 倍）。
//   round151 补齐：重量族加 两；计数/包装族一律 **1:1 当量**。
//   ⚠️ 「个 = 1」不是"猜"，是**定义**：引擎以「基准单位」记数，按个买+按个用时 1 个就是 1 个
//      （单价 ¥1.2/个、用量 2 个 ⇒ 成本 ¥2.4 —— 数学上自洽，不需要知道"1 个多少克"）。
const QTY_FACTOR = {
  '克': 1, '千克': 1000, '公斤': 1000, '斤': 500, '两': 50,
  '毫升': 1, '升': 1000,
  '个': 1, '只': 1, '条': 1, '瓶': 1, '包': 1, '份': 1, '箱': 1, '桶': 1,
};

const BASE_UNIT = '克';

// ===== 计量族（round151）=====
// 用途有二：
//   ① 「换算系数」的**基准单位词**随族走 —— 重量族说「1 斤 = 500 克」、体积族说「1 升 = 1000 毫升」、
//      计数族说「1 箱 = 24 个」。改前无论什么单位都写「→克」，按个买的老板直接看不懂。
//   ② 跨族混用时给**提示**（不是拦截）—— 参考产品在这里栽过：采购「个」× 用量「千克」
//      它静默按 1:1 硬算，界面上跳出 ¥6,000,000.00 且**一个字都不提示**（实测）。
//   ⚠️ 口径声明：引擎内部以「基准单位」记数。重量族基准 = 克（引擎红线，一字不改）；
//      体积族按 1 毫升 ≈ 1 克（水/油/酱油密度≈1，既有口径）；计数族基准 = 个（1:1 当量）。
const UNIT_FAMILY = {
  '克': 'weight', '千克': 'weight', '公斤': 'weight', '斤': 'weight', '两': 'weight',
  '毫升': 'volume', '升': 'volume',
  '个': 'count', '只': 'count', '条': 'count', '瓶': 'count',
  '包': 'count', '份': 'count', '箱': 'count', '桶': 'count',
};
const FAMILY_BASE_WORD = { weight: '克', volume: '毫升', count: '个' };

// 未知单位按重量族兜底（引擎基准恒为克 ⇒ 这是最不容易错的方向）
function familyOf(unit) {
  return UNIT_FAMILY[String(unit == null ? '' : unit).trim()] || 'weight';
}

// 该单位的基准单位词（页面文案用；页面不得自己再写一份族表）
function baseWordOf(unit) {
  return FAMILY_BASE_WORD[familyOf(unit)];
}

// 是否跨族（计数族 ↔ 非计数族）。重量↔体积**不算跨族**（既有 1 毫升≈1 克口径，水油通用）；
//   只有"计数"与"计量"之间没有通用换算 ⇒ 那才是需要提示的情形。
function isCrossFamily(a, b) {
  const fa = familyOf(a);
  const fb = familyOf(b);
  if (fa === fb) return false;
  return fa === 'count' || fb === 'count';
}

// 单价折算：¥/采购单位 → ¥/基准单位（手工录入行的「单价单位」用）。
//   非正数原样返回 0（调用方据此判空）；页面禁止自己除倍率。
function priceToBase(price, unit) {
  const n = Number(price);
  if (!isFinite(n) || n <= 0) return 0;
  return n / factorOf(unit);
}

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
  UNIT_FAMILY,
  FAMILY_BASE_WORD,
  factorOf,
  toBase,
  suggestConvert,
  convertQtyText,
  // round151
  familyOf,
  baseWordOf,
  isCrossFamily,
  priceToBase,
};
