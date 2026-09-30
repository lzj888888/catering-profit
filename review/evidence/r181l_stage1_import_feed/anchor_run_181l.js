// anchor_run_181l.js —— 锚点独立复算（JS 侧）：require 生产 utils/billParse.js / utils/gradeGate.js，
// 喂我方 fixture 矩阵。🔴 期望值来自 review/evidence/r181l_.../anchor_indep_181l.py（Python 侧独立实现），
// **不是**抄 InsCode 的 tools/selftest_bill_parse.js。
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../../..');
const bp = require(path.join(ROOT, 'utils/billParse.js'));
const gg = require(path.join(ROOT, 'utils/gradeGate.js'));
const FIX = path.join(__dirname, 'fixtures');

let pass = 0;
let fail = 0;
const ck = (n, c, x) => {
  if (c) { pass++; console.log('✅ ' + n + (x ? '   | ' + x : '')); }
  else { fail++; console.log('❌ ' + n + (x ? '   | ' + x : '')); }
};

const tbDoc = JSON.parse(fs.readFileSync(path.join(FIX, 'taobao_2026-08.matrix.json'), 'utf8'));
const mtDoc = JSON.parse(fs.readFileSync(path.join(FIX, 'meituan_2026-08.matrix.json'), 'utf8'));
const tbM = tbDoc.sheets['外卖账单明细'].rows;
const mtM = mtDoc.sheets['订单明细'].rows;

console.log('===== A 平台判定（🔴 按列名，不看文件名）=====');
ck('A1 淘宝表头 → taobao', bp.detectPlatform(tbM[0]) === 'taobao', bp.detectPlatform(tbM[0]));
ck('A2 美团表头 → meituan', bp.detectPlatform(mtM[0]) === 'meituan', bp.detectPlatform(mtM[0]));
ck('A3 淘宝表头不误判 meituan', bp.detectPlatform(tbM[0]) !== 'meituan', '');

console.log('===== B 锚点（期望值 = Python 侧独立复算）=====');
const tb = bp.parseBillMatrix(tbDoc, { platform: 'taobao' });
ck('B1 淘宝 rowCount = 156', tb.totals.rowCount === 156, 'got ' + tb.totals.rowCount);
ck('B2 淘宝 amountFen = 377965（3779.65 元）', tb.totals.amountFen === 377965, 'got ' + tb.totals.amountFen);
const mt = bp.parseBillMatrix(mtDoc, { platform: 'meituan' });
ck('B3 美团 rowCount = 50', mt.totals.rowCount === 50, 'got ' + mt.totals.rowCount);
ck('B4 美团 amountFen = 182664（1826.64 元）', mt.totals.amountFen === 182664, 'got ' + mt.totals.amountFen);
ck('B5 美团 excluded.rows = 47', !!(mt.excluded && mt.excluded.rows === 47), 'got ' + (mt.excluded && mt.excluded.rows));

console.log('===== C 甲级门禁（输入我方自造）=====');
const g1 = gg.checkGradeA({ platform: 'taobao', shopId: 's1', rows: tb.rows, totals: tb.totals }, gg.SALES_SCHEMA);
ck('C1 淘宝真实解析结果 → 过甲级', g1.pass === true, JSON.stringify(g1.failures));
const g2 = gg.checkGradeA({ platform: 'taobao', shopId: 's1', rows: [], totals: { amountFen: 0, qty: 0, rowCount: 0 } }, gg.SALES_SCHEMA);
ck('C2 空行 → 阻断 CHANNEL_EMPTY', g2.pass === false && g2.failures.some((f) => f.code === 'CHANNEL_EMPTY'), JSON.stringify(g2.failures.map((f) => f.code)));

console.log('\n===== 锚点复算（JS 侧 · require 生产单源）: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
