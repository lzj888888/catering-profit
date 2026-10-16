// utils/bizPreset.js —— M2v1.3 · 业态参数包 + 入参装配（纯数据 + 纯函数，仓根 utils/）
//
// 🔴 纯前端常量 / 纯函数：**零 `wx.*`、零网络、零 `getApp()`、零 require 云函数代码**。
//   本文件是「用户输入(5 个数) + 参数包 → 引擎入参(fixed_items/var_items)」的**唯一装配入口**。
//
// 🔴 分层边界（开发规范 v1.3 §二-3）：
//   · 本层做的是**入参装配**（用户输入 → 引擎入参），**不是结果计算** —— 输出只有
//     `{ fixedItems:[{key,fen}], varItems:[{key,pct}] }`，**绝不**出现保本 / 毛利 / 摊销算式。
//   · **展示数字一律直接读引擎出参**；唯一合法例外 = `paybackCash`（§五-2 的一次除法，只读展示、不回写）。
//   · 🔴 折旧/建店投入**只能**经 `buildRef` → 引擎 `buildItems`（引擎算摊销）；
//     **严禁**在 `costMeta` 里塞一笔月折旧进 `fixed_items`（会与 buildItems 摊销**双计**）。
//
// 🔴 命名口径：本文件是前端本地常量（**不入库**），用 **camelCase**；
//   一旦落进 `param_json` 必须转 **snake_case**（v1.2 §4.2 红线不变）。
// 🔴 城市系数：`coef` 从生产源 `cloudfunctions/common/indicatorRef.js::CITY_TIERS` 取
//   （tier1 {rent:1.20, labor:1.15} / tier23 {rent:1.00, labor:1.00} / county {rent:0.75, labor:0.85}）。
//   前端不便 require 云函数 ⇒ 以下 **CITY_COEF 是复刻**，单源出处已加注释（规范 §4.3 允许、且必须两键都带）。

// 🔴 城市系数（复刻自 `cloudfunctions/common/indicatorRef.js::CITY_TIERS`，仅此一处前端来源）。
//   三档都要带 **rent + labor 双键**（漏乘 labor ⇒ 一线固定成本退回与二三线相同，保本偏低）。
const CITY_COEF = {
  tier1:  { rent: 1.20, labor: 1.15 },   // 一线 / 新一线
  tier23: { rent: 1.00, labor: 1.00 },   // 二三线（基准）
  county: { rent: 0.75, labor: 0.85 },   // 县城 / 乡镇
};

// 🔴 P1-②（2026-10）：占营收率成本（utility/manage）合规落点修正的「房租兜底」。
//   背景：原实现把它们写成 form:'revenue_rate' ⇒ 被 assembleItems 塞进 var_items，
//   但 validate 的 VAR_KEYS 仅放行 4 键（takeawayComm/grouponComm/cardFee/other），
//   utility/manage 不在其中 ⇒ 整条 preset 测算被拒（INVALID_PARAM），链路从根上不通；
//   矩阵批量分支绕过 validate 能出数，但 mkt 被 utility+manage 虚高、energy/manage 指标因
//   fixedFen 无值恒 null（两路口径矛盾）。
//   修法（方案 B，合规 R188「严禁给 VAR_KEYS 加新键」）：utility/manage 改走 fixed_items
//   （它们本就在 FIXED_KEYS），由「房租 × 房租占比(rentPct)」派生固定额；房租缺失（找店/反推
//   模式未填 rentYuan）⇒ 用本兜底额 × 城市系数 派生。energy/manage 指标改从 fixedFen 正确算出，
//   mkt 仅含合法 var 项（'other' 费率），整条 preset 链路 unblock，引擎零改动、51 副本零重部署。
//   ⚠️ 已知权衡：保本点把水电/管理当固定（轻微偏高保本），但无静默错、链路通、单源零漂移。
//
// 🔴🔴 R292 修正（**本条是 R292 老板视角实跑抓出的 P0 回归**）：`rentPct` 的语义澄清 + 数值重定。
//   原实现（P1-②）把「占**营收** X%」直接写成了「房租 × X%」，数值沿用原 pct（5/7/4/2）未换算
//   ⇒ 分母从「营收」换成「房租」，而房租只占营收 7~12% ⇒ **水电/管理被系统性低估 8~16 倍**。
//   实测（R292 探针）：县城小面馆水电算出 ¥150/月、川菜正餐 ¥320/月、烧烤 ¥500/月 —— 荒谬，
//   且**直接后果是保本营业额被严重低估**（小面馆算出「月做 1.6 万即保本」，真实需 3 万+），
//   属于「给老板一个乐观到离谱的数字」这一最危险的错误类型。
//   修正口径：装配层拿不到营收（营收是算出来的），而**房租与营收强相关** ⇒
//     rentPct = 目标占营收率 ÷ 该业态房租占营收率（BANDS.rent 中值）
//   例 fastfood：房租占营收 7.5%（BANDS.rent[5,10] 中值）⇒ 营收 ≈ 房租 × 13.3；
//     水电取 3%（energy[2,4] 中值）⇒ 3% × 13.3 = **房租的 40%** ⇒ rentPct = 40。
//   ⚠️ 误差来源：当房租占比偏离带中值时（如一线铺面贵到 12%），派生值会同步偏高 ——
//     方向是「房租贵 ⇒ 面积/规模大 ⇒ 水电高」，属合理同向，已在此写明，非静默错。
//   ⚠️ R292 当时把 src 标为 **'E'（经验折算，待校准）** —— 因为「占营收率」那一头是我方自定值。
//
// 🔴🔴 R293（李老师 2026-10-14 拍板：「咱们数据库有的指数，比如各种占比，按咱们的指数走」）：
//   占营收率的**分子一律取 BANDS 指数中值**，**禁止自定**（此前 manage 用 2.5%~3.5%，
//   而 BANDS.manage 中值是 **7.5%** ⇒ 管理费被低估 2~3 倍，保本点偏乐观）。
//   推导式（`ind` = energy | manage）：
//     rentPct = BANDS[biz][ind] 中值 ÷ BANDS[biz].rent 中值 × 100
//   各业态结果（BANDS 中值：rent / energy / manage）：
//     fastfood 7.5 / 3 / 6 ⇒ utility 40 · manage **80**
//     dining   11.5 / 4 / 6 ⇒ utility 35 · manage **52**
//     hotpot   11.5 / 5 / 6 ⇒ utility 43 · manage **52**
//     cafe      8.5 / 2 / 6 ⇒ utility 24 · manage **71**
//     other      10 / 3.5 / 6 ⇒ utility 35 · manage **60**
//   ⇒ src 由 'E' 改为 **'B'（BANDS 指数派生）**；**不再有自定占比**。
//   ⚠️ 已知代价（诚实标注）：BANDS.manage [4,8] 是**连锁口径**（含总部管理费/系统/办公/招待），
//     小微单店真实管理杂费约 1~4% ⇒ 按库中值执行后管理费等额偏高，**方向是保守（保本偏高）**，
//     不是乐观偏差。若要贴近单店实际，须改 BANDS.manage（单源，改它要同步重部署 51 份副本）。
//   🔴 防漂移：`tools/check_biz_preset.js` G 段机器校验 rentPct ≡ BANDS 推导值（改 BANDS 即红）。
const RATE_COST_FLOOR = { fastfood: 8000, hotpot: 12000, dining: 12000, cafe: 8000, other: 10000 };

// ===== 九个预设（🔴 照抄开发规范 v1.3 §3.4-bis，数值不得自创；R287 整改：删火锅浇头面、补正餐细分）=====
// 取值来源标记 src：P=项目方 BP · D1=权威参考带 · S=我方自定 · U=用户填
const BIZ_PRESETS = [
  // 1) 面馆（小面 / 米线 / 面条 / 拉面）—— [P] 小面测算.xlsx；R287 合并「小面+面条」归小吃快餐，统称面馆；人工走人头线性 ⇒ 规模可伸缩
  {
    presetKey: 'fastfood_noodle', bizKey: 'fastfood', paybackView: 'cash',
    // 🔴 R293：毛利率 55%（BP 实测）落在 BANDS.fastfood.grossMargin [58,68] **带外**
    //   ⇒ 老板一进来就被判「毛利率偏低」（误判），且保本按偏低的毛利算。**按库指数走** ⇒ 取带中值 63%。
    //   ⚠️ 若李老师更信 [P] 小面 BP 实测 55%，改回即可（代价：仍会被参考带判 warn）。
    params: { grossMarginPct: { v: 63, src: 'B' }, laborUnitYuan: { v: 4500, src: 'S' },
      avgPriceYuan: { v: 12, src: 'P' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'labor_total', src: 'U' },              // 直接填人工总额（不×人数/不×系数）
      // R293：rentPct **一律取 BANDS 指数中值**（推导见 RATE_COST_FLOOR 处，禁自定）：
      //   utility 3%（BANDS.energy[2,4] 中值）÷ 房租 7.5%（BANDS.rent[5,10] 中值）= 40%
      //   manage 6%（BANDS.manage[4,8] 中值）÷ 7.5% = 80%
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 40, src: 'B' },
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 80, src: 'B' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'P', labelKey: 'costLoss' },
    ],
  },
  // 3) 火锅（半自助）/ 卤鸡火锅 —— [P] 卤鸡火锅 BP；含建店投入参考
  {
    presetKey: 'hotpot_half_self', bizKey: 'hotpot', paybackView: 'cash',
    params: { grossMarginPct: { v: 53, src: 'P' }, openDays: { v: 30, src: 'P' } },   // 标准 60% → 实际 53%（自助浪费）
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'fixed', defaultYuan: 25000, src: 'P' },   // 2.5 万
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 43, src: 'B' },  // 火锅业态能耗：房租×占比反推（找店兜底）
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'P', labelKey: 'costLoss' },    // 🔴 P1-② fixed→var：使 mkt 非 0（与全局 other 口径一致）
      // R293：manage 6%（BANDS.manage[4,8] 中值）÷ 11.5%房租 = 52%
      //   （utility 保持下方 BP 实测绝对额 7500，不折算）
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 52, src: 'B' },
    ],
    // 🔴 折旧只能走这里：投资 26.2 万，BP 口径月摊销 0.61 万 ⇒ 等效年限 3.579234972677596 年。
    // 🔴🔴 R292 修正（**P0 功能性 BUG，老板视角实跑抓出**）：原写法 `years: 3.579…`（小数）
    //   会被 `calcSandbox/validate.js` 判红（`years 必须是 1~20 的整数`）⇒ **整个「火锅半自助」
    //   预设正算/反推两路都被拒**，老板一选这个业态点测算就报「填写错误」，预设完全不可用。
    //   修法：拆成**两笔整数年限**，使总投资与月摊销都与原 BP **精确相等**（锚点零漂移）：
    //     decor 15.6 万 ÷ (3×12) = 4,333.33 元/月
    //     equip 10.6 万 ÷ (5×12) = 1,766.67 元/月
    //     合计 26.2 万 / 6,100.00 元/月 —— 与 BP 的 0.61 万逐分吻合。
    //   ⚠️ 为什么不用「years 取整 3」：那会让月摊销变 7,277.78（偏离 BP 19%）；
    //      为什么不用「改 validate 收小数」：契约层 years 整数是既有约定，动它要重部署云函数。
    //      ⇒ 拆笔是**零部署、零漂移、零契约改动**的唯一解。
    buildRef: [
      { key: 'decor', fen: 15600000, years: 3, src: 'P' },   // 装修 15.6 万，按 3 年翻新周期
      { key: 'equip', fen: 10600000, years: 5, src: 'P' },   // 设备 10.6 万，按 5 年直线折旧
    ],
  },
  // 4) 烧烤 —— [D1] 参考带（BANDS.hotpot；「烧烤」不新增第 5 类，属 hotpot）
  {
    presetKey: 'hotpot_barbecue', bizKey: 'hotpot', paybackView: 'cash',
    params: { grossMarginPct: { v: 59, src: 'D1' }, laborUnitYuan: { v: 5000, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'labor_total', src: 'U' },
      // R293：utility 5%（BANDS.energy[4,6] 中值）÷ 11.5%房租 = 43%；manage 6% ÷ 11.5% = 52%
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 43, src: 'B' },
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 52, src: 'B' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
  // 5) 川菜 / 中餐 —— [D1] 参考带
  {
    presetKey: 'dining_sichuan', bizKey: 'dining', paybackView: 'invest',
    params: { grossMarginPct: { v: 60, src: 'D1' }, laborUnitYuan: { v: 5500, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'labor_total', src: 'U' },
      // R293：utility 4%（BANDS.energy[3,5] 中值）÷ 11.5%房租 = 35%；manage 6% ÷ 11.5% = 52%
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 35, src: 'B' },
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 52, src: 'B' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
  // 5b) 湘菜 —— [D1] 参考带（正餐系，bizKey=dining，与川菜同参考带；R287 补正餐细分）
  {
    presetKey: 'dining_xiang', bizKey: 'dining', paybackView: 'invest',
    params: { grossMarginPct: { v: 60, src: 'D1' }, laborUnitYuan: { v: 5500, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'labor_total', src: 'U' },
      // R293：utility 4%（BANDS.energy[3,5] 中值）÷ 11.5%房租 = 35%；manage 6% ÷ 11.5% = 52%
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 35, src: 'B' },
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 52, src: 'B' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
  // 5c) 粤菜 —— [D1] 参考带
  {
    presetKey: 'dining_yue', bizKey: 'dining', paybackView: 'invest',
    params: { grossMarginPct: { v: 60, src: 'D1' }, laborUnitYuan: { v: 5500, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'labor_total', src: 'U' },
      // R293：utility 4%（BANDS.energy[3,5] 中值）÷ 11.5%房租 = 35%；manage 6% ÷ 11.5% = 52%
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 35, src: 'B' },
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 52, src: 'B' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
  // 5d) 家常菜 —— [D1] 参考带
  {
    presetKey: 'dining_jiachang', bizKey: 'dining', paybackView: 'invest',
    params: { grossMarginPct: { v: 60, src: 'D1' }, laborUnitYuan: { v: 5500, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'labor_total', src: 'U' },
      // R293：utility 4%（BANDS.energy[3,5] 中值）÷ 11.5%房租 = 35%；manage 6% ÷ 11.5% = 52%
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 35, src: 'B' },
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 52, src: 'B' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
  // 6) 新式茶饮 —— [D1] 参考带
  {
    presetKey: 'cafe_tea', bizKey: 'cafe', paybackView: 'invest',
    params: { grossMarginPct: { v: 67, src: 'D1' }, laborUnitYuan: { v: 4500, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'labor_total', src: 'U' },
      // R293：utility 2%（BANDS.energy[1,3] 中值）÷ 8.5%房租 = 24%；manage 6% ÷ 8.5% = 71%
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 24, src: 'B' },
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 71, src: 'B' },
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
  // 7) 其他 / 通用餐饮 —— 🔴 round276 新增**通用兜底**：老板开的店不在上面 8 个预设里时的诚实出口。
  //    bizKey='other' ⇒ 走 indicatorRef.BANDS.other（4 类带的保守并集，标注"未细分行业"）。
  //    参数全部取通用中位（非特定行业）：人工直接填总额（多数业态适用）、各项 revenue_rate 取并集区间中值。
  //    ⚠️ 这是"系统给初值、用户可改"的默认值，**不承担计算口径**（用户改了就以用户的为准）。
  {
    presetKey: 'other', bizKey: 'other', paybackView: 'invest',
    params: { grossMarginPct: { v: 60, src: 'S' }, laborUnitYuan: { v: 5000, src: 'S' }, openDays: { v: 30, src: 'P' } },
    costMeta: [
      { itemKey: 'rent', form: 'fixed', src: 'U' },
      { itemKey: 'labor', form: 'labor_total', src: 'U' },
      { itemKey: 'utility', form: 'energy_split', derivedFrom: 'rent_rate', rentPct: 35, src: 'B' },  // 3.5%（energy[1,6] 中值）÷ 10%（rent[5,15] 中值）
      { itemKey: 'manage', form: 'fixed_opt', derivedFrom: 'rent_rate', rentPct: 60, src: 'B' },   // 6%（manage[4,8] 中值）÷ 10% = 60%
      { itemKey: 'other', form: 'revenue_rate', pct: 2, src: 'S', labelKey: 'costLoss' },
    ],
  },
];

const FORMS = ['fixed', 'area_linear', 'headcount_linear', 'revenue_rate', 'step', 'labor_total', 'energy_split', 'fixed_opt'];

// ===== R234 · 业态预设**平铺**所需的两张派生表 =====
//
// 🔴 背景（李老师 2026-10-07 原话）：「业态预设里面只有川菜 中餐。还有一个不确定 手填全部。」
//   根因不是数据少了 —— 6 个预设**都在**，而是 `syncPresetOptions()` 按上一级「经营类型」
//   （4 大类）过滤：**快餐 2 / 火锅 2 / 正餐 1 / 茶饮 1**，选「中式正餐」后下拉自然只剩 1 项。
//   ⇒ 治法：**大类只用于后端取 `BANDS`，不该让用户先答**（用户只想答「我开什么店」）。
//
// 🔴 `bizKeyOfPreset`：选完预设后由**系统**把它映射回 4 个大类之一，`BANDS` 零改动。
//   为什么必须留这张表：**指标参考带只有 4 套**（分业态），而预设是 6 个 ——
//   若删了映射，6 个预设就得写 6 套 BANDS，等于推翻单源。
function bizKeyOfPreset(presetKey) {
  const hit = BIZ_PRESETS.filter((p) => p.presetKey === presetKey)[0];
  return hit ? hit.bizKey : null;
}

// ===== R237 · 单桌座位数（业态默认）—— 「桌数 → 座位数」的**唯一换算系数** =====
//
// 🔴 背景（李老师 2026-10-08 原话）：「餐饮老板算账都是按桌数来算……桌数只能推论或者顾客自己选填最准」。
//   引擎入参 `seats`（座位数）**名字与形状一字不改** ⇒ 前端把用户填的「桌数」按本表换成座位数再送引擎，
//   **引擎零改动、锁定锚点零漂**（合计仍等于 20 ⇒ 输出仍 3.70）。
//
// 🔴 src='S' + 豆包第 4 轮同行经验估值（**待真实样本校准**）：这是"系统给初值、用户可改"的默认值，
//   **不承担任何计算口径**（用户改了就以用户的为准）。依据：火锅/正餐多为 4 人方桌圆桌；
//   快餐/小面是长条拼桌、单人居多；茶饮堂食位少且以外带为主。
const SEATS_PER_TABLE = {
  fastfood: 2,   // 小面 / 米线 / 快餐：长条拼桌，单人居多
  dining:   4,   // 川菜 / 中餐：4 人方桌圆桌为主（包间多可手动调大）
  hotpot:   4,   // 火锅 / 烧烤：4 人桌为主
  cafe:     2,   // 新式茶饮：堂食位少，以外带为主
  other:    4,   // 通用兜底：取餐饮中位（与 seatsPerTableOf 的未知业态默认值一致）
};

// ===== R237 · 翻台口径分组（豆包第 4 轮裁定）=====
//
// 🔴 「翻台」= 翻**桌**（桌台），分母是桌数；「座位周转」= 翻**椅**，分母是座位数。
//   两者只在"每桌坐满"时数值相等 —— 豆包第 5 轮给了反例（2 桌 8 座、日客流 8 人全单人：
//   桌周转 4、座位周转 1）。M2 是**事前反推**（不是收银事后统计），豆包裁定：
//   「M2 使用【假设满座】简化模型是合理取舍，牺牲一部分真实经营的精细度，
//     换取小白能理解、引擎不动、锚点不漂移。M1 事后复盘才需要区分满座率。」
//   ⇒ 引擎只算一套，**前端按业态切话术 + 切阈值**。
//
// ⚠️ 因此：本表内的业态，前端才允许出现「翻台」二字（一律说「桌周转」）；
//   其余业态（快餐/小面/茶饮）**禁用「翻台」**，只说「座位周转」。
const TURN_BIZ_TABLE = ['hotpot', 'dining'];

// ===== R237 · 翻台难度阈值（**自定值，待校准**）=====
//
// 🔴 src='S'（我方自定 + 豆包同行经验估值）：豆包第 4 轮**自己标注**了「以下阈值属于餐饮一线
//   经验估值，作为系统自定值，非行业强制标准，可后续由你们微调」。⇒ 按 R225 第 5 条处理：
//   写明自定 + 理由 + 回退方法（改下面两行即可推翻），**不当权威源采信**。
//
// ⚠️ 这是**展示层分档**，不参与任何金额计算 ⇒ 误设也不会算错钱。
const TURN_THRESHOLD = {
  table: { easyMax: 1.8, okMax: 2.8 },   // 每日桌周转：≤1.8 轻松 / 1.8~2.8 有点难 / >2.8 很难
  seat:  { easyMax: 2.5, okMax: 4.0 },   // 每日座位周转：≤2.5 轻松 / 2.5~4.0 有点难 / >4.0 很难
  // 🔴 R292 新增**业态维**（老板视角实跑抓出的误导性提示）：
  //   反推实测「县城小面馆」座位周转 5.36 ⇒ 套统一 seat 档（>4.0）被判 **hard「这数偏高，店里得
  //   真忙得起来」**—— 但快餐/小面翻座 5~6 次/天本就是常态（吃完就走），这句提示是**吓跑老板**，
  //   与事实相反。根因：原表只有 table/seat 两档，**未按业态区分**快餐与正餐的天然周转差异。
  //   ⇒ 新增业态键（与各自口径配套：hotpot/dining 用桌档值、fastfood/cafe 用放宽后的座位档值），
  //     旧两键**保留**（`turnLevelOf` 签名与行为一字不变 ⇒ 既有守卫 F-④ 不红、老调用方零漂移）。
  fastfood: { easyMax: 4.0, okMax: 6.5 },  // 快餐/小面：吃完即走，翻座 4~6 属常态
  cafe:     { easyMax: 5.0, okMax: 8.0 },  // 茶饮：外带为主，座位周转天然更高
  hotpot:   { easyMax: 1.8, okMax: 2.8 },  // 火锅/烧烤：桌周转（与 table 档同值）
  dining:   { easyMax: 1.8, okMax: 2.8 },  // 正餐：桌周转（与 table 档同值）
  other:    { easyMax: 2.5, okMax: 4.0 },  // 通用兜底：取中位
};

/**
 * 🔴 R292 · 按**业态**分档（推荐入口）。
 *  与 `turnLevelOf(mode, …)` 的区别：那个按「桌/座」口径查通用档；本函数按业态查**细分档**
 *  （快餐/茶饮的座位周转天然高于正餐，套通用档会把常态判成「很难」）。
 * @returns {'easy'|'ok'|'hard'|''}
 */
function turnLevelOfBiz(bizKey, value) {
  return turnLevelOf(bizKey, value);   // 查表键即业态名（TURN_THRESHOLD 已含业态维）；未命中回落 seat 档
}

/** 业态默认「一桌坐几人」。未知业态 ⇒ 4（餐饮通用中位）。 */
function seatsPerTableOf(bizKey) {
  const v = SEATS_PER_TABLE[bizKey];
  return v > 0 ? v : 4;
}

/** 翻台口径：'table'（桌周转，**可说「翻台」**）/ 'seat'（座位周转，**禁用「翻台」二字**）。 */
function turnModeOf(bizKey) {
  return TURN_BIZ_TABLE.indexOf(bizKey) >= 0 ? 'table' : 'seat';
}

/**
 * 翻台难度分档。**纯展示层**，不参与测算。
 * @param {'table'|'seat'} mode 口径
 * @param {number} value 每日周转值（引擎 `turn_rate`）
 * @returns {'easy'|'ok'|'hard'|''} 空串 = 无值 / 非有限数（**不编造**）
 */
function turnLevelOf(mode, value) {
  // 🔴 R237-锚点实测修掉的真缺陷：`Number(null) === 0`、`Number('') === 0` ⇒ 若不先挡空值，
  //   引擎红警时返回的 `turn_rate: null` 会被分档成 **'easy'**，页面渲染出
  //   「这个水平，正常做着就能到」—— 这是**最坏的一类静默错**（把"算不出来"说成"很轻松"）。
  //   ⇒ 空值一律返回空串（页面据此不渲染难度行）。
  if (value == null || value === '') return '';
  const v = Number(value);
  if (!isFinite(v)) return '';
  const t = TURN_THRESHOLD[mode] || TURN_THRESHOLD.seat;
  if (v <= t.easyMax) return 'easy';
  if (v <= t.okMax) return 'ok';
  return 'hard';
}

function fenOf(yuan) {
  const n = Number(yuan);
  return Number.isFinite(n) ? Math.round(Number((n * 100).toFixed(10))) : 0;
}

/**
 * 🔴 **唯一入参装配函数**（cost_meta 形态运算只准出现在这里）。
 * @param {object} preset 参数包预设（BIZ_PRESETS 的一项）
 * @param {object} input   用户输入：{ area, headcount, rentYuan, laborTotalYuan, waterYuan, electricYuan, gasYuan, fixedYuan:{itemKey:yuan}, buildItems:[] }
 * @param {object} coef    城市系数：{ rent, labor }（来自 CITY_COEF，或云函数 CITY_TIERS 实读物）
 * @returns {{fixedItems:Array<{key,fen}>, varItems:Array<{key,pct}>}}
 *   —— 输出与引擎入参**完全同形**，本函数内**不得出现任何保本/毛利/摊销算式**。
 */
function assembleItems(preset, input, coef) {
  const p = preset || {};
  const in_ = input || {};
  const co = coef || {};
  const fixedItems = [];
  const varItems = [];
  const costMeta = Array.isArray(p.costMeta) ? p.costMeta : [];
  // 房租（分）：用户填的已知（页面 input.rentYuan）；找店/反推模式未填 ⇒ 0（下方走 floor 兜底）
  const rentFenRaw = in_.rentYuan != null ? fenOf(in_.rentYuan) : 0;
  const bizKey = p.bizKey;

  for (const m of costMeta) {
    const form = m.form;
    if (form === 'fixed') {
      // 用户填了 ⇒ 用它的（src='U'，**不乘** coef）；没填且有 defaultYuan ⇒ 参数包供给（**乘** coef[对应项]）
      const userVal = in_.fixedYuan ? in_.fixedYuan[m.itemKey] : undefined;
      if (userVal !== undefined && userVal !== null && userVal !== '') {
        fixedItems.push({ key: m.itemKey, fen: fenOf(userVal) });
      } else if (m.derivedFrom === 'rent_rate') {
        // 🔴 P1-②：占营收率成本（utility/manage）合规落点 —— 由「房租 × 房租占比(rentPct)」派生固定额。
        //   房租缺失（找店/反推模式未填 rentYuan）⇒ 用 RATE_COST_FLOOR[bizKey] × 城市系数 兜底。
        //   房租已知（用户填 rentYuan）⇒ base=房租分；两者都走 fixed_items（utility/manage 本就在
        //   FIXED_KEYS），与 R188「严禁给 VAR_KEYS 加新键」一致，引擎零改动、51 副本零重部署。
        const base = rentFenRaw > 0 ? rentFenRaw
          : Math.round(fenOf(RATE_COST_FLOOR[bizKey] || 10000) * (co.rent || 1));
        const fen = Math.round(base * (Number(m.rentPct) || 0) / 100);
        if (fen > 0) fixedItems.push({ key: m.itemKey, fen });
      } else if (m.defaultYuan != null) {
        const c = co[m.itemKey] || 1;          // labor→co.labor / rent→co.rent；utility/manage/other 无对应键 ⇒ ×1
        fixedItems.push({ key: m.itemKey, fen: fenOf(Number(m.defaultYuan) * c) });
      }
      // src='U' 且用户没填、又无 defaultYuan/derivedFrom ⇒ 跳过（不编造）
    } else if (form === 'area_linear') {
      // 🔴 不乘 coef（参数已是元/㎡ 绝对成本；城市差异走分城参数包，乘系数 = 双重折算）
      const a = Number(in_.area) || 0;
      fixedItems.push({ key: m.itemKey, fen: fenOf(Number(m.baseYuan) + Number(m.perSqmYuan) * a) });
    } else if (form === 'headcount_linear') {
      // 单价：**用户填了就用用户的**（L2「员工月均工资」），没填才回落参数包预设。
      // 🔴 round276 修的静默错：此前**恒读** `params.laborUnitYuan.v` ⇒ 用户在 L2 把工资从
      //   4500 改成 6000，保本点纹丝不动（改了触发重算、结果零变化，用户以为是自己看错）。
      //   参数包值仍作**兜底**（选预设时会把预设值写回 L2 输入框 ⇒ 老路径结果一字不漂）。
      //   ⚠️ 入参只是**新增一个可选字段**，老调用方不传 ⇒ 走兜底分支 ⇒ 行为完全不变。
      const u = Number(in_.laborUnitYuan);
      const unit = u > 0 ? u : (p.params && p.params.laborUnitYuan ? Number(p.params.laborUnitYuan.v) : 0);
      const hc = Number(in_.headcount) || 0;
      // 🔴 R296-E（P1-③）：手填实际工资**不乘**城市系数（它已是当地真值，乘系数会失真）；
      //   仅回落到预设基准工资时才乘 co.labor（一线人工绝对成本高，基准需按城折算）。
      //   此前恒乘 co.labor ⇒ 县城手填 3200 被压成 2720，与第 378 行"用户填了就用用户的"自相矛盾。
      const laborMul = u > 0 ? 1 : (co.labor || 1);
      fixedItems.push({ key: m.itemKey, fen: fenOf(unit * laborMul * hc) });
    } else if (form === 'labor_total') {
      // 🔴 拍1（李老师 2026-10）：人工 = 用户**直接填总额**，不乘人数、不乘城市系数
      //   （人数是给人效展示用的，不是用来乘出工资 —— 各店工资不同，乘法会失真）。
      //   ⚠️ 兜底：**空 / 0 / 非正数** ⇒ 一律回落「人数 × 人均(参数包或 L2) × 城市系数」旧估算，
      //      避免人工=0 把保本点乐观化（R292 同族危险）。有填正数 ⇒ 一律用用户的。
      //   🔴 为什么 `n <= 0` 也要兜底（不只是空串）：前端 `Number(v) || 0` 会把空串变 0，
      //      若只挡空串，0 会掉进「if 成立但 n>0 不成立」的夹缝 ⇒ 人工=0 静默乐观化。
      const userLabor = in_.laborTotalYuan;
      const n = (userLabor !== undefined && userLabor !== null && userLabor !== '') ? Number(userLabor) : 0;
      if (n > 0) {
        fixedItems.push({ key: m.itemKey, fen: fenOf(n) });
      } else {
        const u = Number(in_.laborUnitYuan);
        const unit = u > 0 ? u : (p.params && p.params.laborUnitYuan ? Number(p.params.laborUnitYuan.v) : 0);
        const hc = Number(in_.headcount) || 0;
        const laborMul = u > 0 ? 1 : (co.labor || 1);
        fixedItems.push({ key: m.itemKey, fen: fenOf(unit * laborMul * hc) });
      }
    } else if (form === 'energy_split') {
      // 🔴 拍3（李老师 2026-10）：水/电/气三拆分（库内 ITEM_TAGS.energy = 水费/电费/燃气费，1:4:3）。
      //   有店 ⇒ 填实数，三数都 >0 则求和进 utility 引擎键（不改 FIXED_KEYS，引擎零改动）；
      //   找店小白未填实数 ⇒ 房租 × 占比(rentPct) 反推总额兜底（与旧 derivedFrom 同口径）。
      const fy = in_.fixedYuan || {};
      const w = Number(in_.waterYuan != null ? in_.waterYuan : fy.water);
      const elec = Number(in_.electricYuan != null ? in_.electricYuan : fy.electric);
      const gas = Number(in_.gasYuan != null ? in_.gasYuan : fy.gas);
      if (w > 0 && elec > 0 && gas > 0) {
        fixedItems.push({ key: m.itemKey, fen: fenOf(w + elec + gas) });
      } else if (m.derivedFrom === 'rent_rate') {
        const base = rentFenRaw > 0 ? rentFenRaw
          : Math.round(fenOf(RATE_COST_FLOOR[bizKey] || 10000) * (co.rent || 1));
        const fen = Math.round(base * (Number(m.rentPct) || 0) / 100);
        if (fen > 0) fixedItems.push({ key: m.itemKey, fen });
      }
    } else if (form === 'fixed_opt') {
      // 🔴 拍2（李老师 2026-10）：管理费这类「有的店有、有的店没有」的项 —— 可选填。
      //   判定依据 = **键是否存在**于 `fixedYuan`（不是"值是否为空"）：
      //     · 键存在（含 '' / 0 / '0'）⇒ 用户**已作答**（显式留空或填 0 = 单店通常无管理费）
      //       ⇒ 一律「不评」（不兜底、不虚高）。填了 >0 ⇒ 用用户的。
      //     · 键**缺失**（矩阵/找店批量调用方压根不传 manage）⇒ 才走「房租×占比」推荐值兜底（保守不乐观）。
      //   🔴 修的是真 Bug：旧写法 `(m.itemKey in fy2) ? fy2[itemKey] : undefined` 后判 `uv !== ''`，
      //      当前端留空传 `''`（键在）时 `uv === ''` 落进 else-if ⇒ **反而加上推荐管理费**，与拍2 相反。
      const fy2 = in_.fixedYuan || {};
      if (m.itemKey in fy2) {
        const uv = fy2[m.itemKey];
        if (uv !== undefined && uv !== null && uv !== '' && Number(uv) > 0) {
          fixedItems.push({ key: m.itemKey, fen: fenOf(Number(uv)) });
        }
        // 键在但空/0/非数 ⇒ 不评（不加任何固定成本）
      } else if (m.derivedFrom === 'rent_rate') {
        const base = rentFenRaw > 0 ? rentFenRaw
          : Math.round(fenOf(RATE_COST_FLOOR[bizKey] || 10000) * (co.rent || 1));
        const fen = Math.round(base * (Number(m.rentPct) || 0) / 100);
        if (fen > 0) fixedItems.push({ key: m.itemKey, fen });
      }
    } else if (form === 'revenue_rate') {
      // 直接给 pct（不换算成金额），**不乘** coef（占比与城市无关）
      varItems.push({ key: m.itemKey, pct: Number(m.pct) });
    } else if (form === 'step') {
      // 按租金档查询命中的 yuan（**不乘** coef）
      const rentYuan = Number(in_.rentYuan) || 0;
      const steps = Array.isArray(m.steps) ? m.steps : [];
      let hit = null;
      for (const s of steps) { if (rentYuan <= Number(s.upToYuan)) { hit = s; break; } }
      if (!hit && steps.length) hit = steps[steps.length - 1];
      fixedItems.push({ key: m.itemKey, fen: fenOf(hit ? Number(hit.yuan) : 0) });
    }
  }
  return { fixedItems, varItems };
}

// 🔴🔴 R297（第一轮查缺补漏抓出的真漏洞）：建店投入**摊销年限默认值**。
//   单源出处：`cloudfunctions/common/indicatorRef.js::BUILD_DEFAULT_YEARS`。
//   为什么前端必须有一份副本：小程序包**不能 require 云函数目录**（cloudfunctions 不进小程序包），
//   而年限既用于「页面初始行的展示值」，也用于「用户清空输入框时的兜底」，必须与引擎同口径。
//   踩过的坑（R297 实测）：`pages/sandbox/index.js` 原写 `years: Number(r.years) || 1` ——
//     用户清空年限 ⇒ 前端按 **1 年**摊销 ⇒ 月摊销虚高 3 倍（equip 5 倍）⇒ 固定成本合计虚高
//     ⇒ 保本点 / 目标营收**同步虚高**，而整个过程**零报错、零提示**（静默错账）。
//     更隐蔽的是：云端 `calcSandbox/validate.js` 里 `BUILD_DEFAULT_YEARS` 那段兜底因此
//     **永远走不到（死代码）** —— 单源写了、但被前端的硬兜底架空了。
//   ⚠️ 改这里必须**同时**改云端单源，否则守卫 `tools/check_build_default_years.js` 转红。
const BUILD_DEFAULT_YEARS = { franchise: 3, decor: 3, equip: 5, transfer: 3, other: 3 };

/**
 * 年限解析（前端唯一入口）：把输入框里的原始字符串/数字归一成引擎可吃的整数年限。
 *   · 合法（≥1 的有限数）⇒ 向下取整；
 *   · 空 / 0 / 负数 / NaN / 未知 key ⇒ 回落到 `BUILD_DEFAULT_YEARS[key]`（与云端同口径）；
 *   · 连 key 都不在白名单 ⇒ `undefined`（让云端单源再兜一次，绝不落 1）。
 * 🔴 为什么**不**兜 1：1 年摊销会让月摊销放大数倍，是把保本点推高的最危险形态。
 * @returns {number|undefined}
 */
function buildYearsOf(key, raw) {
  const y = Number(raw);
  if (Number.isFinite(y) && y >= 1) return Math.floor(y);
  return Object.prototype.hasOwnProperty.call(BUILD_DEFAULT_YEARS, key)
    ? BUILD_DEFAULT_YEARS[key] : undefined;
}

/**
 * 建店投入（buildItems）：用户填了真实建店投入 ⇒ 用用户的；没填 ⇒ 用 preset.buildRef（两条路二选一，不叠加）。
 * 输出形状 = 引擎 build_items：[{key, fen, years}]。
 * @returns {Array<{key,fen,years}>}
 */
function resolveBuild(preset, input) {
  const in_ = input || {};
  if (Array.isArray(in_.buildItems) && in_.buildItems.length > 0) return in_.buildItems;
  const ref = (preset && preset.buildRef) || [];
  return ref.map((b) => ({ key: b.key, fen: Number(b.fen), years: Number(b.years) }));
}

// 保留 1 位小数带十进制容差（与引擎 round1 同规；25×1.15 浮点陷阱）
function round1(n) { return Math.round(n * 10 + 1e-9) / 10; }

/**
 * 🔴 `cash` 回本口径 —— 本仓**唯一**允许的展示派生（一次除法，不回写、不参与引擎）。
 *   算式：buildTotalFen ÷ (targetProfitFen + buildAmortMonthlyFen)。
 *   `targetProfitFen ≤ 0` ⇒ 返回 null（**不编造**，与引擎 payback_months 同规）。
 * @returns {number|null} 月数（1 位小数）
 */
function paybackCash(buildTotalFen, targetProfitFen, buildAmortMonthlyFen) {
  if (!(Number(targetProfitFen) > 0)) return null;
  const denom = Number(targetProfitFen) + (Number(buildAmortMonthlyFen) || 0);
  if (!(denom > 0)) return null;
  const months = Number(buildTotalFen) / denom;
  return round1(months);
}

// 按 presetKey 取预设（页面用）
function findPreset(key) {
  return BIZ_PRESETS.filter((p) => p.presetKey === key)[0] || null;
}

module.exports = {
  BIZ_PRESETS, CITY_COEF, FORMS,
  assembleItems, resolveBuild, paybackCash, findPreset, round1,
  // R297：建店投入摊销年限默认值（与云端 indicatorRef 同口径）+ 年限归一入口
  BUILD_DEFAULT_YEARS, buildYearsOf,
  // R234：业态预设平铺（预设 → 4 大类反查）
  bizKeyOfPreset,
  // R237：桌数 ⇄ 座位数 换算 + 翻台口径/阈值（引擎零改的入参变换层）
  SEATS_PER_TABLE, TURN_BIZ_TABLE, TURN_THRESHOLD,
  seatsPerTableOf, turnModeOf, turnLevelOf,
  // R292：按业态细分档（快餐/茶饮不再被判「很难」）
  turnLevelOfBiz,
};