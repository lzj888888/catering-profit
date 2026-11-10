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
    dish_name: '自制牛油锅底（炒一桶打12锅）',
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
    dish_name: '自制番茄锅底（炒一桶打10锅）',
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
  // ===== 正餐 / 炒菜（R673 重写，20 道）=====
  // 🔴 为什么整体重写而不是修补：旧 20 道来源不明、且**每道只有 2-4 行、完全没有调料**。
  //   一盘鱼香肉丝的调料（糖醋酱油淀粉油）约 1.5-2.5 元，主料约 4 元 ⇒ 调料占成本 30-40%。
  //   旧的算出来比实际低三四成 —— 这不是数据不准，是**漏了一整层**，修补等于每道都要重写。
  // 🔴 本组每道都必须含：主料 + 辅料 + **调料（油/盐/糖/醋/酱油/淀粉/料酒）**。
  //   守卫 check_dish_templates 的 T-⑯ 强制要求"每条正餐模板至少有 3 种调料"，缺则门禁红。
  // ⚠️ 用量为门店单份出品量的行业常见值，各店差异大，老板按自家改。
  {
    cat: 'dining',
    tpl_key: 'gongbao_jiding',
    dish_name: '宫保鸡丁',
    lines: [
      { line_name: '鸡腿肉（或鸡胸）', qty: 200, unit: '克' },
      { line_name: '油酥花生米', qty: 50, unit: '克' },
      { line_name: '干辣椒节', qty: 8, unit: '克' },
      { line_name: '花椒', qty: 3, unit: '克' },
      { line_name: '葱白', qty: 20, unit: '克' },
      { line_name: '白糖', qty: 15, unit: '克' },
      { line_name: '醋', qty: 12, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '料酒', qty: 5, unit: '克' },
      { line_name: '淀粉', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 30, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'yuxiang_rousi',
    dish_name: '鱼香肉丝',
    lines: [
      { line_name: '猪里脊', qty: 150, unit: '克' },
      { line_name: '干木耳（泡发前）', qty: 5, unit: '克' },
      { line_name: '胡萝卜', qty: 50, unit: '克' },
      { line_name: '泡椒', qty: 20, unit: '克' },
      { line_name: '葱姜蒜', qty: 20, unit: '克' },
      { line_name: '白糖', qty: 15, unit: '克' },
      { line_name: '醋', qty: 15, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '淀粉', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 30, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'mapo_doufu',
    dish_name: '麻婆豆腐',
    lines: [
      { line_name: '嫩豆腐', qty: 300, unit: '克' },
      { line_name: '牛肉末（或猪肉末）', qty: 50, unit: '克' },
      { line_name: '青蒜苗', qty: 10, unit: '克' },
      { line_name: '郫县豆瓣', qty: 15, unit: '克' },
      { line_name: '豆豉', qty: 5, unit: '克' },
      { line_name: '辣椒面', qty: 7, unit: '克' },
      { line_name: '花椒面', qty: 6, unit: '克' },
      { line_name: '淀粉', qty: 15, unit: '克' },
      { line_name: '酱油', qty: 5, unit: '克' },
      { line_name: '食用油', qty: 40, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'huiguo_rou',
    dish_name: '回锅肉',
    lines: [
      { line_name: '五花肉', qty: 150, unit: '克' },
      { line_name: '青椒', qty: 50, unit: '克' },
      { line_name: '蒜苗', qty: 30, unit: '克' },
      { line_name: '郫县豆瓣', qty: 15, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '白糖', qty: 3, unit: '克' },
      { line_name: '料酒', qty: 5, unit: '克' },
      { line_name: '食用油', qty: 20, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'suanla_tudousi',
    dish_name: '酸辣土豆丝',
    lines: [
      { line_name: '土豆', qty: 300, unit: '克' },
      { line_name: '青椒', qty: 30, unit: '克' },
      { line_name: '干辣椒', qty: 5, unit: '克' },
      { line_name: '花椒', qty: 2, unit: '克' },
      { line_name: '醋', qty: 15, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
      { line_name: '食用油', qty: 25, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'fanqie_chao_dan',
    dish_name: '番茄炒蛋',
    lines: [
      { line_name: '番茄', qty: 250, unit: '克' },
      { line_name: '鸡蛋', qty: 150, unit: '克' },
      { line_name: '葱', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 30, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
      { line_name: '白糖', qty: 5, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'hongshao_rou',
    dish_name: '红烧肉',
    lines: [
      { line_name: '五花肉', qty: 300, unit: '克' },
      { line_name: '姜', qty: 10, unit: '克' },
      { line_name: '葱', qty: 15, unit: '克' },
      { line_name: '冰糖', qty: 20, unit: '克' },
      { line_name: '酱油', qty: 25, unit: '克' },
      { line_name: '料酒', qty: 15, unit: '克' },
      { line_name: '食用油', qty: 15, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
      { line_name: '香料（八角桂皮）', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'shuizhu_yu',
    dish_name: '水煮鱼',
    lines: [
      { line_name: '草鱼/黑鱼', qty: 400, unit: '克' },
      { line_name: '黄豆芽', qty: 100, unit: '克' },
      { line_name: '干辣椒', qty: 15, unit: '克' },
      { line_name: '花椒', qty: 8, unit: '克' },
      { line_name: '郫县豆瓣', qty: 25, unit: '克' },
      { line_name: '淀粉', qty: 15, unit: '克' },
      { line_name: '料酒', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 80, unit: '克' },
      { line_name: '盐', qty: 5, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'lazi_ji',
    dish_name: '辣子鸡',
    lines: [
      { line_name: '鸡腿肉', qty: 300, unit: '克' },
      { line_name: '干辣椒', qty: 30, unit: '克' },
      { line_name: '花椒', qty: 8, unit: '克' },
      { line_name: '葱姜蒜', qty: 20, unit: '克' },
      { line_name: '淀粉', qty: 10, unit: '克' },
      { line_name: '料酒', qty: 10, unit: '克' },
      { line_name: '白糖', qty: 5, unit: '克' },
      { line_name: '食用油', qty: 60, unit: '克' },
      { line_name: '盐', qty: 4, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'tangcu_liji',
    dish_name: '糖醋里脊',
    lines: [
      { line_name: '猪里脊', qty: 200, unit: '克' },
      { line_name: '鸡蛋', qty: 30, unit: '克' },
      { line_name: '白糖', qty: 30, unit: '克' },
      { line_name: '醋', qty: 25, unit: '克' },
      { line_name: '番茄酱', qty: 20, unit: '克' },
      { line_name: '淀粉', qty: 30, unit: '克' },
      { line_name: '食用油', qty: 60, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'suanrong_qingcai',
    dish_name: '蒜蓉青菜',
    lines: [
      { line_name: '青菜', qty: 300, unit: '克' },
      { line_name: '蒜', qty: 20, unit: '克' },
      { line_name: '食用油', qty: 20, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'qingzheng_luyu',
    dish_name: '清蒸鲈鱼',
    lines: [
      { line_name: '鲈鱼', qty: 400, unit: '克' },
      { line_name: '葱姜', qty: 30, unit: '克' },
      { line_name: '蒸鱼豉油', qty: 25, unit: '克' },
      { line_name: '料酒', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 20, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'ganbian_sijidou',
    dish_name: '干煸四季豆',
    lines: [
      { line_name: '四季豆', qty: 300, unit: '克' },
      { line_name: '猪肉末', qty: 50, unit: '克' },
      { line_name: '干辣椒', qty: 5, unit: '克' },
      { line_name: '蒜', qty: 10, unit: '克' },
      { line_name: '酱油', qty: 8, unit: '克' },
      { line_name: '食用油', qty: 40, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'kele_jichi',
    dish_name: '可乐鸡翅',
    lines: [
      { line_name: '鸡翅', qty: 300, unit: '克' },
      { line_name: '姜', qty: 10, unit: '克' },
      { line_name: '可乐', qty: 200, unit: '毫升' },
      { line_name: '酱油', qty: 20, unit: '克' },
      { line_name: '料酒', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 15, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'disan_xian',
    dish_name: '地三鲜',
    lines: [
      { line_name: '土豆', qty: 150, unit: '克' },
      { line_name: '茄子', qty: 150, unit: '克' },
      { line_name: '青椒', qty: 80, unit: '克' },
      { line_name: '蒜', qty: 10, unit: '克' },
      { line_name: '酱油', qty: 15, unit: '克' },
      { line_name: '白糖', qty: 5, unit: '克' },
      { line_name: '淀粉', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 50, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'mayi_shangshu',
    dish_name: '蚂蚁上树',
    lines: [
      { line_name: '粉丝', qty: 100, unit: '克' },
      { line_name: '猪肉末', qty: 80, unit: '克' },
      { line_name: '葱姜蒜', qty: 15, unit: '克' },
      { line_name: '郫县豆瓣', qty: 15, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 30, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'suancai_yu',
    dish_name: '酸菜鱼',
    lines: [
      { line_name: '草鱼/黑鱼', qty: 400, unit: '克' },
      { line_name: '酸菜', qty: 150, unit: '克' },
      { line_name: '泡椒', qty: 20, unit: '克' },
      { line_name: '花椒', qty: 5, unit: '克' },
      { line_name: '淀粉', qty: 15, unit: '克' },
      { line_name: '料酒', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 50, unit: '克' },
      { line_name: '盐', qty: 5, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'hongshao_qiezi',
    dish_name: '红烧茄子',
    lines: [
      { line_name: '茄子', qty: 300, unit: '克' },
      { line_name: '蒜', qty: 15, unit: '克' },
      { line_name: '酱油', qty: 15, unit: '克' },
      { line_name: '白糖', qty: 5, unit: '克' },
      { line_name: '淀粉', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 50, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'jiucai_chao_dan',
    dish_name: '韭菜炒蛋',
    lines: [
      { line_name: '韭菜', qty: 200, unit: '克' },
      { line_name: '鸡蛋', qty: 150, unit: '克' },
      { line_name: '食用油', qty: 30, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
    ],
  },
  {
    cat: 'dining',
    tpl_key: 'qingjiao_rousi',
    dish_name: '青椒肉丝',
    lines: [
      { line_name: '猪里脊', qty: 150, unit: '克' },
      { line_name: '青椒', qty: 100, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '淀粉', qty: 10, unit: '克' },
      { line_name: '料酒', qty: 5, unit: '克' },
      { line_name: '食用油', qty: 25, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
    ],
  },

  // ===== 火锅：外购成品料（R677 新增）=====
  // 🔴 李老师：外地火锅店**多数不自己炒料**，是买成品底料 ——「一斤底料多少钱，一锅打几两底料，
  //   加上三斤或四斤五斤油」。这和自制的成本结构**完全不同**，硬用一个模板必然算错：
  //     自制 = 炒一桶（油+料+香料一起下锅）÷ 出锅数
  //     外购 = **底料按斤买** + 另加油（成品料含油少，店家常补） + 打锅辅料
  //   所以单独做一个，用 mode A（一锅 = 一份），老板填多少就是多少，不用换算批次。
  //   ⚠️ 每锅几两料、几斤油**各店差异极大**（7-8 两料 / 3-5 斤油都正常），
  //      本模板按「8 两料 + 4 斤油」给，老板必须按自家改。
  {
    cat: 'hotpot',
    tpl_key: 'niuyou_guodi_buy',
    dish_name: '外购牛油锅底（一锅）',
    lines: [
      { line_name: '成品牛油底料（约8两）', qty: 400, unit: '克' },
      { line_name: '牛油（另加）', qty: 2000, unit: '克' },
      { line_name: '葱段', qty: 50, unit: '克' },
      { line_name: '姜片', qty: 50, unit: '克' },
      { line_name: '醪糟', qty: 25, unit: '克' },
      { line_name: '冰糖', qty: 12, unit: '克' },
      { line_name: '鸡精', qty: 25, unit: '克' },
      { line_name: '盐', qty: 12, unit: '克' },
    ],
  },
  {
    cat: 'hotpot',
    tpl_key: 'qingyou_guodi_buy',
    dish_name: '外购清油锅底（一锅）',
    lines: [
      { line_name: '成品清油底料（约8两）', qty: 400, unit: '克' },
      { line_name: '菜籽油（另加）', qty: 2000, unit: '克' },
      { line_name: '葱段', qty: 50, unit: '克' },
      { line_name: '姜片', qty: 50, unit: '克' },
      { line_name: '醪糟', qty: 25, unit: '克' },
      { line_name: '冰糖', qty: 12, unit: '克' },
      { line_name: '鸡精', qty: 25, unit: '克' },
      { line_name: '盐', qty: 12, unit: '克' },
    ],
  },
  {
    // 🔴 R677：羊肉汤锅 —— 李老师点名要的「一个汤底就能开店」那类。
    //   和牛油锅底一样是「熬一桶 → 分 N 锅」，所以用 mode B。
    //   骨水比按 1:4（10 斤骨配 40 斤水）—— 这是清汤锅的常见比例，
    //   汤要白要浓就减水，要清就加水，老板按自家改。
    //   ⚠️ 一锅 4L 汤里带 200g 骨 + 50g 肉（骨肉跟着汤一起上桌），所以「每锅」含骨肉不只是汤。
    cat: 'hotpot',
    tpl_key: 'yangrou_tangguo',
    dish_name: '自制羊肉汤锅底（熬一桶打10锅）',
    mode: 'B',
    batch_output: 10,
    lines: [
      // ① 熬汤（整桶）
      { line_name: '羊棒骨', qty: 2000, unit: '克' },
      { line_name: '羊肉（带皮/腿肉）', qty: 500, unit: '克' },
      { line_name: '姜', qty: 100, unit: '克' },
      { line_name: '葱', qty: 100, unit: '克' },
      { line_name: '白芷', qty: 20, unit: '克' },
      { line_name: '花椒', qty: 10, unit: '克' },
      // ⚠️ 水：**保留但标「可不计价」**。理由有二：
      //   ① 水量决定出品量（骨水比 1:4），去掉老板就不知道一锅汤有多少；
      //   ② 但自来水属**水电费（期间费用）**，和燃气同理（R675 已裁定不进单品毛利率），
      //      单价填 0 或按吨价填都行 —— 别让它变成一项假成本。
      { line_name: '水（熬汤用·单价可填0）', qty: 40000, unit: '毫升' },
      // ② 打锅辅料（整批 10 锅的量 = 每锅量 × 10）
      { line_name: '盐（每锅约12g·按汤量增减）', qty: 120, unit: '克' },
      { line_name: '鸡精（每锅约15g）', qty: 150, unit: '克' },
      { line_name: '葱段（打锅用·每锅约30g）', qty: 300, unit: '克' },
      { line_name: '香菜（每锅约10g）', qty: 100, unit: '克' },
    ],
  },

  // ===== 快餐 / 小面（R672 新增，8 道）=====
  // 🔴 数据口径：每份**门店出品量**（不是家庭份），用量为行业常见区间中值。
  //   面条类成本结构最简单（面 + 浇头 + 调料），所以先做这一类验证流程。
  // ⚠️ 面/粉的干湿换算各店不同（干面 150g ≈ 湿面 180g），老板按自家采购规格改。
  {
    cat: 'fastfood',
    tpl_key: 'cq_xiaomian',
    dish_name: '重庆小面（素面）',
    lines: [
      { line_name: '水面（碱面）', qty: 150, unit: '克' },
      { line_name: '青菜', qty: 50, unit: '克' },
      { line_name: '辣椒油', qty: 15, unit: '克' },
      { line_name: '花椒面', qty: 2, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '猪油', qty: 10, unit: '克' },
      { line_name: '蒜水', qty: 10, unit: '克' },
      { line_name: '芽菜', qty: 10, unit: '克' },
      { line_name: '葱花', qty: 5, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
      { line_name: '鸡精', qty: 3, unit: '克' },
    ],
  },
  {
    cat: 'fastfood',
    tpl_key: 'wanzha_mian',
    dish_name: '豌杂面',
    lines: [
      { line_name: '水面（碱面）', qty: 150, unit: '克' },
      { line_name: '豌豆（耙豌豆）', qty: 50, unit: '克' },
      { line_name: '猪肉末（杂酱）', qty: 50, unit: '克' },
      { line_name: '青菜', qty: 50, unit: '克' },
      { line_name: '郫县豆瓣', qty: 10, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '辣椒油', qty: 10, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'fastfood',
    tpl_key: 'hongshao_niuroumian',
    dish_name: '红烧牛肉面',
    lines: [
      { line_name: '面条', qty: 150, unit: '克' },
      { line_name: '牛肉', qty: 80, unit: '克' },
      { line_name: '青菜', qty: 50, unit: '克' },
      { line_name: '酱油', qty: 15, unit: '克' },
      { line_name: '郫县豆瓣', qty: 10, unit: '克' },
      { line_name: '冰糖', qty: 5, unit: '克' },
      { line_name: '香料（八角桂皮等）', qty: 2, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
    ],
  },
  {
    cat: 'fastfood',
    tpl_key: 'suanlafen',
    dish_name: '酸辣粉',
    lines: [
      { line_name: '红薯粉', qty: 150, unit: '克' },
      { line_name: '酥花生', qty: 15, unit: '克' },
      { line_name: '酥黄豆', qty: 10, unit: '克' },
      { line_name: '榨菜', qty: 10, unit: '克' },
      { line_name: '保宁醋', qty: 15, unit: '克' },
      { line_name: '辣椒油', qty: 15, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '花椒面', qty: 2, unit: '克' },
      { line_name: '蒜水', qty: 10, unit: '克' },
    ],
  },
  {
    cat: 'fastfood',
    tpl_key: 'fanqie_jidanmian',
    dish_name: '番茄鸡蛋面',
    lines: [
      { line_name: '面条', qty: 150, unit: '克' },
      { line_name: '番茄', qty: 150, unit: '克' },
      { line_name: '鸡蛋', qty: 100, unit: '克' },
      { line_name: '葱花', qty: 5, unit: '克' },
      { line_name: '食用油', qty: 20, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
      { line_name: '白糖', qty: 3, unit: '克' },
    ],
  },
  {
    cat: 'fastfood',
    tpl_key: 'chaoshou',
    dish_name: '红油抄手',
    lines: [
      { line_name: '馄饨皮', qty: 100, unit: '克' },
      { line_name: '猪肉馅', qty: 80, unit: '克' },
      { line_name: '辣椒油', qty: 15, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '蒜水', qty: 10, unit: '克' },
      { line_name: '葱花', qty: 5, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'fastfood',
    tpl_key: 'huiguorou_gaifan',
    dish_name: '回锅肉盖饭',
    lines: [
      // 💡 盖饭 = 米饭 + 一道菜。菜的部分也可直接用「正餐/炒菜」里的回锅肉模板，成本合并即可。
      { line_name: '米饭', qty: 250, unit: '克' },
      { line_name: '五花肉', qty: 100, unit: '克' },
      { line_name: '青椒', qty: 50, unit: '克' },
      { line_name: '蒜苗', qty: 30, unit: '克' },
      { line_name: '郫县豆瓣', qty: 15, unit: '克' },
      { line_name: '酱油', qty: 10, unit: '克' },
      { line_name: '白糖', qty: 3, unit: '克' },
      { line_name: '食用油', qty: 15, unit: '克' },
    ],
  },
  {
    cat: 'fastfood',
    tpl_key: 'dan_chaofan',
    dish_name: '蛋炒饭',
    lines: [
      { line_name: '米饭', qty: 250, unit: '克' },
      { line_name: '鸡蛋', qty: 100, unit: '克' },
      { line_name: '葱花', qty: 10, unit: '克' },
      { line_name: '食用油', qty: 20, unit: '克' },
      { line_name: '盐', qty: 3, unit: '克' },
    ],
  },
  // ===== 咖啡茶饮（R672 新增，5 道）=====
  // 🔴 饮品成本结构：原料单一、损耗极低，但**杯型差异大**（中杯/大杯差 30-50%）。
  //   本模板按中杯（约 400-500ml）给，老板按自家杯型改。
  {
    cat: 'cafe',
    tpl_key: 'americano',
    dish_name: '美式咖啡（中杯）',
    lines: [
      { line_name: '咖啡豆', qty: 18, unit: '克' },
      { line_name: '纯净水', qty: 200, unit: '毫升' },
    ],
  },
  {
    cat: 'cafe',
    tpl_key: 'latte',
    dish_name: '拿铁（中杯）',
    lines: [
      { line_name: '咖啡豆', qty: 18, unit: '克' },
      { line_name: '牛奶', qty: 200, unit: '毫升' },
    ],
  },
  {
    cat: 'cafe',
    tpl_key: 'zhenzhu_naicha',
    dish_name: '珍珠奶茶（中杯）',
    lines: [
      { line_name: '红茶（茶包/茶叶）', qty: 5, unit: '克' },
      { line_name: '奶精（植脂末）', qty: 30, unit: '克' },
      { line_name: '白砂糖（或果糖）', qty: 20, unit: '克' },
      { line_name: '珍珠（木薯粉圆）', qty: 50, unit: '克' },
      { line_name: '水', qty: 300, unit: '毫升' },
    ],
  },
  {
    cat: 'cafe',
    tpl_key: 'ningmeng_cha',
    dish_name: '柠檬茶（中杯）',
    lines: [
      { line_name: '柠檬', qty: 50, unit: '克' },
      { line_name: '红茶（茶包/茶叶）', qty: 5, unit: '克' },
      { line_name: '白砂糖（或果糖）', qty: 25, unit: '克' },
      { line_name: '水', qty: 400, unit: '毫升' },
    ],
  },
  {
    cat: 'cafe',
    tpl_key: 'yangzhi_ganlu',
    dish_name: '杨枝甘露（中杯）',
    lines: [
      { line_name: '芒果', qty: 150, unit: '克' },
      { line_name: '西米', qty: 30, unit: '克' },
      { line_name: '椰浆', qty: 100, unit: '毫升' },
      { line_name: '白砂糖', qty: 15, unit: '克' },
    ],
  },

  // ===== 其他（R672 新增，6 道：卤味 / 凉菜 / 早餐）=====
  // 🔴 卤味的关键：**老汤是循环用的**，不是每次新配。所以「老汤」按"每份分摊量"填，
  //   而不是"每锅新汤量" —— 否则卤味成本会虚高几倍。
  //   补盐量取决于老汤用过多少次、蒸发多少，**给不了固定值**，老板按自家尝味定。
  {
    cat: 'other',
    tpl_key: 'lu_niurou',
    dish_name: '卤牛肉',
    lines: [
      { line_name: '牛腱子', qty: 200, unit: '克' },
      { line_name: '老汤（循环使用·按份分摊）', qty: 100, unit: '毫升' },
      { line_name: '卤料包（按份分摊）', qty: 5, unit: '克' },
      { line_name: '酱油', qty: 15, unit: '克' },
      { line_name: '盐（按老汤咸度补）', qty: 5, unit: '克' },
      { line_name: '姜', qty: 10, unit: '克' },
    ],
  },
  {
    cat: 'other',
    tpl_key: 'lu_jizhua',
    dish_name: '卤鸡爪',
    lines: [
      { line_name: '鸡爪', qty: 200, unit: '克' },
      { line_name: '老汤（循环使用·按份分摊）', qty: 80, unit: '毫升' },
      { line_name: '卤料包（按份分摊）', qty: 4, unit: '克' },
      { line_name: '酱油', qty: 12, unit: '克' },
      { line_name: '冰糖', qty: 5, unit: '克' },
      { line_name: '盐（按老汤咸度补）', qty: 4, unit: '克' },
    ],
  },
  {
    cat: 'other',
    tpl_key: 'liangban_muer',
    dish_name: '凉拌木耳',
    lines: [
      { line_name: '干木耳（泡发前）', qty: 20, unit: '克' },
      { line_name: '蒜', qty: 10, unit: '克' },
      { line_name: '保宁醋', qty: 15, unit: '克' },
      { line_name: '辣椒油', qty: 10, unit: '克' },
      { line_name: '酱油', qty: 8, unit: '克' },
      { line_name: '香菜', qty: 5, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
    ],
  },
  {
    cat: 'other',
    tpl_key: 'doujiang',
    dish_name: '豆浆（一碗）',
    lines: [
      { line_name: '黄豆（干）', qty: 50, unit: '克' },
      { line_name: '水', qty: 500, unit: '毫升' },
      { line_name: '白砂糖', qty: 10, unit: '克' },
    ],
  },
  {
    cat: 'other',
    tpl_key: 'youtiao',
    dish_name: '油条（一根）',
    lines: [
      { line_name: '面粉', qty: 100, unit: '克' },
      { line_name: '酵母/膨松剂', qty: 2, unit: '克' },
      { line_name: '盐', qty: 2, unit: '克' },
      { line_name: '水', qty: 60, unit: '毫升' },
      { line_name: '食用油（炸用·按根分摊）', qty: 15, unit: '克' },
    ],
  },
  {
    cat: 'other',
    tpl_key: 'baizhou',
    dish_name: '白粥（一碗）',
    lines: [
      { line_name: '大米', qty: 50, unit: '克' },
      { line_name: '水', qty: 500, unit: '毫升' },
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
// 🔴 R674：**按原料**给出净料率（出成率），不再靠品类一个值兜全部。
//
//   为什么必须按原料（三司会诊 2026-11-10 共识，我 + 豆包 + DeepSeek 一致）：
//     猪里脊 95% 和 整鱼 65% 差 30 个百分点，把它们都归到「热炒荤菜 85%」必然错；
//     品类粒度太粗 —— 同一品类里既有净料又有毛料，一个值必然一半偏一半欠。
//
//   取值原则：**一律取行业经验区间的下沿（保守）**。
//     出净率低估 ⇒ 净料单价算高 ⇒ 成本算高 ⇒ 老板不会误以为赚钱。
//     反向错误（成本算低）会让老板以为在赚、实际在亏，那个代价大得多。
//
//   ⚠️ 匹配顺序即优先级，先命中先返回。顺序不是随手排的，有三处必须靠前：
//     ① 「鸡精 / 辣椒油 / 蒸鱼豉油 / 番茄酱」含「鸡 / 辣椒 / 鱼 / 番茄」字样，
//        若按主料规则匹配会被当成整鸡、整鱼、鲜番茄 ⇒ 调料规则必须排第一。
//     ② 「牛肉末 / 猪肉末」含「牛 / 猪」，但它们是已加工净料（95%），
//        必须排在「普通肉 88%」之前。
//     ③ 「番茄酱」若排到「番茄 88%」之后也会错。
const YIELD_RULES = [
  // ① 纯调料 / 液体 / 腌制品 —— 采购即用，无择洗损耗
  { re: /油|盐|糖|醋|酱油|豉油|酱|料酒|淀粉|鸡精|花椒|辣椒|豆瓣|豆豉|香料|膨松剂|醪糟|可乐|纯净水|^水$|牛奶|椰浆|植脂末|茶叶|茶包|咖啡豆|老汤|卤料包|酸菜|酵母/, y: 100 },
  // ② 香辛料 —— 有去皮择洗损耗（用量小，差几分钱，不细究）
  { re: /姜|葱|蒜|香菜|泡椒|榨菜|芽菜/, y: 90 },
  // ③ 干货 —— 按干重称量，无损耗（「干木耳（泡发前）」也是这一类）
  { re: /大米|米饭|面粉|面条|碱面|红薯粉|粉丝|西米|木薯粉圆|馄饨皮|花生|黄豆|干木耳|木耳/, y: 100 },
  // ④ 已加工净肉 / 水产净料
  { re: /里脊|鸡胸|鸡腿肉|肉末|杂酱|肉馅|虾/, y: 95 },
  // ⑤ 禽类分割件（翅/爪已分割，损耗小）
  { re: /鸡翅|鸡爪/, y: 95 },
  // ⑥ 普通肉（带皮 / 带筋 / 带骨）
  // ⚠️ R677 补「羊」：原来只有牛/猪，羊肉（带皮/带骨）会掉到兜底 100 ⇒ 成本低估约 12%
  { re: /五花|牛腱|牛肉|排骨|羊肉|羊腿|羊排|羊杂/, y: 88 },
  // ⑦ 整鱼 —— 去鳞去内脏去骨，损耗最大的一类
  { re: /草鱼|黑鱼|鲈鱼|整鱼/, y: 65 },
  // ⑧ 叶菜 / 嫩茎 —— 择洗损耗大
  { re: /青菜|韭菜|菠菜|生菜|豆芽|四季豆/, y: 78 },
  // ⑨ 根茎 / 果实 —— 去皮去蒂
  { re: /土豆|胡萝卜|萝卜|茄子|番茄|青椒|洋葱|柠檬|芒果|豌豆/, y: 88 },
  // ⑩ 豆制品 / 蛋
  { re: /豆腐|豆干|鸡蛋|蛋$/, y: 98 },
];

// 兜底 100：没匹配上的视为「采购即用的净料」。宁可保守（100），也不乱猜一个折减值。
function yieldOf(name) {
  const s = String(name || '');
  for (let i = 0; i < YIELD_RULES.length; i += 1) {
    if (YIELD_RULES[i].re.test(s)) return YIELD_RULES[i].y;
  }
  return 100;
}

function applyTemplate(tpl) {
  return (tpl && Array.isArray(tpl.lines) ? tpl.lines : []).map((l) => ({
    line_name: String((l && l.line_name) || ''),
    qty: l && l.qty,
    unit: String((l && l.unit) || ''),
    // 🔴 R674：出净率**跟着行一起走**，不再靠「品类默认值」兜
    //   —— 这是「删掉『这道菜属于哪类』」的前置条件：品类删了，行必须自己知道损耗。
    //   行上若显式写了 yield_rate（个别原料要特例）则以它为准，否则按原料规则表推。
    yield_rate: (l && l.yield_rate) || yieldOf(l && l.line_name),
  }));
}

// 🔴 R676（李老师：「删完品类，老板面对空白配料区不知道填什么」）：
//   老板输完菜名 → 自动匹配模板库 → 提示「检测到「宫保鸡丁」，要套用吗？」
//   这是**替代品类选择器**的入口引导（品类已删，R675）。
//
//   匹配规则故意做**严**（只认归一化后相等），不接受包含匹配：
//     「宫保鸡丁盖饭」≠「宫保鸡丁」—— 盖饭还要加米饭，套上宫保模板会**漏掉米饭成本**；
//     「牛肉面」≠「红烧牛肉面」—— 两者配料不同。
//   **宁可少提示，不能给错**：不提示的代价是老板自己填（他知道自己卖什么），
//   给错的代价是一张成本错的卡（而且他看不出来）。
function normDishName(v) {
  return String(v == null ? '' : v)
    .replace(/（[^）]*）/g, '')   // 全角括号及其内容（如「重庆小面（素面）」→「重庆小面」）
    .replace(/\([^)]*\)/g, '')   // 半角括号
    .replace(/\s+/g, '')         // 所有空白
    .trim();
}

/**
 * 按菜名找模板（纯读）。
 * @returns {object|null} 命中返回模板对象，否则 null（**不猜**）
 */
function matchTemplateByName(name) {
  const n = normDishName(name);
  if (!n) return null;
  for (let i = 0; i < TEMPLATES.length; i += 1) {
    if (normDishName(TEMPLATES[i].dish_name) === n) return TEMPLATES[i];
  }
  return null;
}

// 🔴 R677：**候选提示** —— 老板输「牛油锅底」时，库里有「自制牛油锅底」和「外购牛油锅底」两道。
//   精确匹配必然落空（两个都不完全等于输入），但**直接说"库里没有"是错的** —— 明明有。
//   所以多一层：找出「模板名里包含输入」或「输入里包含模板名」的所有模板，
//   交给页面去说「库里有 2 个相关的，请从上面挑」，而不是让老板以为没有。
//   ⚠️ 只在**精确匹配落空时**用，且**不自动套用** —— 有歧义时机器不能替老板选
//      （自制和外购的成本结构完全不同，选错了整张卡都错）。
function suggestTemplates(name) {
  const n = normDishName(name);
  if (!n || n.length < 2) return [];      // 单字太宽（"面""鸡"会命中一片），不猜
  return TEMPLATES.filter((t) => {
    const tn = normDishName(t.dish_name);
    return tn !== n && (tn.indexOf(n) >= 0 || n.indexOf(tn) >= 0);
  });
}

// R671：额外导出「按大类分组」的读法 —— 页面两级选择用这它，不用自己 group
function templatesByCat(catKey) {
  return TEMPLATES.filter((t) => !catKey || t.cat === catKey);
}

module.exports = { TEMPLATES, TEMPLATE_CATS, templatesByCat, getTemplate, applyTemplate, yieldOf, matchTemplateByName, suggestTemplates, normDishName };
