// cloudfunctions/syncCostCard/service.js —— 批次 3 · POC2 成本卡「按原料最新价格另存新版本」（Service 层纯逻辑）
//
// 自包含：与 calcBom / saveCostCard 同源成本的引擎在此内联一份（云函数无法跨包 require）。
// 行为：取指定 card_code 的**最新版本**卡元数据（模式 / 损耗 / 辅料 / 售价 / 产出份数）与其现有
//   明细行（material_id + quantity），用**原料当前最新净料单位成本**重新构建快照并重算成本 → 生成新版本。
//   旧版本保留（只 INSERT 不 UPDATE）。快照隔离：新版本用最新价，旧版本仍用各自保存时的快照。
const { ERROR_CODES } = require('./common');

function netUnitCostWan(purchasePriceFen, convertFactor, yieldRate) {
  // 🔴 R298（D2）：出成率 / 换算系数**夹紧**（口径同前端 utils/units.js::yieldRateOf：未填=100）。
  //   原实现裸除 ⇒ yieldRate=0 时 ÷0 = Infinity、缺失时 NaN、>100 时成本被系统性低估（静默错账）。
  //   手工行路径（saveCostCard/index.js）云端**无 validate 兜底** ⇒ 必须在本函数内 fail-closed。
  //   越界 / 缺失 / 非数 ⇒ 100（不折损，中性值）；换算系数 ≤0 ⇒ 1。
  const y = Number(yieldRate);
  const yr = (Number.isFinite(y) && y > 0 && y <= 100) ? y : 100;
  const cf = Number(convertFactor) > 0 ? Number(convertFactor) : 1;
  const yuan = (purchasePriceFen / 100) / cf / (yr / 100);
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
      // 🔴 H2（2026-10-27 审计）：line_kind / group_name 是「规格缩放」与「分组」的唯一依据。
      //   原实现只搬 8 个字段 ⇒ 同步一次后全部兜底成 'main' ⇒ 半份/小份成本静默算错且不可逆
      //   （specDerive.kindOf 只认 line_kind：调料/耗材/半成品「不减半」规则全部失效）。
      line_kind: ln.line_kind || 'main',
      group_name: ln.group_name || '',
      // 任务1（S0）：快照补 5 字段（与 saveCostCard.buildSnapshotLines 同字段集）
      brand_spec: mat.brand_spec || '',
      purchase_unit: mat.purchase_unit || '',
      purchase_price: mat.purchase_price != null ? mat.purchase_price : 0, // 整数分
      convert_factor: mat.convert_factor != null ? mat.convert_factor : 0,
      yield_rate: mat.yield_rate != null ? mat.yield_rate : 0,
    });
  }
  return lines;
}

// 成本引擎（与 calcBom.calcCostCard 同款）
function calcCostCard(p) {
  const lines = (p && Array.isArray(p.lines)) ? p.lines : [];
  // R81：mode 白名单（断言式）—— 非法值**抛错**，不再静默兜底 A。
  //   与 validate.js 构成双保险：validate 守入口，这里守引擎（syncCostCard 等旁路也会经过）。
  //   历史兜底会把 'b' / 2 / 'C' / '' / 缺失 静默当 A ⇒ 成本语义悄悄变错且无报错。
  //   'INVALID_PARAM' 与 common/errors.js::ERROR_CODES.INVALID_PARAM 同值（与另两副本同口径）。
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
    // 🔴 R298（B2）：**十进制安全** —— 原式 `Math.round(<元> * 100)` 在半步（真值恰为 x.xx5）会
    //   **少进 1 分**（实测 qty=0.1 × 净料 14500 万分之元 ⇒ 真值 14.5 分，原式取 14）。根因与
    //   `money.yuanToFen` 同一处浮点：`toFixed(10)` 只消 1e-13 量级噪声、不动真实半步。
    //   成本引擎三副本（calcBom / saveCostCard / syncCostCard）**必须同源同口径**。
    lineOut.push({ quantity: qty, net_unit_cost: wan, line_net_cost_fen: Math.round(Number((yuan * 100).toFixed(10))) });
  }
  const materialTotalFen = Math.round(Number((detailSumYuan * 100).toFixed(10)));
  const divisor = 1 - lossPct / 100;
  const rawTotalYuan = (detailSumYuan + auxFen / 100) / divisor;
  let unitCostFen = Math.round(Number((rawTotalYuan * 100).toFixed(10)));
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

/**
 * #21（2026-10-31）内容级幂等：判断「这次同步算出来的内容，与最新版本是否逐行相同」。
 *
 * 为什么需要：R408 只挡得住**本页面**的重复点击（`syncing` 标志 + 幂等键），挡不住
 *   旧版客户端 / 越权直调 / 脚本 —— 这些来源每调一次都会 INSERT 一个新版本（版本号连跳、
 *   内容完全重复）。真正的兜底只能由服务端自己判「内容没变就别建版本」。
 *
 * 判据（只比会写进新版本的字段，不比 `_id` / `sort_order` / 时间戳）：
 *   - 卡级：`total_cost`（整数分，成本变了必然要出新版本）
 *   - 行级：material_id / material_name / quantity / net_unit_cost /
 *           line_type / input_type / group_name / sub_card_ref / sub_version
 *   - 数值用 1e-6 容差（`0.1+0.2` 类浮点噪声不该造出新版本）
 *
 * ⚠️ `sub_version` 必须比：子卡升版但成本恰好没变时，套餐仍要记下新版本号（锁版本语义）。
 * ⚠️ 不比 `line_net_cost`：它由 quantity × net_unit_cost 派生，前两项相同则它必然相同。
 *
 * @returns {boolean} true = 与最新版内容完全相同（不必新建版本）
 */
function syncContentEqual(latestCard, existingLines, newLines, result) {
  if (!latestCard || !result) return false;
  if (Number(latestCard.total_cost || 0) !== Number(result.unit_cost_fen || 0)) return false;
  if (!Array.isArray(existingLines) || !Array.isArray(newLines)) return false;
  if (existingLines.length !== newLines.length) return false;
  const eqNum = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-6;
  for (let i = 0; i < existingLines.length; i++) {
    const a = existingLines[i] || {};
    const b = newLines[i] || {};
    if (String(a.material_id || '') !== String(b.material_id || '')) return false;
    if (String(a.material_name || '') !== String(b.material_name || '')) return false;
    if (!eqNum(a.quantity, b.quantity)) return false;
    if (!eqNum(a.net_unit_cost, b.net_unit_cost)) return false;
    if (Number(a.line_type || 1) !== Number(b.line_type || 1)) return false;
    if (Number(a.input_type || 1) !== Number(b.input_type || 1)) return false;
    if (String(a.group_name || '') !== String(b.group_name || '')) return false;
    if (String(a.sub_card_ref || '') !== String(b.sub_card_ref || '')) return false;
    if (!eqNum(a.sub_version, b.sub_version)) return false;
  }
  return true;
}

module.exports = { netUnitCostWan, rebuildSnapshotLines, calcCostCard, cardParamFromDoc, ERROR_CODES, syncContentEqual };