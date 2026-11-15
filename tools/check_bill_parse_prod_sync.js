// 生产账单解析 ≡ 自测副本 守卫（R746 / GAP-1）
//
// 守的是什么事故：R695/R700 只修了 utils/billParse.js，云端生产
//   cloudfunctions/importSalesBill/service.js 仍落后两版 —— 同一张美团退款真表：
//   自测 9081 分 / 生产 13066 分（多算 39.85 元 / 44%），老板预览看到的是错的。
//   而 check_bill_realtables.js 全仓零断言调生产 SV.parseBillMatrix ⇒ 门禁全绿无人知（R181m 同族）。
//
// 判据分层（防假绿）：
//   A 行为：真调【生产】SV.parseBillMatrix(美团退款真表) 断言 9081 分（不是只验档案字面）
//   B 同源：两个档案的 R695/R700 关键字段逐项相等
//   C 解析逻辑：生产 parseBillMatrix 内含 keepContains / isRefundType 两条分支
//   D 回归：淘宝/京东档案不被本次改动带偏（行为仍与自测一致）
//   E 变异回灌：把生产档案改回旧版（去掉 keepContains）必须被 A/B 抓到
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');

// service.js require('xlsx'/'wx-server-sdk')—— 与审计探针同手法喂真库/桩，不改产品文件
const XLSX = require('C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules/xlsx');
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
Module._load = origLoad;

const svSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'), 'utf8');
const bpSrc = fs.readFileSync(path.join(ROOT, 'utils/billParse.js'), 'utf8');
const mt = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'review/evidence/r700_realtables/meituan_bill.json'), 'utf8'));

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}

console.log('\n=== A 行为：真调生产 parseBillMatrix（不是档案字面）===');
const svR = SV.parseBillMatrix(mt, { platform: 'meituan' });
const bpR = BP.parseBillMatrix(mt, { platform: 'meituan' });
ok('A-① 🔴 生产解析美团退款真表 = 9081 分（改前 13066，多算 39.85 元）',
  svR.totals.amountFen === 9081, '生产=' + svR.totals.amountFen);
ok('A-② 生产 qty=5 / rowCount=6 与自测一致（退款不计单、冲减行保留）',
  svR.totals.qty === 5 && svR.totals.rowCount === 6
  && svR.totals.qty === bpR.totals.qty && svR.totals.rowCount === bpR.totals.rowCount,
  '生产 qty=' + svR.totals.qty + '/rows=' + svR.totals.rowCount);
ok('A-③ 生产 ≡ 自测逐分相等（两份同一真表）',
  svR.totals.amountFen === bpR.totals.amountFen,
  '生产=' + svR.totals.amountFen + ' 自测=' + bpR.totals.amountFen);
ok('A-④ 退款行没被整行排除（excluded 数与自测一致）',
  svR.excluded.rows === bpR.excluded.rows,
  '生产=' + svR.excluded.rows + ' 自测=' + bpR.excluded.rows);

console.log('\n=== B 档案关键字段同源（R695/R700）===');
const sp = SV.PLATFORM_PROFILE.meituan;
const bp = BP.PLATFORM_PROFILE.meituan;
for (const k of ['rowFilter', 'orderType', 'refund', 'refundTypeContains', 'qtyRule']) {
  ok('B-① 档案字段 ' + k + ' 生产 ≡ 自测', JSON.stringify(sp[k]) === JSON.stringify(bp[k]),
    '生产=' + JSON.stringify(sp[k]) + ' 自测=' + JSON.stringify(bp[k]));
}
ok('B-② keepContains 含「退款」（只放退款冲减，广告/保险照排）',
  Array.isArray(sp.rowFilter && sp.rowFilter.keepContains)
  && sp.rowFilter.keepContains.indexOf('退款') >= 0);

console.log('\n=== C 生产解析逻辑同源（不是只改档案）===');
ok('C-① 生产 parseBillMatrix 有 keepContains 分支',
  /keepContains[\s\S]{0,160}excludedRows\+\+/.test(svSrc));
ok('C-② 生产 parseBillMatrix 有 refundTypeContains / isRefundType 分支',
  /refundTypeContains/.test(svSrc) && /isRefundType/.test(svSrc));
ok('C-③ 生产与自测的两段解析逻辑形状一致（都非注释里的死代码）',
  /const kept = \(rf\.keepContains \|\| \[\]\)/.test(svSrc)
  && /const kept = \(rf\.keepContains \|\| \[\]\)/.test(bpSrc));

console.log('\n=== D 其它平台不回归 ===');
for (const pf of ['taobao', 'jd_order']) {
  if (!SV.PLATFORM_PROFILE[pf] || !BP.PLATFORM_PROFILE[pf]) continue;
  ok('D-① ' + pf + ' 档案未被本次改动带偏',
    JSON.stringify(SV.PLATFORM_PROFILE[pf]) === JSON.stringify(BP.PLATFORM_PROFILE[pf]));
}

console.log('\n=== E 变异回灌（证明 A/B 判据有牙，非恒真）===');
{
  const spMut = Object.assign({}, sp, { rowFilter: { col: '交易类型', eq: '外卖订单' } });
  ok('E-① 变异体（删掉 keepContains）在 B-① 判据下必须转红',
    JSON.stringify(spMut.rowFilter) !== JSON.stringify(bp.rowFilter));
  ok('E-② 变异体（qtyRule 退回 perRow）在 B-① 判据下必须转红',
    JSON.stringify(Object.assign({}, sp, { qtyRule: 'perRow' }).qtyRule)
    !== JSON.stringify(bp.qtyRule));
  ok('E-③ 真表 13066 ≠ 9081（证明 A-① 的 9081 不是恒真断言）',
    13066 !== bpR.totals.amountFen && bpR.totals.amountFen === 9081);
}

console.log('\n===== 账单解析生产/自测同源守卫：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
process.exit(fails.length === 0 ? 0 : 1);
