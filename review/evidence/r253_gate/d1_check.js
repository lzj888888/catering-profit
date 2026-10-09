// D1/D1b 复核：两份副本 detectPlatform 行为必须逐字节一致，且哨兵按预期触发
const bp = require('../../../utils/billParse.js');
// 云端副本 service.js 顶部 require('xlsx')（本机未装）⇒ 照 selftest_bill_parse.js 的既有做法打桩
const path = require('path');
let svc = null;
try { svc = require(path.join(__dirname, '..', '..', '..', 'cloudfunctions', 'importSalesBill', 'service.js')); }
catch (e) {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  svc = require(path.join(__dirname, '..', '..', '..', 'cloudfunctions', 'importSalesBill', 'service.js'));
  Module._load = orig;
}

const cases = [
  ['淘宝真表头', ['账单日期', '结算金额', '订单类型']],
  ['美团真表头', ['账单日期', '商家应收款', '交易类型']],
  ['京东订单级', ['应结金额', '对账单业务类型', '账期']],
  ['京东 SKU', ['结算金额', 'sku名称', '费用类型', '账期时间']],
  ['空表头', []],
  ['未知表头', ['foo', 'bar']],
  ['🔴 淘宝∪美团（多平台）', ['账单日期', '结算金额', '商家应收款']],
  ['🔴 三平台并集', ['账单日期', '结算金额', '商家应收款', '应结金额', '对账单业务类型']],
];

let bad = 0;
for (const [name, cols] of cases) {
  const a = bp.detectPlatform(cols);
  const b = svc.detectPlatform(cols);
  const same = a === b;
  if (!same) bad++;
  console.log((name + '                       ').slice(0, 30), '| utils=' + JSON.stringify(a),
    '| 云端=' + JSON.stringify(b), same ? '' : '  ❌ 两份不一致');
}

// 哨兵必须冒泡（truthy 陷阱回归）
const ambigSheet = { sheets: { s1: { rows: [['账单日期', '结算金额', '商家应收款'], ['1', '2', '3']] } } };
const r1 = bp.detectPlatformInRows(ambigSheet.sheets.s1.rows);
const r2 = bp.detectPlatformInMatrix(ambigSheet);
const r3 = svc.detectPlatformInRows(ambigSheet.sheets.s1.rows);
const r4 = svc.detectPlatformInMatrix(ambigSheet);
console.log('\nInRows  utils=', JSON.stringify(r1), ' 云端=', JSON.stringify(r3));
console.log('InMatrix utils=', JSON.stringify(r2), ' 云端=', JSON.stringify(r4));
if (!(r1 && r1.platform === 'AMBIGUOUS')) { console.log('❌ InRows 未冒泡哨兵'); bad++; }
if (!(r2 && r2.platform === 'AMBIGUOUS')) { console.log('❌ InMatrix 未冒泡哨兵'); bad++; }
if (!(r3 && r3.platform === 'AMBIGUOUS')) { console.log('❌ 云端 InRows 未冒泡哨兵'); bad++; }
if (!(r4 && r4.platform === 'AMBIGUOUS')) { console.log('❌ 云端 InMatrix 未冒泡哨兵'); bad++; }

// 兼容性：单平台样本必须仍返原值（防加哨兵改坏主路）
const okCases = [
  [['账单日期', '结算金额'], 'taobao'],
  [['账单日期', '商家应收款'], 'meituan'],
  [['应结金额', '对账单业务类型'], 'jd_order'],
  [['结算金额', 'sku名称', '费用类型'], 'jd_sku'],
];
for (const [cols, want] of okCases) {
  if (bp.detectPlatform(cols) !== want) { console.log('❌ 兼容性破坏：', cols.join(','), '期望', want, '实得', bp.detectPlatform(cols)); bad++; }
}
console.log('\n结论：', bad === 0 ? '✅ 两份一致 + 哨兵冒泡 + 单平台兼容 全通过' : ('❌ ' + bad + ' 处不符'));
process.exit(bad === 0 ? 0 : 1);
