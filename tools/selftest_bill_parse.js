// tools/selftest_bill_parse.js —— 批次 F 账单解析自测（零依赖，只用仓库内 fixture）
//
// 锚点（PLAN §四，移植后必须原样复现，否则不算交付）：
//   淘宝闪购 2026-08：156 行 / 到手 3779.65 元
//   美团 2026-08：全 97 行 → 外卖订单筛后 50 行 / 应收 1826.64 元
//
// 运行：node tools/selftest_bill_parse.js

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const { detectPlatform, guessHeader, parseBillMatrix } = require('../utils/billParse.js');
const ROOT = path.join(__dirname, '..', 'review', 'evidence', 'r181l_stage1_import_feed', 'fixtures');
const tb = JSON.parse(fs.readFileSync(path.join(ROOT, 'taobao_2026-08.matrix.json'), 'utf8'));
const mt = JSON.parse(fs.readFileSync(path.join(ROOT, 'meituan_2026-08.matrix.json'), 'utf8'));

console.log('===== detectPlatform（按列名，不看文件名）=====');
const tbHeader = tb.sheets['外卖账单明细'].rows[0].map((s) => String(s).trim());
const mtHeader = mt.sheets['订单明细'].rows[0].map((s) => String(s).trim());
check('detectPlatform 淘宝表头 → taobao', detectPlatform(tbHeader) === 'taobao', detectPlatform(tbHeader));
check('detectPlatform 美团表头 → meituan', detectPlatform(mtHeader) === 'meituan', detectPlatform(mtHeader));
// 反例：美团文件名叫 09bbd0104….xlsx、淘宝叫「淘宝闪购.xlsx」—— 只看列名不看文件名
check('detectPlatform 空表头 → null', detectPlatform([]) === null, '');
check('detectPlatform 未知表头 → null', detectPlatform(['foo', 'bar']) === null, '');

// 🔴 P1（R245）：判据从「单列特征」改为「签名列全中 + 排除列全不中」
//    京东 SKU 表第 11 列也叫「结算金额」⇒ 旧判据把它误判成 taobao（能算出错数的静默错账）。
console.log('===== P1 平台判据加严（京东串味回归）=====');
const JDR = path.join(__dirname, '..', 'review', 'evidence', 'r245_jd_profile');
const jdSkuH = JSON.parse(fs.readFileSync(path.join(JDR, 'jd_sku_header.json'), 'utf8')).header;
const jdOrdH = JSON.parse(fs.readFileSync(path.join(JDR, 'jd_order_header.json'), 'utf8')).header;
check('京东 SKU 表头 ≠ taobao（deny 排除生效）', detectPlatform(jdSkuH) !== 'taobao', String(detectPlatform(jdSkuH)));
check('京东订单级表头 ≠ taobao', detectPlatform(jdOrdH) !== 'taobao', String(detectPlatform(jdOrdH)));
check('淘宝表头混入「应结金额」⇒ 判 null（deny 硬判据）', detectPlatform(tbHeader.concat(['应结金额'])) === null, String(detectPlatform(tbHeader.concat(['应结金额']))));
check('缺签名列（只有账单日期）⇒ null', detectPlatform(['账单日期']) === null, String(detectPlatform(['账单日期'])));
check('签名列单中一个（只有结算金额）⇒ 不判 taobao', detectPlatform(['结算金额']) !== 'taobao', String(detectPlatform(['结算金额'])));

console.log('===== 淘宝锚点 =====');
const tbR = parseBillMatrix(tb, { platform: 'taobao' });
check('淘宝 行数 156（totals.rowCount）', tbR.totals.rowCount === 156, `got ${tbR.totals.rowCount}`);
check('淘宝 到手 3779.65 元 = 377965 分', tbR.totals.amountFen === 377965, `got ${tbR.totals.amountFen}`);
check('淘宝 有效订单数 150（不含退单 6）', tbR.totals.qty === 150, `got ${tbR.totals.qty}`);
check('淘宝 归月 months 含 2026-08', tbR.months.indexOf('2026-08') >= 0, JSON.stringify(tbR.months));

console.log('===== 美团锚点 =====');
const mtR = parseBillMatrix(mt, { platform: 'meituan' });
check('美团 筛后 50 行（totals.rowCount）', mtR.totals.rowCount === 50, `got ${mtR.totals.rowCount}`);
check('美团 应收 1826.64 元 = 182664 分', mtR.totals.amountFen === 182664, `got ${mtR.totals.amountFen}`);
check('美团 有效订单数 50', mtR.totals.qty === 50, `got ${mtR.totals.qty}`);
check('美团 排除 47 行（全 97 − 筛后 50）', mtR.excluded.rows === 47, `got ${mtR.excluded.rows}`);
check('美团 不筛直接 Σ 会得 1747.95（≠ 收入，已通过筛选避开）', mtR.totals.amountFen !== 174795, `应收=${mtR.totals.amountFen}`);

console.log('===== guessHeader（前 5 行非空文本格最多）=====');
check('guessHeader 淘宝 → 0', guessHeader(tb.sheets['外卖账单明细'].rows) === 0, String(guessHeader(tb.sheets['外卖账单明细'].rows)));
check('guessHeader 美团 → 0', guessHeader(mt.sheets['订单明细'].rows) === 0, String(guessHeader(mt.sheets['订单明细'].rows)));

// 🔴 P2~P6（R245）：京东秒送两形态接入（订单级两级表头 / SKU 级长表）
console.log('===== 京东秒送（P2~P6）=====');
const jdOrderM = JSON.parse(fs.readFileSync(path.join(JDR, 'jd_order_2026-09.matrix.json'), 'utf8'));
const jdSkuM = JSON.parse(fs.readFileSync(path.join(JDR, 'jd_sku_sample.matrix.json'), 'utf8'));
check('detectPlatform 京东订单级表头 → jd_order', detectPlatform(jdOrdH) === 'jd_order', String(detectPlatform(jdOrdH)));
check('detectPlatform 京东 SKU 表头 → jd_sku', detectPlatform(jdSkuH) === 'jd_sku', String(detectPlatform(jdSkuH)));

const jo = parseBillMatrix(jdOrderM, { platform: 'jd_order' });
check('京东订单级 表头行 = 1（两级表头取 R2）', jo.headerRow === 1, `got ${jo.headerRow}`);
check('京东订单级 收入 555.96 元 = 55596 分（仅正向订单）', jo.totals.amountFen === 55596, `got ${jo.totals.amountFen}`);
check('京东订单级 有效订单 23（按主订单号去重）', jo.totals.qty === 23, `got ${jo.totals.qty}`);
check('京东订单级 排除 92 行（115 − 23）', jo.excluded.rows === 92, `got ${jo.excluded.rows}`);
check('京东订单级 不筛会得 482.65（错值，已验证避开）', jo.totals.amountFen !== 48265, `收入=${jo.totals.amountFen}`);
check('京东订单级 bizDate 由「账期」区间归一为 YYYY-MM-DD', jo.rows.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(jo.rows[0].bizDate), JSON.stringify(jo.rows[0]));

const js = parseBillMatrix(jdSkuM, { platform: 'jd_sku' });
check('京东 SKU 表头行 = 0', js.headerRow === 0, `got ${js.headerRow}`);
check('京东 SKU 结算合计 237.00 元 = 23700 分', js.totals.amountFen === 23700, `got ${js.totals.amountFen}`);
check('京东 SKU 订单数 3（13 行按到家业务单号去重）', js.totals.qty === 3, `got ${js.totals.qty}`);
check('京东 SKU 计费行 13（长表一行一费项）', js.totals.rowCount === 13, `got ${js.totals.rowCount}`);
check('京东 SKU bizDate 取「账期时间」', js.rows.length === 1 && js.rows[0].bizDate === '2026-09-01', JSON.stringify(js.rows));

// 🔴 云函数副本同步（防两处漂移）：cloudfunctions/importSalesBill/service.js 内联了同源实现，
//    云函数独立打包不能 require utils/ ⇒ 必须**人工同步**。此处用源码特征做**便宜的防漂移判据**
//    （比 runtime 等价便宜的版本；逐字节等价由 probe_cf_parity.js 单独证）。
console.log('===== 云函数副本同步检查（防两处漂移）=====');
const cfSrc = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'importSalesBill', 'service.js'), 'utf8');
check('云函数副本含 PLATFORM_PROFILE 档案', cfSrc.indexOf('PLATFORM_PROFILE') >= 0, '');
check('云函数副本含 jd_order / jd_sku 两形态', cfSrc.indexOf("'jd_order'") >= 0 && cfSrc.indexOf("'jd_sku'") >= 0, '');
check('云函数副本含 pickSheet（按签名找 sheet，P4）', cfSrc.indexOf('function pickSheet') >= 0, '');
check('云函数副本 detectPlatform 用 require+deny（P1）', cfSrc.indexOf('prof.deny') >= 0, '');

// 🔴 R245：平台枚举在仓内有**三份**手写副本（云端 SALES_SCHEMA / 前端 utils/gradeGate.js / 入参 validate.js）。
//    P1 给云端加了 jd_order/jd_sku 而另两份漏跟 ⇒ check_grade_gate_dual A-② 当场红（抓到了才补）。
//    ⇒ 此处立「三副本逐值同序」判据，防止下次加平台又只改一处。
console.log('===== 平台枚举三副本同步（R245：京东两形态）=====');
const enumOf = (src) => {
  const m = src.match(/platform: \{[^}]*enum: \[([^\]]*)\]/);
  return m ? m[1].replace(/['"\s]/g, '').split(',').filter(Boolean) : null;
};
const ggSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'gradeGate.js'), 'utf8');
const vaSrc = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'importSalesBill', 'validate.js'), 'utf8');
const eCloud = enumOf(cfSrc);
const eFront = enumOf(ggSrc);
check('前端 utils/gradeGate.js 与云端 SALES_SCHEMA 的 platform.enum 逐值同序（含 jd_order/jd_sku）',
  !!eCloud && !!eFront && eCloud.join(',') === eFront.join(',') && eCloud.indexOf('jd_order') >= 0
    && eCloud.indexOf('jd_sku') >= 0,
  'cloud=[' + (eCloud || []).join(',') + '] front=[' + (eFront || []).join(',') + ']');
const platValidate = (vaSrc.match(/PLATFORMS = \[([^\]]*)\]/) || [])[1];
const pv = platValidate ? platValidate.replace(/['"\s]/g, '').split(',').filter(Boolean) : [];
check('入参 validate.js 的 PLATFORMS 含 jd_order/jd_sku 且不含 pos（入口不得把京东平台吞成空）',
  pv.indexOf('jd_order') >= 0 && pv.indexOf('jd_sku') >= 0 && pv.indexOf('pos') < 0,
  'PLATFORMS=[' + pv.join(',') + ']');

console.log('\n' + '='.repeat(60));
console.log(`===== 账单解析自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
