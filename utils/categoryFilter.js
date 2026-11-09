// utils/categoryFilter.js —— 菜品分类候选的脏值判定（R666）
//
// 起因（李老师反馈）：「新建成本卡 → 选菜品分类时，出来的词不达意。
//   比如新建『宫保鸡丁』，选分类出来的是『猪肉 多少多少』。」
//
// 查证：预置表 `TERMS.card.dishCats` 干净（热菜/凉菜/荤菜…）；写入点只存老板自己填的；
//   导入按 `line.category` 匹配、默认空 ⇒ **代码里找不到「猪肉 200g」变成分类的路径**。
//   根因待定（历史版本遗留脏数据 / 老板手填过）。**所以在入口做防御。**
//
// 🔴 判据的设计原则：**宁可漏挡，不可误挡**。
//   「大口吃肉」这种营销栏目名是老板有意为之（R626 教训：程序替他改字会造成"我明明填了却变了"）。
//   所以只挡「一眼就是食材+用量」的，不碰任何看起来像人写的名字。

/**
 * @param {*} v 候选值
 * @returns {boolean} true = 明显不是分类（食材/用量/纯数字/过长）
 */
function isDirtyCat(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return true;                                  // 空值不是分类
  if (s.length > 12) return true;                       // 分类名不会这么长（"大口吃肉"5 字，留足余量）
  if (/^\d+(\.\d+)?$/.test(s)) return true;             // 纯数字
  // 含数字 + 计量单位 ⇒ 几乎必然是"食材 + 用量"（猪肉 200g / 鸡蛋 3 个 / 油 50 毫升）
  if (/\d/.test(s) && /(克|kg|千克|斤|两|毫升|ml|元|份|个|只|条|块|g\b|l\b)/i.test(s)) return true;
  return false;
}

module.exports = { isDirtyCat };
