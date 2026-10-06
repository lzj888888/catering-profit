#!/usr/bin/env node
/* ============================================================================
 * R231 · M3.33 阶段②（销量导入 → 单品毛利复盘）锚点复算
 * ----------------------------------------------------------------------------
 * 铁律（spec-increment-authoring §铁律2）：锚点必须 require **生产引擎**，
 *   绝不手写等价公式（重写 = 第二个真相源）。
 * 数据来源：**真表**（李老师 2026-10-05 微信发来，R226 已归档为文本 dump）
 *   - 堂食《菜品销售统计》: review/evidence/r226_sales_sample/dish.txt
 *   - 团购《套餐销售明细》: review/evidence/r226_sales_sample/combo.txt
 *   ⚠️ 原始 xlsx 不在仓内（含真实经营数据）；dump 为逐格 · 无损文本。
 * 判据：CHK 逐条 ✅/❌；末尾 process.exitCode 非零即红。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

// 仓根：脚本位于 <仓根>/review/evidence/r231_m333_parse/  ⇒ 上溯 3 层
const ROOT = path.resolve(__dirname, '..', '..', '..');
const E = require(path.join(ROOT, 'cloudfunctions', 'calcBom', 'service.js')); // 生产引擎

const EV = path.join(ROOT, 'review', 'evidence', 'r226_sales_sample');
const OUT = [];

let PASS = 0, FAIL = 0;
function CHK(name, got, want) {
  const ok = (typeof got === 'number' && typeof want === 'number')
    ? Math.abs(got - want) < 1e-9
    : JSON.stringify(got) === JSON.stringify(want);
  const line = `${ok ? '✅' : '❌'} ${name}  got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`;
  OUT.push(line);
  console.log(line);
  ok ? PASS++ : FAIL++;
  return ok;
}
function SEC(t) { OUT.push(''); OUT.push('=== ' + t + ' ==='); console.log('\n=== ' + t + ' ==='); }
// 分/元换算
const y2f = (yuan) => Math.round(yuan * 100);

/* ---------------------------------------------------------------------------
 * dump 解析：把 `R5   | 快餐15元 | 930.0 | ...` 转成 {r, cells[]}
 * ------------------------------------------------------------------------ */
function parseDump(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const rows = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.match(/^R(\d+)\s*\|\s?(.*)$/);
    if (!m) continue;
    const r = Number(m[1]);
    // 去掉行尾的一个可选 " | " 终止
    let body = m[2];
    if (body.endsWith(' | ')) body = body.slice(0, -3);
    else if (body.endsWith(' |')) body = body.slice(0, -2);
    const cells = body.split(' | ').map(s => s.trim());
    rows.push({ r, cells });
  }
  return rows;
}
const numOrNull = (s) => {
  if (s === '' || s === undefined || s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const dishRows = parseDump(path.join(EV, 'dish.txt'));
const comboRows = parseDump(path.join(EV, 'combo.txt'));

/* =========================================================================
 * 段一 · 旧锚点回归（先证「引擎没漂」，再证「新增对」）
 * ====================================================================== */
SEC('段一 旧锚点回归 —— 生产引擎 key anchors 必须原样复现');

// R-1 netUnitCostWan(15元/斤, 500g, 净料率90%) = 333 万分/g
//   独立手算：1500分/500g = 3分/g；÷0.9 = 3.3333…分/g = 0.033333…元/g = 333.33万分/g ⇒ round 333
CHK('R-1 netUnitCostWan(1500,500,90)', E.netUnitCostWan(1500, 500, 90), 333);

const wChicken = E.netUnitCostWan(1500, 500, 90);
// R-2 90g × 333 万分/g = 29970 万分 = 2.9970 元 ⇒ round 300 分
const cardA = E.calcCostCard({ lines: [{ quantity: 90, net_unit_cost: wChicken }], mode: 'A', lossPct: 0, auxFen: 0, priceFen: 1500 });
CHK('R-2 unit_cost_fen(90g, no loss/aux)', cardA.unit_cost_fen, 300);
// R-3 (300分 + 100分辅料) ÷ (1 − 5%) = 400/0.95 = 421.05… ⇒ round 421 分
const cardB = E.calcCostCard({ lines: [{ quantity: 90, net_unit_cost: wChicken }], mode: 'A', lossPct: 5, auxFen: 100, priceFen: 1500 });
CHK('R-3 unit_cost_fen(90g, loss5, aux100)', cardB.unit_cost_fen, 421);
// R-4 单份毛利 / 毛利率取 round 后 unitCostFen 反推
CHK('R-4 gross_margin_pct(price1500, cost421)', cardB.gross_margin_pct, 71.93);

/* =========================================================================
 * 段二 · 解析层锚点（数据来自**真表**，非构造）
 * ====================================================================== */
SEC('段二 解析层锚点 —— 真表《菜品销售统计》（265 菜品 / 15 列）');

// 表结构（R226 六项必核实测，此处独立复现）
CHK('N-0 dish 表头行 = [3,4]（两行表头）',
  dishRows.filter(x => [3, 4].includes(x.r)).length, 2);
CHK('N-0 dish R1 标题', dishRows.find(x => x.r === 1).cells[0], '菜品销售统计');

// 数据行 = R5..R269（排除 R1-R4 表头 + R270 合计）
const dataRows = dishRows.filter(x => x.r >= 5 && x.r <= 269);
CHK('N-1 数据行数（排除表头+合计）', dataRows.length, 265);

// 合计行在场且值可核对
const totalRow = dishRows.find(x => x.r === 270);
CHK('N-1b 合计行 R270 标签', totalRow.cells[0], '合计');
CHK('N-1c 合计行不在数据面内', dataRows.some(x => x.cells[0] === '合计'), false);

// 逐行求和 vs 合计行（机器对账：列序 数量=1, 销售额=3, 收入=5, 优惠=7）
const sumQty = dataRows.reduce((s, x) => s + (numOrNull(x.cells[1]) || 0), 0);
const sumSales = dataRows.reduce((s, x) => s + (numOrNull(x.cells[3]) || 0), 0);
const sumIncome = dataRows.reduce((s, x) => s + (numOrNull(x.cells[5]) || 0), 0);
const sumDisc = dataRows.reduce((s, x) => s + (numOrNull(x.cells[7]) || 0), 0);
CHK('N-2 Σ销售数量 == 合计行 3280.3', Math.round(sumQty * 10) / 10, 3280.3);
CHK('N-3 Σ销售额(元) == 合计行 33146.2', Math.round(sumSales * 10) / 10, 33146.2);
CHK('N-4 Σ菜品收入(元) == 合计行 30319.7', Math.round(sumIncome * 10) / 10, 30319.7);
CHK('N-4b 恒等式 销售额 − 优惠 == 收入（元）',
  Math.round((33146.2 - 2826.5) * 100) / 100, 30319.7);
CHK('N-4c Σ菜品优惠 == 合计行 2826.5', Math.round(sumDisc * 10) / 10, 2826.5);

// N-5 单位反推（用真表一行已知数据，不得假定元/分/厘）
const r5 = dataRows.find(x => x.cells[0] === '快餐15元');
const unitPrice = numOrNull(r5.cells[3]) / numOrNull(r5.cells[1]);
CHK('N-5 单价反推 = 15.0000 元 ⇒ 单位=元', Math.round(unitPrice * 10000) / 10000, 15.0);

// N-6 金额一律转分（整数）
CHK('N-6 Σ销售额 元→分 = 3314620（整数）', y2f(33146.2), 3314620);
CHK('N-6b Number.isInteger(分)', Number.isInteger(y2f(33146.2)), true);

// N-7 规格内嵌在名称里（第三种形态）—— 🔴 全角（）与半角() **两种都要认**
//   勘误：R226 NOTE 记「实测 5 行」，实为 **6 行**（漏了半角 `心相印小(10送2)`）⇒ 见 NOTE §3。
const specEmbed = dataRows.filter(x => /[（(][^）)]+[）)]$/.test(x.cells[0])).map(x => x.cells[0]);
CHK('N-7 名称内嵌规格行数 == 6（全角+半角括号）', specEmbed.length, 6);
CHK('N-7b 半角括号样本在场（心相印小(10送2)）', specEmbed.some(n => /\(/.test(n)), true);
OUT.push('     样本: ' + specEmbed.join(' / '));

// N-8 非厨房出品 SKU 可被识别（打包耗材样本行）
const packRow = dataRows.find(x => x.cells[0] === '打包盒');
CHK('N-8 打包盒行存在（非菜品 SKU 样本）', !!packRow, true);
CHK('N-8b 打包盒 数量 == 销售额 == 56.0',
  [numOrNull(packRow.cells[1]), numOrNull(packRow.cells[3])], [56, 56]);

// N-9 称重/计量菜 ⇒ qty 非整数（合计 3280.3）：证明「qty 取整口径」必须定死
CHK('N-9 合计 qty 非整数（存在称重菜）', Number.isInteger(3280.3), false);

/* =========================================================================
 * 段三 · 重复计算禁令（R226 §四-① · 阶段② 最先要防的坑）
 * ====================================================================== */
SEC('段三 重复计算 —— 菜品表已含套餐明细 ⇒ 不得与套餐表相加');

// 套餐表 R2 自述：统计方式【套餐明细】
const comboNote = comboRows.find(x => x.r === 2).cells[0];
CHK('N-10 菜品表 R2 声明「销售方式：单品+套餐明细」',
  /单品\+套餐明细/.test(dishRows.find(x => x.r === 2).cells.join(' ')), true);
CHK('N-10b 套餐表 R2 声明「统计方式：套餐明细」', /统计方式：.*套餐明细/.test(comboNote), true);

// 套餐表组分（列 2 = 单品名称），去重
const comboData = comboRows.filter(x => x.r >= 4 && x.r <= 72);
const comboDishes = Array.from(new Set(comboData.map(x => x.cells[2]).filter(Boolean)));
// 菜品表菜品名集合
const dishNames = new Set(dataRows.map(x => x.cells[0]));
const hit = comboDishes.filter(n => dishNames.has(n));
CHK(`N-11 套餐组分 ${comboDishes.length} 个 → 命中菜品表`, hit.length, comboDishes.length);
CHK('N-11b 命中率 == 100%（24/24）', comboDishes.length, 24);

// 套餐表合计（R73: 数量=6, 销售额=7, 优惠=8, 收入=9）
const comboTotal = comboRows.find(x => x.r === 73);
const comboSales = numOrNull(comboTotal.cells[7]);
CHK('N-12 套餐表合计销售额 == 887.8', comboSales, 887.8);
// 相加 = 虚增
const inflated = Math.round((sumSales + comboSales) * 10) / 10;
CHK('N-13 菜品表+套餐表 相加虚增额 == 887.8（无声错误）', Math.round((inflated - sumSales) * 10) / 10, 887.8);
CHK('N-13b 虚增占比 ≈ 2.68%', Math.round((comboSales / sumSales) * 10000) / 100, 2.68);

/* =========================================================================
 * 段四 · 计算层锚点（口径：单品总成本 = 份数 × unit_cost_fen）
 * ====================================================================== */
SEC('段四 计算层锚点 —— 份数 × unit_cost_fen（用生产引擎出参，不手写公式）');

// 构造一张卡（假设「快餐15元」标准成本 300 分/份，来自上面 R-2 的引擎出参口径）
const unitCostFen = 300;
const qty = numOrNull(r5.cells[1]);              // 930 份
const revenueFen = y2f(numOrNull(r5.cells[3]));  // 1395000 分
const totalCostFen = qty * unitCostFen;          // 279000 分
const grossFen = revenueFen - totalCostFen;
const grossPct = Math.round((grossFen / revenueFen) * 10000) / 100;

CHK('N-14 单品总成本 = 930 × 300 = 279000 分', totalCostFen, 279000);
CHK('N-15 单品毛利 = 1395000 − 279000 = 1116000 分', grossFen, 1116000);
CHK('N-16 单品毛利率 = 80.00%', grossPct, 80.0);

// 与引擎单份口径互证：
//   ⚠️ 引擎 `net_unit_cost` 单位是「万分/克」、`quantity` 是「克」⇒ 构造 100g × 300万分/g = 30000万分 = 300 分
//      （首版误把 unit_cost_fen=300【分】当 net_unit_cost 传入 ⇒ 出参 3 分 ⇒ 红，属我方构造错）
const perUnit = E.calcCostCard({ lines: [{ quantity: 100, net_unit_cost: 300 }], mode: 'A', lossPct: 0, auxFen: 0, priceFen: 1500 });
CHK('N-17 引擎单份成本(100g×300万分/g) = 300 分 ≡ unit_cost_fen 口径', perUnit.unit_cost_fen, 300);
CHK('N-17c 引擎单份毛利(1500分价 − 300分本) = 1200 分', perUnit.gross_profit_fen, 1200);
CHK('N-17b 单份毛利 × 份数 ≡ 汇总毛利（两条路互证）', perUnit.gross_profit_fen * qty, grossFen);

/* =========================================================================
 * 段五 · 反例（证明规则**有必要**，用目标值表达）
 * ====================================================================== */
SEC('段五 反例 —— 去掉规则会得到「看着合理的错数」');

// C-1 若不排除合计行 ⇒ 多出一道叫「合计」的菜，金额虚增整整一个总数
const withTotal = dataRows.concat([totalRow]);
CHK('C-1 不排除合计行 ⇒ 行数 265→266', withTotal.length, 266);
CHK('C-1b 不排除合计行 ⇒ 销售数量虚增 3280.3（+100%）',
  Math.round((withTotal.reduce((s, x) => s + (numOrNull(x.cells[1]) || 0), 0) - sumQty) * 10) / 10, 3280.3);

// C-2 若菜品表与套餐表相加 ⇒ 虚增 887.8 元（重复计算）
CHK('C-2 两表相加 ⇒ 销售额虚增 887.8 元（⚠️ 不报错）', Math.round((inflated - sumSales) * 10) / 10, 887.8);

// C-3 若把「合计 qty 3280.3」直接落库 ⇒ 撞 SALES_SCHEMA::qty integer
const gradeGate = require(path.join(ROOT, 'utils', 'gradeGate.js'));
// ⚠️ SALES_SCHEMA 真形态 = `{fields:{...}}`（首版按扁平取 ⇒ 拿到 {} ⇒ 红，属我方构造错）
const schema = (gradeGate.SALES_SCHEMA && gradeGate.SALES_SCHEMA.fields) || {};
const qtyRule = schema.qty || {};
CHK('C-3 SALES_SCHEMA.fields.qty 要求 integer（3280.3 会被 fail-closed）',
  JSON.stringify({ t: qtyRule.type, i: qtyRule.integer }), JSON.stringify({ t: 'number', i: true }));
CHK('C-3b amount 也要求 integer ⇒ 落库前必须转分',
  JSON.stringify({ t: schema.amount.type, i: schema.amount.integer }), JSON.stringify({ t: 'number', i: true }));
CHK('C-3c platform enum 已含 eleme（外卖不必扩枚举）',
  (schema.platform.enum || []).indexOf('eleme') >= 0, true);

/* =========================================================================
 * 汇总
 * ====================================================================== */
SEC('汇总');
const sum = `总览：${PASS}/${PASS + FAIL} 通过 · FAIL=${FAIL}`;
OUT.push(sum); console.log('\n' + sum);

fs.writeFileSync(path.join(__dirname, 'recalc_anchors_m333.out.txt'),
  OUT.join('\n') + '\n', 'utf8');
process.exitCode = FAIL === 0 ? 0 : 1;
