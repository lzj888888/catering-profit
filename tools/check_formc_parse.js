#!/usr/bin/env node
// tools/check_formc_parse.js —— v1.7 · 形态 C（外卖「商品销量」）解析层守卫
// 运行：node tools/check_formc_parse.js   （由 verify_all.js 的 [formc-parse] 套件调用）
//
// ===== 为什么需要它（真缺口，非纸面演练）=====
//   v1.7 给 importSalesBill/service.js 加了 parseDishSalesC()：单行表头 R1、白名单取列、行内 biz_date、
//   qty 先 toNum、amount=销售额转分（🔴 严禁「订单交易额」）、禁止补零、zeroAmountQty 单列。
//   这几条是**写库正确性前置**，且每条都踩过坑：
//     · 误用「订单交易额」（整单口径）⇒ 重复计钱（实测 Σ 2974.91 vs 正确的 1823.08，虚增 63%）
//     · 补零行 ⇒ 与「真卖 0 份」不可区分 ⇒ 破坏 _id 幂等（重导时序列变）
//     · 销量列全文本 ⇒ 直接 Number.isFinite 判空会把 "43" 误杀（v1.6 §4.5 同类）
//   ⇒ 本守卫把这些变成机器判据，并配反例（改回错写法 ⇒ 必须红在目标断言上）。
//
// 判据（全部 fail-closed：读不到 service.js / dump 即判红）。数据来源：真样例 dump
//   review/evidence/r232_formc_sample/formc_cells.txt（逐格 · 无损，R232 归档）。
// 🔴 零子进程（纯 fs 扫描 + require 生产模块）⇒ 沙箱内 node 直接可跑。
// 🔴 顶部**不得**用 === 装饰横幅 —— R66 会判「段标题下零断言」（断言全绿也红）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVC_REL = 'cloudfunctions/importSalesBill/service.js';
const DUMP_REL = 'review/evidence/r232_formc_sample/formc_cells.txt';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// ---------- 加载 service.js（stub xlsx）----------
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
    rows[Number(m[1]) - 1] = body.split(' | ').map((s) => s.trim());
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
const r1 = (n) => Math.round(n * 100) / 100;

// ============ S 扫描面 ============
sec('S · 扫描面（service.js 可加载 + 真样例 dump 可读）');
check('S-① service.js 可加载且导出 parseDishSalesC(function) / DISH_SHAPES.C / saleDocId',
  !!svc && typeof svc.parseDishSalesC === 'function' && !!svc.DISH_SHAPES
    && svc.DISH_SHAPES.C === 'waimai_goods' && typeof svc.saleDocId === 'function',
  svc ? 'DISH_SHAPES.C=' + (svc.DISH_SHAPES && svc.DISH_SHAPES.C) + (stubbed ? '（xlsx 空桩）' : '') : 'require 失败');

const C = parseDump(DUMP_REL);
check('S-② 真样例 dump 可读且数据行 ≥ 355（R1 表头 + R2~R355 数据）', C.length >= 355, C.length + ' 行');

if (!svc || C.length < 355) {
  console.log('\n===== formc-parse 守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(1);
}

const hdr = (C[0] || []).map((x) => (x == null ? '' : String(x).trim()));
const col = (name) => hdr.indexOf(name);

// ============ R-C1 真样例复算 ============
sec('R-C1 · 真样例复算（Σ销量/Σ销售额/行数/天数/商品数/零价行）');
const parsed = svc.parseDishSalesC(C, { platform: 'meituan' });
check('R-C1-① 行数 = 354（单行表头 R1，数据 R2 起）', parsed.rows.length === 354, parsed.rows.length + ' 行');
check('R-C1-② Σ销量 = 118', parsed.totals.qty === 118, parsed.totals.qty);
check('R-C1-③ Σ销售额 = 1823.08（amountFen=182308）', parsed.totals.amountFen === 182308, parsed.totals.amountFen + ' 分');
check('R-C1-④ 天数 = 7（按 bizDate 分 7 组）', parsed.groups.length === 7, parsed.groups.length + ' 组');
check('R-C1-⑤ 商品数 = 51（去重）', new Set(parsed.rows.map((x) => x.dishKey)).size === 51,
  new Set(parsed.rows.map((x) => x.dishKey)).size + ' 个');
check('R-C1-⑥ zeroAmountQty 恰 1 条（来点辣椒吗 qty=43）',
  parsed.zeroAmountQty.length === 1 && parsed.zeroAmountQty[0].name === '来点辣椒吗' && parsed.zeroAmountQty[0].qty === 43,
  JSON.stringify(parsed.zeroAmountQty));
check('R-C1-⑦ 组日期序正确（首末 = 09-07 / 09-13）',
  parsed.groups[0].bizDate === '2026-09-07' && parsed.groups[6].bizDate === '2026-09-13',
  parsed.groups.map((g) => g.bizDate).join('~'));

// ============ R-C2 反例（证明规则有必要）============
sec('R-C2 · 反例（改回错写法 ⇒ 数字必须变，证明规则非恒真）');

// 反例①：误用「订单交易额」⇒ Σ 应为 2974.91（≠1823.08）
const iOrderAmt = col('订单交易额');
const iQty = col('销量');
const iSales = col('销售额');
let orderAmtSum = 0;
for (let r = 1; r < C.length; r++) {
  const q = toNum((C[r] || [])[iQty]) || 0;
  if (q <= 0) continue;
  orderAmtSum += toNum((C[r] || [])[iOrderAmt]) || 0;
}
check('R-C2-① 反例：误用「订单交易额」Σ=2974.91 ≠ 正确 1823.08（禁止订单交易额有意义）',
  r1(orderAmtSum) === 2974.91 && r1(orderAmtSum) !== 1823.08, r1(orderAmtSum) + ' vs ' + 1823.08);

// 反例②：补零 ⇒ 51×7=357 ≠ 354（禁止补零有意义）
const names = new Set();
const dates = new Set();
for (let r = 1; r < C.length; r++) {
  const nm = ((C[r] || [])[col('商品名称')] || '').trim();
  const dt = ((C[r] || [])[col('日期')] || '').trim();
  if (nm) names.add(nm);
  if (dt) dates.add(dt);
}
check('R-C2-② 反例：网格 51×7=357 ≠ 实得 354（禁止补零有意义）',
  names.size * dates.size === 357 && names.size * dates.size !== parsed.rows.length,
  names.size + '×' + dates.size + '=' + (names.size * dates.size) + ' vs ' + parsed.rows.length);

// 反例③：销量列全文本 ⇒ 直接 Number.isFinite 会误杀（必 toNum）
const qtyAllText = (() => {
  for (let r = 1; r < C.length; r++) {
    const v = (C[r] || [])[iQty];
    if (v !== '' && v !== undefined && v !== null && typeof v !== 'string') return false;
  }
  return true;
})();
check('R-C2-③ 反例：销量列全为文本（Number.isFinite("43")=false 会误杀）⇒ 必须 toNum',
  qtyAllText && Number.isFinite('43') === false && parsed.totals.qty === 118,
  'qtyAllText=' + qtyAllText + ' / isFinite("43")=' + Number.isFinite('43'));

// ============ R-C3 幂等 ============
sec('R-C3 · 幂等（同表重导 ⇒ _id 集合逐字节相同）');
function idSet(p, shop, platform) {
  const s = [];
  for (const g of p.groups) {
    g.rows.forEach((row, seq) => s.push(svc.saleDocId(shop, platform, g.bizDate, seq)));
  }
  return s.sort().join('|');
}
const idA = idSet(parsed, 's1', 'meituan');
const parsed2 = svc.parseDishSalesC(C, { platform: 'meituan' });
const idB = idSet(parsed2, 's1', 'meituan');
check('R-C3-① 同表重导 ⇒ _id 集合逐字节相同', idA === idB && idA.length > 0, 'idCount=' + idA.split('|').length);

// ============ R-C4 自失效护栏 ============
sec('R-C4 · 自失效护栏（扫描面非退化 + 关键锚点在场）');
check('R-C4-① 扫描面非退化：dump 行数 ≥ 355', C.length >= 355, C.length + ' 行');
check('R-C4-② 表头 18 列且含 5 白名单列',
  hdr.length === 18 && ['日期', '门店编号', '商品名称', '销量', '销售额'].every((c) => col(c) >= 0),
  hdr.length + ' 列');
check('R-C4-③ 关键锚点在场：形态 C 判定不回归（detectDishShape=waimai_goods）',
  svc.detectDishShape(C) === 'waimai_goods', svc.detectDishShape(C));

// ============ R-C5 美团真样例·别名列名（R245 P7）============
sec('R-C5 · 美团真样例·别名列名（R245 P7：商品名/商品销量/商品销售额）');
const MTR = 'review/evidence/r245_mt_goods/mt_goods_matrix.json';
const hasMTR = fs.existsSync(path.join(ROOT, MTR));
let MTG = { rows: [] };
if (hasMTR) MTG = JSON.parse(fs.readFileSync(path.join(ROOT, MTR), 'utf8'));
const MTG_H = (MTG.rows[0] || []).map((x) => (x == null ? '' : String(x).trim()));
check('R-C5-① 美团真样例矩阵在场（11 行 × 14 列；缺失即红）',
  hasMTR && MTG.rows.length === 11 && MTG_H.length === 14,
  hasMTR ? MTG.rows.length + ' 行 × ' + MTG_H.length + ' 列' : '🔴 ' + MTR + ' 缺失');
const pMT = (hasMTR && MTG.rows.length) ? svc.parseDishSalesC(MTG.rows, { platform: 'meituan' }) : null;
check('R-C5-② 行数 = 10（单行表头 R1，数据 R2 起）', !!pMT && pMT.rows.length === 10,
  pMT ? pMT.rows.length + ' 行' : '🔴 无解析结果');
check('R-C5-③ Σ销量 = 12（别名列「商品销量」取得到 ⇒ 不是 0）', !!pMT && pMT.totals.qty === 12,
  pMT ? String(pMT.totals.qty) : '🔴');
check('R-C5-④ Σ商品销售额 = 270.00（amountFen=27000；别名列「商品销售额」取得到）',
  !!pMT && pMT.totals.amountFen === 27000, pMT ? pMT.totals.amountFen + ' 分' : '🔴');
check('R-C5-⑤ 天数 = 3 且首末 = 2026-09-10 / 2026-09-13（R245 P8 紧凑 8 位「20260910」归一）',
  !!pMT && pMT.groups.length === 3 && pMT.groups[0].bizDate === '2026-09-10' && pMT.groups[2].bizDate === '2026-09-13',
  pMT ? pMT.groups.map((g) => g.bizDate).join('~') : '🔴');
check('R-C5-⑥ zeroAmountQty 恰 1 条「来点辣椒?吗」qty=4（0910×1 + 0912×3，按名聚合）',
  !!pMT && pMT.zeroAmountQty.length === 1 && pMT.zeroAmountQty[0].name === '来点辣椒?吗'
    && pMT.zeroAmountQty[0].qty === 4,
  pMT ? JSON.stringify(pMT.zeroAmountQty) : '🔴');
check('R-C5-⑦ 自失效护栏：真表头**零正名**命中（删别名 ⇒ 取列全 -1 ⇒ 上列数字必变）',
  ['商品名称', '销量', '销售额'].every((c) => MTG_H.indexOf(c) < 0),
  '命中=' + (['商品名称', '销量', '销售额'].filter((c) => MTG_H.indexOf(c) >= 0).join(',') || '零命中 ✓'));

// ============ R-C6 normalizeDate 紧凑格式（R245 P8）============
sec('R-C6 · normalizeDate 紧凑 8 位（R245 P8）');
check('R-C6-① 20260910 ⇒ 2026-09-10（美团商品表真格式）',
  !!svc && svc.normalizeDate('20260910') === '2026-09-10', svc ? svc.normalizeDate('20260910') : '🔴');
check('R-C6-② 2026/9/7 ⇒ 2026-09-07（旧形态不回归）',
  !!svc && svc.normalizeDate('2026/9/7') === '2026-09-07', svc ? svc.normalizeDate('2026/9/7') : '🔴');
check('R-C6-③ 2026091（7 位）⇒ 原样返回（fail-closed，不猜）',
  !!svc && svc.normalizeDate('2026091') === '2026091', svc ? svc.normalizeDate('2026091') : '🔴');
check('R-C6-④ abc ⇒ 原样返回（非日期不改写）',
  !!svc && svc.normalizeDate('abc') === 'abc', svc ? svc.normalizeDate('abc') : '🔴');

console.log('\n===== formc-parse 守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
