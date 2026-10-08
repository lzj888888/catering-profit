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

console.log('\n' + '='.repeat(60));
console.log(`===== 账单解析自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
