// cloudfunctions/importSalesBill/dsi1.js —— DSI-1 标准导入格式的识别与解析
//
// 契约：`specs/dev-specs/core/店算标准导入格式_v1.md`（DSI-1）
// 本文件是**纯函数 · 零 IO**，只做两件事：认表头、把行变成标准行。
//
// 🔴 为什么单独一个文件（不塞进 service.js）：
//   ① service.js 已 900+ 行，再塞解析会让人找不到边界；
//   ② 纯函数可直接被守卫 require 做行为断言，不需要 xlsx 桩。
//
// 🔴 两条从评审里学来的硬规则（写错会让老板的数据被静默拒掉）：
//   ① **销量允许小数**（卤味/麻辣烫按斤卖，1.5 份是真实现实）—— 原设计写"必须整数"会整表拒收；
//   ② **允许负数**（退单/退款就是负销量负金额）—— 原设计写"≥0"会让销量虚高。
//
// 与现有三种形态（A/B/C）的关系：本格式**新增**一种，不替代任何现有形态。
// 识别依据是**7 个列名精确匹配**，与 A/B/C 的列名天然不重叠。

const { normalizeDishName } = require('./cx_dishKey');
const { yuanToFen } = require('./cx_money');   // 元→分单源（十进制安全；不许自己乘一百再取整）

const HEADERS = ['日期', '渠道', '平台', '商品名称', '销量', '销售额', '备注'];

// 渠道 → 落库 platform（复用现有枚举：pos = 堂食，takeaway 由平台列决定）
const CHANNEL_DINE = '堂食';
const CHANNEL_TAKEAWAY = '外卖';

// 平台中文名 → 机器值（与 SALES_SCHEMA.platform.enum 对齐）
const PLATFORM_MAP = {
  美团: 'meituan',
  淘宝闪购: 'taobao',
  饿了么: 'taobao',      // R580：同一实体（阿里 2026 财年年报已更名）
  京东: 'jd_order',
};

const ERR = {
  BAD_HEADER: '表头不是店算标准格式（应为：日期/渠道/平台/商品名称/销量/销售额/备注）',
  BAD_DATE: '日期解析不出来（要 2026-09-07 这种）',
  BAD_CHANNEL: '渠道只能是「堂食」或「外卖」',
  BAD_NAME: '商品名称不能为空',
  BAD_NUM: '销量或销售额不是数字',
  EMPTY: '表里没有数据行',
};

/** 单元格取字符串（去首尾空格） */
function s(v) {
  return v == null ? '' : String(v).trim();
}

/** 数字解析：允许千分位、允许负号、允许小数；空/占位符 → null */
function toNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = s(v).replace(/,/g, '');
  if (t === '' || t === '-' || t === '--') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 日期归一 → YYYY-MM-DD；认不出返回 '' */
function normDate(v) {
  const t = s(v);
  if (!t) return '';
  const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = String(Number(m[2])).padStart(2, '0');
    const d = String(Number(m[3])).padStart(2, '0');
    const mm = Number(mo);
    const dd = Number(d);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    return `${y}-${mo}-${d}`;
  }
  return '';
}

/**
 * 是不是 DSI-1 表头
 * 规则：前 7 列**逐字等于** HEADERS（末尾允许多余空列）
 */
function isDSI1(headerRow) {
  const h = (headerRow || []).map(s);
  // 去掉尾部空列
  while (h.length && h[h.length - 1] === '') h.pop();
  if (h.length < HEADERS.length) return false;
  for (let i = 0; i < HEADERS.length; i++) {
    if (h[i] !== HEADERS[i]) return false;
  }
  return true;
}

/**
 * 解析 DSI-1
 * @param {Array<Array>} rows 全表（第 0 行是表头）
 * @returns {{ok:true, rows:Array, summary:Object} | {ok:false, error:string}}
 */
function parse(rows) {
  const all = Array.isArray(rows) ? rows : [];
  if (!all.length || !isDSI1(all[0])) return { ok: false, error: ERR.BAD_HEADER };

  const out = [];
  const nonInt = [];
  const refunds = [];
  let skipped = 0;

  for (let i = 1; i < all.length; i++) {
    const r = all[i] || [];
    // 整行空 ⇒ 跳过（Excel 常留尾部空行）
    if (r.every((c) => s(c) === '')) { skipped++; continue; }

    const date0 = s(r[0]);
    if (date0 === '') { skipped++; continue; }           // 没有日期的行不要（多半是尾部说明行）

    const bizDate = normDate(date0);
    if (!bizDate) return { ok: false, error: `${ERR.BAD_DATE}：第 ${i + 1} 行「${date0}」` };

    const channel = s(r[1]);
    if (channel !== CHANNEL_DINE && channel !== CHANNEL_TAKEAWAY) {
      return { ok: false, error: `${ERR.BAD_CHANNEL}：第 ${i + 1} 行填的是「${channel}」` };
    }

    const platName = s(r[2]);
    const name0 = s(r[3]);
    if (!name0) return { ok: false, error: `${ERR.BAD_NAME}：第 ${i + 1} 行` };

    const rawQty = toNum(r[4]);
    const sales = toNum(r[5]);
    if (rawQty == null) return { ok: false, error: `${ERR.BAD_NUM}（销量）：第 ${i + 1} 行「${s(r[4])}」` };
    if (sales == null) return { ok: false, error: `${ERR.BAD_NUM}（销售额）：第 ${i + 1} 行「${s(r[5])}」` };

    // 🔴 小数销量：保留原始值，入库取整，并单列进报告（沿用 R231 的做法，绝不静默吞）
    const qty = Math.round(rawQty);
    if (!Number.isInteger(rawQty)) nonInt.push({ name: name0, raw: rawQty, rounded: qty, line: i + 1 });

    // 🔴 元 → 分**必须走单源** `cx_money::yuanToFen`，不许自己乘一百再取整：
    //   ① money-precision 守卫要求面内每处乘法都具名登记（未登记即红，本轮实测抓到）；
    //   ② 更要紧的是**十进制安全** —— R298 实测手写取整在三位小数全域会少进 1 分
    //      （方向恒偏小），`yuanToFen` 用 toFixed(10) 消掉浮点噪声、恢复十进制语义。
    //   它与前端 `utils/api.js::yuanToFen` 同款，两份必须一致。
    const amountFen = yuanToFen(sales);

    // 退款行（负数）单独记账 —— 不剔除，要让使用者看见
    if (rawQty < 0 || sales < 0) refunds.push({ name: name0, qty, amountFen, line: i + 1 });

    // 渠道 → platform
    let platform;
    if (channel === CHANNEL_DINE) {
      platform = 'pos';                                  // 堂食
    } else {
      platform = PLATFORM_MAP[platName] || 'other';       // 外卖：映射不到的落 other（不猜）
      if (!platName) platform = 'other';
    }

    const dishKey = normalizeDishName(name0);
    out.push({
      bizDate, channel, platform, platName,
      name: name0, dishKey, qty, rawQty, amountFen,
    });
  }

  if (!out.length) return { ok: false, error: ERR.EMPTY };

  const days = Array.from(new Set(out.map((x) => x.bizDate))).sort();
  const dishes = Array.from(new Set(out.map((x) => x.dishKey || x.name)));
  const byChannel = {};
  for (const x of out) {
    const k = x.channel + (x.platform === 'pos' ? '' : ':' + x.platform);
    byChannel[k] = byChannel[k] || { channel: x.channel, platform: x.platform, qty: 0, amountFen: 0, rows: 0 };
    byChannel[k].qty += x.qty;
    byChannel[k].amountFen += x.amountFen;
    byChannel[k].rows += 1;
  }

  return {
    ok: true,
    rows: out,
    summary: {
      rowCount: out.length,
      skipped,
      dayFrom: days[0],
      dayTo: days[days.length - 1],
      dayCount: days.length,
      dishCount: dishes.length,
      totalQty: out.reduce((a, x) => a + x.qty, 0),
      totalAmountFen: out.reduce((a, x) => a + x.amountFen, 0),
      nonInt,
      refunds,
      byChannel,
      // 🔴 与 S2 的口径差：S1 不含打包费 ⇒ 汇总金额天然小于 S2 营业额（契约 §S1-③ 已写明）
      noteNoPackFee: true,
    },
  };
}

/**
 * 按 (platform, bizDate) 分组 —— 落库 _id 的两个维度。
 *
 * 🔴 为什么单独抽成纯函数：这是整条 DSI-1 链路**最易错的一步**。
 *   一份 DSI-1 可同时含堂食 + 美团 + 淘宝闪购，若按 bizDate 单维分组，
 *   同一天不同平台的行会被塞进同一组、seq 连号 ⇒ `saleDocId(shop, platform, date, seq)`
 *   里的 platform 只能取一个值 ⇒ **另一平台的行整批丢失或互相覆盖，且不报错**。
 *
 * @param {Array} rows parse() 产出的行
 * @returns {Array<{platform:string, bizDate:string, rows:Array}>} 按 bizDate 升序、同日按 platform 名升序
 */
function groupByPlatformDate(rows) {
  const m = new Map();
  for (const r of (rows || [])) {
    const k = r.platform + '|' + r.bizDate;
    if (!m.has(k)) m.set(k, { platform: r.platform, bizDate: r.bizDate, rows: [] });
    m.get(k).rows.push(r);
  }
  return Array.from(m.values()).sort((a, b) => (
    a.bizDate === b.bizDate
      ? (a.platform < b.platform ? -1 : (a.platform > b.platform ? 1 : 0))
      : (a.bizDate < b.bizDate ? -1 : 1)
  ));
}

module.exports = { HEADERS, isDSI1, parse, normDate, toNum, ERR, PLATFORM_MAP, groupByPlatformDate };
