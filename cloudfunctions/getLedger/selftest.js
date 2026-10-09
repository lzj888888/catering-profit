// cloudfunctions/getLedger/selftest.js —— 批次 4 · M1 月度账读取（读）自测（R57 补齐）
// 运行： node cloudfunctions/getLedger/selftest.js
//
// 背景：此前无 selftest。本函数是 M1 的**回读重算**入口——index.js 注释明写"防篡改：不信任落库存量，
// 回读时用明细重算"。⇒ 重算引擎必须与落库引擎（saveLedger/service.js）**逐字段同值**，否则同一个月
// 存进去与读出来是两个数。本套件把这条"同源"从注释变成机器断言。
//   ① 锚点回归：S1 经营参考 9,160 / S2 全要素 3,476.67 / 差异 5,683.33（与 batch1/4 同一组锚点）
//   ② 跨函数等价：getLedger.calcMonthlyProfit ≡ saveLedger.calcMonthlyProfit（多组输入逐字段）
//   ③ 口径锁：开库存开关时"经营参考利润"仍用老板直接填的消耗（**不得**改用倒轧）
//   ④ 入参面 + 静态形状守卫

const fs = require('fs');
const path = require('path');
const { calcMonthlyProfit, resolveArchiveSwitches } = require('./service');
const saveLedger = require('../saveLedger/service');
const { validateInput } = require('./validate');
const { ERROR_CODES } = require('./common');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const YUAN = 100;
const itemsYuan = (arr) => arr.map((y) => ({ amountFen: Math.round(y * YUAN) }));
const INCOME_ITEMS = itemsYuan([8000, 25000, 5000, 3000, 2000, 18000, 500, 1500, 1000]); // 64,000
const EXPENSE_ITEMS = itemsYuan([8000, 500, 200, 800, 600, 100, 100, 12000, 1500, 800, 500, 200, 3600, 1200, 1500, 300, 400, 240, 300]); // 32,840
const DIRECT_CONSUME_FEN = 22000 * YUAN;
const AMORTIZE_FEN = Math.round(4683.33 * YUAN);

console.log('===== 1. 锚点回归（与 batch1 calcMonthlyProfit / batch4 saveLedger 同锚点）=====');
const r1 = calcMonthlyProfit({ incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: false, inventorySwitchOn: false, inventory: {} });
check('S1 收入合计 = 64,000 元（6400000 分）', r1.incomeTotalFen === 6400000, `=${r1.incomeTotalFen}`);
check('S1 费用合计 = 32,840 元（3284000 分）', r1.expenseTotalFen === 3284000, `=${r1.expenseTotalFen}`);
check('🏆 S1 经营参考利润 = 9,160（916000 分）', r1.operationRefProfitFen === 916000, `=${r1.operationRefProfitFen}`);
check('S1 全要素真实利润 = 9,160（库存关无倒轧）', r1.totalFactorRealProfitFen === 916000, `=${r1.totalFactorRealProfitFen}`);
check('S1 差异 = 0', r1.profitDiffFen === 0);
check('S1 自洽校验位 diffCheck = true', r1.diffCheck === true);

const r2 = calcMonthlyProfit({ incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: true, inventorySwitchOn: true, inventory: { openingFen: 5000 * YUAN, purchaseFen: 25000 * YUAN, closingFen: 7000 * YUAN } });
check('S2 真实消耗 = 23,000（倒轧 5000+25000−7000）', r2.realConsumeFen === 2300000, `=${r2.realConsumeFen}`);
check('🏆 S2 经营参考利润仍 = 9,160（🔴 口径锁：开库存也不改用倒轧，出 8160 即违规）', r2.operationRefProfitFen === 916000, `=${r2.operationRefProfitFen}`);
check('S2 经营参考 ≠ 816000（反面断言：防"开了开关就倒轧"回归）', r2.operationRefProfitFen !== 816000);
check('🏆 S2 全要素真实利润 = 3,476.67（347667 分）', r2.totalFactorRealProfitFen === 347667, `=${r2.totalFactorRealProfitFen}`);
check('S2 两利润差异 = 5,683.33（568333 分）', r2.profitDiffFen === 568333, `=${r2.profitDiffFen}`);
check('S2 毛利 = 64,000 − 23,000 = 41,000（4100000 分）', r2.grossProfitFen === 4100000, `=${r2.grossProfitFen}`);
check('S2 毛利率 = 64.0625%', r2.grossMarginRatePctDisplay === 64.06, `=${r2.grossMarginRatePctDisplay}`);

console.log('===== 2. 跨函数等价（回读重算 ≡ 落库引擎，防口径漂移）=====');
const CASES = [
  { name: 'S1 双关', input: { incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: false, inventorySwitchOn: false, inventory: {} } },
  { name: 'S2 双开', input: { incomeItems: INCOME_ITEMS, expenseItems: EXPENSE_ITEMS, directConsumeFen: DIRECT_CONSUME_FEN, amortizeFen: AMORTIZE_FEN, amortizeSwitchOn: true, inventorySwitchOn: true, inventory: { openingFen: 500000, purchaseFen: 2500000, closingFen: 700000 } } },
  { name: '空账（无收入无费用）', input: { incomeItems: [], expenseItems: [], directConsumeFen: 0, amortizeFen: 0, amortizeSwitchOn: false, inventorySwitchOn: false } },
  { name: '零收入有开销（毛利率除零保护）', input: { incomeItems: [], expenseItems: itemsYuan([1000]), directConsumeFen: 50000, amortizeFen: 0, amortizeSwitchOn: false, inventorySwitchOn: false } },
  { name: '仅库存开（倒轧为负：进少耗多）', input: { incomeItems: itemsYuan([10000]), expenseItems: [], directConsumeFen: 0, amortizeFen: 0, amortizeSwitchOn: false, inventorySwitchOn: true, inventory: { openingFen: 100000, purchaseFen: 0, closingFen: 300000 } } },
  { name: '仅摊销开 + 小数摊销额', input: { incomeItems: itemsYuan([10000]), expenseItems: [], directConsumeFen: 100000, amortizeFen: 333344.6, amortizeSwitchOn: true, inventorySwitchOn: false } },
  { name: '脏输入（字符串/NaN/缺字段）', input: { incomeItems: [{ amountFen: '100' }, { amountFen: NaN }], expenseItems: [{ amountFen: 50 }], directConsumeFen: '200', amortizeFen: NaN, amortizeSwitchOn: 1, inventorySwitchOn: 'x' } },
];
for (const c of CASES) {
  const a = calcMonthlyProfit(c.input);
  const b = saveLedger.calcMonthlyProfit(c.input);
  const diff = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  check(`[${c.name}] getLedger ≡ saveLedger（逐字段 ${Object.keys(b).length} 项）`, diff.length === 0, diff.length ? '不一致字段: ' + diff.join(',') : '');
}
check('零收入毛利率 = 0（不产生 NaN/Infinity）', calcMonthlyProfit({ incomeItems: [], expenseItems: [], directConsumeFen: 0, amortizeFen: 0 }).grossMarginRatePctDisplay === 0);
check('脏输入不产生 NaN（金额一律 num0 归一）', Number.isFinite(calcMonthlyProfit({ incomeItems: [], expenseItems: [], directConsumeFen: 'abc' }).operationRefProfitFen));
check('金额出参一律整数分（Number.isInteger）', [r1, r2].every((x) => Number.isInteger(x.incomeTotalFen) && Number.isInteger(x.operationRefProfitFen) && Number.isInteger(x.totalFactorRealProfitFen)));

console.log('===== 3. 入参面 =====');
check('合法入参放行', validateInput({ shop_id: 's1', month: '2026-09' }).error === null);
check('month "2026-13" → 拒', validateInput({ shop_id: 's1', month: '2026-13' }).error === ERROR_CODES.INVALID_PARAM);
check('month "2026-1" → 拒（两位月）', validateInput({ shop_id: 's1', month: '2026-1' }).error === ERROR_CODES.INVALID_PARAM);
check('month "202609" → 拒', validateInput({ shop_id: 's1', month: '202609' }).error === ERROR_CODES.INVALID_PARAM);
check('month 缺失 → 拒（本函数 month 必填）', validateInput({ shop_id: 's1' }).error === ERROR_CODES.INVALID_PARAM);
check('shop_id 缺失 → 拒', validateInput({ month: '2026-09' }).error === ERROR_CODES.INVALID_PARAM);
check('支持 { input: {...} } 包裹层', validateInput({ input: { shop_id: 's1', month: '2026-09' } }).month === '2026-09');
check('错误码 = INVALID_PARAM（全局标准码）', ERROR_CODES.INVALID_PARAM === 'INVALID_PARAM');

console.log('===== 4. 静态形状守卫 =====');
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const body = src.slice(src.indexOf('exports.main'));
const at = (s) => body.indexOf(s);
check('顺序：resolveAuth → assertShopOwner → validateInput', at('resolveAuth') < at('assertShopOwner') && at('assertShopOwner') < at('validateInput'));
check('🔴 开关取服务端权威值（读 shop_switch 表，不信前端/落库快照）', /da\.list\('shop_switch'/.test(body) && /inventory_switch/.test(body));
check('🔴 回读即重算（调 calcMonthlyProfit），不直接回吐库存值', /calcMonthlyProfit\(/.test(body));
check('无记录返回空账而非报错（RESOURCE_NOT_FOUND 不得出现）', !/RESOURCE_NOT_FOUND/.test(body));
check('读账走 DataAdapter（软删过滤）', /da\.list\('shop_monthly_account'/.test(body));
check('出参金额字段名与 service 一致（snake_case 契约）', body.includes('operation_ref_profit_fen: result.operationRefProfitFen') && body.includes('total_factor_real_profit_fen: result.totalFactorRealProfitFen'));

console.log('===== 5. round115 · M1 行业指标对照（细项归属 + 缺项不评级）=====');
const ir = require('./cx_indicatorRef');
const EXP_TAGGED = [
  { category: 'operation', name: '运营费用', amountFen: 1350000, subItems: [
    { subItem: '房租', amountFen: 1000000 }, { subItem: '水费', amountFen: 100000 },
    { subItem: '电费', amountFen: 200000 }, { subItem: '垃圾清运费', amountFen: 50000 }] },
  { category: 'labor', name: '人工费用', amountFen: 1500000, subItems: [{ subItem: '工资绩效', amountFen: 1500000 }] },
  { category: 'marketing', name: '营销费用', amountFen: 700000, subItems: [{ subItem: '外卖平台佣金', amountFen: 700000 }] },
];
const byInd = ir.sumByTag(EXP_TAGGED);
check('细项归属：rent = 10,000 元（从 operation 大类里拆出）', byInd.rent === 1000000, `=${byInd.rent}`);
check('细项归属：energy = 3,000 元（水费+电费合并）', byInd.energy === 300000, `=${byInd.energy}`);
check('细项归属：labor = 15,000 元（细项名命中）', byInd.labor === 1500000, `=${byInd.labor}`);
check('细项归属：mkt = 7,000 元（细项名命中）', byInd.mkt === 700000, `=${byInd.mkt}`);
// 总额 3,550,000 分（13,500+15,000+7,000 元）；认领 3,500,000 ⇒ 未认领恰为「垃圾清运费」500 元
check('🔴 未识别细项无人认领（垃圾清运费 500 元不计入任何指标）',
  (byInd.rent + byInd.energy + byInd.labor + byInd.mkt) === 3500000
  && (3550000 - (byInd.rent + byInd.energy + byInd.labor + byInd.mkt)) === 50000,
  `Σ=${byInd.rent + byInd.energy + byInd.labor + byInd.mkt} 未认领=${3550000 - (byInd.rent + byInd.energy + byInd.labor + byInd.mkt)}`);
check('🔴 缺项**不出键**（而不是出 0 —— 0 会被当成「占比 0%，优秀」）',
  ir.sumByTag([{ category: 'labor', name: '人工', amountFen: 100, subItems: [] }]).rent === undefined);
check('🔴 operation 大类整额未拆细项 ⇒ rent/energy 均不出（不猜）', (() => {
  const r = ir.sumByTag([{ category: 'operation', name: '运营', amountFen: 1200000, subItems: [] }]);
  return r.rent === undefined && r.energy === undefined;
})());
check('自定义细项回落到大类归属（labor 下自建「临时工」不漏算）',
  ir.sumByTag([{ category: 'labor', name: '人工', amountFen: 1500000, subItems: [{ subItem: '临时工', amountFen: 500000 }, { subItem: '工资绩效', amountFen: 1000000 }] }]).labor === 1500000);
check('键映射 energy → utility（fixedFen 入参键，单源出，不靠调用方猜）', ir.toFixedFen({ energy: 300 }).utility === 300);
check('M1 口径 = 5 项且**不含 manage**（李老师 2026-09-24 拍板）',
  ir.M1_IND_KEYS.length === 5 && ir.M1_IND_KEYS.indexOf('manage') < 0, ir.M1_IND_KEYS.join(','));

const IND_PARTIAL = ir.evaluateIndicators({
  bizKey: 'dining', cityKey: 'tier23', revenueFen: 10000000,
  fixedFen: ir.toFixedFen(byInd), grossMarginPct: null, platformPct: null,
});
const gmItem = IND_PARTIAL.find((x) => x.key === 'grossMargin');
const mktItem = IND_PARTIAL.find((x) => x.key === 'mkt');
check('🔴 缺项 ⇒ 毛利率 pct=null（**不得**变成 0%/bad —— round115 实测抓过的真 bug）', gmItem.pct === null, `=${gmItem.pct}`);
check('🔴 缺项 ⇒ level=na（不评级）', gmItem.level === 'na' && mktItem.level === 'na');
check('有数据的项照常评级（labor 15% 低于 dining 带下限 17% ⇒ good，且不得为 na）', IND_PARTIAL.find((x) => x.key === 'labor').level === 'good');
check('过滤后 5 项、无 manage', ir.m1IndicatorsOf(IND_PARTIAL).length === 5 && !ir.m1IndicatorsOf(IND_PARTIAL).some((x) => x.key === 'manage'));

check('🔴 出参经 M1 口径过滤（m1IndicatorsOf，不在前端/controller 里手筛）', /m1IndicatorsOf\(/.test(body));
check('🔴 细项归属走单源 sumByTag（controller 不自己写映射表）', /indicatorRef\.sumByTag\(/.test(body));
check('🔴 fixedFen 键由 toFixedFen 转换（energy→utility 不靠猜）', /toFixedFen\(/.test(body));
check('出参含 indicator_scope（业态/城市回显 + 是否默认口径）', /indicator_scope/.test(body) && /is_default_scope/.test(body));
check('🔴 分母与 result **同源**（revenueFen 取 result.incomeTotalFen，不另立口径）',
  /const incomeTotal = result\.incomeTotalFen/.test(body) && /revenueFen: incomeTotal/.test(body));
check('读 shop 取业态 / 城市层级（参考带的前提输入）',
  /da\.get\('shop'/.test(body) && /biz_type/.test(body) && /city_tier/.test(body));

// ===== 6. R257 · 归档月回读必须用「落库时的开关快照」 =====
// 缺口：回读重算的入参里，明细全冻结在 acct 里，**唯独开关读的是实时 shop_switch**
//   ⇒ 归档后改一次开关，封账月的利润就漂了。saveLedger 早已落库 switch_used，只是没人读。
// 口径：归档+完整快照⇒snapshot；未归档⇒live；归档但快照缺失/残缺⇒回落实时（唯一 fail-open，零回归）。
const SNAP_OFF = { inventorySwitchOn: false, amortizeSwitchOn: false };
const SNAP_ON = { inventorySwitchOn: true, amortizeSwitchOn: true };

const a1 = resolveArchiveSwitches({ isArchive: true, switchUsed: SNAP_OFF, liveInventorySwitchOn: true, liveAmortizeSwitchOn: true });
check('R257 归档月 + 完整快照 ⇒ 用快照（实时全开也压不住）',
  a1.source === 'snapshot' && a1.inventorySwitchOn === false && a1.amortizeSwitchOn === false, a1.source);

const a2 = resolveArchiveSwitches({ isArchive: true, switchUsed: SNAP_ON, liveInventorySwitchOn: false, liveAmortizeSwitchOn: false });
check('R257 归档月 + 快照全开 ⇒ 实时全关也压不住（反向）',
  a2.source === 'snapshot' && a2.inventorySwitchOn === true && a2.amortizeSwitchOn === true, a2.source);

const a3 = resolveArchiveSwitches({ isArchive: false, switchUsed: SNAP_OFF, liveInventorySwitchOn: true, liveAmortizeSwitchOn: false });
check('R257 未归档月 ⇒ 用实时（快照不参与）',
  a3.source === 'live' && a3.inventorySwitchOn === true && a3.amortizeSwitchOn === false, a3.source);

const a4 = resolveArchiveSwitches({ isArchive: true, switchUsed: null, liveInventorySwitchOn: true, liveAmortizeSwitchOn: false });
check('R257 归档但快照缺失 ⇒ 回落实时（唯一 fail-open：老数据硬拒就再也看不了）',
  a4.source === 'live_no_snapshot' && a4.inventorySwitchOn === true && a4.amortizeSwitchOn === false, a4.source);

const a5 = resolveArchiveSwitches({ isArchive: true, switchUsed: { inventorySwitchOn: true }, liveInventorySwitchOn: false, liveAmortizeSwitchOn: false });
check('R257 快照残缺（只一个布尔键）⇒ 判不完整、回落实时（不半用半不用的拼盘）',
  a5.source === 'live_no_snapshot' && a5.inventorySwitchOn === false, a5.source);

const a6 = resolveArchiveSwitches();
check('R257 空入参不炸（未归档语义 ⇒ live 全关）',
  a6.source === 'live' && a6.inventorySwitchOn === false && a6.amortizeSwitchOn === false);

// 静态形状：controller 必须把解算结果喂进引擎，而不是 swGet(...) 的实时值
check('R257 controller 引入 resolveArchiveSwitches（纯函数单源）', /resolveArchiveSwitches/.test(body));
check('R257 🔴 开关常量取自解算结果 sw.*（换回 swGet(...) = 缺口复发）',
  /const inventorySwitchOn = sw\.inventorySwitchOn;/.test(body)
  && /const amortizeSwitchOn = sw\.amortizeSwitchOn;/.test(body)
  && !/SwitchOn\s*=\s*swGet\(/.test(body));
// 引擎入参是**简写多行**（amortizeSwitchOn, inventorySwitchOn,），故按调用块取，不做整行匹配
const iCall = body.indexOf('calcMonthlyProfit({');
const callBlock = iCall >= 0 ? body.slice(iCall, body.indexOf('});', iCall)) : '';
check('R257 🔴 引擎入参用的是上面那两个常量（简写），且块内不含实时 swGet',
  callBlock.indexOf('inventorySwitchOn') >= 0 && callBlock.indexOf('amortizeSwitchOn') >= 0
  && callBlock.indexOf('swGet(') < 0, `block=${callBlock.length}字`);
check('R257 解算发生在重算之前（顺序：resolveArchiveSwitches 早于 calcMonthlyProfit）',
  body.indexOf('resolveArchiveSwitches({') >= 0 && body.indexOf('calcMonthlyProfit({') > body.indexOf('resolveArchiveSwitches({'));
check('R257 isArchive 判定与落库同源（acct.is_archive，不另立开关态）',
  /const isArchiveNow = !!\(\s*acct && acct\.is_archive\s*\)/.test(body));
check('R257 快照取自 acct.switch_used（与 saveLedger 落库字段同名同源）',
  /switchUsed:\s*acct && acct\.switch_used/.test(body));
check('R257 出参带 switch_source（归档月数字为什么没跟开关变，有一条可查线索）',
  /switch_source:\s*sw\.source/.test(body));

console.log(`\n==== getLedger 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
