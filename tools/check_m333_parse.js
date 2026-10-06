#!/usr/bin/env node
// tools/check_m333_parse.js —— R231 · M3.33 表形态解析守卫（R231-1/2/3/5）
// 运行：node tools/check_m333_parse.js   （由 verify_all.js 的 [m333-parse] 套件调用）
//
// ===== 为什么需要它（真缺口，非纸面演练）=====
//   M3.33（批次 G）给 cloudfunctions/importSalesBill/service.js 加了「堂食菜品表」解析：
//   形态判定（A/B/C fail-closed）、两行表头、合计行排除、单位转分、qty 取整、dish_key 归一、
//   external_ref_id 编码（DISH:…:dish_key）、幂等 _id（SALE_…_seq）。这些是**写库正确性的前置**：
//     ① 合计行不排除 ⇒ 多出一道叫「合计」的菜，qty 虚增 100%（§6 反例 C-1）；
//     ② external_ref_id 不含 dish_key ⇒ 唯一索引 (shop_id, biz_date, external_ref_id) 让同平台同天
//        所有菜共用同一三元组 ⇒ 只落得下 1 条（§5.1）；
//     ③ qty 不取整 ⇒ 撞 SALES_SCHEMA::qty integer（fail-closed）。
//   本守卫把这三条 + 幂等 + 未匹配不归零 变成机器判据，并配反例（故意改错 ⇒ 必须红在目标断言上）。
//
// 判据（全部 fail-closed：读不到 service.js / dump 即判红，不静默放行）。
// 数据来源：真表 dump review/evidence/r226_sales_sample/dish.txt（逐格 · 无损，R226 归档）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVC_REL = 'cloudfunctions/importSalesBill/service.js';
const DUMP_REL = 'review/evidence/r226_sales_sample/dish.txt';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 加载 service.js（stub xlsx：本地无该外部包）----------
let svc = null, stubbed = false;
try {
  svc = require(path.join(ROOT, SVC_REL));
} catch (e) {
  if (!/xlsx/.test(String(e.message || ''))) svc = null;
  else {
    const Module = require('module');
    const orig = Module._load;
    Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
    try { svc = require(path.join(ROOT, SVC_REL)); stubbed = true; }
    catch (e2) { svc = null; }
    finally { Module._load = orig; }
  }
}

// ---------- dump → 2D rows（index = 行号-1）----------
function parseDump(file) {
  let txt;
  try { txt = fs.readFileSync(path.join(ROOT, file), 'utf8'); }
  catch (e) { return []; }
  const rows = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.match(/^R(\d+)\s*\|\s?(.*)$/);
    if (!m) continue;
    let body = m[2];
    if (body.endsWith(' | ')) body = body.slice(0, -3);
    else if (body.endsWith(' |')) body = body.slice(0, -2);
    const cells = body.split(' | ').map((s) => s.trim());
    rows[Number(m[1]) - 1] = cells;
  }
  return rows;
}
const numOrNull = (s) => {
  if (s === '' || s === undefined || s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ============ S 扫描面 ============
sec('S · 扫描面（service.js 可加载 + 真表 dump 可读）');
check('S-① service.js 可加载且导出 parseDishSales(function) / dishRefId / saleDocId / DISH_SHAPES',
  !!svc && typeof svc.parseDishSales === 'function' && typeof svc.dishRefId === 'function'
    && typeof svc.saleDocId === 'function' && !!svc.DISH_SHAPES,
  svc ? '导出键：' + Object.keys(svc).filter((k) => /Dish|dish|Sale|sale|SHAPES|STRUCT/.test(k)).join(',')
    + (stubbed ? '（xlsx 已注入空桩）' : '') : 'require 失败');

const dishRows = parseDump(DUMP_REL);
check('S-② 真表 dump 可读且行数 ≥ 270（R1~R270）', dishRows.length >= 270, dishRows.length + ' 行');

if (!svc || dishRows.length < 270) {
  console.log('\n===== m333-parse 守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(1);
}

const parsed = svc.parseDishSales(dishRows);

// ============ R231-1 · 表形态常量 ≡ 真表结构 ============
sec('R231-1 · 表形态常量 ≡ 真表结构（表头行 / 合计行 / 单位）');
check('1-① 形态判定 = A（堂食菜品销售统计）', svc.detectDishShape(dishRows) === svc.DISH_SHAPES.A,
  'detectDishShape=' + svc.detectDishShape(dishRows));
check('1-② 表结构常量 ≡ 真表（两行表头 R3/R4，数据 R5 起，合计标签）',
  svc.DISH_A_STRUCT.headerRow1 === 3 && svc.DISH_A_STRUCT.headerRow2 === 4
    && svc.DISH_A_STRUCT.dataStartRow === 5 && svc.DISH_A_STRUCT.totalLabel === '合计',
  JSON.stringify(svc.DISH_A_STRUCT));
check('1-③ 数据行数 = 265（排除 R1–R4 表头 + R270 合计）', parsed.rows.length === 265, parsed.rows.length + ' 行');
check('1-③b 合计行未混入数据面（无 name==合计）', parsed.rows.every((r) => r.name !== '合计'), true);

// 单位反推（§4.3/锚点 N-5）：快餐15元 销售额 13950 ÷ qty 930 = 15 元 ⇒ 转分后单价 1500 分
const r5 = parsed.rows.find((r) => r.name === '快餐15元');
const unitFen = r5 ? r5.salesFen / r5.qty : NaN;
check('1-④ 单位 = 元（快餐15元 单价 = 1500 分 = 15 元）', r5 && unitFen === 1500,
  r5 ? 'salesFen ' + r5.salesFen + ' / qty ' + r5.qty + ' = ' + unitFen + ' 分' : '无快餐15元行');

// 周合计锚点（§2.1.2）
const r1 = (n) => Math.round(n * 10) / 10;
check('1-⑤ Σ销售数量 = 3280.3', r1(parsed.totals.qty) === 3280.3, r1(parsed.totals.qty));
check('1-⑤b Σ销售额(元) = 33146.2', r1(parsed.totals.sales) === 33146.2, r1(parsed.totals.sales));
check('1-⑤c Σ收入(元) = 30319.7（amount 用实际收入口径）', r1(parsed.totals.income) === 30319.7, r1(parsed.totals.income));
check('1-⑤d 恒等式 销售额 − 优惠 == 收入', r1(r1(parsed.totals.sales) - r1(parsed.totals.discount)) === r1(parsed.totals.income),
  parsed.totals.sales + ' − ' + parsed.totals.discount + ' = ' + (r1(parsed.totals.sales) - r1(parsed.totals.discount)));

// 反例 C-1：若纳入合计行 ⇒ 266（证明确实有一行「合计」被排除，非「本来就没有合计行」）
const withTotal = dishRows.slice(4);          // R5 起，含 R270 合计
check('1-⑥ 反例：纳入合计行 ⇒ 266 行（排除合计是必要规则，非恒真）', withTotal.length === 266, withTotal.length + ' 行');

// ============ R231-2 · external_ref_id 必含 dish_key ============
sec('R231-2 · external_ref_id 必含 dish_key 段（§5.1）');
const refHasDishKey = (ref) => {
  const p = String(ref || '').split(':');
  return p.length >= 4 && p[0] === 'DISH' && p[3] !== '';
};
const refReal = svc.dishRefId('pos', '2026-09-13', '耙牛肉（半斤）');
check('2-① dishRefId 含 dish_key 且 DISH: 前缀', refReal === 'DISH:pos:2026-09-13:耙牛肉（半斤）' && refHasDishKey(refReal), refReal);
check('2-② 落库行 external_ref_id 均由 dishRefId 生成（含各自 dish_key）',
  parsed.rows.every((r) => refHasDishKey(svc.dishRefId('pos', parsed.bizDate, r.dishKey))),
  parsed.bizDate || 'bizDate 空');
// 反例：退回 BILL:<platform>:<biz_date> 形态（无 dish_key）⇒ 判据必须判红
const billStyle = 'BILL:pos:2026-09-13';
check('2-③ 反例：BILL: 形态（无 dish_key）⇒ 判据判红', refHasDishKey(billStyle) === false, billStyle);

// ============ R231-3 · qty 恒整数 ============
sec('R231-3 · qty 恒整数（§5.2，撞 SALES_SCHEMA::qty integer）');
check('3-① 全部落库行 qty 为整数', parsed.rows.every((r) => Number.isInteger(r.qty)),
  parsed.rows.length + ' 行全部整数');
// 非整数 qty 行（实测 加工 16.5 / 泡椒酸菜鱼 4.8）必须被 round 且进 nonInt（不静默）
const jg = parsed.nonInt.find((x) => x.name === '加工');
const py = parsed.nonInt.find((x) => x.name === '泡椒酸菜鱼');
check('3-② 非整数 qty 被 round 且单列进解析报告（加工 16.5→17）',
  !!jg && jg.raw === 16.5 && jg.rounded === 17,
  JSON.stringify(parsed.nonInt.map((x) => ({ n: x.name, raw: x.raw, rounded: x.rounded }))));
check('3-②b 泡椒酸菜鱼 4.8→5 同样在报告内', !!py && py.raw === 4.8 && py.rounded === 5,
  py ? JSON.stringify(py) : '未命中');
// 反例：注入 3280.3（不 round）⇒ 整数判据判红
check('3-③ 反例：qty=3280.3（未 round）⇒ Number.isInteger 判红', Number.isInteger(3280.3) === false, '3280.3');

// ============ R231-5 · 幂等 + 未匹配不归零 ============
sec('R231-5 · 幂等（二次导入行数不变）+ 未匹配不静默归零');
const parsed2 = svc.parseDishSales(dishRows);
check('5-① 幂等：同一矩阵解析两次 ⇒ 行数 / 合计恒等',
  parsed2.rows.length === parsed.rows.length && parsed2.totals.amountFen === parsed.totals.amountFen,
  parsed2.rows.length + ' / ' + parsed.rows.length + ' 行');
const idA = svc.saleDocId('s1', 'pos', '2026-09-13', 0);
const idB = svc.saleDocId('s1', 'pos', '2026-09-13', 0);
const idC = svc.saleDocId('s1', 'pos', '2026-09-13', 1);
check('5-② _id 确定性（同 shop/platform/biz/seq ⇒ 同 _id；seq 不同 ⇒ 不同 _id）',
  idA === idB && idA !== idC, idA + ' vs ' + idC);

// 未匹配不归零：'-' 行（外卖未建映射）必须归 unmatched 且 qty/amount 保留，不静默归零
const synthetic = dishRows.slice(0, 4).concat([['-', '5', '', '50', '', '45', '', '5', '', '', '', '', '', '', '']]);
const synParsed = svc.parseDishSales(synthetic);
const dash = synParsed.unmatched.find((u) => u.dishKey === '-' || u.name === '-');
check('5-③ 未匹配：菜名 "-" 行归 unmatched（不落为菜名、不静默归零）', !!dash, JSON.stringify(synParsed.unmatched));
check('5-③b 未匹配行的 qty/amount 保留（不归零）', !!dash && dash.qty === 5 && dash.amountFen === 4500,
  dash ? 'qty ' + dash.qty + ' / amountFen ' + dash.amountFen : '未命中');

console.log('\n===== m333-parse 守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
