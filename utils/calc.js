// 餐饮毛利核算核心计算
function calcDish(d) {
  const sellPrice = Number(d.sellPrice) || 0;
  const unitCost = Number(d.unitCost) || 0;
  const soldQty = Number(d.soldQty) || 0;
  const revenue = sellPrice * soldQty;
  const cost = unitCost * soldQty;
  const profit = revenue - cost;
  const rate = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { revenue, cost, profit, rate };
}

function calcSummary(dishes, fixedCosts) {
  const fc = fixedCosts || { rent: 0, labor: 0, utility: 0 };
  let totalRevenue = 0;
  let totalCost = 0;
  dishes.forEach(d => {
    const r = calcDish(d);
    totalRevenue += r.revenue;
    totalCost += r.cost;
  });
  const grossProfit = totalRevenue - totalCost;
  const grossRate = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const fixedTotal = (Number(fc.rent) || 0) + (Number(fc.labor) || 0) + (Number(fc.utility) || 0);
  const netProfit = grossProfit - fixedTotal;
  return { totalRevenue, totalCost, grossProfit, grossRate, fixedTotal, netProfit };
}

module.exports = { calcDish, calcSummary };
