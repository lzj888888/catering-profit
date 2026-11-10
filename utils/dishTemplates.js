// utils/dishTemplates.js —— M3.20 菜品模板库（纯数据单源）
//
// 依据：`specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.20。
//
// 🔴 红线：
//   ① 只预填「行结构 + 用量 + 单位」，**绝不预填价格**（R138）—— 价格全部留空等用户填。
//   ② 所有 `unit` ∈ `utils/units.js::PURCHASE_UNITS`（16 项）。
//   ③ `applyTemplate` 返回的行**不得含** price / unit_cost / cost 类键（模板不掺金额口径）。
//   ④ 纯数据、不写库 —— 模板只是省打字，保存仍走既有 `api.call('saveCostCard')`，配额照扣。
//   ⑤ **模式必须随模板走**（R317）：模板可带 `mode`（'A' 省略 / 'B' 批量产出）与 `batch_output`。
//      🔴 不加这条会**静默算错 10 倍**：火锅锅底是「炒一批料 → 打 N 锅」，
//      若套用时仍按 mode A 算，整批料的成本会变成「一锅」的成本，且界面看不出来。
//
// 20 道高频菜品模板。每道：{ tpl_key, dish_name, lines: [{ line_name, qty, unit }] }。
// 可选：mode:'B' + batch_output:N（批量产出；仅在「一次投料、多次出品」的菜上使用，如火锅锅底/卤水/红油）。
// 🔴 何时该用 mode B：**一次投的料，产出多份**（炒一锅料打 10 锅）⇒ 单份成本 = 整批 ÷ 产出数。
//    若这道菜就是"一份投一份"（宫保鸡丁），**不要**加 mode，保持默认 A。
// 🔴 R671：模板按**业态大类**分组，与 M2 业态（utils/bizPreset.js）**同一套词**。
//   为什么不自己另造一套品类：老板在 M2 选过「火锅/烧烤」，到 M3 建卡看到同一个词才不用二次理解；
//   自己造一套（如"热炒荤菜/卤味烧腊"）老板根本不知道对应他店里什么。
//   ⚠️ key 必须与 bizPreset 的业态键一致（fastfood/dining/hotpot/cafe/other），
//      由 tools/check_dish_templates.js 的 T-⑩ 守住，防两边漂移。
const TEMPLATE_CATS = [
  { key: 'dining',   label: '正餐 / 炒菜' },
  { key: 'hotpot',   label: '火锅 / 烧烤' },
  { key: 'fastfood', label: '快餐 / 小面' },
  { key: 'cafe',     label: '咖啡茶饮' },
  { key: 'other',    label: '其他' },
];

const TEMPLATES = [
  {
    cat: 'dining',
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
    cat: 'dining',
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
    cat: 'dining',
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
    cat: 'dining',
    tpl_key: 'huiguo_rou',
    dish_name: '回锅肉',
    lines: [
      { line_name: '五花肉', qty: 200, unit: '克' },
      { line_name: '青蒜', qty: 100, unit: '克' },
      { line_name: '豆瓣酱', qty: 20, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'qingshuai_tudousi',
    dish_name: '酸辣土豆丝',
    lines: [
      { line_name: '土豆', qty: 300, unit: '克' },
      { line_name: '干辣椒', qty: 10, unit: '克' },
      { line_name: '醋', qty: 20, unit: '毫升' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'fanqie_chao_dan',
    dish_name: '番茄炒蛋',
    lines: [
      { line_name: '番茄', qty: 200, unit: '克' },
      { line_name: '鸡蛋', qty: 3, unit: '个' },
      { line_name: '大葱', qty: 10, unit: '克' },
    ],
  },
  {
    cat: 'dining',
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
    cat: 'dining',
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
    cat: 'dining',
    tpl_key: 'lazi_ji',
    dish_name: '辣子鸡',
    lines: [
      { line_name: '鸡腿', qty: 300, unit: '克' },
      { line_name: '干辣椒', qty: 50, unit: '克' },
      { line_name: '花椒', qty: 20, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'tangcu_liji',
    dish_name: '糖醋里脊',
    lines: [
      { line_name: '猪里脊', qty: 250, unit: '克' },
      { line_name: '淀粉', qty: 50, unit: '克' },
      { line_name: '番茄酱', qty: 30, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'suanrong_qingcai',
    dish_name: '蒜蓉青菜',
    lines: [
      { line_name: '生菜', qty: 300, unit: '克' },
      { line_name: '大蒜', qty: 20, unit: '克' },
    ],
  },
  {
    cat: 'dining',
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
    cat: 'dining',
    tpl_key: 'ganbian_sijidou',
    dish_name: '干煸四季豆',
    lines: [
      { line_name: '四季豆', qty: 300, unit: '克' },
      { line_name: '猪瘦肉', qty: 50, unit: '克' },
      { line_name: '干辣椒', qty: 15, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'kele_jichi',
    dish_name: '可乐鸡翅',
    lines: [
      { line_name: '鸡翅', qty: 400, unit: '克' },
      { line_name: '生抽', qty: 15, unit: '毫升' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'disan_xian',
    dish_name: '地三鲜',
    lines: [
      { line_name: '土豆', qty: 150, unit: '克' },
      { line_name: '茄子', qty: 150, unit: '克' },
      { line_name: '青椒', qty: 100, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'mayi_shangshu',
    dish_name: '蚂蚁上树',
    lines: [
      { line_name: '粉丝', qty: 100, unit: '克' },
      { line_name: '猪瘦肉', qty: 80, unit: '克' },
      { line_name: '豆瓣酱', qty: 20, unit: '克' },
    ],
  },
  {
    cat: 'dining',
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
    cat: 'dining',
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
    cat: 'dining',
    tpl_key: 'jiucai_chao_dan',
    dish_name: '韭菜炒鸡蛋',
    lines: [
      { line_name: '韭菜', qty: 200, unit: '克' },
      { line_name: '鸡蛋', qty: 3, unit: '个' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'qingjiao_rousi',
    dish_name: '青椒肉丝',
    lines: [
      { line_name: '青椒', qty: 200, unit: '克' },
      { line_name: '猪里脊', qty: 100, unit: '克' },
    ],
  },
  // ===== 一批多用（mode B）=====
  // 🔴 这两道与上面 20 道**性质不同**：上面是「投一份、出一份」，这两道是「炒一批、打多锅」，
  //   所以必须带 mode:'B' + batch_output，套用时页面会自动切到「批量预制」并展开产出数。
  // ⚠️ 用量是**行业常见量级**（一锅约 2kg 油 / 250g 豆瓣），不是标准配方 ——
  //   各店炒料差异极大，老板必须按自家改（页面文案已写「模板只给例子」）。
  //   量级校验：按常见采购价，整批约 600–700 元 ÷ 12 锅 ≈ 50–60 元/锅，落在火锅锅底合理区间。
  {
    // 🔴 R670（李老师）：火锅锅底的真实成本是**三层**，不是一个数：
    //     ① 炒料（一次炒一桶）② 打锅时另加的油 ③ **打锅辅料**（葱段/姜片/醪糟/冰糖/鸡精/盐）
    //   原模板只有 ①，把 ③ 漏了 —— 而 ③ 是**每锅都要放**的，漏了会系统性低估锅底成本。
    //   本模板按「炒一桶 → 出 12 锅」：
    //     每锅 = 底料约 2.5kg（含油，落在常见「8两料+4斤油」的 2.4-2.9kg 区间）
    //   ③ 按「整批量」填（= 每锅用量 × 12），这样 mode B 除下来每锅才含辅料。
//      ⚠️ 「每锅多少」直接写进 line_name —— 因为 `applyTemplate` 只透传 line_name/qty/unit，
//         另加 note 字段会**静默丢失**（实测确认）。想加字段得同时改 applyTemplate + 页面映射 + wxml，
//         为了一个提示不值当。
    //   ⚠️ 油量、料量各店差异极大（3-5 斤油/锅都正常）⇒ 老板必须按自家改，页面文案已写「模板只给例子」。
    //   💡 锅底一般另收锅底费（重庆 28-58、外地更高）⇒ 套用后请在「售价」填锅底费，
    //      系统就能算出「锅底赚不赚」—— 这是火锅店最容易被低估的一项。
    cat: 'hotpot',
    tpl_key: 'niuyou_guodi',
    dish_name: '牛油锅底（自制·炒一桶打12锅）',
    mode: 'B',
    batch_output: 12,
    lines: [
      // ① 炒料（整桶）
      { line_name: '牛油', qty: 24000, unit: '克' },
      { line_name: '郫县豆瓣', qty: 3000, unit: '克' },
      { line_name: '干辣椒', qty: 1500, unit: '克' },
      { line_name: '花椒', qty: 600, unit: '克' },
      { line_name: '姜', qty: 1000, unit: '克' },
      { line_name: '蒜', qty: 800, unit: '克' },
      { line_name: '香料', qty: 400, unit: '克' },
      // ③ 打锅辅料（整批 12 锅的量 = 每锅量 × 12）
      { line_name: '葱段（打锅用·每锅约50g）', qty: 600, unit: '克' },
      { line_name: '姜片（打锅用·每锅约50g）', qty: 600, unit: '克' },
      { line_name: '醪糟（每锅约25g·去燥增香）', qty: 300, unit: '克' },
      { line_name: '冰糖（每锅约12g）', qty: 150, unit: '克' },
      { line_name: '鸡精（每锅约25g）', qty: 300, unit: '克' },
      { line_name: '盐（每锅约12g·按汤量增减）', qty: 150, unit: '克' },
    ],
  },
  {
    // 🔴 R670：番茄锅底同样有**打锅辅料**这一层 —— 原模板只列了炒料，漏了葱/盐/鸡精/冰糖。
    //   番茄锅靠"酸甜鲜"立味，冰糖和鸡精尤其不能省（否则汤寡）。
    //   每锅约：底料 800g + 葱段 50g + 盐 10g + 鸡精 20g + 冰糖 10g。
    cat: 'hotpot',
    tpl_key: 'fanqie_guodi',
    dish_name: '番茄锅底（自制·炒一桶打10锅）',
    mode: 'B',
    batch_output: 10,
    lines: [
      // ① 炒料（整桶）
      { line_name: '番茄', qty: 5000, unit: '克' },
      { line_name: '番茄酱', qty: 2000, unit: '克' },
      { line_name: '洋葱', qty: 1500, unit: '克' },
      { line_name: '食用油', qty: 1500, unit: '克' },
      { line_name: '姜', qty: 300, unit: '克' },
      // ③ 打锅辅料（整批 10 锅的量）
      { line_name: '葱段（打锅用·每锅约50g）', qty: 500, unit: '克' },
      { line_name: '盐（每锅约10g·按汤量增减）', qty: 100, unit: '克' },
      { line_name: '鸡精（每锅约20g）', qty: 200, unit: '克' },
      { line_name: '冰糖（每锅约10g·提鲜）', qty: 100, unit: '克' },
      { line_name: '醪糟（每锅约10g）', qty: 100, unit: '克' },
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

// R671：额外导出「按大类分组」的读法 —— 页面两级选择用这它，不用自己 group
function templatesByCat(catKey) {
  return TEMPLATES.filter((t) => !catKey || t.cat === catKey);
}

module.exports = { TEMPLATES, TEMPLATE_CATS, templatesByCat, getTemplate, applyTemplate };
