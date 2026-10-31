#!/usr/bin/env node
// tools/check_dsi1_parse.js —— DSI-1 标准导入格式解析守卫（R583）
//
// 为什么需要它：
//   `specs/dev-specs/core/店算标准导入格式_v1.md` 是对**外**承诺的契约（给 AI 看的）。
//   契约一旦发布，改列名或改口径会让所有依赖它的 AI 产出**静默失配** —— 不报错、只是数不对。
//   所以解析器必须有行为判据，且判据要能区分：
//     ① 格式对 → 认得出；② 格式不对 → 拒得掉，且**说人话 + 带行号**；
//     ③ 两个从评审里学来的硬规则（销量允许小数 / 退款允许负数）**不能被"优化"掉**。
//
// 判据（A 识别 / B 正向 / C 边界 / D 拒收 / E 反恒真）
//
// 运行：node tools/check_dsi1_parse.js

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

let D = null;
try { D = require(path.join(ROOT, 'cloudfunctions/importSalesBill/dsi1.js')); } catch (e) { D = null; }

console.log('[R583] DSI-1 标准导入格式解析守卫\n');

sec('A · 识别（精确 7 列，与现有形态 A/B/C 列名天然不重叠）');
check('A-⓪ 模块可加载且导出 parse / isDSI1 / normDate',
  !!D && typeof D.parse === 'function' && typeof D.isDSI1 === 'function' && typeof D.normDate === 'function');
if (!D) {
  console.log(`\n===== DSI-1 解析守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  process.exit(1);
}

const H = ['日期', '渠道', '平台', '商品名称', '销量', '销售额', '备注'];
check('A-① 标准表头认得出', D.isDSI1(H) === true);
check('A-② 列名不同 ⇒ 认不出（不许模糊匹配）',
  D.isDSI1(['日期', '渠道', '菜品名称', '销量', '销售额']) === false);
check('A-③ 顺序不同 ⇒ 认不出（顺序是契约的一部分）',
  D.isDSI1(['渠道', '日期', '平台', '商品名称', '销量', '销售额', '备注']) === false);
check('A-④ 尾部多余空列可容忍（Excel 常见）',
  D.isDSI1(H.concat(['', ''])) === true);

sec('B · 正向解析（契约里的样例）');
const GOOD = [
  H,
  ['2026-09-07', '堂食', '', '重庆小面', 12, 216.00, ''],
  ['2026-09-07', '堂食', '', '卤牛肉', 1.5, 135.00, '称重'],
  ['2026-09-07', '外卖', '美团', '重庆小面', 5, 95.00, ''],
  ['2026-09-08', '堂食', '', '重庆小面', -2, -36.00, '退单'],
];
const r = D.parse(GOOD);
check('B-① 解析成功且行数 4', r.ok && r.summary.rowCount === 4, r.ok ? String(r.summary.rowCount) : r.error);
check('B-② 天数 2（09-07 / 09-08）且区间正确',
  r.ok && r.summary.dayCount === 2 && r.summary.dayFrom === '2026-09-07' && r.summary.dayTo === '2026-09-08');
check('B-③ 菜品去重数 2（重庆小面/卤牛肉，名字归一后）', r.ok && r.summary.dishCount === 2);
check('B-④ 金额：21600+13500+9500−3600 = 41000 分', r.ok && r.summary.totalAmountFen === 41000,
  r.ok ? String(r.summary.totalAmountFen) : '');
check('B-⑤ 渠道分组：堂食 3 行 / 外卖:meituan 1 行（platform 由渠道+平台列推出）',
  r.ok && r.summary.byChannel['堂食'] && r.summary.byChannel['堂食'].rows === 3
  && r.summary.byChannel['外卖:meituan'] && r.summary.byChannel['外卖:meituan'].rows === 1);
check('B-⑥ 堂食行 platform = pos（复用现有枚举，不新造值）',
  r.ok && r.rows[0].platform === 'pos');

sec('C · 两条从评审学来的硬规则（不能被"优化"掉）');
check('C-① 🔴 小数销量保留原始值 + 单列进报告（1.5 → 2，且 nonInt 有记录）',
  r.ok && r.rows[1].rawQty === 1.5 && r.rows[1].qty === 2
  && r.summary.nonInt.length === 1 && r.summary.nonInt[0].raw === 1.5,
  r.ok ? JSON.stringify(r.summary.nonInt) : '');
check('C-② 🔴 退款行（负数）不剔除、单独记账（−2 / −3600）',
  r.ok && r.summary.refunds.length === 1
  && r.summary.refunds[0].qty === -2 && r.summary.refunds[0].amountFen === -3600);
check('C-③ 尾部全空行跳过、不计入行数', (function () {
  const x = D.parse([H, ['2026-09-07', '堂食', '', '面', 1, 10, ''], ['', '', '', '', '', '', '']]);
  return x.ok && x.summary.rowCount === 1 && x.summary.skipped === 1;
})());
check('C-④ 契约声明的口径差：summary 带 noteNoPackFee（S1 不含打包费，与 S2 不可直接对账）',
  r.ok && r.summary.noteNoPackFee === true);

sec('D · 拒收：说人话 + 带行号');
const bad = [
  ['表头不对', [['日期', '渠道', '菜名']], '标准格式'],
  ['渠道写「自提」', [H, ['2026-09-07', '自提', '', '面', 1, 10, '']], '堂食'],
  ['日期写「9月7日」', [H, ['9月7日', '堂食', '', '面', 1, 10, '']], '日期'],
  ['销量写「约十份」', [H, ['2026-09-07', '堂食', '', '面', '约十份', 10, '']], '数字'],
  ['只有表头没有数据', [H], '没有数据'],
];
for (const [label, rows, kw] of bad) {
  const x = D.parse(rows);
  check(`D · ${label} ⇒ 拒收且说人话`, x.ok === false && String(x.error).indexOf(kw) >= 0,
    x.ok ? '竟然通过了' : String(x.error).slice(0, 46));
}
check('D-⑥ 错误信息带行号（老板能定位到第几行）',
  (function () {
    const x = D.parse([H, ['2026-09-07', '堂食', '', '面', 1, 10, ''], ['2026-09-08', '自提', '', '面', 1, 10, '']]);
    return x.ok === false && /第 3 行/.test(x.error);
  })());

sec('E · 反恒真');
check('E-① 空输入必须拒（防"恒返回成功"）', D.parse([]).ok === false);
check('E-② 把小数规则改回取整吞掉 ⇒ C-① 的判据会失效（证明它盯着 rawQty 而非 qty）',
  r.ok && r.rows[1].qty === 2 && r.rows[1].rawQty === 1.5);

console.log(`\n===== DSI-1 解析守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
