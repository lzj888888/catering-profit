// probe_cf_parity.js —— 验证 cloudfunctions/importSalesBill/service.js 里的 billParse **等价副本**
// 与 utils/billParse.js 的**结果逐字节一致**（防两处漂移）。
//
// 🔴 为什么需要它：云函数独立打包、不能 require 小程序侧 utils/ ⇒ service.js 内联了同源实现。
//    此前**环上零守卫**，任一侧改了另一侧忘了 ⇒ 线上/本地分叉且无告警（与 R232 C-9 dishKey 同族）。
//
// 运行：node review/evidence/r245_jd_profile/probe_cf_parity.js
const fs = require('fs');
const path = require('path');
const Module = require('module');

// xlsx 替身（PITFALLS §23：必须在 require 目标之前生效，且用 function 形式）
const STUB = path.join(__dirname, 'xlsx_stub.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === 'xlsx') return STUB;
  return origResolve.apply(this, arguments);
};

const REPO = path.join(__dirname, '..', '..', '..');
const utils = require(path.join(REPO, 'utils', 'billParse.js'));
const svc = require(path.join(REPO, 'cloudfunctions', 'importSalesBill', 'service.js'));

const R = __dirname;
const jdOrderH = JSON.parse(fs.readFileSync(path.join(R, 'jd_order_header.json'), 'utf8')).header;
const jdSkuH = JSON.parse(fs.readFileSync(path.join(R, 'jd_sku_header.json'), 'utf8')).header;
const jdOrderM = JSON.parse(fs.readFileSync(path.join(R, 'jd_order_2026-09.matrix.json'), 'utf8'));
const jdSkuM = JSON.parse(fs.readFileSync(path.join(R, 'jd_sku_sample.matrix.json'), 'utf8'));
const FIX = path.join(REPO, 'review', 'evidence', 'r181l_stage1_import_feed', 'fixtures');
const tbM = JSON.parse(fs.readFileSync(path.join(FIX, 'taobao_2026-08.matrix.json'), 'utf8'));
const mtM = JSON.parse(fs.readFileSync(path.join(FIX, 'meituan_2026-08.matrix.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (name, cond, detail) => {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
};

console.log('===== 1. 云函数副本的京东结果（独立于 utils 那份）=====');
chk('cf detectPlatform 京东订单级 → jd_order', svc.detectPlatform(jdOrderH) === 'jd_order', String(svc.detectPlatform(jdOrderH)));
chk('cf detectPlatform 京东 SKU → jd_sku', svc.detectPlatform(jdSkuH) === 'jd_sku', String(svc.detectPlatform(jdSkuH)));
const cfJo = svc.parseBillMatrix(jdOrderM, { platform: 'jd_order' });
const cfJs = svc.parseBillMatrix(jdSkuM, { platform: 'jd_sku' });
chk('cf 京东订单级 55596 分 / qty 23', cfJo.totals.amountFen === 55596 && cfJo.totals.qty === 23,
  `${cfJo.totals.amountFen}/${cfJo.totals.qty}`);
chk('cf 京东 SKU 23700 分 / qty 3', cfJs.totals.amountFen === 23700 && cfJs.totals.qty === 3,
  `${cfJs.totals.amountFen}/${cfJs.totals.qty}`);

console.log('===== 2. 两副本「逐字节一致」（核心判据）=====');
const cases = [
  ['淘宝', tbM, 'taobao'], ['美团', mtM, 'meituan'],
  ['京东订单级', jdOrderM, 'jd_order'], ['京东 SKU', jdSkuM, 'jd_sku'],
];
for (const [nm, m, p] of cases) {
  const a = JSON.stringify(utils.parseBillMatrix(m, { platform: p }));
  const b = JSON.stringify(svc.parseBillMatrix(m, { platform: p }));
  chk(`副本一致 · ${nm}`, a === b, a === b ? 'byte-identical' : 'DIFF');
}
for (const [nm, h] of [['淘宝表头', tbM.sheets['外卖账单明细'].rows[0].map(String)],
                       ['美团表头', mtM.sheets['订单明细'].rows[0].map(String)],
                       ['京东订单级表头', jdOrderH], ['京东 SKU 表头', jdSkuH],
                       ['空表头', []], ['未知表头', ['foo', 'bar']]]) {
  const a = String(utils.detectPlatform(h)), b = String(svc.detectPlatform(h));
  chk(`detectPlatform 一致 · ${nm}`, a === b, `${a} vs ${b}`);
}

console.log('\n' + '='.repeat(56));
console.log(`===== 云函数副本一致性：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
