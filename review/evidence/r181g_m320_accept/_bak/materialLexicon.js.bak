// utils/materialLexicon.js —— M3.20 标准原料词库（纯数据单源）
//
// 依据：`specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.20。
//
// 🔴 红线（违反即退回）：
//   ① 只做「搜索建议」，**绝不自动匹配替换** —— 「辣椒」被静默换成「干辣椒」= 成本**静默变错**
//      （与 round116「静默 0 行」同一种病）。本文件只导出读函数，不导出任何写/替换函数。
//   ② **绝不带价格**（R138）—— 每条只允许 4 键，无任何 price/cost 字段。
//   ③ **不带分类** —— 避免与 M1 的 ITEM_TAGS 归属体系打架（三级分类不落库）。
//   ④ `default_unit` 必须 ∈ `utils/units.js::PURCHASE_UNITS`（16 项）。
//
// ⚠️ 本文件**不落库、不进云函数、不需要派生副本** —— 词库只在前端，云侧不复制一份（不制造漂移点）。
//   原料档案新增的 `std_key` 只记「本料取自词库哪一条」，云端不校验。

// 只允许 4 个键：std_key（稳定键）/ std_name（标准名）/ aliases（别名，检索用）/ default_unit（建议单位）。
// 规模 60~80 条（本表 65 条）。
const LEXICON = [
  // ===== 肉禽蛋 =====
  { std_key: 'chicken_breast', std_name: '鸡胸肉', aliases: ['鸡脯肉', '鸡大胸', '鸡柳肉'], default_unit: '斤' },
  { std_key: 'chicken_leg', std_name: '鸡腿', aliases: ['琵琶腿', '鸡腿肉', '手枪腿'], default_unit: '斤' },
  { std_key: 'chicken_wing', std_name: '鸡翅', aliases: ['鸡中翅', '鸡翅膀'], default_unit: '斤' },
  { std_key: 'pork_belly', std_name: '五花肉', aliases: ['猪五花', '肋条肉', '三层肉'], default_unit: '斤' },
  { std_key: 'pork_loin', std_name: '猪里脊', aliases: ['里脊肉', '猪柳', '通脊'], default_unit: '斤' },
  { std_key: 'pork_rib', std_name: '猪排骨', aliases: ['排骨', '肋排', '仔排'], default_unit: '斤' },
  { std_key: 'pork_lean', std_name: '猪瘦肉', aliases: ['瘦肉', '里脊丝'], default_unit: '斤' },
  { std_key: 'beef_brisket', std_name: '牛腩', aliases: ['牛肋条', '坑腩', '牛腹肉'], default_unit: '斤' },
  { std_key: 'beef_lean', std_name: '牛里脊', aliases: ['牛柳', '菲力'], default_unit: '斤' },
  { std_key: 'lamb', std_name: '羊肉', aliases: ['羊腿肉', '羊排', '羊肉卷'], default_unit: '斤' },
  { std_key: 'egg', std_name: '鸡蛋', aliases: ['土鸡蛋', '蛋', '鲜蛋'], default_unit: '个' },
  // ===== 蔬菜 =====
  { std_key: 'potato', std_name: '土豆', aliases: ['马铃薯', '洋芋', '山药蛋'], default_unit: '斤' },
  { std_key: 'tomato', std_name: '番茄', aliases: ['西红柿', '圣女果'], default_unit: '斤' },
  { std_key: 'green_pepper', std_name: '青椒', aliases: ['菜椒', '柿子椒', '灯笼椒'], default_unit: '斤' },
  { std_key: 'carrot', std_name: '胡萝卜', aliases: ['红萝卜', '甘笋'], default_unit: '斤' },
  { std_key: 'radish', std_name: '白萝卜', aliases: ['萝卜', '菜头'], default_unit: '斤' },
  { std_key: 'cabbage', std_name: '大白菜', aliases: ['白菜', '黄芽菜'], default_unit: '斤' },
  { std_key: 'lettuce', std_name: '生菜', aliases: ['莴苣', '玻璃生菜'], default_unit: '斤' },
  { std_key: 'spinach', std_name: '菠菜', aliases: ['菠薐菜', '鹦鹉菜'], default_unit: '斤' },
  { std_key: 'chive', std_name: '韭菜', aliases: ['韭黄', '扁菜'], default_unit: '斤' },
  { std_key: 'celery', std_name: '芹菜', aliases: ['香芹', '西芹'], default_unit: '斤' },
  { std_key: 'cucumber', std_name: '黄瓜', aliases: ['青瓜', '胡瓜'], default_unit: '斤' },
  { std_key: 'eggplant', std_name: '茄子', aliases: ['矮瓜', '紫茄'], default_unit: '斤' },
  { std_key: 'green_bean', std_name: '四季豆', aliases: ['豆角', '豇豆', '芸豆'], default_unit: '斤' },
  { std_key: 'onion', std_name: '洋葱', aliases: ['圆葱', '洋葱头'], default_unit: '斤' },
  { std_key: 'garlic', std_name: '大蒜', aliases: ['蒜头', '蒜', '蒜瓣'], default_unit: '斤' },
  { std_key: 'ginger', std_name: '生姜', aliases: ['姜', '老姜', '姜片'], default_unit: '斤' },
  { std_key: 'scallion', std_name: '大葱', aliases: ['葱', '京葱', '葱段'], default_unit: '斤' },
  { std_key: 'cilantro', std_name: '香菜', aliases: ['芫荽', '香荽'], default_unit: '斤' },
  { std_key: 'tofu', std_name: '豆腐', aliases: ['嫩豆腐', '南豆腐', '北豆腐'], default_unit: '斤' },
  { std_key: 'tofu_skin', std_name: '豆腐皮', aliases: ['千张', '豆皮', '百叶'], default_unit: '斤' },
  { std_key: 'bean_sprout', std_name: '豆芽', aliases: ['黄豆芽', '绿豆芽'], default_unit: '斤' },
  { std_key: 'enoki', std_name: '金针菇', aliases: ['黄金菇', '金针菜'], default_unit: '斤' },
  { std_key: 'shiitake', std_name: '香菇', aliases: ['冬菇', '花菇'], default_unit: '斤' },
  { std_key: 'wood_ear', std_name: '木耳', aliases: ['黑木耳', '云耳'], default_unit: '斤' },
  { std_key: 'peanut', std_name: '花生米', aliases: ['花生仁', '红衣花生'], default_unit: '斤' },
  // ===== 水产 =====
  { std_key: 'grass_carp', std_name: '草鱼', aliases: ['草鲩', '鲩鱼'], default_unit: '斤' },
  { std_key: 'bass', std_name: '鲈鱼', aliases: ['花鲈', '海鲈鱼'], default_unit: '条' },
  { std_key: 'shrimp', std_name: '基围虾', aliases: ['对虾', '明虾', '青虾'], default_unit: '斤' },
  // ===== 香辛料 / 干货 =====
  { std_key: 'dried_chili', std_name: '干辣椒', aliases: ['辣椒', '干红椒', '辣椒段'], default_unit: '斤' },
  { std_key: 'sichuan_pepper', std_name: '花椒', aliases: ['麻椒', '川椒'], default_unit: '斤' },
  { std_key: 'star_anise', std_name: '八角', aliases: ['大料', '茴香'], default_unit: '斤' },
  { std_key: 'cinnamon', std_name: '桂皮', aliases: ['肉桂', '官桂'], default_unit: '斤' },
  { std_key: 'bay_leaf', std_name: '香叶', aliases: ['月桂叶', '桂叶'], default_unit: '斤' },
  { std_key: 'cumin', std_name: '孜然', aliases: ['孜然粉', '安息茴香'], default_unit: '斤' },
  { std_key: 'pepper_powder', std_name: '胡椒粉', aliases: ['白胡椒', '黑胡椒', '胡椒面'], default_unit: '斤' },
  { std_key: 'sesame', std_name: '芝麻', aliases: ['白芝麻', '黑芝麻'], default_unit: '斤' },
  { std_key: 'bean_sauce', std_name: '豆瓣酱', aliases: ['郫县豆瓣', '红油豆瓣', '辣豆瓣'], default_unit: '斤' },
  { std_key: 'vinegar', std_name: '醋', aliases: ['陈醋', '香醋', '米醋'], default_unit: '瓶' },
  // ===== 调味 =====
  { std_key: 'light_soy', std_name: '生抽', aliases: ['酱油', '豉油', '淡酱油'], default_unit: '瓶' },
  { std_key: 'dark_soy', std_name: '老抽', aliases: ['红烧酱油', '浓酱油'], default_unit: '瓶' },
  { std_key: 'cooking_wine', std_name: '料酒', aliases: ['黄酒', '绍酒', '花雕'], default_unit: '瓶' },
  { std_key: 'oyster_sauce', std_name: '蚝油', aliases: ['蚝汁'], default_unit: '瓶' },
  { std_key: 'sugar', std_name: '白糖', aliases: ['砂糖', '白砂糖', '绵白糖'], default_unit: '斤' },
  { std_key: 'rock_sugar', std_name: '冰糖', aliases: ['老冰糖', '黄冰糖'], default_unit: '斤' },
  { std_key: 'salt', std_name: '盐', aliases: ['食盐', '精制盐'], default_unit: '斤' },
  { std_key: 'msg', std_name: '味精', aliases: ['味素'], default_unit: '斤' },
  { std_key: 'chicken_essence', std_name: '鸡精', aliases: ['鸡粉', '鸡味鲜'], default_unit: '斤' },
  { std_key: 'starch', std_name: '淀粉', aliases: ['生粉', '太白粉', '玉米淀粉'], default_unit: '斤' },
  // ===== 油 =====
  { std_key: 'rapeseed_oil', std_name: '菜籽油', aliases: ['菜油', '菜籽色拉油'], default_unit: '升' },
  { std_key: 'peanut_oil', std_name: '花生油', aliases: ['落花生油'], default_unit: '升' },
  { std_key: 'soy_oil', std_name: '大豆油', aliases: ['色拉油', '豆油', '调和油'], default_unit: '升' },
  { std_key: 'sesame_oil', std_name: '香油', aliases: ['芝麻油', '麻油'], default_unit: '瓶' },
  // ===== 主食 / 粉面 =====
  { std_key: 'rice', std_name: '大米', aliases: ['粳米', '香米', '米'], default_unit: '斤' },
  { std_key: 'glutinous_rice', std_name: '糯米', aliases: ['江米'], default_unit: '斤' },
  { std_key: 'flour', std_name: '面粉', aliases: ['小麦粉', '中筋粉', '低筋粉'], default_unit: '斤' },
  { std_key: 'vermicelli', std_name: '粉丝', aliases: ['粉条', '红薯粉', '龙口粉丝'], default_unit: '斤' },
];

/**
 * 按名称/别名模糊建议（纯读，**绝不改写入参、绝不自动替换**）。
 * 排序：标准名精确 > 标准名前缀 > 标准名包含 > 别名精确 > 别名前缀 > 别名包含。
 * @param {string} name 用户正在输入的名称
 * @param {number} [limit=5] 返回条数上限
 * @returns {Array} 命中条目（原样引用 LEXICON 项，不 copy 不 replace）
 */
function suggestByName(name, limit) {
  const q = String(name == null ? '' : name).trim().toLowerCase();
  if (!q) return [];
  const n = (typeof limit === 'number' && limit > 0) ? limit : 5;
  const scored = [];
  for (const it of LEXICON) {
    const std = it.std_name.toLowerCase();
    const aliases = (it.aliases || []).map((a) => String(a).toLowerCase());
    let score = -1;
    if (std === q) score = 0;
    else if (std.indexOf(q) === 0) score = 1;
    else if (std.indexOf(q) >= 0) score = 2;
    else if (aliases.indexOf(q) >= 0) score = 3;
    else if (aliases.some((a) => a.indexOf(q) === 0)) score = 4;
    else if (aliases.some((a) => a.indexOf(q) >= 0)) score = 5;
    if (score >= 0) scored.push({ it, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, n).map((s) => s.it);
}

/**
 * 按稳定键取一条（纯读）。
 * @param {string} key std_key
 * @returns {object|null} 命中条目或 null
 */
function getByKey(key) {
  const k = String(key == null ? '' : key).trim();
  if (!k) return null;
  return LEXICON.find((it) => it.std_key === k) || null;
}

module.exports = { LEXICON, suggestByName, getByKey };
