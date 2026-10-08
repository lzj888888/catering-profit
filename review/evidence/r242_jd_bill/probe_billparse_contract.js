// review/evidence/r242_jd_bill/probe_billparse_contract.js —— 核实 parseBillMatrix 的**真实入参契约**
// 起因：技能 waimai-bill-reconcile 第 32-33 行写「要传 {sheets:[...]}（数组）」，但生产 utils/billParse.js:80
//       是 `sheets[SHEET[platform]]`（**字符串键**）⇒ 矛盾。R242e 京东探针正是照技能写成数组 ⇒ 踩坑。
// 判据：用**官方 fixture**（锚点已知）分别喂「对象」与「数组」两种形态，看谁得到锚点值。
// 运行：node probe_billparse_contract.js
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const BP = require(path.join(ROOT, 'utils', 'billParse.js'));

const fixtures = [
  ['meituan_2026-08.matrix.json', 'meituan', 182664, 50],   // 锚点：外卖订单 50 行应收 1826.64
  ['taobao_2026-08.matrix.json', 'taobao', 377965, null],   // 锚点：到手 3779.65
];
const dir = path.join(ROOT, 'review', 'evidence', 'r181l_stage1_import_feed', 'fixtures');

function shape(doc) {
  const s = doc && doc.sheets;
  if (Array.isArray(s)) return '数组[长度' + s.length + ']';
  if (s && typeof s === 'object') return '对象{键:' + Object.keys(s).slice(0, 3).join(',') + '…}';
  return String(typeof s);
}

for (const [file, plat, anchorFen, anchorQty] of fixtures) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  console.log('\n===== ' + file + ' =====');
  console.log('  sheets 形态 =', shape(doc));

  // A) 原样（对象）
  const rA = BP.parseBillMatrix(doc, { platform: plat });
  console.log('  [A] 原样(对象) → totals =', JSON.stringify(rA.totals));
  console.log('      锚点期望 amountFen=' + anchorFen + (anchorQty ? ' qty=' + anchorQty : '')
    + ' ⇒ ' + (rA.totals.amountFen === anchorFen ? '✅ 命中' : '❌ 不符'));

  // B) 改成数组（技能里描述的那种形态）
  const arr = Object.keys(doc.sheets).map((k) => ({ name: k, rows: doc.sheets[k].rows }));
  const rB = BP.parseBillMatrix({ sheets: arr }, { platform: plat });
  console.log('  [B] 数组形态   → totals =', JSON.stringify(rB.totals) + ' ⇒ ' + (rB.totals.amountFen === 0 ? '❌ 归零（取不到 sheet）' : '✅ 也有值'));

  // C) 直接传二维数组
  const firstRows = doc.sheets[Object.keys(doc.sheets)[0]].rows;
  const rC = BP.parseBillMatrix(firstRows, { platform: plat });
  console.log('  [C] 二维数组   → totals =', JSON.stringify(rC.totals));
}

// D) 生产调用方到底怎么传？（看 importSalesBill/index.js 与 service.js 的调用点）
console.log('\n===== 生产调用点 =====');
for (const f of ['cloudfunctions/importSalesBill/index.js', 'cloudfunctions/importSalesBill/service.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/parseBillMatrix\s*\(/.test(l)) console.log('  ' + f + ':' + (i + 1) + '  ' + l.trim());
  });
}
