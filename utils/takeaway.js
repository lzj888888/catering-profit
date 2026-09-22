// utils/takeaway.js —— R85 · 外卖段取数与录入（纯函数，可单测；页面 input.js 调用）
//
// 规范依据：specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md §A.11（2026-09-22 锁定，不改口径）。
// 🔒 单一数据源：平台名与顺序只来自 terms.js::ledger.income[takeaway].items；
//   营销项名来自 collections.js::SEED_EXPENSE_ITEMS(marketing)（terms 的 expenseItemNotes 按展示名挂）。
// 🔴 纪律（A.11.7 V1-V3 未验证）：配平校验**只做软提示** —— 不阻断保存、不参与利润、不写入任何金额。
//   最坏结果只能是"多一句提示"，绝不能影响存进去的钱。

// ===================== 模式推断 / 快照（复用堂食 dineMode 约定） =====================

/**
 * 外卖模式初始判定：本地缓存优先；无缓存按数据推断（细项行 >1 ⇒ 分项）。
 * @param {string|null} cached 本地缓存值（'fast'|'detail'|null）
 * @param {Array} rows 该组细项行
 * @returns {'fast'|'detail'}
 */
function pickTakeawayMode(cached, rows) {
  if (cached === 'fast' || cached === 'detail') return cached;
  return (Array.isArray(rows) && rows.length > 1) ? 'detail' : 'fast';
}

/**
 * 模式键（含 shop_id，与 dineModeKey 同法；换设备/清缓存回默认）。
 */
function takeawayModeKey(shopId, month, prefix) {
  return (prefix || 'tw_mode_') + shopId + '_' + month;
}

/**
 * 快速 → 分项快照保留：切模式前把当前分项行（平台名 + 三个数）存快照；
 * 切回分项时原样恢复，不丢值。
 * 快照结构：[{ platform, goods, pack, subsidy }]
 */
function snapshotDetail(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    platform: (r && r.platform) || (r && r.subItem) || '',
    goods: (r && r.goods) || '',
    pack: (r && r.pack) || '',
    subsidy: (r && r.subsidy) || '',
  }));
}

/**
 * 用快照恢复分项行（平台名按预设清单铺全，金额按平台名回填）。
 * @param {Array} snap 快照 [{platform,goods,pack,subsidy}]
 * @param {Array} presets 平台名清单（terms takeaway items）
 * @returns {Array} [{ platform, goods, pack, subsidy, subtotal, fixed:true }]
 */
function restoreDetail(snap, presets) {
  const src = Array.isArray(snap) ? snap : [];
  const byName = {};
  for (const s of src) {
    if (s && s.platform) {
      byName[s.platform] = byName[s.platform] || { goods: '', pack: '', subsidy: '' };
      byName[s.platform].goods = s.goods || byName[s.platform].goods;
      byName[s.platform].pack = s.pack || byName[s.platform].pack;
      byName[s.platform].subsidy = s.subsidy || byName[s.platform].subsidy;
    }
  }
  return (Array.isArray(presets) ? presets : []).map((name) => {
    const v = byName[name] || {};
    const goods = v.goods || '';
    const pack = v.pack || '';
    const subsidy = v.subsidy || '';
    return {
      platform: name,
      goods,
      pack,
      subsidy,
      subtotal: subtotalOf(goods, pack, subsidy),
      fixed: true,
    };
  });
}

/** 分项小计（元，字符串）：三项相加（前端预计算，WXML 不支持方法调用）。 */
function subtotalOf(goods, pack, subsidy) {
  const s = (Number(goods) || 0) + (Number(pack) || 0) + (Number(subsidy) || 0);
  return s ? s.toFixed(2) : '';
}

// ===================== 粘贴提取（A.11.5：只提取数字并求和） =====================

/**
 * 从粘贴文本中提取数字并求和。
 * - 自动跳过表头文字、空单元格、说明列（非数字行自然跳过）；
 * - 行内若有多个数字，只取每行的**第一个**数字（一列对应一个数）；
 * - 含「合计 / 总计」字样的行 → hasTotal=true（由页面弹确认）；
 * - 千分位逗号与中文金额符号已处理。
 * @param {string} text 原始粘贴文本（含换行/制表符/逗号分隔）
 * @returns {{ sum:number, hasTotal:boolean, numbers:number[], raw:string }}
 */
function extractPaste(text) {
  const raw = String(text == null ? '' : text);
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  let sum = 0;
  let hasTotal = false;
  const numbers = [];
  for (const line of lines) {
    const n = firstNumber(line);
    if (n === null) continue;                       // 纯文字行（表头/说明列）→ 跳过
    if (/合计|总计|total|小计/i.test(line)) { hasTotal = true; continue; } // 合计行不算入求和（防重复加）
    sum += n;
    numbers.push(n);
  }
  return { sum, hasTotal, numbers, raw };
}

/**
 * 抹掉行内「明显不是金额」的形态：账期 / 日期 / 时间 / 长单号。
 * ⚠️ 根因（R85 实测）：平台账单常带「归属账期」列（如 2026-09）或「下单时间」列（如 2026-09-21 13:45），
 *   不剔除就会被 firstNumber 当金额加进去，而 UI 仍提示「已提取并填入」⇒ 静默算错钱。
 *   ⇒ 只剔除形态明确的非金额串，不做「像不像金额」的主观判断（避免误伤 2 位小数金额）。
 */
function stripNonMoney(s) {
  return String(s == null ? '' : s)
    .replace(/\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?/g, ' ')     // 2026-09 / 2026-09-21 / 2026/9/1
    .replace(/\d{4}年\d{1,2}月(?:\d{1,2}日)?/g, ' ')        // 2026年9月21日
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')             // 13:45 / 13:45:30
    .replace(/\d{11,}/g, ' ');                            // 订单号 / 流水号（≥11 位纯数字）
}

/** 取一行文本中的第一个金额数字（支持 1,234.56 / 1234 / 12.5 元 等形态）；无则 null。
 *  ⚠️ 先过 stripNonMoney：账期/日期/时间/长单号不得当金额。 */
function firstNumber(line) {
  // ⚠️ R85 修复：原式 `\d{1,3}(?:,\d{3})*` 对「≥4 位且无千分位」的整数**只取前 3 位**
  //   （4380.00 → 438、1234.56 → 123）⇒ 账单里最常见的写法恰好中招、且静默算错钱。
  //   ⇒ 用 (?:千分位形态 | 纯数字) 二选一，先完整吃下数字再谈小数。
  const m = String(stripNonMoney(line)).match(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/**
 * 粘贴提取结果 → 金额框显示值（元，两位小数字符串）。
 * 🔴 R119 修复：原页面写 `res.sum ? res.sum.toFixed(2) : ''` —— 提取到 **0** 时被当成"空"，
 *   金额框什么都不显示，用户以为没粘上（而 0 是合法金额：零打包费 / 零补贴都要能填）。
 *   判据改为「有没有提取到数字」而不是「数字非零」。
 * @param {{sum:number,numbers:number[]}} res extractPaste 的返回值
 * @returns {string} '' = 确实没提取到数字；否则两位小数（含 '0.00'）
 */
function pasteFillValue(res) {
  if (!res || !Array.isArray(res.numbers) || res.numbers.length === 0) return '';
  const v = Number(res.sum);
  return Number.isFinite(v) ? v.toFixed(2) : '';
}

/**
 * 「已填 N / M 个平台」串。
 * ⚠️ M ≤ 1 时返回 '' —— 真机实测：外卖组在「只填整类总额」的常态下**只有 1 行**，
 *   此时显示「已填 1 / 1 个平台」纯属噪音；这句话只在**多平台**场景才有信息量。
 * @param {string} tpl i18n 模板（含 {n} / {m}）
 * @param {number} filled 已填平台数
 * @param {number} total 平台行总数
 */
function filledLabel(tpl, filled, total) {
  if (!(Number(total) > 1)) return '';
  return String(tpl || '').replace('{n}', String(filled)).replace('{m}', String(total));
}

// ===================== 费用侧自动带出（A.11.3 sort 30） =====================

/**
 * 分项模式下各平台「商家活动补贴」求和（元）→ 带出到费用侧「外卖活动补贴」。
 * @param {Array} detailRows [{platform,goods,pack,subsidy}]
 * @returns {number} 补贴合计（元）
 */
function subsidyTotal(detailRows) {
  return (Array.isArray(detailRows) ? detailRows : []).reduce(
    (s, r) => s + (Number(r && r.subsidy) || 0), 0);
}

// ===================== 配平校验（A.11.4 · 只做软提示） =====================

const RECONCILE_THRESHOLD = 50; // 元

/**
 * 机器近似校验式（A.11.4 b）：
 *   应有商家应收款 ≈ 外卖收入合计 − 商家活动补贴 − 佣金 − 配送服务费 − 配送补贴
 * @param {object} p {
 *   incomeTotal,     // 外卖收入合计（快速模式 = 各平台总额之和；分项模式 = 各平台小计之和）（元）
 *   subsidy,         // 商家活动补贴（元）
 *   commission,      // 外卖平台佣金（元）
 *   deliveryFee,     // 外卖配送服务费（元）
 *   deliverySubsidy, // 外卖配送补贴（元）
 *   actualReceivable,// 客户填的账单商家应收款（元）；0/空 = 跳过校验
 *   packTotal,       // 打包费合计（元，专项检测用）
 * }
 * @returns {null|{status:'pass'|'miss'|'packaging'|'delivery', diff, expected, actual}}
 *   null = 客户未填应收款 → 跳过（不提示，也不误报）。
 */
function reconcile(p) {
  const actual = Number(p && p.actualReceivable);
  if (!(actual > 0)) return null; // 未填 → 不校验（选填框）

  const incomeTotal = Number(p && p.incomeTotal) || 0;
  const subsidy = Number(p && p.subsidy) || 0;
  const commission = Number(p && p.commission) || 0;
  const deliveryFee = Number(p && p.deliveryFee) || 0;
  const deliverySubsidy = Number(p && p.deliverySubsidy) || 0;
  const expected = incomeTotal - subsidy - commission - deliveryFee - deliverySubsidy;
  const diff = Math.round((actual - expected) * 100) / 100;
  const absDiff = Math.abs(diff);

  // 专项：差额恰等于打包费合计（A.11.4 c）—— 先于漏填判断（更具体）
  const packTotal = Math.round((Number(p && p.packTotal) || 0) * 100) / 100;
  if (packTotal > 0 && Math.abs(absDiff - packTotal) <= 0.01) {
    return { status: 'packaging', diff, expected, actual };
  }

  if (absDiff <= RECONCILE_THRESHOLD) {
    return { status: 'pass', diff, expected, actual };
  }

  // 专项：差额稳定等于某笔配送费（用户支付配送费计入应收款，商家自配送常见）→ 不得判为填错
  const delivery = Number(p && p.deliveryFee) || 0;
  if (delivery > 0 && Math.abs(absDiff - delivery) <= 0.01) {
    return { status: 'delivery', diff, expected, actual };
  }

  return { status: 'miss', diff, expected, actual };
}

module.exports = {
  pickTakeawayMode, takeawayModeKey, snapshotDetail, restoreDetail, subtotalOf,
  extractPaste, firstNumber, stripNonMoney, pasteFillValue, filledLabel,
  subsidyTotal, reconcile, RECONCILE_THRESHOLD,
};
