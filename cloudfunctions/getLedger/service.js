// cloudfunctions/getLedger/service.js —— 内嵌批次 1 calcMonthlyProfit 双利润引擎（与 saveLedger/service.js 同源）。
const { ERROR_CODES } = require('./common');

function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// ===== R257：归档月回读必须用「落库时的开关快照」 =====
// 背景（缺口由穷尽对照扫出，见 review/PLAN_2026-10-10_归档月开关快照回读.md §二）：
//   getLedger 自述「防篡改：不信任落库存量，回读时用明细重算」⇒ 归档月的展示值是**每次读都现算**的。
//   重算的入参里，明细（income/expense/direct_consume/inventory/amortize_fen/lump_sum_fen）
//   全都冻结在 acct 里不会漂；**唯独开关是读实时 shop_switch** ⇒ 归档后改一次开关，封账月的利润就变了。
//   而 saveLedger 早就把快照落库了（switch_used = 引擎产出的 {inventorySwitchOn, amortizeSwitchOn}），
//   只是**从没人读**（死字段）。
// 口径（本轮定死）：
//   · 归档月 + 快照完整 ⇒ 用快照（source='snapshot'）—— 归档=只读，含「算它用的参数」
//   · 未归档月           ⇒ 用实时（source='live'）—— 开关是实时建模控件，改了就该立刻看到效果
//   · 归档月但快照缺失/残缺 ⇒ 回落实时（source='live_no_snapshot'）
//     ⚠️ 这是**唯一一处 fail-open**：本字段上线前已归档的月份拿不到正确值，硬拒 = 用户再也看不了那个月。
//        回落到「现状行为」= 零回归；来源与理由已写在这里，改口径前先读完这段。
function resolveArchiveSwitches(input) {
  const inp = input || {};
  const LIVE = {
    inventorySwitchOn: !!inp.liveInventorySwitchOn,
    amortizeSwitchOn: !!inp.liveAmortizeSwitchOn,
  };
  if (!inp.isArchive) return Object.assign({ source: 'live' }, LIVE);
  const su = inp.switchUsed;
  const complete = !!su && typeof su === 'object'
    && typeof su.inventorySwitchOn === 'boolean'
    && typeof su.amortizeSwitchOn === 'boolean';
  if (!complete) return Object.assign({ source: 'live_no_snapshot' }, LIVE);
  return {
    inventorySwitchOn: su.inventorySwitchOn,
    amortizeSwitchOn: su.amortizeSwitchOn,
    source: 'snapshot',
  };
}

function calcMonthlyProfit(clean) {
  const incomeItems = (clean && clean.incomeItems) || [];
  const expenseItems = (clean && clean.expenseItems) || [];
  // R477：直接填的消耗 —— 先**归一化**再判断（不许直接 === 0）。
  //   directProvided = 「老板填过没有」（undefined/null/''/NaN ⇒ 没填）；
  //   显式填 0 与未填必须分开：填 0 = 明确声明这月没消耗，要尊重；未填 = 不知道。
  //   ⚠️ 与 calcMonthlyProfit/service.js、saveLedger/service.js 同源同口径，改一处必改三处。
  const rawDirect = (clean && clean.directConsumeFen);
  const directProvided = rawDirect !== undefined && rawDirect !== null && rawDirect !== ''
    && !(typeof rawDirect === 'number' && Number.isNaN(rawDirect));
  const directConsumeFen = directProvided ? num0(rawDirect) : 0;
  const amortizeFen = num0(clean && clean.amortizeFen);
  const amortizeSwitchOn = !!(clean && clean.amortizeSwitchOn);
  const inventorySwitchOn = !!(clean && clean.inventorySwitchOn);
  // round106（F2）：一次性投入（分）—— 与 saveLedger/service.js 同源同口径
  // round107：去掉「与摊销互斥」（原 amortizeSwitchOn ? 0 : lumpSumFen）。理由见 saveLedger/service.js。
  const lumpSumFen = num0(clean && clean.lumpSumFen);
  const effectiveLumpSumFen = lumpSumFen;
  const inv = (clean && clean.inventory) || {};
  const incomeTotalFen = incomeItems.reduce((s, it) => s + num0(it && it.amountFen), 0);
  const expenseTotalFen = expenseItems.reduce((s, it) => s + num0(it && it.amountFen), 0);
  const realConsumeFen = inventorySwitchOn
    ? num0(inv.openingFen) + num0(inv.purchaseFen) - num0(inv.closingFen)
    : directConsumeFen;
  const materialCostFen = realConsumeFen;
  const grossProfitFen = Math.round(incomeTotalFen - materialCostFen);
  const grossMarginRatePct = incomeTotalFen === 0 ? 0 : (grossProfitFen / incomeTotalFen) * 100;
  const effectiveAmortizeFen = amortizeSwitchOn ? Math.round(amortizeFen) : 0;
  // R477：参考口径取数 —— 库存开且「直接填的消耗」没有正数 ⇒ 回落倒轧。
  //   判据为什么是 ≤ 0 而不是「未填」：库存模式下前端恒传 0（subpkg/biz/month/inventory.js:240
  //   写死 `|| 0`），那个 0 是占位、不承载老板意图 ⇒ 按"未填"处理。详见 calcMonthlyProfit/service.js 头部。
  const refMaterialSource = (inventorySwitchOn && !(directConsumeFen > 0)) ? 'reverse' : 'direct';
  const refMaterialFen = refMaterialSource === 'reverse' ? realConsumeFen : directConsumeFen;
  const profitCaliberVersion = 'm1_v2';
  const operationRefProfitFen = Math.round(incomeTotalFen - expenseTotalFen - refMaterialFen - effectiveLumpSumFen);
  const totalFactorRealProfitFen = Math.round(incomeTotalFen - expenseTotalFen - realConsumeFen - effectiveAmortizeFen - effectiveLumpSumFen);
  const profitDiffFen = Math.round((realConsumeFen - refMaterialFen) + effectiveAmortizeFen);
  return {
    incomeTotalFen, expenseTotalFen, materialCostFen, directConsumeFen, realConsumeFen,
    grossProfitFen, grossMarginRatePct,
    grossMarginRatePctDisplay: Math.round((grossMarginRatePct + Number.EPSILON) * 100) / 100,
    amortizeFen, effectiveAmortizeFen,
    lumpSumFen, effectiveLumpSumFen,
    operationRefProfitFen, totalFactorRealProfitFen, profitDiffFen,
    // R477：参考口径取数与来源（前端解释差异的取数单源）+ 口径版本标识
    refMaterialFen, refMaterialSource, directProvided, profitCaliberVersion,
    switchUsed: { inventorySwitchOn, amortizeSwitchOn },
    diffCheck: operationRefProfitFen - totalFactorRealProfitFen === profitDiffFen,
  };
}

module.exports = { calcMonthlyProfit, resolveArchiveSwitches, ERROR_CODES };