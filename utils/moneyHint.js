// utils/moneyHint.js —— 金额化单源（会审 R637：把「率」变成「钱」）
//
// 为什么必须金额化：
//   老板看不懂「毛利率 18%」—— 那是会计语言。
//   「这道菜每卖一份亏 1.2 元」是**他自己口袋里的语言**，看一眼就会停下来。
//
// 🔴 会审硬约束（原话）：
//   「需要老板填一个数：这菜一天大概卖几份。**没有销量就只给单份金额，绝不编总数。**」
//   ⇒ 本模块**只做单份金额**。任何"一个月少赚 1080 元"这类总额，
//     必须先拿到老板自己填的销量，否则一律不给 —— 拿行业均值替他编数是最恶劣的做法。
//
// 纯函数、零 IO ⇒ 可被 selftest 直测，也可被页面 require。

const FEN = 100;

/**
 * 单份金额化文案。
 * @param {number} costFen   单份成本（分）
 * @param {number} priceFen  售价（分）
 * @param {number} targetMarginPct 老板自己设的目标毛利率（0-100，可空）
 * @returns {{kind:'loss'|'thin'|'', text:string, perFen:number}} kind 为空表示不提示
 */
function moneyHint(costFen, priceFen, targetMarginPct) {
  const c = Number(costFen) || 0;
  const p = Number(priceFen) || 0;
  // 成本或售价缺失 ⇒ 算不出来就不说，绝不拿半个数编话
  if (!(c > 0) || !(p > 0)) return { kind: '', text: '', perFen: 0 };
  const perFen = p - c;
  const yuan = (fen) => (Math.abs(fen) / FEN).toFixed(2);

  if (perFen < 0) {
    return { kind: 'loss', text: `每卖一份亏 ${yuan(perFen)} 元`, perFen };
  }
  if (perFen === 0) {
    return { kind: 'loss', text: '每卖一份正好保本，一分不赚', perFen };
  }
  // 赚钱：只在老板**自己**设过目标毛利率、且实际低于目标时才提醒
  //   —— 不替他定"多少算低"（火锅和快餐的合格线本来就不同）
  const t = Number(targetMarginPct);
  const actualPct = (perFen / p) * 100;
  if (t > 0 && actualPct < t) {
    return {
      kind: 'thin',
      text: `每卖一份只赚 ${yuan(perFen)} 元，毛利率 ${actualPct.toFixed(1)}% 低于你设的 ${t}%`,
      perFen,
    };
  }
  return { kind: '', text: '', perFen };
}

/**
 * 有销量时才给总额（老板自己填的销量，不是我们猜的）。
 * @param {number} perFen    单份盈亏（分，亏为负）
 * @param {number} qtyPerDay 老板填的「一天大概卖几份」
 * @returns {{day:string, month:string}|null} 没填销量 ⇒ null（**绝不推算**）
 */
function moneyTotal(perFen, qtyPerDay) {
  const q = Number(qtyPerDay);
  if (!(q > 0)) return null;
  const dayFen = Math.round(perFen * q);
  const yuan = (fen) => (Math.abs(fen) / FEN).toFixed(2);
  const sign = dayFen < 0 ? '亏' : '赚';
  return {
    day: `一天约${sign} ${yuan(dayFen)} 元`,
    // ⚠️ 30 天：这是"一个月"的口语口径，不按当月实际天数（老板对"一天×30"有直觉）
    month: `一个月约${sign} ${yuan(dayFen * 30)} 元`,
  };
}

module.exports = { moneyHint, moneyTotal };
