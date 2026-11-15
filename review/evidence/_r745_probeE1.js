// _r745_probeE1.js —— M3 导入/导出审计只读探针（R745·audit-m3-io）
// 运行： node review/evidence/_r745_probeE1.js
// 纪律：只读现有文件；本文件是允许前缀 _r745_probeE* 的新探针，不改任何已有文件。
// 目的：用【真 SheetJS 0.18.5】+ 生产同源纯函数，实证六面结论（不采信注释自述）。
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const XLSX_PATH = 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules/xlsx';
const XLSX = require(XLSX_PATH);
console.log('真 SheetJS 版本 =', XLSX.version);

// 把 'xlsx' / 'wx-server-sdk' 路由给被测代码（与仓库守卫同一手法，喂的是真库不是桩）
const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'xlsx') return XLSX;
  if (req === 'wx-server-sdk') return {
    init() {}, DYNAMIC_CURRENT_ENV: 'x',
    database: () => ({ collection: () => ({}), command: {} }),
    getWXContext: () => ({}),
  };
  return origLoad.apply(this, arguments);
};
const SV = require(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'));
const BP = require(path.join(ROOT, 'utils/billParse.js'));
const RD = require(path.join(ROOT, 'cloudfunctions/importSalesBill/revenueDailyParse.js'));
const CM = require(path.join(ROOT, 'cloudfunctions/common/money.js'));
const CXM = require(path.join(ROOT, 'cloudfunctions/importSalesBill/cx_money.js'));
const E = require(path.join(ROOT, 'cloudfunctions/exportData/index.js'));
const A = require(path.join(ROOT, 'utils/api.js'));
Module._load = origLoad;

let n = 0;
const p = (t) => console.log('\n===== ' + (++n) + ') ' + t + ' =====');

// ---------------------------------------------------------------------------
p('两份 parseBillMatrix 在【同一张美团退款真表】上的行为差异（R181m 同族盲区）');
const mt = JSON.parse(fs.readFileSync(path.join(ROOT, 'review/evidence/r700_realtables/meituan_bill.json'), 'utf8'));
const bpR = BP.parseBillMatrix(mt, { platform: 'meituan' });
const svR = SV.parseBillMatrix(mt, { platform: 'meituan' });
console.log('utils/billParse.js (自测/守卫吃这份):', JSON.stringify(bpR.totals), 'excluded=' + bpR.excluded.rows);
console.log('cloudfunctions/importSalesBill/service.js (云端生产):', JSON.stringify(svR.totals), 'excluded=' + svR.excluded.rows);
console.log('金额差 =', svR.totals.amountFen - bpR.totals.amountFen, '分 =', ((svR.totals.amountFen - bpR.totals.amountFen) / 100).toFixed(2), '元（老板看到的是这个数）');
console.log('meituan 档案 BP:', JSON.stringify(BP.PLATFORM_PROFILE.meituan));
console.log('meituan 档案 SV:', JSON.stringify(SV.PLATFORM_PROFILE.meituan));

// ---------------------------------------------------------------------------
p('金额精度：解析层内联式 vs 单源，逐点穷举（当前是否真会算错钱）');
const inSvc = (x) => Math.round(Number((x * 100).toFixed(10)));   // service.js 6 处同式
const inRd = (x) => Math.round(Number((x * 100).toFixed(10)));     // revenueDailyParse fen()
let diff = 0, firstDiff = null, cnt = 0;
for (let i = 0; i <= 200000; i++) {
  const x = i / 1000;   // 三位小数全域（0.000 ~ 200.000）
  const a = CM.yuanToFen(x), b = A.yuanToFen(x), c = CXM.yuanToFen(x), d = inSvc(x), e = inRd(x);
  cnt++;
  if (!(a === b && b === c && c === d && d === e)) { diff++; if (!firstDiff) firstDiff = { x, a, b, c, d, e }; }
}
console.log('穷举点数 =', cnt, ' 分歧数 =', diff, ' 首个分歧 =', JSON.stringify(firstDiff));
console.log('=> 当前五份式子逐点等价（含 1.005 / 0.145 等 x.xx5 敏感点）；历史「裸 Math.round(x*100) 少进 1 分」已修。');
console.log('   但解析层 8 处是内联式、未 require 单源；守卫 check_money_precision.js 以源码形态登记覆盖（非行为穷举）。');

// ---------------------------------------------------------------------------
p('UTF-8 BOM CSV：decodeTextBuffer 判据 + 真 SheetJS 是否吞掉 BOM');
const csvHead = '日期,商品名,商品销量,商品销售额\n20260910,煮小酥肉,3,90.00\n';
const bomBuf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(csvHead, 'utf8')]);
const noBomBuf = Buffer.from(csvHead, 'utf8');
const decBom = SV.decodeTextBuffer(bomBuf);
const decNo = SV.decodeTextBuffer(noBomBuf);
console.log('带 BOM: encoding =', decBom.encoding, ' 首字符码位 = 0x' + decBom.text.charCodeAt(0).toString(16),
  ' 是否等于 \\uFEFF =', decBom.text.charCodeAt(0) === 0xFEFF);
console.log('无 BOM: encoding =', decNo.encoding, ' 首字符 =', JSON.stringify(decNo.text.slice(0, 2)));
const mtxBom = SV.bufferToMatrix(bomBuf);
const mtxNo = SV.bufferToMatrix(noBomBuf);
const hBom = mtxBom.sheets[Object.keys(mtxBom.sheets)[0]].rows[0];
const hNo = mtxNo.sheets[Object.keys(mtxNo.sheets)[0]].rows[0];
console.log('真 SheetJS 读回带 BOM 表头 =', JSON.stringify(hBom));
console.log('真 SheetJS 读回无 BOM 表头 =', JSON.stringify(hNo));
console.log('带 BOM 判形态 =', JSON.stringify(SV.detectDishMatrix(mtxBom)), ' 无 BOM 判形态 =', JSON.stringify(SV.detectDishMatrix(mtxNo)));
console.log('=> 结论见报告：SheetJS 是否自动剥 BOM 由此实证；编码守卫的桩 splitCsv 自己 replace(/^\\uFEFF/) 掩盖了这条。');

// ---------------------------------------------------------------------------
p('CSV 引号内逗号：真 SheetJS 是否切对列');
const quoted = '商品名称,销量,销售额\n"小酥肉,大份",3,90.00\n"牛肉,麻辣,中份",2,45.50\n';
const mtxQ = SV.bufferToMatrix(Buffer.from(quoted, 'utf8'));
const qRows = mtxQ.sheets[Object.keys(mtxQ.sheets)[0]].rows;
console.log('表头 =', JSON.stringify(qRows[0]));
console.log('数据行1 =', JSON.stringify(qRows[1]), ' 列数 =', (qRows[1] || []).length);
console.log('数据行2 =', JSON.stringify(qRows[2]), ' 列数 =', (qRows[2] || []).length);
console.log('形态 =', JSON.stringify(SV.detectDishMatrix(mtxQ)));
console.log('=> 与 check_import_encoding.js 的桩 splitCsv（l.split(",") 裸切）对比：桩会把引号内逗号切错，真库是否切对由此实证。');

// ---------------------------------------------------------------------------
p('GBK 无 BOM CSV 真库复核（R94/R615 已修证据）');
const gbkFile = path.join(ROOT, 'review/evidence/r242_mt_goods/mt_goods_20260907_20260913.csv');
if (fs.existsSync(gbkFile)) {
  const gbkBuf = fs.readFileSync(gbkFile);
  const dec = SV.decodeTextBuffer(gbkBuf);
  const mtx = SV.bufferToMatrix(gbkBuf);
  console.log('encoding =', dec.encoding, ' 表头前 8 列 =', JSON.stringify(mtx.sheets[Object.keys(mtx.sheets)[0]].rows[0].slice(0, 8)));
  console.log('形态 =', JSON.stringify(SV.detectDishMatrix(mtx)));
} else console.log('样例文件不存在，跳过');

// ---------------------------------------------------------------------------
p('UTF-16LE BOM 与 magic bytes 判据（不靠扩展名）');
console.log('xlsx(PK) =>', SV.decodeTextBuffer(Buffer.from([0x50, 0x4B, 0x03, 0x04, 1, 2, 3])));
console.log('xls(OLE) =>', SV.decodeTextBuffer(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 1, 2])));
const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(csvHead, 'utf16le')]);
const d16 = SV.decodeTextBuffer(u16);
console.log('UTF-16LE =>', d16.encoding, ' 表头 =', JSON.stringify(d16.text.split('\n')[0]));

// ---------------------------------------------------------------------------
p('导出 xlsx / CSV 能否被 importSalesBill 重新导入（round-trip 零交集实证）');
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
const b64 = E.xlsxSheetsBase64(sheets.concat([{ name: '关于本表', header: ['项目', '内容'], rows: [['本表由', '店算']] }]));
const xbuf = Buffer.from(b64, 'base64');
console.log('导出 xlsx 魔数 =', xbuf.slice(0, 4).toString('hex'), ' 大小 =', xbuf.length);
const rb = SV.bufferToMatrix(xbuf);
const rev = Object.keys(rb.sheets).map((nm) => ({ nm, hit: RD.detectRevenueDaily(rb.sheets[nm].rows).hit }));
console.log('回读 sheet 名 =', JSON.stringify(Object.keys(rb.sheets)));
console.log('营收日报表识别 =', JSON.stringify(rev));
console.log('菜品表形态 =', JSON.stringify(SV.detectDishMatrix(rb)));
console.log('账单平台 =', JSON.stringify(SV.detectPlatformInMatrix(rb)));
console.log('diagnoseColumns =', JSON.stringify(SV.diagnoseColumns(rb)));
// CSV 兼容通道（带 UTF-8 BOM）
const csvOut = E.csvFromRows(sheets[0].header, sheets[0].rows);
const cmtx = SV.bufferToMatrix(Buffer.from(csvOut, 'utf8'));
console.log('导出 CSV 回读首表头 =', JSON.stringify(cmtx.sheets[Object.keys(cmtx.sheets)[0]].rows[0]));
console.log('导出 CSV 判形态 =', JSON.stringify(SV.detectDishMatrix(cmtx)), ' 平台 =', JSON.stringify(SV.detectPlatformInMatrix(cmtx)));

// ---------------------------------------------------------------------------
p('导出利润表「表内合计与明细能否对平」+ 金额单元格类型');
const profit = sheets[0].rows;
const get = (label) => (profit.find((r) => String(r[0]) === label) || [])[1];
const opRef = get('＝ 经营参考利润'), gap = get('　消耗差异（真实 − 参考口径用的消耗）');
const amort = get('　减：当月摊销'), realP = get('＝ 全要素真实利润');
console.log('经营参考利润 =', opRef, ' 消耗差异 =', gap, ' 当月摊销 =', amort, ' 全要素真实利润 =', realP);
console.log('opRef - gap - amort =', Math.round(Number((opRef - gap - amort).toFixed(10)) * 100) / 100,
  ' 与 realP 相等 =', Math.abs((opRef - gap - amort) - realP) < 1e-9);
console.log('金额列单元格类型 =', typeof profit[0][1], ' (number 才能被 Excel SUM)');
console.log('整数金额显示（无 numFmt）: yuan(100000) =', E.yuan(100000), ' → Excel 显示 1000 而非 1000.00（口径说明称「保留 2 位小数」）');
const inc = get('营业收入');
const detail = sheets[1].rows.filter((r) => String(r[0]) === '收入');
const detailSum = detail.reduce((s, r) => s + (typeof r[3] === 'number' ? r[3] : 0), 0);
console.log('利润表营业收入 =', inc, ' 明细表逐项（含合计行）累加 =', detailSum, '（明细含自身合计行，老板需剔除才对得上）');

// ---------------------------------------------------------------------------
p('静默按 0：营收日报表缺「美团外卖」列 ⇒ M1 营收少算且自检抓不到');
// 完整表（含 18 列中的关键列）
const fullHdr = ['日期', '班次', '现金', '充值', '扫码', '美团团购', '抖音团购', '美团外卖', '京东外卖', '淘宝闪购', '茶楼', '会员消费', '挂账人/金额', '挂账还款人/金额', '营业收入', '合计'];
const rowOf = (h, vals) => h.map((_, i) => (vals[i] === undefined ? '' : vals[i]));
const dataRow = ['2026/9/1', '早班', 100, 0, 200, 0, 0, 888.88, 0, 0, 0, 0, '', '', '', 100 + 200 + 888.88];
const full = [fullHdr, rowOf(fullHdr, dataRow)];
const missHdr = fullHdr.filter((c) => c !== '美团外卖');   // 老板把「美团外卖」写成别的名 / 整列删了
const miss = [missHdr, rowOf(missHdr, dataRow)];
const fullOut = RD.parseRevenueDaily(full);
const missOut = RD.parseRevenueDaily(miss);
console.log('完整表 revenueM1.totalYuan =', fullOut.revenueM1.totalYuan, ' cashInflow.pass =', fullOut.cashInflow.pass, ' identityOk =', fullOut.bridge.identityOk);
console.log('缺列表 revenueM1.totalYuan =', missOut.revenueM1.totalYuan, ' cashInflow.pass =', missOut.cashInflow.pass, ' identityOk =', missOut.bridge.identityOk);
console.log('少算 =', (fullOut.revenueM1.totalYuan - missOut.revenueM1.totalYuan).toFixed(2), '元；缺列表 cols 里有 waimaiMeituan 吗 =', Object.prototype.hasOwnProperty.call(missOut.cols, 'waimaiMeituan'));
console.log('=> 缺列后 cashInflow.pass / identityOk 均仍为 true（自检不算 M1 渠道键）⇒ 静默少算，零报错。');

// ---------------------------------------------------------------------------
p('列名大小写/全半角/空格归一：形态 C 与 DSI-1 表头判据');
const baseC = ['日期', '商品名称', '销量', '销售额'];
const variants = [
  ['商品 名称（中间空格）', ['日期', '商品 名称', '销量', '销售额']],
  ['全角 ＳＡＬＥＳ', ['日期', '商品名称', '销量', '销售額']],
  ['销售额(元) 带单位后缀', ['日期', '商品名称', '销量', '销售额(元)']],
  ['英文列名 Sales', ['date', 'name', 'qty', 'sales']],
  ['别名单价', ['日期', '商品名', '商品销量', '商品销售额']],  // 别名表内应有
];
for (const [label, hdr] of variants) {
  const rows = [hdr, ['2026-09-10', '煮小酥肉', 3, 90]];
  console.log(label.padEnd(24), 'detectDishShape =', String(SV.detectDishShape(rows)),
    ' | diag =', JSON.stringify(SV.diagnoseColumns({ sheets: { S: { rows } } }).missing));
}
console.log('基线(正名) =', String(SV.detectDishShape([baseC, ['2026-09-10', '煮小酥肉', 3, 90]])));
const DSI = require(path.join(ROOT, 'cloudfunctions/importSalesBill/dsi1.js'));
console.log('DSI-1 表头「 日期」前后空格 =', DSI.isDSI1([' 日期', '渠道', '平台', '商品名称', '销量', '销售额', '备注']));
console.log('DSI-1 表头「日期(必填)」 =', DSI.isDSI1(['日期(必填)', '渠道', '平台', '商品名称', '销量', '销售额', '备注']));
console.log('DSI-1 表头「销量 」尾空格 =', DSI.isDSI1(['日期', '渠道', '平台', '商品名称', '销量 ', '销售额', '备注']));

// ---------------------------------------------------------------------------
p('DSI-1 行级错误结构（带行号）——是否会被 api.call 吞掉');
const bad = DSI.parse([DSI.HEADERS, ['2026-09-10', '堂食', '', '煮小酥肉', 'abc', 90]]);
console.log('parse 返回 =', JSON.stringify(bad));
console.log('=> index.js:796 用 fail(INVALID_PARAM, parsed.error) 回；utils/api.js:60 用 msgOf(r.code) 整条覆盖 r.msg ⇒ 用户看不到行号。');

console.log('\n===== 探针结束（以上全部为只读真跑，未修改任何现有文件）=====');
