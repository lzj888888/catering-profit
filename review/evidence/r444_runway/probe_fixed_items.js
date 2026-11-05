// R444 收口取证：证明「直取 byInd.utility 恒 null」而「经 toFixedFen 能出 utility」
// 纯本地、零云调用。用法：node review/evidence/r444_runway/probe_fixed_items.js
const path = require('path');
const REF = require(path.join(__dirname, '../../../cloudfunctions/common/indicatorRef.js'));

// ⚠️ 形状必须照真实台账（`normalizeToCamel(rawExpense)`）：category 只有大类，
//    rent 靠**细项名**「房租」命中 ITEM_TAGS；`CATEGORY_TAG` 只有 labor/marketing
//    ⇒ 把 rent 写成大类是造样本，会把「房租没归属」这个真实行为误判成 bug。
const expenseItems = [
  { category: 'operation', name: '房租', amountFen: 1200000, subItems: [
    { subItem: '房租', amountFen: 1200000 },
  ] },
  { category: 'labor', name: '人工', amountFen: 1500000, subItems: [
    { subItem: '工资绩效', amountFen: 1400000 },
    { subItem: '社保', amountFen: 100000 },
  ] },
  { category: 'operation', name: '水电燃气', amountFen: 300000, subItems: [
    { subItem: '水费', amountFen: 80000 },
    { subItem: '电费', amountFen: 200000 },
    { subItem: '燃气费', amountFen: 20000 },
  ] },
];

const byInd = REF.sumByTag(expenseItems);
const fx = REF.toFixedFen(byInd);

const oldShape = {
  rent: byInd.rent != null ? byInd.rent : null,
  labor: byInd.labor != null ? byInd.labor : null,
  utility: byInd.utility != null ? byInd.utility : null,   // ← 在途旧写法
};
const newShape = {
  rent: fx.rent != null ? fx.rent : null,
  labor: fx.labor != null ? fx.labor : null,
  utility: fx.utility != null ? fx.utility : null,         // ← 收口写法
};

console.log('sumByTag 键集合 =', Object.keys(byInd).join(','));
console.log('toFixedFen 键集合 =', Object.keys(fx).join(','));
console.log('旧写法 fixed_items_fen =', JSON.stringify(oldShape));
console.log('新写法 fixed_items_fen =', JSON.stringify(newShape));

// A：旧写法必须证明 utility 恒为 null（即使真填了水电）
const A = oldShape.utility === null;
// B：新写法必须出真值 300000 分
const B = newShape.utility === 300000 && newShape.rent === 1200000 && newShape.labor === 1500000;
// C：缺项时必须是 null 而不是 0（防「没填」被当「0 元」）
const fx2 = REF.toFixedFen(REF.sumByTag([
  { category: 'rent', name: '房租', amountFen: 1200000, subItems: [] },
]));
const C = fx2.utility === undefined;
// D：可撑月数（现金 90000 元 / 刚性 30000 元 = 3 个月）
const fixedFen = newShape.rent + newShape.labor + newShape.utility;
const D = Math.round((9000000 / fixedFen) * 10) / 10 === 3;

console.log('A 旧写法恒 null      =', A);
console.log('B 新写出真值         =', B);
console.log('C 缺项为 null 非 0   =', C);
console.log('D 可撑 3.0 个月      =', D);
const pass = A && B && C && D;
console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
process.exit(pass ? 0 : 1);
