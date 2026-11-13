// cloudfunctions/getSalesBills/selftest.js —— R252 已导入账单列表（读侧）自测
// 运行： node cloudfunctions/getSalesBills/selftest.js
//
// 范式（R57 立约）：纯函数层（service.js / validate.js）行为断言。
//   `index.js` 含 require('wx-server-sdk') ⇒ 纯 node 加载不了 ⇒ 由 tools/check_salesbills.js
//   做「源码形状断言」（只读性 / 鉴权 / 幂等位置）。
const { buildBillList, buildDishDetail } = require('./service');
const { validateInput } = require('./validate');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const ROWS = [
  { _id: 'BILL_shop_mu6j87v1itrs_taobao_2026-10-08', qty: 118, amount: 182308, is_deleted: false },
  { _id: 'BILL_shop_mu6j87v1itrs_jd_order_2026-10-08', qty: 0, amount: 0, is_deleted: false },
  { _id: 'SALE_shop_mu6j87v1itrs_taobao_2026-10-08_0', qty: 2, amount: 1520, is_deleted: false },
  { _id: 'SALE_shop_mu6j87v1itrs_taobao_2026-10-08_1', qty: 43, amount: 0, is_deleted: false },
  { _id: 'SALE_shop_mu6j87v1itrs_pos_2026-10-07_0', qty: 5, amount: 5000, is_deleted: true, delete_at: '2026-10-09T08:00:00Z' },
];

const r = buildBillList(ROWS, {});
check('默认视图 3 条（账单级 2 + 菜品级 1）', r.list.length === 3, `list=${r.list.length}`);
check('软删行被滤掉（pos 不在默认视图）', r.list.every((x) => x.platform !== 'pos'));
check('菜品级两行聚合成一条（row_count=2）', r.list.filter((x) => x.kind === 'dish')[0].row_count === 2);
check('菜品级 qty 求和 = 45', r.list.filter((x) => x.kind === 'dish')[0].qty === 45);
check('菜品级 amount 求和 = 1520 分', r.list.filter((x) => x.kind === 'dish')[0].amount_fen === 1520);
check('账单级 jd_order 平台名完整（未被切成 order）',
  r.list.some((x) => x.platform === 'jd_order'), r.list.map((x) => x.platform).join(','));
check('summary.active_bills = 3', r.summary.active_bills === 3);
check('summary.platforms 去重排序', r.summary.platforms.join(',') === 'jd_order,taobao', r.summary.platforms.join(','));
check('includeCleared 时 cleared_bills = 1', buildBillList(ROWS, { includeCleared: true }).summary.cleared_bills === 1);
check('全量视图排序：新日期在前', buildBillList(ROWS, { includeCleared: true }).list[0].biz_date === '2026-10-08');
check('空输入 ⇒ 0 条（非恒真有值）', buildBillList([], {}).list.length === 0);
check('认不出的 _id 计入 unknownCount', buildBillList([{ _id: 'XXX_1' }], {}).unknownCount === 1);

check('validateInput 正常入参放行', validateInput({ shop_id: 's1' }).error === null);
check('validateInput 缺 shop_id 拒绝', validateInput({}).error !== null);
check('validateInput 日期格式错拒绝', validateInput({ shop_id: 's1', biz_date_from: '2026/10/08' }).error !== null);
check('validateInput include_cleared 严格布尔', validateInput({ shop_id: 's1', include_cleared: 'yes' }).include_cleared === false);

// ===== R728 S1/S2：菜品级明细（半开区间 / granularity / 缺参 fail-closed）=====
const DROWS = [
  { _id: 'S1', biz_date: '2026-11-01', dish_key: '青菜', qty: 10, amount: 12000, is_deleted: false },
  { _id: 'S2', biz_date: '2026-11-30', dish_key: '青菜', qty: 5, amount: 6000, is_deleted: false },
  { _id: 'S3', biz_date: '2026-12-01', dish_key: '青菜', qty: 99, amount: 0, is_deleted: false },
  { _id: 'S4', biz_date: '2026-11-10', dish_key: '', qty: 7, amount: 0, is_deleted: false },
  { _id: 'S5', biz_date: '2026-11-10', dish_key: '称菜', qty: 2.5, amount: 0, is_deleted: false },
  { _id: 'S6', biz_date: '2026-11-10', dish_key: '区间菜', qty: 8, amount: 0, is_deleted: false,
    granularity: 'interval', period_from: '2026-10-28', period_to: '2026-11-03' },
  { _id: 'S7', biz_date: '2026-11-11', dish_key: '软删菜', qty: 3, amount: 0, is_deleted: true },
];
const RNG = { biz_date_from: '2026-11-01', biz_date_to: '2026-12-01' };
const dd = buildDishDetail(DROWS, RNG);
check('R728-① 半开区间：11/01 与 11/30 计入、12/01 排除', dd.qtyByDish['青菜'] === 15, JSON.stringify(dd.qtyByDish));
check('R728-② 账单级空 dish_key 不计入菜品权重但如实上报', dd.unmatched_rows === 1 && !dd.qtyByDish[''], JSON.stringify(dd));
check('R728-③ 称重菜小数 qty 用原值且上报 fractional_qty_rows', dd.qtyByDish['称菜'] === 2.5 && dd.fractional_qty_rows === 1);
check('R728-④ 跨月区间汇总行排除并计数（绝不静默归边）',
  !dd.qtyByDish['区间菜'] && dd.interval_cross_month_rows === 1, JSON.stringify(dd));
check('R728-⑤ 软删行默认不计入（includeCleared 才放开）',
  !dd.qtyByDish['软删菜'] && buildDishDetail(DROWS, Object.assign({}, RNG, { includeCleared: true })).qtyByDish['软删菜'] === 3);
check('R728-⑥ 缺区间 fail-closed：reason=missing_range 且空权重（不读全表）',
  buildDishDetail(DROWS, {}).reason === 'missing_range' && Object.keys(buildDishDetail(DROWS, {}).qtyByDish).length === 0);
check('R728-⑦ from >= to 视为非法区间（不静默放行）',
  buildDishDetail(DROWS, { biz_date_from: '2026-12-01', biz_date_to: '2026-11-01' }).reason === 'missing_range');
check('R728-⑧ 只有账单级行时 reason=no_dish_rows（前端据此降级）',
  buildDishDetail([{ biz_date: '2026-11-05', dish_key: '', qty: 1 }], RNG).reason === 'no_dish_rows');
check('R728-⑨ 反恒真：全部明细行都在区间内时 matched_rows>0（不是恒零假绿）', dd.matched_rows === 3, String(dd.matched_rows));
check('R728-⑩ validateInput：detail=true 缺区间必拒 / 给区间必放 / 老调用不变',
  validateInput({ shop_id: 's1', detail: true }).error !== null
  && validateInput({ shop_id: 's1', detail: true, biz_date_from: '2026-11-01', biz_date_to: '2026-12-01' }).error === null
  && validateInput({ shop_id: 's1' }).detail === false);

console.log(`\n==== getSalesBills R252 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
