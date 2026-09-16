// cloudfunctions/syncCostCard/service.js —— 批次 3 · POC2 成本卡「按原料最新价格另存新版本」（Service 层纯逻辑）
//
// 自包含：与 calcBom / saveCostCard 同源成本的引擎在此内联一份（云函数无法跨包 require）。
// 行为：取指定 card_code 的**最新版本**卡元数据（模式 / 损耗 / 辅料 / 售价 / 产出份数）与其现有
//   明细行（material_id + quantity），用**原料当前最新净料单位成本**重新构建快照并重算成本 → 生成新版本。
//   旧版本保留（只 INSERT 不 UPDATE）。快照隔离：新版本用最新价，旧版本仍用各自保存时的快照。
const { ERROR_CODES } = require('./common');

function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  const yuan = (purchasePriceFen / 100) / convertFactor / (yieldRate / 100);
  return Math.round(yuan * 10000);
}

// 用「最新原料成本」重建快照明细：行 = 用量(旧) × 原料当前 net_unit_cost(万分)
function rebuildSnapshotLines(existingLines, materialsById) {
  const lines = [];
  for (const ln of (existingLines || [])) {
    const mat = materialsById.get(String(ln.material_id));
    if (!mat) {
      const e = new Error(`原料 ${ln.material_id} 不存在或已软删，无法同步`);
      e.code = 'RESOURCE_NOT_FOUND';
      throw e;
    }
    lines.push({
      material_id: String(ln.material_id),
      material_name: mat.name || ln.material_name || '',
      quantity: Number(ln.quantity) || 0,
      net_unit_cost: Number(mat.net_unit_cost) || 0, // 快照：取原料**当前**净料单位成本
    });
  }
  return lines;
}

// 成本引擎（与 calcBom.calcCostCard 同款）
function calcCostCard(p) {
  const lines = (p && Array.isArray(p.lines)) ? p.lines : [];
  const mode = (p && p.mode === 'B') ? 'B' : 'A';
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
  if (priceFen > 0) { grossProfitFen = priceFen - unitCostFen; grossMarginPct = Math.round((grossProfitFen / priceFen) * 10000) / 100; }
  let reversePriceFen = 0;
  if (p && Number.isFinite(p.targetMarginPct) && p.targetMarginPct > 0 && p.targetMarginPct < 100) reversePriceFen = Math.round(unitCostFen / (1 - p.targetMarginPct / 100));
  return { material_total_fen: materialTotalFen, lines: lineOut, unit_cost_fen: unitCostFen, batch_total_fen: batchTotalFen, gross_profit_fen: grossProfitFen, gross_margin_pct: grossMarginPct, reverse_price_fen: reversePriceFen };
}

// 由最新版本卡 doc 派生「干净卡参数」（模式 / 损耗 / 辅料 / 售价 / 产出）
function cardParamFromDoc(doc) {
  return {
    mode: (doc.calc_mode === 2) ? 'B' : 'A',
    lossPct: doc.loss_rate != null ? doc.loss_rate : 0,
    auxFen: doc.aux_cost != null ? doc.aux_cost : 0,
    priceFen: doc.price_list != null ? doc.price_list : 0,
    batchOutput: doc.batch_output != null ? doc.batch_output : 0,
  };
}

module.exports = { netUnitCostWan, rebuildSnapshotLines, calcCostCard, cardParamFromDoc, ERROR_CODES };