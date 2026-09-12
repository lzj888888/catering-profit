/**
 * POC2 · BOM 两层嵌套与循环引用拦截（Node 验证原型）
 *
 * 依据：specs/dev-specs/poc/POC2_BOM两层与循环拦截.md
 * 严格实现：原料净料成本 / 单品(单份·批量)成本 / 辅料按损耗放大 / 虚拟原料 / 快照 / 循环检测
 *
 * 金额：原料单价、用量、净料成本用双精度浮点中间计算，最后结果 round 到分展示。
 *   （生产云函数应改为整数分存储；本原型验证「算法逻辑正确性」，双精度对两位以下小数足够，
 *    且能暴露文档锚点偏差——test_poc2.js 已按「口径 B」锁定宫保鸡丁总成本 9.75（旧文档 9.76 为笔误）。）
 */

// 净料单位成本（元/克）—— ModuleM3:60 纪律：中间保留 4 位小数（禁止原始双精度直接累积）
function netCostPerGram(unitPriceYuan, convToGram, yieldPct) {
  const perGram = unitPriceYuan / convToGram;          // 采购每克
  const net = perGram / (yieldPct / 100);              // 净料单位成本
  return Math.round(net * 10000) / 10000;              // 锁定 4 位小数，杜绝浮点漂移（2位→9.05 / 3位→9.68 反例）
}

/**
 * @param {Object} card
 * @param {('single'|'batch')} card.mode  单份 / 批量
 * @param {number} card.lossPct           菜品制作损耗率 %
 * @param {number} card.auxYuan           辅料综合分摊成本（元）
 * @param {Array}  card.items  [{ref, amount, netCost}]  amount=用量(克或份)，netCost=该行净料单位成本(元/单位，已快照)
 * @param {number} [card.batchShares]     批量模式：本批次总产出份数
 */
function calcDishCost(card) {
  let detail = 0;
  for (const it of card.items) detail += it.amount * it.netCost; // 明细净料成本合计（netCost 已锁 4 位小数）
  const denom = 1 - card.lossPct / 100;                          // (1 - 损耗率)
  if (card.mode === 'batch') {
    const batchTotal = (detail + card.auxYuan) / denom;          // 整批总成本
    const perShare = batchTotal / card.batchShares;              // 单份半成品成本
    return { detail, batchTotal, perShare, totalFen: Math.round(batchTotal * 100) }; // 落库值=整数分
  }
  const total = (detail + card.auxYuan) / denom;                 // 单品原材料总成本（辅料一并放大）
  return { detail, total, totalFen: Math.round(total * 100) };   // totalFen = 生产落库整数分（ModuleM3:62）
}

// 反算售价：目标毛利率 g% -> 售价 = 总成本 / (1 - g/100)
function reversePrice(totalCost, targetMarginPct) {
  return totalCost / (1 - targetMarginPct / 100);
}

// 循环引用检测：沿半成品引用链 DFS，回到正在访问的节点即环
function detectBomCycle(cardId, refIds, allCards) {
  const visiting = new Set();
  function dfs(id) {
    if (visiting.has(id)) return true; // 回到自身 -> 环
    visiting.add(id);
    const c = allCards[id];
    if (c && c.refSemiIds) {
      for (const ref of c.refSemiIds) if (dfs(ref)) return true;
    }
    visiting.delete(id);
    return false;
  }
  for (const ref of refIds) if (dfs(ref)) return true;
  return false;
}

module.exports = { netCostPerGram, calcDishCost, reversePrice, detectBomCycle };
