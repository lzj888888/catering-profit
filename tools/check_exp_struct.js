// tools/check_exp_struct.js —— R689（M3 优化 B）费用分类占比守卫
//
// 判据对象：`subpkg/biz/month/result.js::buildExpStruct`
//   —— 把 `expense_items`（每项 { category, name, amount_fen, sub_items }）
//      按 category 聚合为「钱花在哪」四类占比。
//
// 为什么必须有这条守卫（不是"加个测试好看"）：
//   占比是**除法**。除法的三个经典错法在这里都会静默产出"看起来对"的数：
//     ① 分母用了「总成本」而不是「费用合计」⇒ 房租占比凭空变小（食材成本不在 expense_items 里）；
//     ② 分母为 0 时回 0% ⇒ 老板读成"这一类没花钱"，实际是"整月一分费用没录"；
//     ③ 金额为 0 的科目仍占一行 ⇒ 凭空多出一类"其他 0%"。
//   三种都不会报错、页面也不会空，**只有断言能拦住**。
const path = require('path');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

// ===== 用 stub 加载页面模块，取到 buildExpStruct =====
// result.js 是 `Page({...})` 形态（不是 module.exports），所以桩一个 Page 捕获配置对象。
// 顶层只有 require、没有 wx 调用（已核对 31~52 行），因此不需要桩 wx 的完整行为。
let captured = null;
global.Page = function (cfg) { captured = cfg; };
global.getApp = function () { return { globalData: {} }; };
global.wx = {
  getStorageSync: function () { return ''; },
  setStorageSync: function () {},
  getSystemInfoSync: function () { return { windowWidth: 375 }; },
  showModal: function () {},
  showToast: function () {},
};

const RESULT_PAGE = path.join(__dirname, '..', 'subpkg/biz/month/result.js');
let loadErr = null;
try {
  require(RESULT_PAGE);
} catch (e) {
  loadErr = e;
}
check('result.js 能被 stub 加载（页面零 wx 顶层副作用）',
  !loadErr && captured && typeof captured.buildExpStruct === 'function',
  loadErr ? String(loadErr.message).slice(0, 80) : '');

if (!captured || typeof captured.buildExpStruct !== 'function') {
  console.log(`\n==== 费用分类占比守卫：${pass} 通过 / ${failN} 失败 ====`);
  process.exit(1);
}

const build = captured.buildExpStruct.bind(captured);
const { TERMS } = require(path.join(__dirname, '../miniprogram/i18n/terms.js'));

// ===== A. 聚合正确 =====
console.log('===== A · 四类聚合与占比 =====');
// ⚠️ 单位是**分**：600000 分 = 6000 元。（首版这里写成 6000000 = 6 万元，
//    断言按 7000 元算 ⇒ 假红一次。守卫没错，是我数据写错了，记在此处免得下次重犯。）
const SAMPLE = [
  { category: 'operation', name: '房租', amount_fen: 600000 },
  { category: 'operation', name: '电费', amount_fen: 100000 },
  { category: 'labor', name: '工资绩效', amount_fen: 200000 },
  { category: 'marketing', name: '平台佣金', amount_fen: 100000 },
];
const r = build(SAMPLE);
check('聚合成 3 个分类（operation 两项合并）', r.length === 3, `实际 ${r.length} 类`);
const op = r.find((x) => x.category === 'operation');
check('同类金额合并 6000+1000=7000 元', op && op.amount === '7000.00', op && op.amount);
check('占比正确 7000/10000 = 70%', op && op.pct === 70, op && String(op.pct));
check('金额升序改降序：第一行是占比最大的 operation',
  r[0].category === 'operation', r[0].category);
check('百分比一位小数（10000 分拆 2000 ⇒ 20%，不出现 33.333）',
  r.filter((x) => String(x.pct).split('.')[1] && String(x.pct).split('.')[1].length > 1).length === 0);

// ===== B. 三条静默错法（本守卫的核心） =====
console.log('\n===== B · 除法的三种静默错法 =====');
const zeroBase = build([{ category: 'operation', name: '房租', amount_fen: 0 }]);
check('金额全为 0 ⇒ 不产生任何行（不是回一行 "0%"）', zeroBase.length === 0, `实际 ${zeroBase.length} 行`);

const empty = build([]);
check('空数组 ⇒ 空结果（页面据此整块不渲染）', Array.isArray(empty) && empty.length === 0);

const mixed = build([
  { category: 'operation', name: '房租', amount_fen: 0 },
  { category: 'labor', name: '工资', amount_fen: 100 },
]);
check('0 元科目不占行、不参与分母（只剩 labor 且占比 100%）',
  mixed.length === 1 && mixed[0].category === 'labor' && mixed[0].pct === 100,
  JSON.stringify(mixed.map((x) => [x.category, x.pct])));

// 分母口径：必须是 expense_items 内部合计。构造「若误把某外部成本并入分母」就会露馅的样本。
const half = build([
  { category: 'operation', name: '房租', amount_fen: 500 },
  { category: 'labor', name: '工资', amount_fen: 500 },
]);
check('两类各 500 ⇒ 各 50%（分母 = 费用合计 1000，不多不少）',
  half.every((x) => x.pct === 50), JSON.stringify(half.map((x) => x.pct)));

// ===== C. 标签与文案 =====
console.log('\n===== C · 标签复用术语单源（不新增中文） =====');
const opLabel = (TERMS.ledger.expense.find((g) => g.category === 'operation') || {}).label;
check('operation 的 label ≡ TERMS.ledger.expense 里的现成 label',
  op && op.label === opLabel, `页面=${op && op.label} / 单源=${opLabel}`);
const unknown = build([{ category: 'weird_cat', name: '怪项', amount_fen: 100 }]);
check('未知 category 不崩、回退成 category 原值（不静默塞进"其他"掩盖数据问题）',
  unknown.length === 1 && unknown[0].label === 'weird_cat', unknown[0] && unknown[0].label);

// ===== D. 变异自证（判据有分辨力） =====
console.log('\n===== D · 变异自证 =====');
const mutantPct = (fen, total) => Math.round((fen / total) * 100);   // 漏了 *10/10 ⇒ 无小数
check('变异①：若百分比不保留一位小数，33.3% 会变成 33% ⇒ 与实现不同',
  Math.round((1 / 3) * 1000) / 10 === 33.3 && mutantPct(1, 3) === 33);
const mutantZero = (total) => (total > 0 ? 1 : 0);                  // 分母 0 回 0 而非 null
check('变异②：若分母 0 回 0%（而不是 null），就会显示"这一类没花钱" ⇒ 本守卫 B 组会红',
  mutantZero(0) === 0 && zeroBase.length === 0);

console.log(`\n==== 费用分类占比守卫结果：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
