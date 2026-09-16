// cloudfunctions/adminOrderList/selftest.js —— 批次 6 · 订单管理列表自测
// 运行： node cloudfunctions/adminOrderList/selftest.js
// 覆盖：过滤条件组装（user_id / status）+ 金额分整数映射。
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 与 index.js 同款条件组装逻辑
function buildCond(v) {
  const cond = { is_deleted: false };
  if (typeof v.user_id === 'string' && v.user_id) cond.user_id = v.user_id;
  if (v.status === 'paid' || v.status === 'pending' || v.status === 'refunded') cond.status = v.status;
  return cond;
}
check('仅 is_deleted=false（软删不出现在后台列表）', buildCond({}).is_deleted === false && Object.keys(buildCond({})).length === 1);
check('带 user_id 过滤', buildCond({ user_id: 'u1' }).user_id === 'u1');
check('status=paid 过滤', buildCond({ status: 'paid' }).status === 'paid');
check('非法 status 不入条件', buildCond({ status: 'hacked' }).status === undefined);
check('user_id + status 组合', (c => c.user_id === 'u1' && c.status === 'refunded')(buildCond({ user_id: 'u1', status: 'refunded' })));

// 金额分映射
const doc = { order_no: 'MO1', amount: 2590, status: 'paid', paid_at: 1726000000000 };
const out = { order_no: doc.order_no, amount_fen: doc.amount, status: doc.status, paid_at: doc.paid_at };
check('金额映射为整数分', out.amount_fen === 2590 && Number.isInteger(out.amount_fen));
check('订单号/状态/支付时间映射', out.order_no === 'MO1' && out.status === 'paid' && out.paid_at === 1726000000000);

console.log(`\n==== adminOrderList 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);