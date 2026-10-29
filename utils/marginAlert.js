// utils/marginAlert.js —— P1 毛利预警 / 成本漂移预警（纯计算核心，不依赖小程序运行时）
//
// 🔴 单源纪律（本模块最重要的一条）：
//   毛利档位（高/中/低）、阈值（60/40）、色值一律取 `utils/marginBand.js`
//   （R298Y 立的「毛利率色阶/区间唯一单源」，有守卫 tools/check_m3_margin_bands.js）。
//   **本模块不定义任何毛利阈值**，只做两件事：
//     ① 把「售价 + 食材成本」算成毛利率，并把**档位**翻译成预警级别（级别是档位的函数，不另立标准）；
//     ② 对比成本变动前后的档位与毛利率，判定「降档 / 跌进低毛利 / 亏本」。
//   为什么必须如此：同一道菜在成本卡列表（色带）与本预警里必须**同色**。
//   若这里另写一套「低于目标 5 个百分点就红」，会出现列表判黄、预警判红 ——
//   正是 marginBand.js 头注记的那个用户可见自相矛盾（改前三份阈值不一致的老病）。
//
// 🔴 口径：毛利率 = (售价 − 食材成本) / 售价；食材成本**不含**燃气燃料、房租等期间费用
//   （与 utils/categoryPresets.js 的 condiment_fen / energy_fen 拆分同口径）。
//   单位统一「分」，避免浮点漂移。
//
// 🔴 公式**必须与成本引擎逐位一致**（否则同一道菜在成本卡页与预警条显示两个百分比）：
//   `cloudfunctions/syncCostCard/service.js::calcCostCard` 的
//   `Math.round(grossProfitFen / priceFen * 10000) / 100`（两位小数）。
//   本模块照此实现，且 selftest 直接 `require` 该引擎做**真行为对拍**（对拍不过即判红）。
//   ⚠️ 唯一有意分叉：`priceFen <= 0`（未定价）引擎返回 0（历史哨兵，云端靠 `noPrice` 兜住），
//   本模块返回 `null` —— 把「未定价」和「毛利 0%」分开，避免未定价卡被误判成低毛利。
//
// 🤖 守卫：utils/marginAlert.selftest.js（由 verify_all.js 的 [margin-alert] 套件执行）

const band = require('./marginBand.js');

// 档位 → 预警级别。**唯一映射点**：页面/推送只认这三档，不得各处自造边界。
const LEVEL_OF_BAND = {
  [band.KEYS.high]: 'ok',
  [band.KEYS.mid]: 'warn',
  [band.KEYS.low]: 'danger',
  [band.KEYS.none]: 'none',
};

// 档位中文名（拼提示语用，与 marginBand.KEYS 同键，避免页面另抄一份）
const BAND_CN = {
  [band.KEYS.high]: '高',
  [band.KEYS.mid]: '中',
  [band.KEYS.low]: '低',
  [band.KEYS.none]: '未定价',
};

// 档位高低次序（只用于判「是否降档」，不含阈值）
const RANK = { [band.KEYS.low]: 0, [band.KEYS.mid]: 1, [band.KEYS.high]: 2 };

// 亏本硬下限：毛利率 < 0 ⇒ 售价连食材成本都不够（比「低毛利」更严重，单独判）
const BREAK_EVEN = 0;

function round1(x) { return Math.round(x * 10) / 10; }

/** 毛利率(%)：售价 ≤0 或成本 <0 视为数据非法 ⇒ null。**两位小数，与成本引擎逐位同式**。 */
function grossMarginPct(priceFen, costFen) {
  if (!(Number(priceFen) > 0)) return null;
  if (!(Number(costFen) >= 0)) return null;
  const p = Number(priceFen);
  const c = Number(costFen);
  return Math.round(((p - c) / p) * 10000) / 100;
}

/**
 * 单品毛利预警：按**现有单源的档位**给级别，另加「亏本」硬判定。
 * @returns {{marginPct:number|null, band:string, level:'ok'|'warn'|'danger'|'none', msg:string}}
 */
function marginAlert(priceFen, costFen) {
  const marginPct = grossMarginPct(priceFen, costFen);
  const b = band.bandOf(marginPct);
  if (marginPct === null) {
    return { marginPct: null, band: b, level: 'none', msg: '未定价或成本缺失，无法判断毛利' };
  }
  if (marginPct < BREAK_EVEN) {
    return { marginPct: marginPct, band: b, level: 'danger', msg: '亏本卖：售价低于食材成本' };
  }
  const MSG = {
    [band.KEYS.high]: '毛利率达标（≥' + band.HIGH + '%）',
    [band.KEYS.mid]: '毛利率中等（' + band.MID + '%~' + band.HIGH + '%）',
    [band.KEYS.low]: '毛利率偏低（<' + band.MID + '%）',
  };
  return { marginPct: marginPct, band: b, level: LEVEL_OF_BAND[b], msg: MSG[b] };
}

/**
 * 成本漂移预警：食材成本变动后，毛利率与档位怎么变。
 * 级别同样只由**变动后的档位**决定（+ 亏本硬判），不引入额外阈值。
 * @returns {{oldMargin:number|null,newMargin:number|null,oldBand:string,newBand:string,
 *            dropPct:number,downgraded:boolean,crossedLow:boolean,level:string,msg:string}}
 */
function costDriftAlert(priceFen, oldCostFen, newCostFen) {
  const oldMargin = grossMarginPct(priceFen, oldCostFen);
  const newMargin = grossMarginPct(priceFen, newCostFen);
  if (oldMargin === null || newMargin === null) {
    return {
      oldMargin: oldMargin, newMargin: newMargin,
      oldBand: band.KEYS.none, newBand: band.KEYS.none,
      dropPct: 0, downgraded: false, crossedLow: false,
      level: 'none', msg: '数据缺失，无法判断成本漂移',
    };
  }
  const oldBand = band.bandOf(oldMargin);
  const newBand = band.bandOf(newMargin);
  const dropPct = round1(newMargin - oldMargin); // 负 = 毛利率下降
  const downgraded = RANK[newBand] < RANK[oldBand];
  const crossedLow = oldBand !== band.KEYS.low && newBand === band.KEYS.low;
  const level = (newMargin < BREAK_EVEN) ? 'danger' : LEVEL_OF_BAND[newBand];

  let msg = '成本变动后毛利率' + (dropPct <= 0 ? '降 ' : '升 ') + Math.abs(dropPct).toFixed(1) + ' 个百分点';
  if (newMargin < BREAK_EVEN) msg += '，已亏本';
  else if (crossedLow) msg += '，已跌进低毛利区';
  else if (downgraded) msg += '，档位由「' + BAND_CN[oldBand] + '」降为「' + BAND_CN[newBand] + '」';

  return {
    oldMargin: oldMargin, newMargin: newMargin,
    oldBand: oldBand, newBand: newBand,
    dropPct: dropPct, downgraded: downgraded, crossedLow: crossedLow,
    level: level, msg: msg,
  };
}

module.exports = {
  grossMarginPct, marginAlert, costDriftAlert,
  LEVEL_OF_BAND, BAND_CN, BREAK_EVEN,
};
