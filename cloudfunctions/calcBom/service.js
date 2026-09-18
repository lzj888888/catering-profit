// cloudfunctions/calcBom/service.js —— 批次 3 · POC2 BOM 两层 + 快照成本（Service 层纯引擎，本批核心锚点）
//
// ⚠️ 分层铁律：本文件是「纯函数」，只做计算，绝不：
//   · require('wx-server-sdk') / 触碰数据库（批次 0 约定 Service 层禁止引入云开发 SDK）
//   · 接触前端请求对象（wx-server-sdk 只在 index.js 的 Controller 使用）
//
// 定价 / 快照精度的权威口径（对齐 M3 §3 核心计算引擎 + _02 数据集 S3 + POC2）：
//   · 采购每克成本(元) = 采购单价(分) ÷100 ÷ 换算系数(→g)
//   · 净料单位成本(元)   = 采购每克成本 ÷ (出成率 ÷ 100)
//   · ⚠️ 精度纪律（M3 反例锚点：4 位 → 9.75 ✅ / 3 位 → 9.68 ❌）：
//        净料单位成本必须**round 到 4 位小数（元）**（本引擎以「万分之一元」的整数表示，
//        即 0.0001 元的整数倍），再作为快照值存储与求积；中间任意高精度累积，仅**最后一步**
//        对「单品原材料总成本」 round 到分（2 位）落库。
//        例：鸡胸肉 15 元/斤、出成率 90% → (15/500)/(0.9) = 0.033333… 元 → round4 = 0.0333 元
//           = 333「万分」。200g × 333/10000 = 6.66 元。
//   · 明细净料成本合计 = Σ(每行用量 × 该行净料单位成本快照)（高精度累积，不逐行 round）
//   · 单品原材料总成本(元) = (明细合计 + 辅料分摊) ÷ (1 − 制作损耗率 ÷ 100)，最后 round 到分。
//     ⚠️ 建模假设（不得"优化"）：辅料与原料**一并**按 (1 − 制作损耗率) 放大。若辅料排除放大，
//       宫保会从 9.75 变 9.73 —— 那是错误锚点。
//   · 模式 A（单份）：辅料 = 单份金额；总成本即单份成本。
//   · 模式 B（批量预制）：辅料 = **整批**金额（不是单份×份数！）；整批总成本 = (合计 + 整批辅料) ÷ …
//       单份半成品成本 = 整批总成本 ÷ 本批次总产出份数。⚠️ 见 M3 红字：勿把整批辅料×份数。
//   · 单品毛利          = 建议挂牌售价 − 单品原材料总成本
//   · 单品毛利率(%)     = 单品毛利 ÷ 建议挂牌售价 × 100（按**先 round 到分**的成本反推，禁止双精度直算）
//   · 反算售价(元/分)   = 单品原材料总成本 ÷ (1 − 目标毛利率 ÷ 100)，round 到分
//
// 所有金额输出一律「分」整数（INT）。净料单位成本为唯一的小数金额，以「万分之一元」整数表达。

// ===================== 单位换算 / 精度（核心） =====================

// 采购每克成本（元，不全 rounding，仅做高精度中间值）。
// 入参：purchasePriceFen=采购单价（分），convertFactor=换算系数(→g)。
function purchasePerGramYuan(purchasePriceFen, convertFactor) {
  return (purchasePriceFen / 100) / convertFactor;
}

/**
 * 净料单位成本（元，round 到 4 位）→ 以「万分之一元」的整数返回。
 * @param {number} purchasePriceFen 采购单价（分）
 * @param {number} convertFactor     换算系数(→g)
 * @param {number} yieldRate         出成率%（100 = 100%）
 * @returns {number} 整数，单位 = 0.0001 元（万分）
 *
 * 例：鸡胸肉 15 元/斤(1500 分) / 500g / 出成率 90%
 *   → (1500/100)/500/(0.9) = 0.033333…元 → Math.round(0.033333*10000) = **333**（即 0.0333 元）
 */
function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  const yuan = purchasePerGramYuan(purchasePriceFen, convertFactor) / (yieldRate / 100);
  return Math.round(yuan * 10000); // round 到 4 位小数（万分）
}

// 行净料成本（元，高精度）：用量 × 净料单位成本快照（万分→元）。不 round。
function lineNetCostYuan(quantity, netUnitWan) {
  return quantity * (netUnitWan / 10000);
}

// ===================== 成本卡计算（核心公式） =====================

/**
 * 计算一张成本卡的完整成本输出（纯函数）。
 * @param {object} p
 *   - lines: [{ quantity(number，g 或 份), net_unit_cost(万分整数快照) }]，已由 Controller/上层填好快照
 *   - auxFen: 辅料综合分摊成本（分）。口径随模式：A=单份；B=整批（勿×份数）。
 *   - lossPct: 制作损耗率%（默认 0）
 *   - mode: 'A' | 'B'
 *   - batchOutput: 模式 B 的本批次总产出份数（模式 A 忽略）
 *   - priceFen: 建议挂牌售价（分，可为 0）
 *   - targetMarginPct: 反算目标毛利率%（可选）
 * @returns {object} {
 *   material_total_fen,   // 明细净料成本合计（分，round）
 *   lines: [{ quantity, net_unit_cost(万分), line_net_cost_fen }],
 *   unit_cost_fen,        // 单品总成本 / 单份半成品成本（分，round 到分）
 *   gross_profit_fen,     // 单品毛利（分）
 *   gross_margin_pct,     // 单品毛利率%（保留 2 位，成本取 round 后值反推）
 *   reverse_price_fen,    // 反算售价（分，round）
 *   batch_total_fen,      // 模式 B：整批总成本（分，round）；模式 A 为 null
 * }
 */
function calcCostCard(p) {
  const lines = (p && Array.isArray(p.lines)) ? p.lines : [];
  // R81：mode 白名单（断言式）—— 非法值**抛错**，不再静默兜底 A。
  //   与 validate.js 构成双保险：validate 守入口，这里守引擎（syncCostCard 等旁路也会经过）。
  //   历史兜底会把 'b' / 2 / 'C' / '' / 缺失 静默当 A ⇒ 成本语义悄悄变错且无报错。
  //   'INVALID_PARAM' 与 common/errors.js::ERROR_CODES.INVALID_PARAM 同值（Service 层保持零依赖）。
  if (!p || (p.mode !== 'A' && p.mode !== 'B')) {
    throw { code: 'INVALID_PARAM', msg: 'card.mode 必须是 "A" 或 "B"（当前值：' + JSON.stringify(p && p.mode !== undefined ? p.mode : null) + '）' };
  }
  const mode = p.mode;
  const lossPct = p && Number.isFinite(p.lossPct) ? p.lossPct : 0;
  const auxFen = (p && Number.isFinite(p.auxFen)) ? p.auxFen : 0;

  // 明细净料成本合计（元）—— 高精度累积（不逐行 round）
  let detailSumYuan = 0;
  const lineOut = [];
  for (const ln of lines) {
    const qty = Number(ln.quantity) || 0;
    const wan = Number(ln.net_unit_cost) || 0; // 万分快照
    const yuan = lineNetCostYuan(qty, wan);
    detailSumYuan += yuan;
    lineOut.push({
      quantity: qty,
      net_unit_cost: wan,
      line_net_cost_fen: Math.round(yuan * 100), // 展示用；合计用高精度 yuan，不逐行 round 累加
    });
  }

  // 明细合计（元）→ 分
  const materialTotalFen = Math.round(detailSumYuan * 100);

  // 单品原材料总成本：((明细合计) + 辅料) ÷ (1 − 损耗%)，中间高精度，仅最后 round 到分
  const divisor = 1 - lossPct / 100;
  const rawTotalYuan = (detailSumYuan + auxFen / 100) / divisor;
  const unitCostFen = Math.round(rawTotalYuan * 100); // round 到分（落库值）

  let batchTotalFen = null;
  let finalUnitFen = unitCostFen;
  if (mode === 'B') {
    batchTotalFen = unitCostFen; // 整批总成本 = round 后的单品总成本（冗余：整批总额）
    const out = p.batchOutput && p.batchOutput > 0 ? p.batchOutput : 1;
    // 单份半成品成本 = 整批总成本 ÷ 产出份数；整批成本已 round 到分，再用高精度相除后 round 到分
    finalUnitFen = Math.round((batchTotalFen / out));
  }

  // 毛利 / 毛利率（成本取 round 后的 unitCostFen 反推，禁止原始双精度直算比例）
  const priceFen = p && Number.isFinite(p.priceFen) ? p.priceFen : 0;
  let grossProfitFen = 0;
  let grossMarginPct = 0;
  if (priceFen > 0) {
    grossProfitFen = priceFen - finalUnitFen;
    grossMarginPct = Math.round((grossProfitFen / priceFen) * 10000) / 100; // 保留 2 位
  }

  // 反算售价：成本 ÷ (1 − 目标毛利率 ÷ 100)
  let reversePriceFen = 0;
  if (p && Number.isFinite(p.targetMarginPct) && p.targetMarginPct > 0 && p.targetMarginPct < 100) {
    reversePriceFen = Math.round(finalUnitFen / (1 - p.targetMarginPct / 100));
  }

  return {
    material_total_fen: materialTotalFen,
    lines: lineOut,
    unit_cost_fen: finalUnitFen,
    batch_total_fen: batchTotalFen,
    gross_profit_fen: grossProfitFen,
    gross_margin_pct: grossMarginPct,
    reverse_price_fen: reversePriceFen,
  };
}

// ===================== 反算售价（独立入口，兼容契约） =====================

function calcReversePrice(unitCostFen, targetMarginPct) {
  if (!Number.isFinite(targetMarginPct) || targetMarginPct <= 0 || targetMarginPct >= 100) return 0;
  return Math.round(unitCostFen / (1 - targetMarginPct / 100));
}

module.exports = {
  // 工具
  purchasePerGramYuan,
  netUnitCostWan,
  lineNetCostYuan,
  // 主引擎（契约 calcBom 的正文）
  calcCostCard,
  calcReversePrice,
};