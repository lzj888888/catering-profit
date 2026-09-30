// utils/dishTemplates.js —— M3.20 菜品模板库（纯数据单源）
//
// 依据：`specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.20。
//
// 🔴 红线：
//   ① 只预填「行结构 + 用量 + 单位」，**绝不预填价格**（R138）—— 价格全部留空等用户填。
//   ② 所有 `unit` ∈ `utils/units.js::PURCHASE_UNITS`（16 项）。
//   ③ `applyTemplate` 返回的行**不得含** price / unit_cost / cost 类键（模板不掺金额口径）。
//   ④ 纯数据、不写库 —— 模板只是省打字，保存仍走既有 `api.call('saveCostCard')`，配额照扣。

// 20 道高频菜品模板。每道：{ tpl_key, dish_name, lines: [{ line_name, qty, unit }] }。
const TEMPLATES = [
  {
    tpl_key: 'gongbao_jiding',
    dish_name: '宫保鸡丁',
    lines: [
      { line_name: '鸡胸肉', qty: 200, unit: '克' },
      { line_name: '花生米', qty: 50, unit: '克' },
      { line_name: '干辣椒', qty: 10, unit: '克' },
      { line_name: '葱姜蒜', qty: 30, unit: '克' },
    ],
  },
  {
    tpl_key: 'yuxiang_rousi',
    dish_name: '鱼香肉丝',
    lines: [
      { line_name: '猪里脊', qty: 150, unit: '克' },
      { line_name: '木耳', qty: 30, unit: '克' },
      { line_name: '胡萝卜', qty: 50, unit: '克' },
      { line_name: '豆瓣酱', qty: 15, unit: '克' },
    ],
  },
  {
    tpl_key: 'mapo_doufu',
    dish_name: '麻婆豆腐',
    lines: [
      { line_name: '豆腐', qty: 300, unit: '克' },
      { line_name: '猪瘦肉', qty: 50, unit: '克' },
      { line_name: '豆瓣酱', qty: 20, unit: '克' },
      { line_name: '花椒', qty: 5, unit: '克' },
    ],
  },
  {
    tpl_key: 'huiguo_rou',
    dish_name: '回锅肉',
    lines: [
      { line_name: '五花肉', qty: 200, unit: '克' },
      { line_name: '青蒜', qty: 100, unit: '克' },
      { line_name: '豆瓣酱', qty: 20, unit: '克' },
    ],
  },
  {
    tpl_key: 'qingshuai_tudousi',
    dish_name: '酸辣土豆丝',
    lines: [
      { line_name: '土豆', qty: 300, unit: '克' },
      { line_name: '干辣椒', qty: 10, unit: '克' },
      { line_name: '醋', qty: 20, unit: '毫升' },
    ],
  },
  {
    tpl_key: 'fanqie_chao_dan',
    dish_name: '番茄炒蛋',
    lines: [
      { line_name: '番茄', qty: 200, unit: '克' },
      { line_name: '鸡蛋', qty: 3, unit: '个' },
      { line_name: '大葱', qty: 10, unit: '克' },
    ],
  },
  {
    tpl_key: 'hongshao_rou',
    dish_name: '红烧肉',
    lines: [
      { line_name: '五花肉', qty: 500, unit: '克' },
      { line_name: '冰糖', qty: 30, unit: '克' },
      { line_name: '生抽', qty: 20, unit: '毫升' },
      { line_name: '老抽', qty: 10, unit: '毫升' },
    ],
  },
  {
    tpl_key: 'shuizhu_yu',
    dish_name: '水煮鱼',
    lines: [
      { line_name: '草鱼', qty: 500, unit: '克' },
      { line_name: '豆芽', qty: 200, unit: '克' },
      { line_name: '干辣椒', qty: 30, unit: '克' },
      { line_name: '花椒', qty: 15, unit: '克' },
    ],
  },
  {
    tpl_key: 'lazi_ji',
    dish_name: '辣子鸡',
    lines: [
      { line_name: '鸡腿', qty: 300, unit: '克' },
      { line_name: '干辣椒', qty: 50, unit: '克' },
      { line_name: '花椒', qty: 20, unit: '克' },
    ],
  },
  {
    tpl_key: 'tangcu_liji',
    dish_name: '糖醋里脊',
    lines: [
      { line_name: '猪里脊', qty: 250, unit: '克' },
      { line_name: '淀粉', qty: 50, unit: '克' },
      { line_name: '番茄酱', qty: 30, unit: '克' },
    ],
  },
  {
    tpl_key: 'suanrong_qingcai',
    dish_name: '蒜蓉青菜',
    lines: [
      { line_name: '生菜', qty: 300, unit: '克' },
      { line_name: '大蒜', qty: 20, unit: '克' },
    ],
  },
  {
    tpl_key: 'qingzheng_luyu',
    dish_name: '清蒸鲈鱼',
    lines: [
      { line_name: '鲈鱼', qty: 1, unit: '条' },
      { line_name: '大葱', qty: 20, unit: '克' },
      { line_name: '生姜', qty: 10, unit: '克' },
      { line_name: '生抽', qty: 20, unit: '毫升' },
    ],
  },
  {
    tpl_key: 'ganbian_sijidou',
    dish_name: '干煸四季豆',
    lines: [
      { line_name: '四季豆', qty: 300, unit: '克' },
      { line_name: '猪瘦肉', qty: 50, unit: '克' },
      { line_name: '干辣椒', qty: 15, unit: '克' },
    ],
  },
  {
    tpl_key: 'kele_jichi',
    dish_name: '可乐鸡翅',
    lines: [
      { line_name: '鸡翅', qty: 400, unit: '克' },
      { line_name: '生抽', qty: 15, unit: '毫升' },
    ],
  },
  {
    tpl_key: 'disan_xian',
    dish_name: '地三鲜',
    lines: [
      { line_name: '土豆', qty: 150, unit: '克' },
      { line_name: '茄子', qty: 150, unit: '克' },
      { line_name: '青椒', qty: 100, unit: '克' },
    ],
  },
  {
    tpl_key: 'mayi_shangshu',
    dish_name: '蚂蚁上树',
    lines: [
      { line_name: '粉丝', qty: 100, unit: '克' },
      { line_name: '猪瘦肉', qty: 80, unit: '克' },
      { line_name: '豆瓣酱', qty: 20, unit: '克' },
    ],
  },
  {
    tpl_key: 'suancai_yu',
    dish_name: '酸菜鱼',
    lines: [
      { line_name: '草鱼', qty: 500, unit: '克' },
      { line_name: '酸菜', qty: 200, unit: '克' },
      { line_name: '干辣椒', qty: 20, unit: '克' },
      { line_name: '花椒', qty: 10, unit: '克' },
    ],
  },
  {
    tpl_key: 'hongshao_qiezi',
    dish_name: '红烧茄子',
    lines: [
      { line_name: '茄子', qty: 300, unit: '克' },
      { line_name: '猪瘦肉', qty: 30, unit: '克' },
      { line_name: '大蒜', qty: 20, unit: '克' },
      { line_name: '生抽', qty: 15, unit: '毫升' },
    ],
  },
  {
    tpl_key: 'jiucai_chao_dan',
    dish_name: '韭菜炒鸡蛋',
    lines: [
      { line_name: '韭菜', qty: 200, unit: '克' },
      { line_name: '鸡蛋', qty: 3, unit: '个' },
    ],
  },
  {
    tpl_key: 'qingjiao_rousi',
    dish_name: '青椒肉丝',
    lines: [
      { line_name: '青椒', qty: 200, unit: '克' },
      { line_name: '猪里脊', qty: 100, unit: '克' },
    ],
  },
];

/**
 * 按 tpl_key 取一道模板（纯读）。
 * @param {string} key tpl_key
 * @returns {object|null}
 */
function getTemplate(key) {
  const k = String(key == null ? '' : key).trim();
  if (!k) return null;
  return TEMPLATES.find((t) => t.tpl_key === k) || null;
}

/**
 * 把模板展开成行数组（纯读、不写库）。返回行**只含** line_name / qty / unit，
 * 不含 price / unit_cost / cost 类键（价格留空等用户填）。
 * @param {object} tpl 模板对象
 * @returns {Array<{line_name:string, qty:number, unit:string}>}
 */
function applyTemplate(tpl) {
  return (tpl && Array.isArray(tpl.lines) ? tpl.lines : []).map((l) => ({
    line_name: String((l && l.line_name) || ''),
    qty: l && l.qty,
    unit: String((l && l.unit) || ''),
  }));
}

module.exports = { TEMPLATES, getTemplate, applyTemplate };
