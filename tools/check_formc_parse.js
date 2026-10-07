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

console.log('\n===== formc-parse 守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
