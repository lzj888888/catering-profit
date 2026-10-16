// B3 可行性探针：能否在**离线**环境下真正「生成 base64 xlsx → 读回」。
const Module = require('module');
const path = require('path');
const WS = 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules';
const orig = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === 'xlsx') return require.resolve(path.join(WS, 'xlsx'));
  return orig.apply(this, arguments);
};
const XLSX = require(path.join(WS, 'xlsx'));
console.log('xlsx 版本 =', XLSX.version);

// 1) 真生成 base64（与 exportData::xlsxSheetsBase64 同路径）
const wb = XLSX.utils.book_new();
const aoa = [['项目', '金额(元)', '说明'], ['营业收入', 3779.65, '明细累加'], ['减：费用合计', 2069.7, '明细累加'], ['', '', '']];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '利润表');
const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
console.log('base64 长度 =', b64.length);

// 2) 真读回
const wb2 = XLSX.read(b64, { type: 'base64' });
console.log('读回工作表名 =', JSON.stringify(wb2.SheetNames));
const ws = wb2.Sheets['利润表'];
const back = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
console.log('读回行数 =', back.length, '（源行数 =', aoa.length, '）');
console.log('读回内容 =', JSON.stringify(back));
for (const r of [1, 2]) {
  const c = ws['B' + (r + 1)];
  console.log(`B${r + 1}: t=${c.t} v=${c.v} typeof=${typeof c.v} 回算分=${Math.round(Number((c.v * 100).toFixed(10)))}`);
}
