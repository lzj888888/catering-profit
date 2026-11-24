// cloudfunctions/common/dishKey.js —— 菜品名归一（dish_key）**单源**（R232 C-9）
//
// 为什么需要：写侧（importSalesBill/service.js）与读侧（getDishReview/index.js）各自内联过一份
// 同逻辑函数（写侧 normalizeDishName / 读侧 normName），**环上零守卫** ⇒ 只要任一侧将来改了规则，
// 两侧口径分叉 ⇒ **全菜匹配不上** ⇒ 用户看到「所有菜都没成本」且**没有任何报错**（失效静默）。
//   ⇒ 单源放这里；两侧一律引用本模块，严禁再内联第二份。
//   伴侣守卫：tools/check_dish_key_single_source.js。
//
// 口径（§4.4 / §4.7 写死）：
//   · trim 去首尾空白
//   · NFKC 归一（全角字母/数字 → 半角），使「Ａ套餐」与「A套餐」命中同一把 key
//   · **保留**规格后缀与括号（不做截断、不去空格）—— 括号是口径的一部分，动了就匹配不上
//   · 老运行时无 String.prototype.normalize 时原样返回（不可 throw，否则整表导入失败）
//
// ⚠️ 本文件不得 require 任何外部包（含 wx-server-sdk）：它是纯函数层，
//    需要被 importSalesBill/service.js（纯逻辑、只依赖 xlsx）与本地守卫直接加载。
function normalizeDishName(name) {
  if (name == null) return '';
  let s = String(name).trim();
  try { s = s.normalize('NFKC'); } catch (e) { /* 老运行时无 normalize 则原样 */ }
  return s;
}

module.exports = { normalizeDishName };
