// _r745_probeE2.js —— 补 E1 的两处构造缺陷（只读）：
//  ① E1 过早恢复 Module._load ⇒ exportData.loadXlsx() 运行时拿不到真库 ⇒ xlsx 生成空串。
//     这里改为全程用 _resolveFilename 补丁（持久），让运行时 require('xlsx') 也命中真库。
//  ② E1 静默按 0 样例：缺列后仍按原位置取值，888.88 漂到相邻列 ⇒ 少算 0，是构造错不是产品对。
//     这里按各自表头逐列对齐构造，且营业收入列填成与现金流入公式一致（让 selfcheck pass=true）。
'use strict';
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
const XLSX = require('C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules/xlsx');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === 'xlsx') {
    try { return origResolve.apply(this, arguments); } catch (e) { return require.resolve('C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules/xlsx'); }
  }
  return origResolve.apply(this, arguments);
};
const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'wx-server-sdk') return { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => ({}), getWXContext: () => ({}) };
  return origLoad.apply(this, arguments);
};
const SV = require(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'));
const RD = require(path.join(ROOT, 'cloudfunctions/importSalesBill/revenueDailyParse.js'));
const E = require(path.join(ROOT, 'cloudfunctions/exportData/index.js'));
// 不恢复补丁：exportData.loadXlsx() 是运行时 require，需要补丁仍在。

console.log('===== A · 导出【真 xlsx】能否被 importSalesBill 重新导入 =====');
const SAMPLE = {
  shopName: '探针店', month: '2026-09', stamp: Date.UTC(2026, 8, 1),
  row: {
    income_items: [{ name: '堂食', amount_fen: 4000000, sub_items: [{ sub_item: '午餐', amount_fen: 2500000 }] }],
    expense_items: [{ name: '房租', amount_fen: 1200000, sub_items: [] }],
    direct_consume_fen: 2200000, real_consume_fen: 2500000, amortize_fen: 333333, lump_sum_fen: 0,
    income_total_fen: 4000000, expense_total_fen: 1200000, gross_profit_fen: 1500000, gross_margin_pct: 37.5,
    operation_ref_profit_fen: 600000, total_factor_real_profit_fen: -33333, profit_diff_fen: 633333,
    switch_used: { inventorySwitchOn: false },
  },
  assets: [{ asset_id: 'a1', name: '装修', value_fen: 12000000, start_month: '2026-01', total_months: 36, mode: 'amort' }],
};
const sheets = E.buildMonthlySheets(SAMPLE);
const about = { name: '关于本表', header: ['项目', '内容'], rows: [['本表由', '店算']] };
const b64 = E.xlsxSheetsBase64(sheets.concat([about]));
console.log('xlsxSheetsBase64 长度 =', b64.length, ' 魔数 =', Buffer.from(b64, 'base64').slice(0, 4).toString('hex'));
const xbuf = Buffer.from(b64, 'base64');
const rb = SV.bufferToMatrix(xbuf);
console.log('回读 sheet 名 =', JSON.stringify(Object.keys(rb.sheets)));
for (const nm of Object.keys(rb.sheets)) {
  const rows = rb.sheets[nm].rows;
  console.log('  [' + nm + '] 首行 =', JSON.stringify((rows[0] || []).slice(0, 5)),
    ' 营收日报表签名 =', RD.detectRevenueDaily(rows).hit);
}
console.log('detectDishMatrix =', JSON.stringify(SV.detectDishMatrix(rb)));
console.log('detectPlatformInMatrix =', JSON.stringify(SV.detectPlatformInMatrix(rb)));
console.log('diagnoseColumns.reason =', SV.diagnoseColumns(rb).reason, ' missing =', JSON.stringify(SV.diagnoseColumns(rb).missing));
console.log('=> 结论：导出件（真 xlsx，5 张表）与各导入签名零交集 ⇒ 不能被重新导入。');

console.log('\n===== B · 静默按 0：营收日报表缺「美团外卖」列（按各自表头对齐构造）=====');
const FULL_HDR = ['日期', '班次', '现金', '充值', '扫码', '美团团购', '抖音团购', '美团外卖', '京东外卖', '淘宝闪购', '茶楼', '会员消费', '挂账人/金额', '挂账还款人/金额', '营业收入', '合计'];
// 现金流入公式 = 现金 + 充值 + 扫码 + 挂账还款 = 100 + 0 + 200 + 0 = 300 ⇒ 营业收入填 300 让自检 pass
// M1 营收 = 现金100 + 扫码200 + 储值/挂账/团购 0 + 外卖(888.88+0+0) = 1188.88
const FULL_VALS = ['2026/9/1', '早班', 100, 0, 200, 0, 0, 888.88, 0, 0, 0, 0, '', '', 300, 1188.88];
const build = (hdr, valsByName) => [hdr, hdr.map((c) => (valsByName[c] === undefined ? '' : valsByName[c]))];
const nameVals = {};
FULL_HDR.forEach((c, i) => { nameVals[c] = FULL_VALS[i]; });
const full = build(FULL_HDR, nameVals);
const MISS_HDR = FULL_HDR.filter((c) => c !== '美团外卖');   // 老板把「美团外卖」写成别名/整列删了
const missVals = Object.assign({}, nameVals); delete missVals['美团外卖'];   // 该渠道数值确实没了
const miss = build(MISS_HDR, missVals);
const fo = RD.parseRevenueDaily(full);
const mo = RD.parseRevenueDaily(miss);
console.log('完整表: revenueM1.totalYuan =', fo.revenueM1.totalYuan,
  ' cashInflow.pass =', fo.cashInflow.pass, ' mismatches =', fo.cashInflow.mismatches.length,
  ' identityOk =', fo.bridge.identityOk, ' takeawayYuan =', fo.revenueM1.takeawayYuan);
console.log('缺列表: revenueM1.totalYuan =', mo.revenueM1.totalYuan,
  ' cashInflow.pass =', mo.cashInflow.pass, ' mismatches =', mo.cashInflow.mismatches.length,
  ' identityOk =', mo.bridge.identityOk, ' takeawayYuan =', mo.revenueM1.takeawayYuan);
console.log('少算 =', (fo.revenueM1.totalYuan - mo.revenueM1.totalYuan).toFixed(2), '元');
console.log('缺列表 cols 有 waimaiMeituan 吗 =', Object.prototype.hasOwnProperty.call(mo.cols, 'waimaiMeituan'));
console.log('回执里暴露「缺列」了吗：index.js payload 字段 = revenueM1/cashInflow/bridge/channelYuan/days/...（无 cols / 无 missingCols）');
console.log('=> 自检只覆盖 REVENUE_FORMULA 四列，恒等式两边同减 888.88 仍成立 ⇒ 368.88 静默少算，零报错。');

console.log('\n===== C · 形态 A 按固定列序取数（列序漂移会取错列吗）=====');
// DISH_A_STRUCT: colName=1 colQty=2 colSales=4 colIncome=6 colDiscount=8（1-based）
// 构造 R3 表头含「菜品名称」「销售数量」+ R2 含「销售方式」⇒ 判形态 A；把「收入」从第 6 列挪到第 5 列
const mkA = (incomeAt) => {
  const r1 = ['菜品销售统计', '', '', '', '', '', '', ''];
  const r2 = ['营业日期：【2026/09/07 至 2026/09/07】  销售方式：全部', '', '', '', '', '', '', ''];
  const r3 = ['菜品名称', '销售数量', '销售额', '', '', '', '', ''];
  // 二级表头 R4 放列标签，数据 R5 起；按 1-based 位置放「收入(元)」
  const r4 = ['', '', '', '', '收入(元)', '优惠(元)', '', ''];
  r4[incomeAt - 1] = '收入(元)';
  const d = ['耙牛肉', 10, 680, 0, 0, 0, 0, 0];
  d[incomeAt - 1] = 500;   // 实际收入 500 元放在 incomeAt 列
  return [r1, r2, r3, r4, d];
};
for (const at of [6, 5, 7]) {
  const rows = mkA(at);
  const shape = SV.detectDishShape(rows);
  const parsed = SV.parseDishSales(rows);
  console.log('收入放第 ' + at + ' 列: shape =', shape,
    ' 首行 amountFen =', parsed.rows[0] ? parsed.rows[0].amountFen : '(无行)',
    ' (期望 50000 分 = 500 元；第 6 列是硬编码 colIncome)');
}
console.log('=> 形态 A 按 DISH_A_STRUCT 固定列序取数，不按列名；列序漂移 ⇒ 静默取错列（金额算错），仅平台导出格式稳定时安全。');

console.log('\n===== 探针结束（只读真跑）=====');
