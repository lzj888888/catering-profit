// review/evidence/r242_jd_bill/mk_jd_sku_variant.js —— 造「带数据的京东 SKU 表」合成变体（只为实测误判后果）
// ⚠️ 这是**合成变体**，不是真实平台文件；原始 jd_sku_bill_20260930.xlsx 一字未改（md5 4e9037fd…）。
// 目的：真表是空表 ⇒ 测不出「平台误判成 taobao」的真实后果 ⇒ 补齐数据做行为级实测（变异回灌思路）。
// 变体做两件事：① sheet 名改成淘宝的 '外卖账单明细'（去掉那道"意外护栏"）② 填 3 行京东语义数据。
// 运行：node mk_jd_sku_variant.js
const fs = require('fs');
const path = require('path');
const Module = require('module');
const WS = 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules';
const o = Module._resolveFilename;
Module._resolveFilename = function (r) { if (r === 'xlsx') return require.resolve(path.join(WS, 'xlsx')); return o.apply(this, arguments); };
const XLSX = require(path.join(WS, 'xlsx'));

const F = path.join(__dirname, 'jd_sku_bill_20260930.xlsx');
const wb = XLSX.read(fs.readFileSync(F), { type: 'buffer' });
const sname = wb.SheetNames[0];
const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sname], { header: 1, blankrows: false, defval: '' });
console.log('原表 sheet 名 =', sname, '| 行数 =', aoa.length);

const header = aoa[0];
console.log('表头 27 列，第 11 列 =', JSON.stringify(header[10]));

// 造 1 个京东到家订单的 3 行长表（正向商品 + 推广费 + 保险）
// 列序：1到家业务单号 2业务类型 3商家编号 4门店编号 5skuId 6sku名称 7sku数量 8商品售价 9费用类型 10二级促销类型
//      11结算金额 12京东承担金额 13商家承担金额 14商家承担比例 15优惠ID 16优惠名称 17upc 18下单时间 19完成时间
//      20账期时间 21结算单id 22钱包结算状态 23钱包 24秒送单号 25秒送skuid 26秒送sku名称 27秒送upc
function row(order, bizType, skuId, skuName, qty, price, feeType, settle, jdBear, merBear, ratio, dt) {
  return [order, bizType, 'M7647722', 'S7647723', skuId, skuName, qty, price, feeType, '',
    settle, jdBear, merBear, ratio, '', '', '', dt, dt, dt, 'JS001', '已结算', '钱包A', '', '', '', ''];
}
const D = '2026-09-30 12:00:00';
const data = [
  row('JD0001', '正向订单', 'SKU-A', '耙牛肉', 1, 88.00, '商品', 88.00, 0, 0, '', D),
  row('JD0001', '交易额转推广费', 'SKU-A', '耙牛肉', 1, 88.00, '推广费', -8.80, 0, -8.80, '', D),
  row('JD0001', '保险单', 'SKU-A', '耙牛肉', 1, 88.00, '准时保', -0.50, 0, -0.50, '', D),
  row('JD0002', '正向订单', 'SKU-B', '耙鸡爪', 2, 36.00, '商品', 72.00, 0, 0, '', D),
];
console.log('合成数据行 =', data.length, '（2 个订单号：JD0001 三行、JD0002 一行）');

const out = [header].concat(data);
const wb2 = XLSX.utils.book_new();
const ws2 = XLSX.utils.aoa_to_sheet(out);
// ① 把 sheet 名改成淘宝的 sheet 名，去掉那道"意外护栏"
XLSX.utils.book_append_sheet(wb2, ws2, '外卖账单明细');
const OUT = path.join(__dirname, '_variant_jd_sku_withdata.xlsx');
XLSX.writeFile(wb2, OUT);
console.log('已写出变体 =', path.basename(OUT), '|', fs.statSync(OUT).size, 'B（sheet 名 = 外卖账单明细）');
console.log('正确口径参照：JD0001 到手应 = 88.00-8.80-0.50 = 78.70；JD0002 = 72.00；合计 = 150.70，订单数应 = 2');
