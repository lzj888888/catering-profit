#!/usr/bin/env node
/* ============================================================================
 * R232 · 形态 C（外卖「商品销量」）规范订正 C-1~C-7 —— 锚点复算
 * ----------------------------------------------------------------------------
 * 铁律（spec-increment-authoring §铁律2）：锚点必须 require **生产代码**，
 *   绝不手写等价公式（重写 = 第二个真相源）。
 * 生产代码：cloudfunctions/importSalesBill/service.js
 *   （本地无 xlsx 包 ⇒ 用 Module._load 空桩，与 tools/check_m333_parse.js 同手法）
 * 数据来源：**真样例**（李老师 2026-10-06 微信来料）
 *   - 形态 C：review/evidence/r232_formc_sample/formc_cells.txt（逐格 dump，本轮新建）
 *   - 形态 A：review/evidence/r226_sales_sample/dish.txt（既有，用于**不误判**反例）
 * ⚠️ 断言一律从**原始素材自己解析**，不抄 NOTE 的二手结论。
 * 判据：CHK 逐条 ✅/❌；末尾 process.exitCode 非零即红。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------- 加载生产 service.js（stub xlsx）----------
let S = null;
{
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  try { S = require(path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js')); }
  finally { Module._load = orig; }
}

let PASS = 0, FAIL = 0;
const OUT = [];
function CHK(name, got, want) {
  const ok = (typeof got === 'number' && typeof want === 'number')
    ? Math.abs(got - want) < 1e-9
    : JSON.stringify(got) === JSON.stringify(want);
  const line = `${ok ? '✅' : '❌'} ${name}  got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`;
  OUT.push(line); console.log(line); ok ? PASS++ : FAIL++; return ok;
}
function SEC(t) { OUT.push(''); OUT.push('=== ' + t + ' ==='); console.log('\n=== ' + t + ' ==='); }

// ---------- dump 解析（复用 R231 锚点同款）----------
function parseDump(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const rows = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.match(/^R(\d+)\s*\|\s?(.*)$/);
    if (!m) continue;
    let body = m[2];
    if (body.endsWith(' | ')) body = body.slice(0, -3);
    else if (body.endsWith(' |')) body = body.slice(0, -2);
    rows.push({ r: Number(m[1]), cells: body.split(' | ').map((s) => s.trim()) });
  }
  return rows;
}
const toNum = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').replace(/¥/g, '').replace(/￥/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
};
// 0-based 二维 cells（detectDishShape 的入参形状）
const toMatrix = (rows) => {
  const maxR = Math.max(...rows.map((x) => x.r));
  const m = [];
  for (let i = 0; i < maxR; i++) m.push(null);
  for (const x of rows) m[x.r - 1] = x.cells.slice();
  return m;
};

const C_ROWS = parseDump(path.join(__dirname, 'formc_cells.txt'));
const A_ROWS = parseDump(path.join(ROOT, 'review', 'evidence', 'r226_sales_sample', 'dish.txt'));
const C_M = toMatrix(C_ROWS);
const A_M = toMatrix(A_ROWS);

/* =========================================================================
 * 段一 · 现状证明：C-1 是「硬阻断」，不是参数微调
 * ====================================================================== */
SEC('段一 现状 —— 真样例喂进**生产** detectDishShape，证明形态 C 永远判不出');

const C_HDR = (C_ROWS.find((x) => x.r === 1) || { cells: [] }).cells;
CHK('C-1a 真样例单行表头 R1 含「商品名称」', C_HDR.indexOf('商品名称') >= 0, true);
CHK('C-1b 真样例表头含「销量」', C_HDR.indexOf('销量') >= 0, true);
CHK('C-1c 🔴 真样例表头**不含**「商品销量」（v1.6 §3.4 写死这个 ⇒ 修前永远判不出）',
  C_HDR.indexOf('商品销量') >= 0, false);
// ⚠️ 本条**已随 v1.7 C-1 修正翻转**：修前 got=null（硬阻断），修后 got='waimai_goods'。
//    「修前 null」的历史证据见 review/NOTE_2026-10-07_round232d_*.md §一与 git 提交记录。
CHK('C-1d 生产 detectDishShape(形态C真矩阵) === waimai_goods（v1.7 C-1 修正后）',
  S.detectDishShape(C_M), 'waimai_goods');
CHK('C-1e 对照：生产 detectDishShape(形态A真矩阵) === dish_sales（形态 A 不受影响）',
  S.detectDishShape(A_M), 'dish_sales');

/* =========================================================================
 * 段二 · 真样例事实（从原始素材自己算，不抄 NOTE）
 * ====================================================================== */
SEC('段二 真样例事实 —— 逐格 dump 自行聚合');

const C_DATA = C_ROWS.filter((x) => x.r >= 2);   // 单行表头 R1 ⇒ 数据 R2 起
CHK('C-2a 数据行数（R2 起，单行表头）', C_DATA.length, 354);
CHK('C-2b 列数', C_HDR.length, 18);

const iDate = C_HDR.indexOf('日期'), iName = C_HDR.indexOf('商品名称');
const iQty = C_HDR.indexOf('销量'), iSales = C_HDR.indexOf('销售额');
const iOrderAmt = C_HDR.indexOf('订单交易额');
CHK('C-2c 关键列位均找到', [iDate, iName, iQty, iSales, iOrderAmt].every((i) => i >= 0), true);

const names = [...new Set(C_DATA.map((x) => x.cells[iName]).filter((s) => s !== ''))];
const dates = [...new Set(C_DATA.map((x) => x.cells[iDate]).filter((s) => s !== ''))].sort();
CHK('C-2d 商品数（去重）', names.length, 51);
CHK('C-2e 日期跨度天数', dates.length, 7);
CHK('C-2f 首/末日期', [dates[0], dates[dates.length - 1]], ['2026-09-07', '2026-09-13']);

// 🔴 销量列是**文本型**（全 354 行）⇒ 必须 toNum，直接 Number() 会被误判
const qtyStrAll = C_DATA.every((x) => typeof x.cells[iQty] === 'string');
CHK('C-2g 销量列全为字符串（dump 侧）⇒ 必须 toNum（§4.5 同类）', qtyStrAll, true);

const sumQty = C_DATA.reduce((s, x) => s + (toNum(x.cells[iQty]) || 0), 0);
const sumSales = C_DATA.reduce((s, x) => s + (toNum(x.cells[iSales]) || 0), 0);
CHK('C-2h Σ销量', sumQty, 118);
CHK('C-2i Σ销售额（元，两位浮点直接比）', Math.round(sumSales * 100) / 100, 1823.08);
CHK('C-2j 有销量行数', C_DATA.filter((x) => (toNum(x.cells[iQty]) || 0) > 0).length, 49);

// 网格不完整 ⇒ C-6「禁止补零」的事实基础
CHK('C-6a 网格 51×7=357 但实得 354 ⇒ 缺 3 格（不补零）', names.length * dates.length - C_DATA.length, 3);

// 🔴 C-5 零价高销量 SKU
const zeroRows = C_DATA.filter((x) => (toNum(x.cells[iQty]) || 0) > 0 && Math.round((toNum(x.cells[iSales]) || 0) * 100) === 0);
const zeroName = zeroRows.length ? zeroRows[0].cells[iName] : '';
CHK('C-5a 存在 amount=0 且 qty>0 的行', zeroRows.length > 0, true);
CHK('C-5b 该类 SKU 名为「来点辣椒吗」（口味询问类，非真菜品）', zeroName, '来点辣椒吗');
CHK('C-5c 该类 qty 占全表比例 36.4%',
  Math.round((zeroRows.reduce((s, x) => s + (toNum(x.cells[iQty]) || 0), 0) / sumQty) * 1000) / 10, 36.4);

// 🔴 C-3「订单交易额」整单口径 ⇒ 严禁取用
let diffCnt = 0, cmpCnt = 0;
for (const x of C_DATA) {
  const q = toNum(x.cells[iQty]) || 0;
  if (q <= 0) continue;
  cmpCnt++;
  if (Math.round((toNum(x.cells[iSales]) || 0) * 100) !== Math.round((toNum(x.cells[iOrderAmt]) || 0) * 100)) diffCnt++;
}
CHK('C-3a 有销量行里「销售额 ≠ 订单交易额」的行数', diffCnt, cmpCnt);
CHK('C-3b 参与比对行数', cmpCnt, 49);

/* =========================================================================
 * 段三 · 反例（证明规则有必要）—— 定式：显式声明目标配置，两条路径对照
 * ====================================================================== */
SEC('段三 反例 —— C-1 提案规则下：形态 C 应判出、且形态 A 不得被误判');

// 目标规则（提案 C-1）：C ← (商品名称|菜品名称) 且 (商品销量|销量) 且 销售额 且 **不含** '销售方式'
function detectTarget(rows) {
  const hdr = ((rows[2] || []).map((x) => (x == null ? '' : String(x).trim())));   // 形态 A：R3
  const hdr1 = ((rows[0] || []).map((x) => (x == null ? '' : String(x).trim())));  // 形态 C：R1
  const all = new Set([...hdr, ...hdr1]);
  const has = (c) => all.has(c);
  const r2 = (rows[1] || []).map((x) => (x == null ? '' : String(x))).join('');
  if (has('菜品名称') && has('销售数量') && r2.indexOf('销售方式') >= 0) return 'dish_sales';
  if (has('套餐') && has('单品名称')) return 'combo_detail';
  const nameOk = has('商品名称') || has('菜品名称');
  const qtyOk = has('商品销量') || has('销量');
  if (nameOk && qtyOk && has('销售额') && r2.indexOf('销售方式') < 0) return 'waimai_goods';
  return null;
}
CHK('C-1f 目标规则下 形态C真矩阵 → waimai_goods（现状 null ⇒ 规则确有必要）',
  detectTarget(C_M), 'waimai_goods');
CHK('C-1g 🔴 目标规则下 形态A真矩阵仍 → dish_sales（不得被误判成 C）',
  detectTarget(A_M), 'dish_sales');

// 若去掉「不含销售方式」这条区分项 ⇒ 形态 A 会同时命中 C（证明区分项不可省）
function detectNoGuard(rows) {
  const hdr = ((rows[2] || []).map((x) => (x == null ? '' : String(x).trim())));
  const hdr1 = ((rows[0] || []).map((x) => (x == null ? '' : String(x).trim())));
  const all = new Set([...hdr, ...hdr1]);
  const has = (c) => all.has(c);
  const r2 = (rows[1] || []).map((x) => (x == null ? '' : String(x))).join('');
  if (has('菜品名称') && has('销售数量') && r2.indexOf('销售方式') >= 0) return 'dish_sales';
  if (has('套餐') && has('单品名称')) return 'combo_detail';
  if ((has('商品名称') || has('菜品名称')) && (has('商品销量') || has('销量')) && has('销售额')) return 'waimai_goods';
  return null;
}
CHK('C-1h 反证：去掉「不含销售方式」⇒ 形态 A 判出什么（用于说明区分项是否可省）',
  detectNoGuard(A_M), 'dish_sales');

// 🔴 C-1i：区分项到底**必要**还是**冗余**？—— 关键在于两套列名是否天然不重叠。
//   形态 A 用「销售数量」，形态 C 用「销量 / 商品销量」：若 A 的表头里根本不含后两者，
//   那么「不含销售方式」这条区分项就是**冗余的保守防御**（不是隔离的实际承担者）。
const A_HDR3 = (A_M[2] || []).map((x) => (x == null ? '' : String(x).trim()));
const A_HDR4 = (A_M[3] || []).map((x) => (x == null ? '' : String(x).trim()));
const A_ALL = new Set([...A_HDR3, ...A_HDR4, ...(A_M[0] || []).map((x) => (x == null ? '' : String(x).trim()))]);
CHK('C-1i 🔴 形态A表头**不含**「销量」⇒ 与 C 天然隔离（区分项是冗余防御，非实际承担者）',
  A_ALL.has('销量'), false);
CHK('C-1j 形态A表头**不含**「商品销量」', A_ALL.has('商品销量'), false);
CHK('C-1k 形态A表头含「销售数量」（C 规则不碰它 ⇒ 不会误伤）', A_ALL.has('销售数量'), true);
CHK('C-1l 形态C表头**不含**「销售数量」（A 规则不碰它 ⇒ 不会误伤）', C_HDR.indexOf('销售数量') >= 0, false);

/* =========================================================================
 * 段四 · C-3 反例：误用「订单交易额」会重复计钱
 * ====================================================================== */
SEC('段四 C-3 反例 —— 误用订单交易额当 amount 的差额');
const sumOrderAmt = C_DATA.reduce((s, x) => s + (toNum(x.cells[iOrderAmt]) || 0), 0);
CHK('C-3c Σ订单交易额（元）≠ Σ销售额（元）', Math.round(sumOrderAmt * 100) / 100 !== 1823.08, true);
CHK('C-3d 误用会虚增（订单交易额 ≥ 销售额）', sumOrderAmt >= sumSales, true);
console.log(`   （Σ销售额=${Math.round(sumSales * 100) / 100} 元 / Σ订单交易额=${Math.round(sumOrderAmt * 100) / 100} 元）`);

console.log(`\n===== 形态C 锚点结果：${PASS} 通过 / ${FAIL} 失败 =====`);
fs.writeFileSync(path.join(__dirname, 'recalc_anchors_formc.out.txt'), OUT.join('\n') + `\n\n===== 形态C 锚点结果：${PASS} 通过 / ${FAIL} 失败 =====\n`, 'utf8');
process.exitCode = FAIL === 0 ? 0 : 1;
