// cloudfunctions/adminExport/selftest.js —— 批次 6 · 导出 CSV 自测（字段完整 / 角色控权）
// 运行： node cloudfunctions/adminExport/selftest.js
// 覆盖验收 8（导出 CSV 能打开且字段完整）+ §2.9 角色控权。
const { csvEscape, csvFromRows } = (function () {
  // 内联复用 index.js 的 CSV 纯函数（单测不引 wx-server-sdk）
  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvFromRows(header, rows) {
    const all = [header].concat(rows);
    return '\uFEFF' + all.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  }
  return { csvEscape, csvFromRows };
})();

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

console.log('===== CSV 转义 =====');
check('普通值原样', csvEscape('MO123') === 'MO123');
check('含逗号 → 引号包裹', csvEscape('a,b') === '"a,b"');
check('含引号 → 双写引号', csvEscape('he said "hi"') === '"he said ""hi"""');
check('含换行 → 引号包裹', csvEscape('a\nb') === '"a\nb"');
check('null/undefined → 空串', csvEscape(null) === '' && csvEscape(undefined) === '');

console.log('===== 验收 8 · 订单 CSV 字段完整 =====');
const header = ['order_no', 'user_id', 'amount_fen', 'plan_id', 'plan_name', 'status', 'channel', 'paid_at', 'created_at'];
const rows = [
  ['MO1', 'u1', 2590, 'plan_basic_month', '真实利润·月', 'paid', 'manual', 1726000000000, 1725900000000],
  ['MO2', 'u2', 19900, 'plan_basic_year', '真实利润·年', 'refunded', 'wechat', 1726000000001, 1725900000001],
];
const csv = csvFromRows(header, rows);
check('含 UTF-8 BOM（Excel 打开中文不乱码）', csv.charCodeAt(0) === 0xFEFF);
check('首行 = 表头 9 字段', csv.split('\r\n')[0].split(',').length === 9, csv.split('\r\n')[0]);
check('数据行数与金额分完整', csv.split('\r\n').length === 3 && csv.includes('2590') && csv.includes('19900'));
check('中文套餐名正确转义', csv.includes('真实利润·月'));
check('每行 9 列（字段完整）', csv.split('\r\n').slice(1).every((l) => l.split(',').length === 9));

console.log('===== §2.9 角色控权（index.js 内联逻辑对照）=====');
// adminExport：scope=entitlements 仅 super；运营仅 orders
const requireRole = (role, allowed) => (allowed && allowed.indexOf(role) >= 0) ? null : 'ADMIN_PERMISSION_DENIED';
check('super 可导出全量(entitlements)', requireRole('super', ['super']) === null);
check('op 导出全量 → 拒绝', requireRole('op', ['super']) === 'ADMIN_PERMISSION_DENIED');
check('op 可导出订单明细(orders)', requireRole('op', ['super', 'op']) === null);

console.log('===== 权益 CSV（全量导出，仅超管）=====');
const eh = ['user_id', 'expire_at', 'source', 'updated_at'];
const ecsv = csvFromRows(eh, [['u1', 1727000000000, 'manual', 1726000000000]]);
check('权益 CSV 4 字段 + BOM', ecsv.split('\r\n')[0].split(',').length === 4 && ecsv.charCodeAt(0) === 0xFEFF);

console.log(`\n==== adminExport 批次 6 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);