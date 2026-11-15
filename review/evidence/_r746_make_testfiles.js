// R746 真机测试表生成器 + 生产引擎自检
// 产出两份 xlsx 到桌面，并用【生产同源函数】真跑确认它们会触发目标分支。
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const XLSX = require('C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules/xlsx');

const ROOT = path.resolve(__dirname, '..', '..');
const DESK = 'C:/Users/lzj/Desktop';
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
const RD = require(path.join(ROOT, 'cloudfunctions/importSalesBill/revenueDailyParse.js'));
Module._load = origLoad;

const F = JSON.parse(fs.readFileSync(path.join(ROOT, 'review/evidence/r615_revenue/revenue_v5_rows.json'), 'utf8'));
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'review/evidence/r700_realtables/meituan_bill.json'), 'utf8'));

function aoaToXlsx(rows, sheetName, outPath) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, outPath);
  return fs.statSync(outPath).size;
}

// ── 表①：营收日报表 · 删掉「美团外卖」列（保留其余真数据）──
const det = RD.detectRevenueDaily(F.rows);
const wm = det.cols.waimaiMeituan;
const cut = F.rows.map((r) => { const c = r.slice(); c.splice(wm, 1); return c; });
const revPath = path.join(DESK, 'R746测试_营收日报_缺美团外卖列.xlsx');
const revSize = aoaToXlsx(cut, '营收日报', revPath);

// 自检：用 XLSX 真读回矩阵 → 生产 detect/parse 链路
//   ⚠️ 不用 SV.bufferToMatrix：它的返回结构是多 sheet 对象（{sheets:{...}}），
//      直接喂 detect 会把 sheet 名当行 ⇒ 误报「所有列都缺」。生产 index.js 也是先取
//      sheet.rows 再喂 detect，这里必须同构（R181m：测试路径 ≠ 生产路径的盲区）。
const revRb = fs.readFileSync(revPath);
const wb1 = XLSX.read(revRb, { type: 'buffer' });
const revRows = XLSX.utils.sheet_to_json(wb1.Sheets[wb1.SheetNames[0]], { header: 1, defval: '' });
const det2 = RD.detectRevenueDaily(revRows);
const revCheck = { hit: det2.hit, missing: RD.missingRevenueCols(det2.cols) };

// ── 表②：美团账单（含「订单部分退款」行）原样 ──
const mtRows = M.sheets['订单明细'].rows;
const mtPath = path.join(DESK, 'R746测试_美团账单_订单部分退款.xlsx');
const mtSize = aoaToXlsx(mtRows, '订单明细', mtPath);

// 自检：真读回 → 生产 parseBillMatrix
const mtRb = fs.readFileSync(mtPath);
const wb2 = XLSX.read(mtRb, { type: 'buffer' });
const mtRowsBack = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: '' });
const mtParsed = SV.parseBillMatrix({ sheets: { '订单明细': { rows: mtRowsBack } } }, { platform: 'meituan' });

console.log('===== 测试表生成与生产引擎自检 =====');
console.log('① ' + revPath + ' (' + revSize + ' B)');
console.log('   表头列数=' + F.rows[1].length + ' → 删列后=' + cut[1].length + '（删的是「' + F.rows[1][wm] + '」）');
console.log('   生产引擎认表=' + revCheck.hit + ' 缺列诊断=' + JSON.stringify(revCheck.missing));
console.log('   ⇒ 上传后应弹「这张表缺：美团外卖…缺了会少算，所以这次没有导入」且不落库');
console.log('② ' + mtPath + ' (' + mtSize + ' B)');
console.log('   行数=' + mtRows.length + ' 生产解析=' + JSON.stringify(mtParsed.totals) + ' excluded=' + mtParsed.excluded.rows);
console.log('   ⇒ 预览应收应为 ' + (mtParsed.totals.amountFen / 100).toFixed(2) + ' 元（改前 130.66）');
console.log('===== DONE =====');
