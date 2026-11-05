#!/usr/bin/env node
// review/evidence/r589_ai_contract/check_output.js —— 把 AI 产出的文本喂给真实解析器
// 用法：node check_output.js <产物路径> [标签]
// 判据：不看"像不像"，只把 CSV 行原样喂 dsi1.parse，看它认不认、数字对不对。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const D = require(path.join(ROOT, 'cloudfunctions/importSalesBill/dsi1.js'));

const file = process.argv[2];
const tag = process.argv[3] || path.basename(file);
const raw = fs.readFileSync(file, 'utf8');

// 去掉 markdown 围栏与说明文字：只保留"看起来是 CSV 的那几行"
let text = raw.replace(/```[a-zA-Z]*/g, '');
const lines = text.split(/\r?\n/).filter((l) => l.trim());
const csvLines = lines.filter((l) => (l.match(/,/g) || []).length >= 3);

console.log('\n===== ' + tag + ' =====');
console.log('原始输出 ' + raw.length + ' 字，其中疑似 CSV 行 ' + csvLines.length + ' 行');
if (!csvLines.length) { console.log('❌ 没找到 CSV 行'); process.exit(1); }

// 简易 CSV 切分（够用：本测试数据里没有引号包裹的逗号）
const rows = csvLines.map((l) => l.split(',').map((c) => c.trim()));

const r = D.parse(rows);
if (!r.ok) {
  console.log('❌ 解析器拒收：' + r.error);
  console.log('   表头实际 = ' + JSON.stringify(rows[0]));
  process.exit(1);
}
const s = r.summary;
console.log('✅ 解析通过');
console.log('   行 ' + s.rowCount + ' | 天 ' + s.dayCount + ' (' + s.dayFrom + '~' + s.dayTo + ') | 商品 ' + s.dishCount);
console.log('   合计 ' + (s.totalAmountFen / 100).toFixed(2) + ' 元 | 总销量 ' + s.totalQty);
console.log('   小数行 ' + s.nonInt.length + ' | 退款行 ' + s.refunds.length);
console.log('   分渠道 ' + Object.keys(s.byChannel).map((k) => k + '=' + (s.byChannel[k].amountFen / 100).toFixed(2)).join(' | '));

// 期望值（原料正确转出来应得；合计行必须被删掉）
// 🔴 期望值修正（R589 实测）：totalQty 用的是**取整后的 qty**（1.5 记 2），
//   所以是 60 而不是 59.5 —— 我第一次把 1.5 原样加进去，判成"AI 错"，实际是我算错。
//   原始值 1.5 在 summary.nonInt 里单列（不会被静默吞掉），这点有断言盯着。
const EXP = { rows: 10, amountFen: 126500, qty: 60, dishes: 4, nonInt: 1, refunds: 1 };
const diff = [];
if (s.rowCount !== EXP.rows) diff.push('行 ' + s.rowCount + ' ≠ ' + EXP.rows);
if (s.totalAmountFen !== EXP.amountFen) diff.push('合计 ' + (s.totalAmountFen / 100) + ' ≠ 1265.00');
if (s.totalQty !== EXP.qty) diff.push('销量 ' + s.totalQty + ' ≠ ' + EXP.qty);
if (s.dishCount !== EXP.dishes) diff.push('商品 ' + s.dishCount + ' ≠ ' + EXP.dishes);
if (s.nonInt.length !== EXP.nonInt) diff.push('小数行 ' + s.nonInt.length + ' ≠ ' + EXP.nonInt);
if (s.refunds.length !== EXP.refunds) diff.push('退款行 ' + s.refunds.length + ' ≠ ' + EXP.refunds);
console.log('');
if (diff.length) { console.log('⚠️ 与期望不符：' + diff.join('；')); process.exit(1); }
console.log('✅ 与期望完全一致（' + EXP.rows + ' 行 / 1265.00 元 / 销量 ' + EXP.qty + ' / 4 个商品）');
