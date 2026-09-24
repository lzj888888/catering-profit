// cloudfunctions/saveCostCard/service.js —— 批次 3 · POC2 成本卡保存（Service 层纯逻辑，嵌快照 / 判环 / 成本引擎）
//
// ⚠️ 本函数包自包含：云函数无法跨包 require，故把 calcBom 的成本引擎 + detectCycle 的 DFS 判环
//    在这里各内联一份。与 calcBom/service.js 及 detectCycle/service.js 保持**同源同口径**；
//    锚点由 saveCostCard/selftest.js 与 calcBom/selftest.js 双侧核对，防漂移。
//
// 核心公式（与 calcBom 一致，见其文件头注释）：
//   净料单位成本 = round4(采购单价÷换算系数÷(出成率/100))，以「万分之一元」整数表达；
//   明细合计      = Σ(用量 × 净料单位成本快照)，高精度累积；
//   单品总成本     = (明细合计 + 辅料) ÷ (1 − 制作损耗率 ÷ 100)，**仅最后一步 round 到分**；
//   模式 B 单份     = 整批总成本 ÷ 本批次产出份数（整批辅料勿×份数）。
//
// 快照机制（核心红线）：保存瞬间，把每个原料当时的 net_unit_cost 复制进明细行快照，
//   之后改原料价**不影响**已保存成本卡。本函数只构建「快照明细 + 算好的输出」，不接触 DB。

// ===================== 单位换算 / 精度（与 calcBom 同款） =====================
function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  const yuan = (purchasePriceFen / 100) / convertFactor / (yieldRate / 100);
  return Math.round(yuan * 10000);
}

// ===================== 快照明细构建 =====================
/**
 * 把「成本卡行（material_id + qty）」映射为「带净料单位成本快照的行」。
 * @param {Array<{material_id:string,quantity:number}>} cardLines 用户录入行
 * @param {Map<string,object>} materialsById 原料映射（含对应 shop_material 文档字段）
 * @returns {{ lines: Array, childVirtualIds: Array<string> }}
 *   lines[].net_unit_cost 为「万分」整数快照；childVirtualIds = 本卡引用的虚拟半成品 id（判环用）
 * @throws {code:'RESOURCE_NOT_FOUND'} 引用了不存在的/软删原料
 */
function buildSnapshotLines(cardLines, materialsById) {
  const lines = [];
  const childVirtualIds = [];
  for (const ln of (cardLines || [])) {
    const mat = materialsById.get(String(ln.material_id));
    if (!mat) {
      const e = new Error(`原料 ${ln.material_id} 不存在或已软删`);
      e.code = 'RESOURCE_NOT_FOUND';
      throw e;
    }
    if (mat.is_virtual) childVirtualIds.push(String(ln.material_id));
    lines.push({
      material_id: String(ln.material_id),
      material_name: mat.name || '',
      quantity: Number(ln.quantity) || 0,
      net_unit_cost: Number(mat.net_unit_cost) || 0, // 万分快照（保存时上手复制）
    });
  }
  return { lines, childVirtualIds };
}

// ===================== 成本引擎（与 calcBom.calcCostCard 同款） =====================
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

  let detailSumYuan = 0;
  const lineOut = [];
  for (const ln of lines) {
    const qty = Number(ln.quantity) || 0;
    const wan = Number(ln.net_unit_cost) || 0;
    const yuan = qty * (wan / 10000);
    detailSumYuan += yuan;
    lineOut.push({ quantity: qty, net_unit_cost: wan, line_net_cost_fen: Math.round(yuan * 100) });
  }
  const materialTotalFen = Math.round(detailSumYuan * 100);

  const divisor = 1 - lossPct / 100;
  const rawTotalYuan = (detailSumYuan + auxFen / 100) / divisor;
  let unitCostFen = Math.round(rawTotalYuan * 100);

  let batchTotalFen = null;
  if (mode === 'B') {
    batchTotalFen = unitCostFen;
    const out = p.batchOutput && p.batchOutput > 0 ? p.batchOutput : 1;
    unitCostFen = Math.round(batchTotalFen / out);
  }

  const priceFen = p && Number.isFinite(p.priceFen) ? p.priceFen : 0;
  let grossProfitFen = 0, grossMarginPct = 0;
  if (priceFen > 0) {
    grossProfitFen = priceFen - unitCostFen;
    grossMarginPct = Math.round((grossProfitFen / priceFen) * 10000) / 100;
  }
  let reversePriceFen = 0;
  if (p && Number.isFinite(p.targetMarginPct) && p.targetMarginPct > 0 && p.targetMarginPct < 100) {
    reversePriceFen = Math.round(unitCostFen / (1 - p.targetMarginPct / 100));
  }
  return {
    material_total_fen: materialTotalFen,
    lines: lineOut,
    unit_cost_fen: unitCostFen,
    batch_total_fen: batchTotalFen,
    gross_profit_fen: grossProfitFen,
    gross_margin_pct: grossMarginPct,
    reverse_price_fen: reversePriceFen,
  };
}

// ===================== 循环引用预检（与 detectCycle 同款 DFS） =====================
// edgesFromVirtual：Map<虚拟半成品id, 它引用的虚拟半成品id[]>（已有半成品图）
// 本次保存会成为虚拟半成品 outputId，其 lines 引用了 childVirtualIds。
// 若从 child 沿已有「半成品→被引半成品」链能回到 outputId（或产自分自引）→ 判环。
const MAX_DEPTH = 5;
function wouldCreateCycle(outputId, childVirtualIds, edgesFromVirtual) {
  if (!outputId) return false;
  if (childVirtualIds.includes(outputId)) return true; // 直接引用自身
  for (const start of childVirtualIds) {
    // DFS 从 start 出发看能否回到 outputId
    const stack = [String(start)];
    const visiting = new Set();
    const dfs = (node, depth) => {
      if (depth > MAX_DEPTH) return true;
      if (String(node) === String(outputId)) return true;
      visiting.add(node);
      const kids = edgesFromVirtual.get(String(node)) || [];
      for (const k of kids) {
        if (stack.includes(k) || visiting.has(k)) return true;
        stack.push(k);
        if (dfs(k, depth + 1)) return true;
        stack.pop();
      }
      visiting.delete(node);
      return false;
    };
    if (dfs(start, 1)) return true;
  }
  return false;
}

module.exports = { netUnitCostWan, buildSnapshotLines, calcCostCard, wouldCreateCycle, MAX_DEPTH, judgeCardQuota };

// ===================== M3.22（批次 A1）· 成本卡配额判定（纯函数，可独立单测）=====================
// 🔴 引擎段（netUnitCostWan / buildSnapshotLines / calcCostCard / wouldCreateCycle）一字未改；
//   本函数**只新增**、不碰引擎，module.exports 仅追加 judgeCardQuota（不改动/重排既有导出）。
// 额度唯一真相源 = feature_permissions.plan_free.limits（Controller 读入后注入）。
// 维度铁律：按 shop_id 统计活跃逻辑卡号数（card_code 去重、版本不计、is_deleted=false 由 DataAdapter 过滤）。

/**
 * 成本卡配额判定（纯逻辑，不引 SDK）。
 * @param {object} limits { shop, cost_card, hard_shop, hard_card }（缺失/该 scope 值缺失 ⇒ 抛 SYSTEM_ERROR）
 * @param {number} activeCount 该 shop_id 下活跃逻辑卡号数（card_code 去重后的大小）
 * @returns {{ hit_free_limit:boolean, hit_hard_limit:boolean, free_limit:number, hard_limit:number }}
 * @throws {{code:'SYSTEM_ERROR'}} limits 缺失或 cost_card/hard_card 缺失
 */
function judgeCardQuota(limits, activeCount) {
  const used = Number(activeCount) || 0;
  const freeLimit = limits && limits.cost_card;
  const hardLimit = limits && limits.hard_card;
  if (freeLimit === undefined || freeLimit === null || hardLimit === undefined || hardLimit === null) {
    const e = new Error('配额配置缺失（plan_id=plan_free，scope=cost_card）');
    e.code = 'SYSTEM_ERROR'; // 与 common/errors.js::ERROR_CODES.SYSTEM_ERROR 同值（本 Service 层零依赖，不 require common）
    throw e;
  }
  return {
    free_limit: freeLimit,
    hard_limit: hardLimit,
    hit_free_limit: used >= freeLimit,
    hit_hard_limit: used >= hardLimit,
  };
}