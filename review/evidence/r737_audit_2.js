// R737 第二轮交叉审计：呈现面对账（纵向）
// 目的：同一家店、同一个月，**页面（getLedger 重算）/ 导出件（exportData）/ 摊销页（getAmortSchedule）**
//       三个出口的钱必须相等；且导出件的表内加减必须成立（老板是拿计算器核的）。
// 场景按「李老师的真实处境」设计，包括最脏的一种：
//   R736 部署**之前**保存过 2026-11（当时开关关着 ⇒ 落库 amortize_fen=0），现在直接导出、不重存。
const path = require('path');
const Module = require('module');
// wx-server-sdk 桩：exportData 是 Controller，但 buildMonthlySheets 是纯函数，不需要真库。
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    const dbStub = {
      command: { in: (x) => x, eq: (x) => x },
      serverDate: () => 0,
      collection: () => ({ where: () => ({ get: async () => ({ data: [] }) }) }),
    };
    return { init() {}, DYNAMIC_CURRENT_ENV: 'stub', database: () => dbStub };
  }
  return _origLoad.apply(this, arguments);
};
const ROOT = path.resolve(__dirname, '..', '..');
const { ASSETS, BOOK, EXPECT_AMORT } = require('./r737_fixture');

const EXP = require(path.join(ROOT, 'cloudfunctions/exportData/index.js'));
const GLS = require(path.join(ROOT, 'cloudfunctions/getLedger/service.js'));   // 页面重算（service 层）
const SCH = require(path.join(ROOT, 'cloudfunctions/getAmortSchedule/service.js'));

let pass = 0, fail = 0;
function ck(id, ok, detail) {
  if (ok) pass++; else { fail++; console.log(`❌ ${id} — ${detail || ''}`); }
}
function yen(f) { return (Number(f) || 0) / 100; }
// 导出表的「项目名」列并不固定在 [0]（表3 的 [0] 是类别、[1] 才是项目名）⇒ 扫整行。
function findRow(rows, key) {
  return (rows || []).find((r) => (r || []).some(
    (c) => String(c == null ? '' : c).replace(/[\s　]/g, '').indexOf(key) >= 0));
}
// 导出件的金额列位置**随表而变**：利润表是 [1]，摊销来源表是最后一列 [6]。
// ⇒ 从右往左找第一个「是数字的单元格」，不用固定索引（否则又是我自己写的假断言）。
function rowFen(row) {
  if (!row) return NaN;
  for (let i = row.length - 1; i >= 0; i--) {
    const c = row[i];
    if (c === '' || c == null) continue;
    const n = Number(c);
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return NaN;
}

// ===== 落库行生成器 =====
// savedByOldCode=true 模拟「R736 部署前保存」：摊销按开关落 0，利润也按 0 算
function mkRow(month, opt) {
  const o = opt || {};
  const inc = 10000000, exp = 3000000, real = 2000000, lump = 5000000;
  const amortFen = o.savedAmort != null ? o.savedAmort : 0;
  const opRef = inc - exp - real - lump;                       // 不含摊销
  const realP = opRef - amortFen;                              // 落库的真实利润
  return {
    month,
    income_items: [{ name: '堂食', amount_fen: inc }],
    expense_items: [{ name: '房租', amount_fen: exp }],
    income_total_fen: inc, expense_total_fen: exp,
    direct_consume_fen: real, real_consume_fen: real,
    amortize_fen: amortFen,
    lump_sum_fen: lump,
    operation_ref_profit_fen: opRef,
    total_factor_real_profit_fen: realP,
    profit_diff_fen: amortFen,
    gross_profit_fen: inc - real,
    gross_margin_pct: 80,
    ref_material_source: 'direct',
    switch_used: {
      inventorySwitchOn: false,
      amortizeSwitchOn: !!o.savedAmortOn,
    },
  };
}

function sheets(month, row) {
  return EXP.buildMonthlySheets({ shopName: '测试店', month, stamp: Date.UTC(2026, 10, 15), row, assets: ASSETS });
}
function rowOf(sh, sheetName, key) {
  const s = sh.find((x) => x.name === sheetName);
  return s ? findRow(s.rows, key) : null;
}

// ===== 页面侧（getLedger 重算链路的 service 部分）=====
function pageView(month, savedAmort, switchSnapshot) {
  const amortRows = ASSETS.filter((a) => a.mode !== 'lump' && a.start_month);
  const v2 = String(month) >= '2026-11';
  const amortizeFen = v2 ? GLS.amortizeTotalForMonth(amortRows, month) : savedAmort;
  const r = GLS.calcMonthlyProfit(Object.assign({}, BOOK, {
    month,
    amortizeFen,
    amortizeSwitchOn: switchSnapshot,
  }));
  return r;
}

console.log('===== 场景 A：2026-11，R736 部署前保存（落库摊销 0、快照 false），直接导出 =====');
{
  const m = '2026-11';
  const row = mkRow(m, { savedAmort: 0, savedAmortOn: false });
  const sh = sheets(m, row);
  const amortRow = rowOf(sh, '利润表', '减：当月摊销');
  const realPRow = rowOf(sh, '利润表', '全要素真实利润');
  const opRefRow = rowOf(sh, '利润表', '经营参考利润');
  const gapRow = rowOf(sh, '利润表', '两口径差额');
  const page = pageView(m, 0, false);
  const ledger = SCH.amortizeForMonth(ASSETS.filter((a) => a.mode !== 'lump'), m);

  ck('A-1 导出件摊销行 = 台账应收 5,277.78（不再念落库 0）',
    Math.abs(rowFen(amortRow) - EXPECT_AMORT[m]) < 1, `实得 ${rowFen(amortRow)}分 / ${amortRow[1]}元`);
  ck('A-2 导出件真实利润 = 经营参考 − 消耗差异 − 摊销（表内恒等式成立）',
    rowFen(realPRow) === rowFen(opRefRow) - rowFen(amortRow),
    `真实=${rowFen(realPRow)} 经营参考=${rowFen(opRefRow)} 摊销=${rowFen(amortRow)}（分）`);
  ck('A-3 导出件真实利润与页面重算**相等**（跨端一致）',
    rowFen(realPRow) === page.totalFactorRealProfitFen,
    `导出=${rowFen(realPRow)} 页面=${page.totalFactorRealProfitFen}`);
  ck('A-4 导出件摊销 = 页面计入额 = 摊销页合计（三出口同数）',
    rowFen(amortRow) === page.effectiveAmortizeFen
    && page.effectiveAmortizeFen === ledger.total_amount_fen,
    `导出=${rowFen(amortRow)} 页面=${page.effectiveAmortizeFen} 摊销页=${ledger.total_amount_fen}`);
  ck('A-5 v2 月份**不得**再出现「台账应收摊销（开关关闭…）」差异行（那会让老板以为没扣）',
    !rowOf(sh, '摊销来源', '台账应收摊销'), '差异行仍存在');
  ck('A-6 口径说明表写「不适用」而不是「关」',
    /不适用/.test(String(rowOf(sh, '口径说明', '摊销开关')[1])), String(rowOf(sh, '口径说明', '摊销开关')[1]));
  ck('A-7 摊销行备注不说「不计入」',
    !/不计入/.test(String(amortRow[2])), String(amortRow[2]));
  ck('A-8 两口径差额 = 消耗差异 + 摊销', Math.abs(rowFen(gapRow) - rowFen(amortRow)) < 1, `差额=${rowFen(gapRow)}分`);
}

console.log('\n===== 场景 B：2026-10（老月份），开关关、落库 0 —— 历史必须一字不改 =====');
{
  const m = '2026-10';
  const row = mkRow(m, { savedAmort: 0, savedAmortOn: false });
  const sh = sheets(m, row);
  const amortRow = rowOf(sh, '利润表', '减：当月摊销');
  const realPRow = rowOf(sh, '利润表', '全要素真实利润');
  const diffRow = rowOf(sh, '摊销来源', '台账应收摊销');
  const page = pageView(m, 0, false);

  ck('B-1 老月份摊销行仍为 0（历史不改）', Math.abs(rowFen(amortRow)) < 1, `实得 ${rowFen(amortRow)}分 / ${amortRow[1]}元`);
  ck('B-2 老月份真实利润 = 落库值 0（不重算）', rowFen(realPRow) === 0, `实得 ${rowFen(realPRow)}分 / ${realPRow[1]}元`);
  ck('B-3 老月份仍出「台账应收摊销」差异行（老板要看到该摊多少）',
    !!diffRow && Math.abs(rowFen(diffRow) - EXPECT_AMORT[m]) < 1,
    diffRow ? `差异行=${rowFen(diffRow)}分` : '缺差异行');
  ck('B-4 导出件与页面在老月份也一致', rowFen(realPRow) === page.totalFactorRealProfitFen,
    `导出=${rowFen(realPRow)} 页面=${page.totalFactorRealProfitFen}`);
  ck('B-5 口径说明仍如实写「关」', /^关$/.test(String(rowOf(sh, '口径说明', '摊销开关')[1])),
    String(rowOf(sh, '口径说明', '摊销开关')[1]));
}

console.log('\n===== 场景 C：2026-10 归档且历史已计入（开关开、落库 527778）=====');
{
  const m = '2026-10';
  const row = mkRow(m, { savedAmort: EXPECT_AMORT[m], savedAmortOn: true });
  const sh = sheets(m, row);
  const amortRow = rowOf(sh, '利润表', '减：当月摊销');
  const realPRow = rowOf(sh, '利润表', '全要素真实利润');
  ck('C-1 历史已计入的月份，导出件照实读落库 5,277.78',
    Math.abs(rowFen(amortRow) - EXPECT_AMORT[m]) < 1, `实得 ${rowFen(amortRow)}分 / ${amortRow[1]}元`);
  ck('C-2 真实利润 = 落库 −5,277.78', rowFen(realPRow) === -527778, `实得 ${rowFen(realPRow)}分 / ${realPRow[1]}元`);
  ck('C-3 不出差异行（本来就没有差异）', !rowOf(sh, '摊销来源', '台账应收摊销'));
}

console.log('\n===== 场景 D/H：台账边界（末月尾差 / 已摊完 / 未开始 / 提前终止）=====');
{
  // 装修：2026-09 起 36 期 ⇒ 末月 = 2026-09 + 35 = 2029-08；尾差 = 13000000 - 361111*35 = 361115
  const d1 = SCH.amountForMonth(ASSETS[0], '2029-08');
  ck('D-1 装修末月尾差倒挤 = 361,115 分', d1 === 361115, `实得 ${d1}`);
  const d2 = SCH.amountForMonth(ASSETS[0], '2029-09');
  ck('D-2 摊完后（2029-09）为 0', d2 === 0, `实得 ${d2}`);
  const d3 = SCH.amountForMonth(ASSETS[0], '2026-08');
  ck('D-3 起摊前（2026-08）为 0', d3 === 0, `实得 ${d3}`);
  const d4 = SCH.amountForMonth(ASSETS[0], '2026-09');
  ck('D-4 首月 = base 361,111 分', d4 === 361111, `实得 ${d4}`);
  // 尾差合计：36 个月加起来必须正好等于原值（一分不多一分不少）
  let sum = 0;
  let mi = SCH.monthIndex('2026-09');
  for (let i = 0; i < 36; i++) { sum += SCH.amountForMonth(ASSETS[0], SCH.fmtMonthIdx(mi + i)); }
  ck('D-5 装修 36 期合计 = 原值 13,000,000 分（尾差不多不少）', sum === 13000000, `实得 ${sum}`);
  // 设备 24 期
  let sum2 = 0;
  let mi2 = SCH.monthIndex('2026-10');
  for (let i = 0; i < 24; i++) { sum2 += SCH.amountForMonth(ASSETS[1], SCH.fmtMonthIdx(mi2 + i)); }
  ck('D-6 设备 24 期合计 = 原值 4,000,000 分', sum2 === 4000000, `实得 ${sum2}`);

  // 提前终止：终止月仍按 base，之后归零
  const term = Object.assign({}, ASSETS[0], { terminate_month: '2026-12' });
  ck('D-7 提前终止月（2026-12）仍按 base 摊', SCH.amountForMonth(term, '2026-12') === 361111);
  ck('D-8 提前终止后（2027-01）为 0', SCH.amountForMonth(term, '2027-01') === 0);

  // 老数据兼容：只有 value_fen 字段（导出件必须能算）
  const oldStyle = ASSETS.map((a) => ({ asset_id: a.asset_id, name: a.name, mode: a.mode, start_month: a.start_month, total_months: a.total_months, value_fen: a.total_value }));
  const shOld = EXP.buildMonthlySheets({ shopName: 'X', month: '2026-11', stamp: 0, row: mkRow('2026-11', { savedAmort: 0 }), assets: oldStyle });
  const amortOld = rowOf(shOld, '利润表', '减：当月摊销');
  ck('H-1 老字段 value_fen 的台账也能算对（导出件兼容）',
    Math.abs(rowFen(amortOld) - EXPECT_AMORT['2026-11']) < 1, `实得 ${rowFen(amortOld)}分`);
}

console.log('\n===== 场景 E：v2 月份台账为空（全 lump）=====');
{
  const row = mkRow('2026-11', { savedAmort: 0 });
  const sh = EXP.buildMonthlySheets({ shopName: 'X', month: '2026-11', stamp: 0, row, assets: [ASSETS[2]] });
  const amortRow = rowOf(sh, '利润表', '减：当月摊销');
  const realPRow = rowOf(sh, '利润表', '全要素真实利润');
  ck('E-1 无摊销资产 ⇒ 摊销行 0', Math.abs(rowFen(amortRow)) < 1, `实得 ${rowFen(amortRow)}分 / ${amortRow[1]}元`);
  ck('E-2 无摊销资产 ⇒ 真实利润 = 经营参考（不被凭空减一笔）',
    rowFen(realPRow) === rowFen(rowOf(sh, '利润表', '经营参考利润')),
    `真实=${rowFen(realPRow)}分`);
  ck('E-3 备注写「本月无应摊资产」而不是「开关关闭」', /无应摊/.test(String(amortRow[2])), String(amortRow[2]));
}

console.log('\n===== 场景 F：跨闸门资产（2026-10 起摊，闸门 2026-11）=====');
{
  // 设备 2026-10 起摊：10 月在闸门之前，11 月在之后
  const octPage = pageView('2026-10', 0, false);
  const novPage = pageView('2026-11', 0, false);
  ck('F-1 2026-10 开关关 ⇒ 页面计入 0（老规则）', octPage.effectiveAmortizeFen === 0, `实得 ${octPage.effectiveAmortizeFen}`);
  ck('F-2 2026-11 开关关 ⇒ 页面计入 527,778 分（新规则不看开关）', novPage.effectiveAmortizeFen === 527778, `实得 ${novPage.effectiveAmortizeFen}`);
  ck('F-3 同一条资产跨闸门：10 月与 11 月台账应摊额相同（527,778），差别只在是否计入',
    SCH.amortizeForMonth(ASSETS.filter((a) => a.mode !== 'lump'), '2026-10').total_amount_fen
    === SCH.amortizeForMonth(ASSETS.filter((a) => a.mode !== 'lump'), '2026-11').total_amount_fen);
  ck('F-4 闸门前后的 switchUsed 报的是「生效值」而非快照原值',
    octPage.switchUsed.amortizeSwitchOn === false && novPage.switchUsed.amortizeSwitchOn === true,
    `10月=${octPage.switchUsed.amortizeSwitchOn} 11月=${novPage.switchUsed.amortizeSwitchOn}`);
}

console.log('\n===== 场景 G：归档月被后续台账改动（封账只读）=====');
{
  const m = '2026-11';
  // 归档时按新代码保存：落库摊销 = 527,778；快照 true；is_archive = true
  const row = mkRow(m, { savedAmort: EXPECT_AMORT[m], savedAmortOn: true });
  row.is_archive = true;
  // 归档之后老板删掉了「设备」这条资产
  const assetsAfterDelete = ASSETS.filter((a) => a.asset_id !== 'a2');
  const sh = EXP.buildMonthlySheets({ shopName: 'X', month: m, stamp: 0, row, assets: assetsAfterDelete });
  const amortRow = rowOf(sh, '利润表', '减：当月摊销');
  const realPRow = rowOf(sh, '利润表', '全要素真实利润');
  ck('G-1 归档月摊销仍是封账值 527,778（删资产不许倒灌旧账）',
    rowFen(amortRow) === EXPECT_AMORT[m], `实得 ${rowFen(amortRow)}（若变成 361111 说明被重算了）`);
  ck('G-2 归档月真实利润 = 落库冻结值（不被重算改写）',
    rowFen(realPRow) === row.total_factor_real_profit_fen, `实得 ${rowFen(realPRow)}`);
  ck('G-3 归档月表内恒等式仍成立（冻结值本来就是一起算出来的）',
    rowFen(realPRow) === rowFen(rowOf(sh, '利润表', '经营参考利润')) - rowFen(amortRow),
    `真实=${rowFen(realPRow)}`);

  // 对照：同一个月**未归档**时，删资产必须立刻反映（否则就是另一个极端：改了看不到）
  const row2 = mkRow(m, { savedAmort: 0, savedAmortOn: false });
  const sh2 = EXP.buildMonthlySheets({ shopName: 'X', month: m, stamp: 0, row: row2, assets: assetsAfterDelete });
  const amort2 = rowFen(rowOf(sh2, '利润表', '减：当月摊销'));
  ck('G-4 【对照】同月未归档 ⇒ 删资产立刻反映（摊销降到 361,111，证明 G-1 不是恒等落库值）',
    amort2 === 361111, `实得 ${amort2}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
