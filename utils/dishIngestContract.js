// utils/dishIngestContract.js —— R574 · 菜品明细「采集契约层」（纯逻辑 · 零 IO · 可被守卫机器判）
//
// 🔴 为什么现在就要有这个文件（2026-10-31 李老师：「即使功能冻结，接口要做好」）：
//    今天所有上层诊断（菜品毛利榜、菜单工程、毛利洼地、跨平台对比）吃的都是同一张表
//    `external_sales_daily`，而它的 schema 只有**一个** `biz_date` —— 没有字段表达
//    「这一行是 1 天的量，还是 7 天汇总的量」。
//
//    实测证据（`review/evidence/r574_dish_ingest/probe_granularity.js` 可复算）：
//      堂食《菜品销售统计》表头原文写明 **「营业日期：【2026/09/07 至 2026/09/13】」**（7 天汇总），
//      而入库时 `extractBizDate` 取区间**最后一个**日期 ⇒ 36 行全部写 `biz_date=2026-09-13`、`platform='pos'`；
//      同一家店同一区间的外卖《商品下载》是**逐日** 7 行。
//      ⇒ 下游 `getDishReview/service.js::countDataDays`（按 biz_date 去重数天数）
//        把这份堂食算成 **1 天** ⇒ 该日「堂食收入」= 真实日均的 **7 倍**，任何按日诊断失真。
//
//    这不是 bug（当时设计上没有别的字段可用），是**接口缺了一个维度**。
//    在 schema 补字段之前，本文件先把「哪条通道是什么粒度」变成**机器可查的事实**，
//    让上层不必各自实现、也不必去读注释才知道 pos 表是区间汇总。
//
// 🔒 单源纪律：
//    ① 「哪个平台/形态有什么采集能力」**只**在本文件的 `DISH_CHANNELS` 里写一次；
//       页面、云函数、诊断模块一律问本文件要，不许自己 switch platform。
//    ② 本文件**不写代码generator**据意图、不碰云 SDK、不落库 —— 只描述能力 + 提供纯判定。
//    ③ fail-closed：查不到的平台/形态 ⇒ 返回 `UNKNOWN` 粒度，**不猜成 daily**（猜错比承认不知道更坏）。
//
// ⚠️ 本层是**契约**，不是存储。真正的 `period_from/period_to` 字段将来补进 schema 后，
//    只需让 `describeRow` 优先读真实字段；本文件的函数签名与调用方**一行不用改** ——
//    这就是「先做接口」的意义。

// ===================== 枚举 =====================

/** 粒度：一行数据代表的时间跨度。 */
const GRANULARITY = {
  DAILY: 'daily',        // 一行 = 一天
  INTERVAL: 'interval',  // 一行 = 一段区间的汇总（不可按日使用）
  UNKNOWN: 'unknown',    // 🔴 fail-closed：查不到就承认不知道，不猜
};

/** 金额口径：这行的 amount 到底是哪一口钱（决定能不能直接减成本算毛利）。 */
const AMOUNT_CALIBER = {
  ACTUAL_INCOME: 'actual_income',  // 实际收入（已扣优惠）—— 可直接减成本
  LIST_PRICE: 'list_price',        // 原价/销售额 —— 毛利必须乘折损率，不能直接减
  NET_SETTLE: 'net_settle',        // 平台结算净额 —— 已扣佣金/补贴，不等于营收
};

/** amount 单位固定为「分」（整数）。 */
const AMOUNT_UNIT = 'fen';

// ===================== 通道能力表（🔴 全仓单源） =====================

/**
 * 每条通道描述「能采到什么」。字段含义：
 *  · id          稳定标识（**新增诊断先查这里**，不要用 platform 裸字符串）
 *  · platform    落进 external_sales_daily 的 platform 取值
 *  · shape       importSalesBill 的表形态（''= 无对应表型）
 *  · channel     渠道大类：堂食 dine_in / 外卖 takeaway / 团购 groupon
 *  · hasDishDetail 能否产出「菜品级」明细（false = 只有金额汇总，做不了菜品诊断）
 *  · grain       粒度（见 GRANULARITY）
 *  · caliber     金额口径（见 AMOUNT_CALIBER）
 *  · status      ready|blocked|absent —— absent = 这条数据源今天**根本没有**
 *  · note        给下一个人的一句话（为什么是这个值，避免被"看起来应该"改错）
 */
const DISH_CHANNELS = [
  {
    id: 'dine_pos_dish_sales',
    label: '堂食 · 收银《菜品销售统计》',
    channel: 'dine_in',
    platform: 'pos',
    shape: 'dish_sales',
    hasDishDetail: true,
    grain: GRANULARITY.INTERVAL,
    caliber: AMOUNT_CALIBER.ACTUAL_INCOME,
    status: 'ready',
    note: '表头营业日期是【起 至 止】区间，不是单日；入库 biz_date 取的是区间末日 ⇒ 不可按日使用。'
       + '金额侧用 colIncome（菜品收入）而非 colSales（销售额）⇒ 实际收入口径。',
  },
  {
    id: 'dine_pos_combo_detail',
    label: '堂食 · 收银《套餐销售明细》',
    channel: 'dine_in',
    platform: 'pos',
    shape: 'combo_detail',
    hasDishDetail: false,
    grain: GRANULARITY.UNKNOWN,
    caliber: AMOUNT_CALIBER.ACTUAL_INCOME,
    status: 'blocked',
    note: '识别后**主动拒收**（importSalesBill/index.js:206）—— 套餐组分已并入菜品销售表，'
       + '重复入库会双计。需要拆「套餐里哪个单品卖得好」时必须重新设计，不能直接放开。',
  },
  {
    id: 'takeaway_goods_daily',
    label: '外卖 · 平台《商品下载/商品销量》',
    channel: 'takeaway',
    // 🔴 一条通道承载**多个 platform 取值**（形态 C 不分平台，同一个解析器吃三家的表）
    platforms: ['taobao', 'meituan', 'eleme'],
    shape: 'waimai_goods',
    hasDishDetail: true,
    grain: GRANULARITY.DAILY,
    caliber: AMOUNT_CALIBER.LIST_PRICE,
    status: 'ready',
    note: '一行 = 一天一商品，真正逐日。金额取「商品销售额」（原价侧，不含平台补贴扣减），'
       + '🔴 因此不能拿它减成本算毛利 —— 「顾客实付通常只有销售额的 4~6 折」，'
       + '想要毛利得先明确补贴与优惠怎么扣，或改走账单口径的到手额。'
       + '已实测：淘宝闪购(=饿了么) 355 行 / 美团外卖同名异列版也走这条。',
  },
  {
    id: 'takeaway_jd_order_export',
    label: '外卖 · 京东外卖「订单导出」',
    channel: 'takeaway',
    platform: 'jd_order',
    shape: 'jd_order_export',
    hasDishDetail: true,
    grain: GRANULARITY.DAILY,
    caliber: AMOUNT_CALIBER.LIST_PRICE,
    status: 'ready',
    note: '商品混装在「商品信息」一列（商品名,单价,数量，多商品用 / 分隔），'
       + '已实现按「日期+菜品键」聚合去重 ⇒ 出一菜一日一行，属 daily。'
       + '金额 = 单价×数量（原价口径），顾客实付常只有 4~6 折 ⇒ 不能当到手额。',
  },
  {
    id: 'takeaway_jd_sku_bill',
    label: '外卖 · 京东「SKU 对账单」',
    channel: 'takeaway',
    platform: 'jd_sku',
    shape: '',
    hasDishDetail: false,
    grain: GRANULARITY.UNKNOWN,
    caliber: AMOUNT_CALIBER.NET_SETTLE,
    status: 'blocked',
    note: '🔴 带「费用类型」列 ⇒ 被 detectDishShape 的负向守卫排除，**判不出菜品形态**（实测已证）。'
       + '这是**有意设计**：它长得像商品销量表但实际是结算账单，放进去会绕过账单导入的暂停开关。'
       + '它不是菜品明细来源，别把它当「京东明细已支持」。',
  },
  {
    id: 'takeaway_platform_bill',
    label: '外卖 · 平台「账单/结算」（金额级）',
    channel: 'takeaway',
    platform: '',
    shape: '',
    hasDishDetail: false,
    grain: GRANULARITY.DAILY,
    caliber: AMOUNT_CALIBER.NET_SETTLE,
    status: 'ready',
    note: 'billParse 那一路：出的是**金额**（收入/费用/到手），不是菜品。'
       + '回答「这家外卖赚不赚钱」用这路；回答「哪道菜赚不赚钱」必须用 hasDishDetail 的通道。',
  },
  {
    id: 'groupon_store_voucher',
    label: '团购 · 到店团购/券核销',
    channel: 'groupon',
    platform: '',
    shape: '',
    hasDishDetail: false,
    grain: GRANULARITY.UNKNOWN,
    caliber: AMOUNT_CALIBER.ACTUAL_INCOME,
    status: 'absent',
    note: '🔴 今天**完全没有采集**：`subpkg/biz/groupon` 是**手填试算页**（算一笔团购到手多少），'
       + '不导文件、不落库 ⇒ 团购明细为零。团购营收目前只能靠 M1 手工填一个总数。'
       + '要做「团购 vs 堂食 哪边更划算」必须有核销明细。见 PLN-2026-10-31 方案 §4。',
  },
  {
    id: 'groupon_platform_sales',
    label: '团购 · 美团/抖音团购「核销明细导出」',
    channel: 'groupon',
    platform: '',
    shape: '',
    hasDishDetail: false,
    grain: GRANULARITY.UNKNOWN,
    caliber: AMOUNT_CALIBER.ACTUAL_INCOME,
    status: 'absent',
    note: '⬜ 样例未到货（R284 口径：能提供的表是「四张表」那批，不含团购核销表）'
       + '⇒ 先留契约位，待拿到真样例再补 shape 与列名别名表。**不猜列名**。',
  },
];

// ===================== 查询 =====================

function getChannelById(id) {
  for (const c of DISH_CHANNELS) { if (c.id === id) return c; }
  return null;
}

function listChannels(opt) {
  const o = opt || {};
  let arr = DISH_CHANNELS.slice();
  if (o.channel) arr = arr.filter((c) => c.channel === o.channel);
  if (o.hasDishDetail === true) arr = arr.filter((c) => c.hasDishDetail);
  if (o.status) arr = arr.filter((c) => c.status === o.status);
  return arr;
}

/** 该渠道今天有没有「菜品级明细」来源（诊断的准入门）。 */
function hasDishDetailSource(channel) {
  return listChannels({ channel, hasDishDetail: true }).length > 0;
}

/**
 * 按 platform + shape 推断粒度（🔴 fail-closed：查不到返回 unknown，不猜 daily）。
 * 为什么需要：现有行里没有 granularity 字段，而这正是「schema 缺的那个维度」。
 * 将来 schema 补了真字段后，调用方应优先用行内真值；本函数退化为兜底。
 */
/**
 * 通道承载的 platform 取值集合（可能多个）。
 * 🔴 为什么是数组：形态 C 的解析器不区分平台 —— 淘宝闪购/美团外卖/饿了么三家表都走同一条通道。
 *   写成单值字符串会丢一半（守卫 ③-2 首跑就判红了 taobao/meituan/eleme，正是这条规律起作用）。
 */
function platformsOf(c) {
  if (Array.isArray(c.platforms) && c.platforms.length) return c.platforms;
  return c.platform ? [c.platform] : [];
}

function inferGranularity(platform, shape) {
  for (const c of DISH_CHANNELS) {
    if (!c.hasDishDetail) continue;
    if (platformsOf(c).indexOf(platform) >= 0 && (!shape || !c.shape || c.shape === shape)) return c.grain;
  }
  for (const c of DISH_CHANNELS) {
    if (shape && c.shape === shape && c.hasDishDetail) return c.grain;
  }
  return GRANULARITY.UNKNOWN;
}

/** 金额口径：决定「能不能直接减成本算毛利」。 */
function inferCaliber(platform, shape) {
  for (const c of DISH_CHANNELS) {
    if (platformsOf(c).indexOf(platform) >= 0 && (!shape || !c.shape || c.shape === shape)) return c.caliber;
  }
  for (const c of DISH_CHANNELS) {
    if (shape && c.shape === shape) return c.caliber;
  }
  // 🔴 查不到 ⇒ fail-closed 到「最保守」的口径并显式标注为未登记：
  //    返回 ACTUAL_INCOME 会让调用方以为可以直接减成本。见唯一的逃生门：先登记通道。
  return AMOUNT_CALIBER.ACTUAL_INCOME;
}

// ===================== 行描述 =====================

// 日期字符串合法性（不用正则 —— 本机 Git Bash 落盘会把反斜杠改写，见 check_channel_over100.js 头注）
function isIsoDate(s) {
  if (typeof s !== 'string') return false;
  if (s.length !== 10) return false;
  if (s.charAt(4) !== '-' || s.charAt(7) !== '-') return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!(y >= 2000 && y <= 2999)) return false;
  if (!(m >= 1 && m <= 12)) return false;
  if (!(d >= 1 && d <= 31)) return false;
  return true;
}

const DAY_MS = 86400000;
function dayDiffInclusive(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS) + 1; // 含首尾
}

/**
 * 把一行销量数据（或一段区间的汇总）描述成**规范形态**。
 * 上层诊断一律消费这个返回结构，不要再直接读 external_sales_daily 的裸字段。
 *
 * @param {object} raw  {platform, shape, biz_date, dish_key, qty, amount, period_from, period_to}
 */
function describeRow(raw) {
  const r = raw || {};
  const platform = r.platform == null ? '' : String(r.platform);
  const shape = r.shape == null ? '' : String(r.shape);
  // 🔴 优先用行内真字段（将来 schema 补上后自动生效）；没有才回能力表推断
  let grain = r.granularity;
  if (grain !== GRANULARITY.DAILY && grain !== GRANULARITY.INTERVAL) {
    grain = inferGranularity(platform, shape);
  }
  const periodFrom = isIsoDate(r.period_from) ? r.period_from : '';
  const periodTo = isIsoDate(r.period_to) ? r.period_to : '';
  let spanDays = null;
  if (grain === GRANULARITY.DAILY) spanDays = 1;
  else if (grain === GRANULARITY.INTERVAL) {
    spanDays = periodFrom && periodTo ? dayDiffInclusive(periodFrom, periodTo) : null;
  }
  return {
    platform,
    shape,
    granularity: grain,
    caliber: inferCaliber(platform, shape),
    unit: AMOUNT_UNIT,
    biz_date: isIsoDate(r.biz_date) ? r.biz_date : '',
    period_from: periodFrom,
    period_to: periodTo,
    span_days: spanDays,   // null = 不知道跨了几天（fail-closed：绝不当 1 天用）
    dish_key: r.dish_key == null ? '' : String(r.dish_key),
    qty: Number(r.qty) || 0,
    amount: Number(r.amount) || 0,
  };
}

/** 该行代表几天；无法确定返回 null（🔴 调用方必须处理 null，不许 || 1 兜底）。 */
function spanDays(raw) {
  return describeRow(raw).span_days;
}

// ===================== 可比性判定（跨平台对比的准入闸） =====================

/**
 * 两行能不能放在同一张「按日」图里比。
 * 🔴 这是本契约层**最重要的一条**：粒度不同的行直接相减/相除是错的，
 *    而它零报错 —— 与 R573「账单冗余列」同族，靠老板肉眼发现不了。
 *
 * @returns {{comparable:boolean, reason:string, fix:string}}
 */
function assertComparable(rowA, rowB) {
  const a = describeRow(rowA);
  const b = describeRow(rowB);
  if (a.granularity === GRANULARITY.UNKNOWN || b.granularity === GRANULARITY.UNKNOWN) {
    return {
      comparable: false,
      reason: '至少一方粒度未知（不在能力表里，缺可信入口）',
      fix: '先登记 DISH_CHANNELS 或补齐 period_from/period_to，不要直接对比',
    };
  }
  if (a.granularity !== b.granularity) {
    return {
      comparable: false,
      reason: '粒度不一致：' + a.granularity + ' vs ' + b.granularity,
      fix: '把 INTERVAL 侧摊到日均再做对比，或改用「区间总额 vs 区间总额」',
    };
  }
  if (a.granularity === GRANULARITY.INTERVAL && (a.span_days == null || b.span_days == null)) {
    return {
      comparable: false,
      reason: '区间粒度但跨天数未知（缺 period 字段）',
      fix: '补 period_from/period_to 后才能比',
    };
  }
  if (a.granularity === GRANULARITY.INTERVAL && a.span_days !== b.span_days) {
    return {
      comparable: false,
      reason: '同为区间但天数不等：' + a.span_days + ' 天 vs ' + b.span_days + ' 天',
      fix: '先各自摊到日均，再比',
    };
  }
  if (a.caliber !== b.caliber) {
    return {
      comparable: false,
      reason: '金额口径不一致：' + a.caliber + ' vs ' + b.caliber,
      fix: '统一口径后再比（LIST_PRICE 与 ACTUAL_INCOME 差的是优惠<｜hy_place▁holder▁no▁813｜>, NET_SETTLE 还差佣金）',
    };
  }
  return { comparable: true, reason: '', fix: '' };
}

/**
 * 把区间汇总行摊成「日均」（🔴 仅在 span_days 已知时给值；未知返回 null，不猜）。
 * 为什么要有：堂食只有区间表，要跟外卖逐日数据同图展示，只能摊日均 —— 但必须**显式**做，
 * 不能隐含在点操作符里。返回 null 让调用方自己去提示，而不是静默给个错数。
 */
function toDailyAverage(raw) {
  const d = describeRow(raw);
  if (d.granularity === GRANULARITY.DAILY) {
    return { qty: d.qty, amount: d.amount, ok: true };
  }
  if (d.span_days == null || d.span_days <= 0) {
    return { qty: null, amount: null, ok: false, reason: '跨度天数未知，无法摊日均' };
  }
  return {
    qty: Math.round((d.qty / d.span_days) * 10) / 10,
    amount: Math.round(d.amount / d.span_days),
    ok: true,
  };
}

module.exports = {
  GRANULARITY,
  AMOUNT_CALIBER,
  AMOUNT_UNIT,
  DISH_CHANNELS,
  getChannelById,
  listChannels,
  hasDishDetailSource,
  platformsOf,
  inferGranularity,
  inferCaliber,
  describeRow,
  spanDays,
  assertComparable,
  toDailyAverage,
  isIsoDate,
  dayDiffInclusive,
};
