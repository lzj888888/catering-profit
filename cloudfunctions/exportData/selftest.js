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
// M3.28（批次 Q3）：此处原本自己抄了一份 `(expireAt, now) => expireAt > now` ——
//   与生产实现是**两份代码** ⇒ 生产那份改坏了，这里照样绿 ⇒ **假绿**。改为 require 真实单源。
const { isPaid, PAID_FEATURES } = require('./common');
check('付费用户（expire_at 有效）→ 可导出', isPaid(NOW + 30 * DAY, NOW) === true);
check('免费用户（无/过期）→ FEATURE_LOCKED 兜底', isPaid(0, NOW) === false && isPaid(NOW - DAY, NOW) === false);
check('付费判定不读 plan_id（🔒 R71 语义延续：判定链下沉后改验单源文件）',
  (() => {
    const s = require('fs').readFileSync(require('path').join(__dirname, 'cx_entitlement.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    return /expire_at/.test(s) && !/plan_id/.test(s) && !/feature_permissions/.test(s);
  })(),
  'cx_entitlement.js 只读 shop_entitlement.expire_at，不引入 plan 维度');
check('index.js 已退出判定链（禁在函数内再写一遍，防复制成第二份真相源）',
  !/expire_at/.test(require('fs').readFileSync(require('path').join(__dirname, 'index.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')),
  '判定只在 cx_entitlement.js 一处');
check('付费域清单含 export / m3_combo / m3_takeaway（S1·S2 落地即有墙，不必二次接线）',
  ['export', 'm3_combo', 'm3_takeaway'].every((k) => PAID_FEATURES.indexOf(k) >= 0), PAID_FEATURES.join(' / '));
// 🔒 round147 变异回灌 V5 暴露的缺口：原本只测了"有效/0/过期前一天"，没测**恰好等于 now** 这一格，
//    把 `>` 改成 `>=` 照样全绿 ⇒ 用户能多白嫖一整天而无人察觉。
check('到期边界：恰好 == now ⇒ false（`>` 写成 `>=` 必须转红，否则到期当天还能用）',
  isPaid(NOW, NOW) === false && isPaid(NOW + 1, NOW) === true,
  `==now:${isPaid(NOW, NOW)} / now+1ms:${isPaid(NOW + 1, NOW)}`);
check('脏数据：undefined / NaN ⇒ false（不因类型脏而放行）',
  isPaid(undefined, NOW) === false && isPaid(NaN, NOW) === false);

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