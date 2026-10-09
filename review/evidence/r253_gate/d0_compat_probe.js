// D0 兼容性检查 —— 多平台同时命中是否真能发生（不是推断，是复算）
// 目的：证明「哨兵值 AMBIGUOUS」有真实靶子，否则 D1 是空转。
const bp = require('../../../utils/billParse.js');

const P = bp.PLATFORM_PROFILE;
const ORDER = ['taobao', 'meituan', 'jd_order', 'jd_sku'];

// 复算：给定表头，列出「所有」命中的平台（现状 detectPlatform 只返第一个）
function allHits(cols) {
  const has = (n) => cols.indexOf(n) >= 0;
  const out = [];
  for (const p of ORDER) {
    const prof = P[p];
    if (!(prof.require || []).every(has)) continue;
    if ((prof.deny || []).some(has)) continue;
    out.push(p);
  }
  return out;
}

const cases = [
  ['淘宝真表头', ['账单日期', '结算金额', '订单类型', '商品名称']],
  ['美团真表头', ['账单日期', '商家应收款', '交易类型', '商品名称']],
  ['京东订单级 R2', ['应结金额', '对账单业务类型', '账期', '订单类型', '主订单号']],
  ['京东 SKU 表', ['结算金额', 'sku名称', '费用类型', '账期时间', '到家业务单号']],
  // 🔴 关键构造：淘宝 ∪ 美团 两套签名列的并集（第三方导出的\"宽表\"很常见）
  ['淘宝∪美团 并集表头', ['账单日期', '结算金额', '商家应收款', '订单类型', '交易类型']],
  ['结算金额 + 商家应收款（无账单日期）', ['结算金额', '商家应收款', '商品名称']],
];

let ambiguous = 0;
for (const [name, cols] of cases) {
  const hits = allHits(cols);
  const cur = bp.detectPlatform(cols);
  const star = hits.length >= 2 ? '  🔴 多平台命中' : '';
  if (hits.length >= 2) ambiguous++;
  console.log(
    (name + '                    ').slice(0, 36),
    '| hits=[' + hits.join(',') + ']',
    '| 现状返回=' + JSON.stringify(cur) + star
  );
}
console.log('\n多平台命中的样本数 =', ambiguous, '/', cases.length);
console.log('⇒ 若 >0，则 AMBIGUOUS 哨兵有真实靶子；现状是「闷头按第一个跑」。');
