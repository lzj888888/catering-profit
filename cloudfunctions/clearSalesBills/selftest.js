// cloudfunctions/clearSalesBills/selftest.js —— R252 清除已导入账单（写侧）自测
// 运行： node cloudfunctions/clearSalesBills/selftest.js
//
// 范式（R57 立约）：纯函数层（service.js / validate.js）行为断言。
//   `index.js`（软删三件套 / 幂等位置 / 上限护栏 / 审计）由 tools/check_salesbills.js
//   做源码形状断言 —— 它含 require('wx-server-sdk')，纯 node 加载不了。
const { matchTargets } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const ROWS = [
  { _id: 'BILL_shop_mu6j87v1itrs_taobao_2026-10-08' },
  { _id: 'BILL_shop_mu6j87v1itrs_jd_order_2026-10-08' },
  { _id: 'SALE_shop_mu6j87v1itrs_taobao_2026-10-08_0' },
  { _id: 'SALE_shop_mu6j87v1itrs_taobao_2026-10-08_1' },
  { _id: 'SALE_shop_mu6j87v1itrs_pos_2026-10-07_0' },
];
const N = (t, o) => matchTargets(ROWS, t, o || {}).hits.length;

check('🔴 kind 缺省 ⇒ 账单级+菜品级都命中（3 行）', N([{ platform: 'taobao', biz_date: '2026-10-08', kind: '' }]) === 3,
  `${N([{ platform: 'taobao', biz_date: '2026-10-08', kind: '' }])} 行`);
check('kind=bill ⇒ 仅账单级（1 行）', N([{ platform: 'taobao', biz_date: '2026-10-08', kind: 'bill' }]) === 1);
check('kind=dish ⇒ 仅菜品级（2 行）', N([{ platform: 'taobao', biz_date: '2026-10-08', kind: 'dish' }]) === 2);
check('🔴 平台名含下划线命中（jd_order）', N([{ platform: 'jd_order', biz_date: '2026-10-08', kind: '' }]) === 1);
check('all=true ⇒ 全部命中（5 行）', N([], { all: true }) === 5);
check('无命中 ⇒ 空数组（不误删不报错）', N([{ platform: 'meituan', biz_date: '2026-10-08', kind: '' }]) === 0);
check('认不出形态的行 ⇒ 不误删（全清也不碰）',
  matchTargets([{ _id: 'XXX_1' }], [], { all: true }).hits.length === 0);
check('多目标并集（淘宝 10-08 + 京东 10-08）',
  N([{ platform: 'taobao', biz_date: '2026-10-08', kind: '' }, { platform: 'jd_order', biz_date: '2026-10-08', kind: '' }]) === 4);

check('validateInput targets 正常放行', validateInput({ shop_id: 's1', targets: [{ platform: 'taobao', biz_date: '2026-10-08' }] }).error === null);
check('validateInput 空 targets 且非 all ⇒ 拒绝', validateInput({ shop_id: 's1' }).error !== null);
check('validateInput all 无 confirm_all ⇒ 拒绝', validateInput({ shop_id: 's1', all: true }).error !== null);
check('validateInput all + confirm_all ⇒ 放行', validateInput({ shop_id: 's1', all: true, confirm_all: true }).error === null);
check('validateInput targets 与 all 同现 ⇒ 拒绝', validateInput({ shop_id: 's1', all: true, confirm_all: true, targets: [{ platform: 'taobao', biz_date: '2026-10-08' }] }).error !== null);
check('validateInput 日期格式错 ⇒ 拒绝', validateInput({ shop_id: 's1', targets: [{ platform: 'taobao', biz_date: '2026/10/08' }] }).error !== null);
check('validateInput kind 非 bill/dish ⇒ 拒绝', validateInput({ shop_id: 's1', targets: [{ platform: 'taobao', biz_date: '2026-10-08', kind: 'x' }] }).error !== null);
check('validateInput 缺 platform ⇒ 拒绝', validateInput({ shop_id: 's1', targets: [{ biz_date: '2026-10-08' }] }).error !== null);

console.log(`\n==== clearSalesBills R252 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
