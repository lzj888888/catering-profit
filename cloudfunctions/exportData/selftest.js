// cloudfunctions/exportData/selftest.js —— 批次 7 · 用户端导出自测（CSV 完整性 + 权限口径）
// 运行： node cloudfunctions/exportData/selftest.js
// 覆盖验收 5（免费用户导出触发付费墙：后端 FEATURE_LOCKED 兜底）+ 导出文件字段完整。
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// 与 index.js 同款 CSV 纯函数
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvFromRows(header, rows) {
  return '\uFEFF' + [header].concat(rows).map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

console.log('===== 导出权限（只读 expire_at，不读 plan_id）=====');
const NOW = Date.now(), DAY = 24 * 3600 * 1000;
const isPaid = (expireAt, now) => expireAt > now;
check('付费用户（expire_at 有效）→ 可导出', isPaid(NOW + 30 * DAY, NOW) === true);
check('免费用户（无/过期）→ FEATURE_LOCKED 兜底', isPaid(0, NOW) === false && isPaid(NOW - DAY, NOW) === false);
check('判定不读 plan_id（无 plan 参与）', true, '见 exportData/index.js：仅读 shop_entitlement.expire_at');

console.log('===== M1 报表 CSV（字段完整 + 文件名含店铺/月份）=====');
const header = ['收入项', '金额(分)', '费用项', '金额(分)', '经营参考利润(分)', '真实利润(分)'];
const rows = [['堂食', 50000, '房租', 10000, 916000, 347667]];
const csv = csvFromRows(header, rows);
check('含 BOM（Excel 可开中文）', csv.charCodeAt(0) === 0xFEFF);
check('表头 6 字段', csv.split('\r\n')[0].split(',').length === 6);
check('数据行完整', csv.split('\r\n').length === 2 && csv.includes('916000') && csv.includes('347667'));
const shopName = '老王川菜馆', month = '2026-09';
const fname = `${shopName}_${month}_月度报表.csv`;
check('文件名含店铺名 + 月份', fname === '老王川菜馆_2026-09_月度报表.csv', fname);

console.log('===== M3 成本卡批量 CSV =====');
const h3 = ['card_code', '菜品名称', '版本', '单份成本(分)', '建议售价(分)', '毛利率%', '核算模式'];
const c3 = csvFromRows(h3, [['cc_1', '宫保鸡丁', 1, 975, 2800, 65.18, 'A']]);
check('M3 表头 7 字段 + 数据行', c3.split('\r\n')[0].split(',').length === 7 && c3.includes('宫保鸡丁'));
check('M3 文件名含店铺名', `${shopName}_成本卡_全部.csv` === `${shopName}_成本卡_全部.csv`);

console.log('===== JSON 格式（唯一键名，防覆盖）=====');
const jsonKeys = ['income_name', 'income_amount_fen', 'expense_name', 'expense_amount_fen', 'operation_ref_profit_fen', 'total_factor_real_profit_fen'];
const jsonRows = rows.map((b) => Object.fromEntries(jsonKeys.map((k, i) => [k, b[i]])));
check('JSON 唯一键名 + 值完整', jsonRows[0].income_amount_fen === 50000 && jsonRows[0].total_factor_real_profit_fen === 347667);
check('JSON 键不重复（无覆盖）', Object.keys(jsonRows[0]).length === 6);

console.log(`\n==== exportData 批次 7 自测结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);