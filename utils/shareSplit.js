// utils/shareSplit.js —— R307 · 「核心爆品占比拆分」参考榜（纯函数 · 零外部依赖）
//
// 🔴 为什么做它（R306 路线决策，李老师授权全权操作）：
//   外卖「单品销量」只能靠平台导出 Excel，而**只有淘宝闪购的表准确**，京东/美团不准且拿不到，
//   老板实际也很少去后台下载表 ⇒ 这条链路大概率走不通（R300/R302/R303 三轮已确认）。
//   但 M3 的核心价值是「**单位单品毛利**」（比销量榜更底层：支撑调价/汰换），
//   它**不需要任何平台数据** —— 只要成本卡（售价 + 单份成本）。
//   ⇒ 补一个「轻量补位」：老板看着平台 App 上的**总订单数**，只填几个核心菜的**销量占比**，
//     系统按占比拆出**参考级**毛利贡献榜。**不用导表、不新增数据源。**
//
// 🔴 三条铁律（本仓最忌"假精确"，宁可少说不可说错）：
//   ① 本榜是**估算**，必须与「实测榜」互斥展示、且文案明标"估算" —— 不许混排、不许显示得像实测；
//   ② 占比合计 <100% **不归一**（剩下的就是"其他菜"，老板心里有数）；>100% **直接拒绝**
//      —— 自动归一等于替老板编数（他填 3 个 50% 也能算出结果，那是假的）；
//   ③ 没有订单数（M1 没填「有效订单数」）⇒ **不算**，返回 `needOrderCount` 让它去填，**不编 0 单**。
//
// 算法（四则，可单测）：
//   估算份数 = 本月外卖有效订单数 × 占比           （**取整**：份数不能是小数）
//   单份毛利 = 售价 − 单份总成本                    （**可为负** ⇒ 亏本菜必须原样露出）
//   毛利贡献 = 估算份数 × 单份毛利                  （分，整数）

/** 最多几行（老板填 3–5 个核心菜就够，多了反而没人填） */
const MAX_ROWS = 5;

/** 占比上界（单行）；合计另判 */
const PCT_MAX = 100;

function toNum(v) {
  const n = Number(String(v === undefined || v === null ? '' : v).trim());
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 校验「菜品 + 占比」这几行能不能算。
 * @param {Array} rows [{ cardCode, name, priceFen, costFen, pctText }]
 * @returns {{ ok:boolean, errors:string[], totalPct:number, filledCount:number }}
 *   errors 里的 code（页面按 code 查 terms，人话在前端）：
 *     noRows      一行都没选 |
 *     dupCard     同一个菜选了两遍 |
 *     pctInvalid  某个占比不是数字 / 负数 |
 *     pctOver     单个占比 >100 |
 *     pctSumOver  合计 >100（**拒绝，不归一**）
 *     noPrice     某道菜没填售价（算不出毛利） |
 *     costOver   售价 < 单份成本（**允许算**，但页面要提示这是亏本菜）
 */
function checkShares(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.cardCode);
  const errors = [];
  if (!list.length) return { ok: false, errors: ['noRows'], totalPct: 0, filledCount: 0 };

  const seen = new Set();
  let totalPct = 0;
  let filledCount = 0;
  for (const r of list) {
    if (seen.has(r.cardCode)) { if (errors.indexOf('dupCard') < 0) errors.push('dupCard'); }
    seen.add(r.cardCode);
    const p = toNum(r.pctText);
    const hasPct = String(r.pctText === undefined || r.pctText === null ? '' : r.pctText).trim() !== '';
    if (hasPct) {
      if (Number.isNaN(p) || p < 0) { if (errors.indexOf('pctInvalid') < 0) errors.push('pctInvalid'); }
      else if (p > PCT_MAX) { if (errors.indexOf('pctOver') < 0) errors.push('pctOver'); }
      else { totalPct += p; filledCount += 1; }
    }
    if (!(Number(r.priceFen) > 0)) { if (errors.indexOf('noPrice') < 0) errors.push('noPrice'); }
  }
  // 浮点尾差（33.3+33.3+33.4）容忍 0.05
  if (totalPct > PCT_MAX + 0.05) errors.push('pctSumOver');
  return { ok: errors.length === 0, errors, totalPct: Math.round(totalPct * 100) / 100, filledCount };
}

/**
 * 按占比拆出**参考级**毛利贡献榜。
 * @param {object} p {
 *   orderCount: number,   // 本月外卖有效订单数（来自 M1 已落库的 sub_items[].qty）
 *   rows: Array,          // 同 checkShares 的入参形状
 * }
 * @returns {{
 *   needOrderCount:boolean, needRows:boolean, errors:string[],
 *   totalPct:number, orderCount:number,
 *   list: Array<{ cardCode, name, sharePct, estQty, unitGrossFen, contribFen, marginPct, loss:boolean }>,
 *   sumContribFen:number, sumEstQty:number
 * }}
 */
function splitRank(p) {
  const o = p || {};
  const orderCount = Math.round(toNum(o.orderCount) || 0);
  const chk = checkShares(o.rows);
  const base = {
    needOrderCount: !(orderCount > 0),
    needRows: !chk.filledCount,
    errors: chk.errors,
    totalPct: chk.totalPct,
    orderCount,
    list: [],
    sumContribFen: 0,
    sumEstQty: 0,
  };
  // 🔴 没有订单数就不能算（**不编 0 单**）；有硬错（重复/超 100/非数字/没售价）也不给榜
  if (base.needOrderCount || !chk.ok) return base;

  const list = [];
  let sumContribFen = 0;
  let sumEstQty = 0;
  for (const r of (o.rows || [])) {
    if (!r || !r.cardCode) continue;
    const pct = toNum(r.pctText);
    if (!(pct > 0)) continue;                        // 没填/填 0 ⇒ 这行不参与（不算"占比 0 的菜"）
    const priceFen = Math.round(toNum(r.priceFen) || 0);
    const costFen = Math.round(toNum(r.costFen) || 0);
    const unitGrossFen = priceFen - costFen;
    // 份数取整：不能出现"48.6 份"
    const estQty = Math.round((orderCount * pct) / 100);
    const contribFen = Math.round(estQty * unitGrossFen);
    sumContribFen += contribFen;
    sumEstQty += estQty;
    list.push({
      cardCode: r.cardCode,
      name: r.name || r.cardCode,
      sharePct: Math.round(pct * 100) / 100,
      estQty,
      unitGrossFen,
      contribFen,
      marginPct: priceFen > 0 ? Math.round((unitGrossFen * 100) / priceFen) : null,
      loss: unitGrossFen < 0,
    });
  }
  list.sort((a, b) => b.contribFen - a.contribFen);   // 毛利贡献从高到低
  return Object.assign({}, base, { list, sumContribFen, sumEstQty });
}

/** 「估算份数」显示：没有 = ''（不显示 0，也不显示 NaN）。 */
function qtyText(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? String(Math.round(v)) : '';
}

module.exports = { checkShares, splitRank, qtyText, MAX_ROWS, PCT_MAX };
