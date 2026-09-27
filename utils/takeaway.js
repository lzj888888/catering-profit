// utils/takeaway.js —— R85 · 外卖段取数与录入（纯函数，可单测；页面 input.js 调用）
//
// 规范依据：specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md §A.11（2026-09-22 锁定，不改口径）。
// 🔴 R162 补充（规范依据：开发规范v1.1_ModuleA增量_外卖有效订单数与补贴口径.md）：
//   分项行新增第 4 个输入「有效订单数 qty」—— **它不参与任何金额计算**（见 qtyTotal / perOrderYuan 注释），
//   只用于回显单均指标；金额口径（收入 = 商品总价 + 打包费 + 补贴）一字未动。
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
 * 快速 → 分项快照保留：切模式前把当前分项行（平台名 + 四个数）存快照；
 * 切回分项时原样恢复，不丢值。
 * 快照结构：[{ platform, goods, pack, subsidy, qty }]
 * ⚠️ R162：qty（有效订单数）必须一起快照 —— 切模式来回一趟把订单数丢了，
 *   等于当着用户的面吃掉他刚填的第 4 个必填（同族：round-trip 丢值）。
 */
function snapshotDetail(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    platform: (r && r.platform) || (r && r.subItem) || '',
    goods: (r && r.goods) || '',
    pack: (r && r.pack) || '',
    subsidy: (r && r.subsidy) || '',
    qty: (r && r.qty) || '',
  }));
}

/**
 * 用快照恢复分项行（平台名按预设清单铺全，金额按平台名回填）。
 * @param {Array} snap 快照 [{platform,goods,pack,subsidy,qty}]
 * @param {Array} presets 平台名清单（terms takeaway items）
 * @returns {Array} [{ platform, goods, pack, subsidy, qty, subtotal, fixed:true }]
 */
function restoreDetail(snap, presets) {
  const src = Array.isArray(snap) ? snap : [];
  const byName = {};
  for (const s of src) {
    if (s && s.platform) {
      byName[s.platform] = byName[s.platform] || { goods: '', pack: '', subsidy: '', qty: '' };
      byName[s.platform].goods = s.goods || byName[s.platform].goods;
      byName[s.platform].pack = s.pack || byName[s.platform].pack;
      byName[s.platform].subsidy = s.subsidy || byName[s.platform].subsidy;
      // 🔴 R162：只回填**非空**的 qty —— 用 `||` 会把合法的 '0' 也当成空吃掉；
      //   而 qty 为 0 是平台账单里真实存在且必须能存的值（当月一单没出）。
      if (s.qty !== undefined && s.qty !== null && String(s.qty).trim() !== '') {
        byName[s.platform].qty = String(s.qty);
      }
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
      qty: (v.qty === undefined || v.qty === null) ? '' : String(v.qty),
      subtotal: subtotalOf(goods, pack, subsidy),
      fixed: true,
    };
  });
}

/** 分项小计（元，字符串）：三项相加（前端预计算，WXML 不支持方法调用）。
 *  ⚠️ R162：**qty 不进小计** —— 有效订单数是数量、不是钱，混进来就是凭空多出一笔收入。 */
function subtotalOf(goods, pack, subsidy) {
  const s = (Number(goods) || 0) + (Number(pack) || 0) + (Number(subsidy) || 0);
  return s ? s.toFixed(2) : '';
}

// ===================== R162 · 有效订单数（qty）—— 只回显，不进任何金额 =====================

/**
 * 各平台「有效订单数」求和（单）。
 * 🔴 硬约束：qty **只用于派生指标回显**（单均），不得进入 subtotalOf / reconcile / 任何金额求和 ——
 *   订单数是一维数量，与金额相加没有意义，混进去就是静默算错钱（R161 实测：三平台账单都有该列，
 *   且缺了它所有单均指标算不出来）。
 * @param {Array} rows [{qty}]
 * @returns {number} 有效订单合计（单）
 */
function qtyTotal(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((s, r) => s + (Number(r && r.qty) || 0), 0);
}

/**
 * 单均值（元，两位小数字符串）：totalYuan ÷ count。
 * ⚠️ count ≤ 0 返回 ''（除零 ⇒ NaN 会渲染成 "NaN"，比留空更糟）；
 *   总额为 0 时返回 '0.00'（0 元是合法结果，不是没算出来）。
 * @param {number|string} totalYuan 金额合计（元）
 * @param {number|string} count 有效订单数（单）
 * @returns {string} '' = 算不出来（没订单数）；否则两位小数
 */
function perOrderYuan(totalYuan, count) {
  const n = Number(count);
  const t = Number(totalYuan);
  if (!(n > 0)) return '';
  if (!Number.isFinite(t)) return '';
  return (t / n).toFixed(2);
}

// ===================== 粘贴提取（A.11.5：只提取数字并求和） =====================

/**
 * 从粘贴文本中提取数字并求和。
 * - 自动跳过表头文字、空单元格、说明列（非数字行自然跳过）；
 * - 行内若有多个数字，只取每行的**第一个**数字（一列对应一个数）；
 * - 含「合计 / 总计 / 小计」字样 ⇒ hasTotal=true（由页面弹确认），且该合计值**不算入求和**；
 * - 千分位逗号与中文金额符号已处理。
 *
 * 🔴 R120 修复（静默算错钱第 3 例）：原护栏写成「**整行**含合计字样就 continue」——
 *   只在「标签与金额同行」（Excel 常规复制 `合计⇥7140.00`）时有效；
 *   而账单里常见的**标签占一行、金额在下一行**（`合计` ⏎ `7140.00`）时护栏完全不触发，
 *   于是合计值被当普通明细加进去 ⇒ 4380+2760+7140 = **14280（翻倍）**，界面却照旧提示「已提取并填入」。
 *   ⇒ 改为**配对**：同行形态直接归合计；纯标签行开启 `pendingTotal`（跨越其间的纯文字行），
 *     由**紧随其后的第一个数字行**归合计。两种形态都不再进 numbers。
 *
 * @param {string} text 原始粘贴文本（含换行/制表符/逗号分隔）
 * @returns {{ sum:number, hasTotal:boolean, totalValue:number|null, numbers:number[], raw:string }}
 *   sum       = 明细求和（**不含**合计行）
 *   totalValue= 合计行的金额（同行形态 或 悬空标签后的第一个数字行；无则 null）
 *   numbers   = 计入求和的明细数字（合计值不在其中）
 */
function extractPaste(text) {
  const raw = String(text == null ? '' : text);
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  let sum = 0;
  let hasTotal = false;
  let totalValue = null;      // 合计金额（后者覆盖前者 ⇒ 无明细时兜底取「最后出现的合计」）
  let pendingTotal = false;   // 上行是「纯标签合计行」⇒ 本行数字归合计，不进 numbers
  const numbers = [];
  for (const line of lines) {
    const n = firstNumber(line);
    const isTotalLabel = /合计|总计|total|小计/i.test(line);
    if (n === null) {
      // 纯文字行：合计标签 ⇒ 开启悬空态（金额在下一行）；其余表头/说明列照旧跳过
      if (isTotalLabel) { hasTotal = true; pendingTotal = true; }
      continue;
    }
    if (isTotalLabel) {                 // 形态一：同行（合计⇥7140.00）
      hasTotal = true; pendingTotal = false; totalValue = n; continue;
    }
    if (pendingTotal) {                 // 形态二：悬空标签后的第一个数字行（合计⏎7140.00）
      hasTotal = true; pendingTotal = false; totalValue = n; continue;
    }
    sum += n;
    numbers.push(n);
  }
  return { sum, hasTotal, totalValue, numbers, raw };
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
  if (!res) return '';
  if (Array.isArray(res.numbers) && res.numbers.length > 0) {
    const v = Number(res.sum);
    return Number.isFinite(v) ? v.toFixed(2) : '';
  }
  // 🔴 R120 兜底：排除后**一个明细数字都不剩**（用户只复制了合计那一行/那两行）⇒ 填合计值，
  //   而不是回「未提取到数字」（旧行为：同行合计给空、换行合计反而填对 ⇒ 同一份账单两种结果）。
  //   ⚠️ 必须显式判 null/undefined：Number(null) === 0 且 isFinite(0) === true，
  //     否则「空文本 / 纯表头」会被误填成 0.00（用例 E1/E2 守这条）。
  const tv = res.totalValue;
  if (tv === null || tv === undefined) return '';
  const v = Number(tv);
  return Number.isFinite(v) ? v.toFixed(2) : '';
}

/**
 * 本次填入是否**来自合计兜底**（而非明细求和）——页面据此给不同提示。
 * 语义：没有任何明细数字、但有可用的合计值。
 * @param {{numbers:number[], totalValue:number|null}} res
 * @returns {boolean}
 */
function pasteFilledFromTotal(res) {
  if (!res) return false;
  if (Array.isArray(res.numbers) && res.numbers.length > 0) return false;
  const tv = res.totalValue;
  if (tv === null || tv === undefined) return false;
  return Number.isFinite(Number(tv));
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
 * 机器近似校验式（A.11.4 b，🔴 R164 修正实现）：
 *   应有商家应收款 ≈ 优惠前总额 − 商家承担补贴 − 佣金 − 配送服务费 − 配送补贴
 *
 * 🔴 为什么不是规范字面那一行（R164 · 用真值证伪，见 NOTE_2026-09-28_round164）：
 *   收入侧「外卖收入合计」是三框相加 ⇒ **本身就含补贴框的值**（符号随客户填法：填正数则加、填负数则减）。
 *   按规范字面只减一次补贴，结果恒等于「优惠前总额 − 佣金 − 配送」⇒ **补贴被完全抵消、一次都没扣**。
 *   真值验算（8 月实测账单 156 行，见 review/evidence/r161_waimai）：expected 恒 = 5849.35，而真实到手 3779.65，
 *   **差恰好 = 商家承担补贴 2069.70 ⇒ 恒定误报「漏填 2069.70」，客户改无可改**。
 *   正确做法两步走：① `incomeTotal − subsidy` 还原优惠前总额；② 再**真实扣一次**补贴（取绝对值 ⇒ 正负号都算对）。
 * @param {object} p {
 *   incomeTotal,     // 外卖收入合计（快速模式 = 各平台总额之和；分项模式 = 各平台小计之和）（元，含补贴框的值）
 *   subsidy,         // 商家承担补贴合计（元，符号随客户填法，取绝对值参与扣减）
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
  // R164：两步走。① 还原优惠前总额（收入合计里含了补贴框的值，先按原符号抵消掉）；
  //          ② 真实扣一次补贴（取绝对值 ⇒ 客户填正数/负数都得同一个正确答案）。
  const gross = incomeTotal - subsidy;
  const expected = gross - Math.abs(subsidy) - commission - deliveryFee - deliverySubsidy;
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

// ===================== 分平台佣金小计（T1，round97 · 只回显不入库） =====================

/**
 * 分平台佣金合计（元）。小计区只是**录入加速器**：按各平台账单填完，合计由这里算，
 * 页面再把它**汇成**营销段佣金总额那一行（入库仍只有一个数，不动库结构与会计口径）。
 * @param {Array} list [{platform, amountYuan}]
 * @returns {number} 合计（元）；空值 / 缺值按 0
 */
function mkByPlatTotal(list) {
  return (Array.isArray(list) ? list : []).reduce((s, p) => s + (Number(p && p.amountYuan) || 0), 0);
}

/**
 * 分平台小计**是否已有任一非空输入** —— 决定要不要「接管」佣金总额那一行。
 * ⚠️ 这是本功能的第一红线：**全空必须返回 false**，否则每次进页都会把库里已存的佣金清零。
 * ⚠️ 语义与页面其它「已填」判据一致：填 `0` 也算填过（只看有没有输入，不看数值大小）。
 * @param {Array} list [{platform, amountYuan}]
 * @returns {boolean}
 */
function mkByPlatFilled(list) {
  return (Array.isArray(list) ? list : []).some((p) => {
    const v = p && p.amountYuan;
    return String(v === undefined || v === null ? '' : v).trim() !== '';
  });
}

module.exports = {
  pickTakeawayMode, takeawayModeKey, snapshotDetail, restoreDetail, subtotalOf,
  extractPaste, firstNumber, stripNonMoney, pasteFillValue, pasteFilledFromTotal, filledLabel,
  subsidyTotal, reconcile, RECONCILE_THRESHOLD,
  mkByPlatTotal, mkByPlatFilled,
  // R162：有效订单数（只回显，不进金额）
  qtyTotal, perOrderYuan,
};
