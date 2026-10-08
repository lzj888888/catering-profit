// review/evidence/r240_module_review/probe_platform.js
// R240 模块评估 —— 多平台账单/销量表「识别面」实证（不读码猜，直接 require 生产解析器）
//
// 目的：回答「京东外卖数据来了，现在能不能进」以及「加一家平台要动几处」。
// 纪律：先跑【正样本基线】证明探针不是恒 null 的假绿，再跑【变体】与【假设京东表】。
//
// 运行：node review/evidence/r240_module_review/probe_platform.js

const path = require('path');
const SVC = path.join(__dirname, '..', '..', '..', 'cloudfunctions', 'importSalesBill', 'service.js');
const S = require(SVC);

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  ' + extra : '')); }
}

console.log('=== 0 正样本基线（证明探针能认出「该认出的」）===');
const HDR_TAOBAO = ['账单日期', '订单编号', '订单类型', '结算金额', '退单'];
const HDR_MEITUAN = ['账单日期', '订单编号', '交易类型', '商家应收款', '账单金额'];
ok(S.detectPlatform(HDR_TAOBAO) === 'taobao', '淘宝表头 → taobao', '实得 ' + S.detectPlatform(HDR_TAOBAO));
ok(S.detectPlatform(HDR_MEITUAN) === 'meituan', '美团表头 → meituan', '实得 ' + S.detectPlatform(HDR_MEITUAN));

console.log('\n=== 1 识别条件 = 单列名硬依赖（去掉那一列即失效）===');
const HDR_TAOBAO_NONET = ['账单日期', '订单编号', '订单类型', '退单'];      // 少了「结算金额」
const HDR_MEITUAN_NONET = ['账单日期', '订单编号', '交易类型', '账单金额']; // 少了「商家应收款」
ok(S.detectPlatform(HDR_TAOBAO_NONET) === null, '淘宝表头去掉「结算金额」→ 认不出', '实得 ' + S.detectPlatform(HDR_TAOBAO_NONET));
ok(S.detectPlatform(HDR_MEITUAN_NONET) === null, '美团表头去掉「商家应收款」→ 认不出', '实得 ' + S.detectPlatform(HDR_MEITUAN_NONET));

console.log('\n=== 2 京东外卖账单（假设列名，共测 4 种常见写法）===');
// ⚠️ 我手上没有京东真样例，以下列名为「假设」，用于证明「只要不含那两个专有列名就必然认不出」。
//    真样例到手后按实际列名复测（本文件的 4 组可替换）。
const JD_VARIANTS = [
  { name: '假设A：商家实收 + 结算状态', hdr: ['账期', '订单号', '订单类型', '商家实收', '结算状态'] },
  { name: '假设B：实付金额 + 打款金额', hdr: ['日期', '订单号', '交易类型', '商品实付', '打款金额'] },
  { name: '假设C：含「结算金额」（与淘宝同名列）', hdr: ['日期', '订单号', '订单类型', '结算金额', '平台服务费'] },
  { name: '假设D：含「商家应收款」（与美团同名列）', hdr: ['日期', '订单号', '交易类型', '商家应收款', '账单金额'] },
];
for (const v of JD_VARIANTS) {
  const p = S.detectPlatform(v.hdr);
  console.log('  · ' + v.name + ' → detectPlatform = ' + JSON.stringify(p));
}

console.log('\n=== 3 模拟 index.js:72 的准入判据（sheetNameByPlatform 白名单）===');
const sheetNameByPlatform = { taobao: '外卖账单明细', meituan: '订单明细' };
const SHAPES = ['taobao', 'meituan', 'eleme', 'other', 'jd'];
for (const p of SHAPES) {
  const has = !!sheetNameByPlatform[p];
  console.log('  · 手选 platform=' + p.padEnd(8) + ' → 白名单 sheet 名 ' + JSON.stringify(sheetNameByPlatform[p]) + ' ⇒ ' + (has ? '放行' : '阻断（报「无法识别账单平台」，提示语里没有这一家）'));
}
ok(!sheetNameByPlatform['jd'], '京东 jd 在白名单外 ⇒ 账单路径必然阻断');
ok(!sheetNameByPlatform['eleme'], '饿了么 eleme 也在白名单外 ⇒ 前端选项里的 eleme 其实进不来');

console.log('\n=== 4 形态 C（外卖「商品销量」）判定 —— 列名词表是否敏感 ===');
const HDR_C_MEITUAN = ['日期', '门店编号', '商品名称', '销量', '销售额'];
const HDR_C_JD_S1 = ['日期', '门店', '商品名称', '销售数量', '销售金额'];   // 假设：数量/金额用词不同
const HDR_C_JD_S2 = ['订单日期', '商品', '商品名称', '销量', '实付金额'];   // 假设：金额用词不同
const mkRows = (hdr) => [hdr, ['2026-08-01', 'S1', '鱼香肉丝', '3', '36.00']];
ok(S.detectDishShape(mkRows(HDR_C_MEITUAN)) === S.DISH_SHAPES.C, '美团式形态C表头 → 判为 C（正样本）', '实得 ' + S.detectDishShape(mkRows(HDR_C_MEITUAN)));
ok(S.detectDishShape(mkRows(HDR_C_JD_S1)) === null, '假设京东式（销售数量/销售金额）→ 判不出', '实得 ' + S.detectDishShape(mkRows(HDR_C_JD_S1)));
ok(S.detectDishShape(mkRows(HDR_C_JD_S2)) === null, '假设京东式（商品/实付金额）→ 判不出', '实得 ' + S.detectDishShape(mkRows(HDR_C_JD_S2)));

console.log('\n=== 5 形态 C 取列白名单（缺列时不报错、静默归空）===');
console.log('  DISH_C_COLS = ' + JSON.stringify(['日期', '门店编号', '商品名称', '销量', '销售额']));
const parsedC = S.parseDishSalesC([
  ['日期', '门店', '商品名称', '销售数量', '销售金额'],       // 假设京东式表头（无一命中白名单）
  ['2026-08-01', 'S1', '鱼香肉丝', '3', '36.00'],
], { platform: 'other' });
console.log('  → rows=' + parsedC.rows.length + '  totals.amountFen=' + parsedC.totals.amountFen
  + '  unmatched=' + parsedC.unmatched.length
  + '  （列名不在白名单 ⇒ 静默取不到数，不报「列缺失」）');
ok(parsedC.rows.length === 1 && parsedC.totals.amountFen === 0, '假设京东式表：行进了、钱是 0（静默）');

console.log('\n=== 6 淘宝式「退单」列缺失时的静默行为（误判后不报错）===');
const mtx = {
  sheets: {
    '外卖账单明细': { rows: [   // 故意用淘宝 sheet 名 + 淘宝识别列，但**没有「退单」列**
      ['账单日期', '订单编号', '订单类型', '结算金额'],
      ['2026-08-01', 'A1', '正常单', '100.00'],
      ['2026-08-02', 'A2', '退款单', '-50.00'],
    ] },
  },
};
const pb = S.parseBillMatrix(mtx, { platform: 'taobao' });
console.log('  → rows=' + JSON.stringify(pb.rows) + '  excluded=' + JSON.stringify(pb.excluded));
ok(pb.totals.amountFen === 5000, '缺「退单」列 ⇒ 退款行被当正常单计入（金额 5000 分）', '实得 ' + pb.totals.amountFen);
console.log('  ⇒ 若某家平台的表恰好含「结算金额」但这张表**不是**淘宝格式 ⇒ 会被当淘宝解析且**不报错**');

console.log('\n===== 汇总：通过 ' + pass + ' / 失败 ' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
