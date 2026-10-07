#!/usr/bin/env node
/* ============================================================================
 * H-1 · 形态 C（外卖「商品销量」）解析层锚点复算
 * ----------------------------------------------------------------------------
 * 铁律（spec-increment-authoring §铁律2）：锚点必须 require **生产代码**，
 *   绝不手写等价公式（重写 = 第二个真相源）。
 * 生产代码：cloudfunctions/importSalesBill/service.js（parseDishSalesC）
 *   （本地无 xlsx 包 ⇒ Module._load 空桩，与 tools/check_formc_parse.js 同手法）
 * 数据来源：真样例逐格 dump —— review/evidence/r232_formc_sample/formc_cells.txt
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

// ---------- dump 解析 ----------
function parseDump(file) {
  const txt = fs.readFileSync(file, 'utf8');
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
const r2 = (n) => Math.round(n * 100) / 100;

const C = parseDump(path.join(ROOT, 'review', 'evidence', 'r232_formc_sample', 'formc_cells.txt'));
const hdr = (C[0] || []).map((x) => (x == null ? '' : String(x).trim()));
const col = (name) => hdr.indexOf(name);

/* =========================================================================
 * 段一 · 生产 parseDishSalesC 真样例复算（§2.6-① 全部数字）
 * ====================================================================== */
SEC('段一 生产 parseDishSalesC 真样例复算');

const p = S.parseDishSalesC(C, { platform: 'meituan' });
CHK('P-1 行数 = 354', p.rows.length, 354);
CHK('P-2 Σ销量 = 118', p.totals.qty, 118);
CHK('P-3 Σ销售额 = 1823.08（amountFen=182308）', p.totals.amountFen, 182308);
CHK('P-4 天数 = 7（按 bizDate 分 7 组）', p.groups.length, 7);
CHK('P-5 商品数 = 51（dish_key 去重）', new Set(p.rows.map((x) => x.dishKey)).size, 51);
CHK('P-6 zeroAmountQty 恰 1 条且 name=来点辣椒吗 qty=43',
  JSON.stringify(p.zeroAmountQty), JSON.stringify([{ name: '来点辣椒吗', qty: 43 }]));
CHK('P-7 组日期序（首 09-07 / 末 09-13）',
  [p.groups[0].bizDate, p.groups[p.groups.length - 1].bizDate], ['2026-09-07', '2026-09-13']);
CHK('P-8 非整数 qty 0 条（本样例无，兜底保留）', p.nonInt.length, 0);
CHK('P-9 未匹配 0 条（本样例无空名）', p.unmatched.length, 0);

/* =========================================================================
 * 段二 · 反例（证明规则有必要 —— 定式：反例值 ≠ 正确值）
 * ====================================================================== */
SEC('段二 反例 —— 改回错写法数字必须变');

// 反例① 订单交易额（整单口径）
const iOrderAmt = col('订单交易额'), iQty = col('销量'), iSales = col('销售额');
let orderSum = 0;
for (let r = 1; r < C.length; r++) {
  const q = toNum((C[r] || [])[iQty]) || 0;
  if (q > 0) orderSum += toNum((C[r] || [])[iOrderAmt]) || 0;
}
CHK('F-1 反例：误用订单交易额 Σ=2974.91（≠正确 1823.08 ⇒ 重复计钱）', r2(orderSum), 2974.91);
CHK('F-1b 正确值来自销售额（1823.08），两者差 1151.83', r2(orderSum) - r2(p.totals.amountFen / 100), 1151.83);

// 反例② 补零
const names = new Set(), dates = new Set();
for (let r = 1; r < C.length; r++) {
  const nm = ((C[r] || [])[col('商品名称')] || '').trim();
  const dt = ((C[r] || [])[col('日期')] || '').trim();
  if (nm) names.add(nm);
  if (dt) dates.add(dt);
}
CHK('F-2 反例：网格 51×7=357（补零会变 357，实得 354 ⇒ 禁止补零）', names.size * dates.size, 357);
CHK('F-2b 实得行数 ≠ 网格（缺 3 格）', names.size * dates.size - p.rows.length, 3);

// 反例③ 销量列全文本
const qtyAllText = (() => {
  for (let r = 1; r < C.length; r++) {
    const v = (C[r] || [])[iQty];
    if (v !== '' && v !== undefined && v !== null && typeof v !== 'string') return false;
  }
  return true;
})();
CHK('F-3 反例：销量列全文本（Number.isFinite("43")=false ⇒ 必 toNum）',
  [qtyAllText, Number.isFinite('43')], [true, false]);

/* =========================================================================
 * 段三 · 幂等（同表重导 _id 集合逐字节相同）
 * ====================================================================== */
SEC('段三 幂等 —— 同表重导 _id 集合逐字节相同');
function idSet(pp, shop, platform) {
  const s = [];
  for (const g of pp.groups) g.rows.forEach((row, seq) => s.push(S.saleDocId(shop, platform, g.bizDate, seq)));
  return s.sort().join('|');
}
const idA = idSet(p, 's1', 'meituan');
const p2 = S.parseDishSalesC(C, { platform: 'meituan' });
const idB = idSet(p2, 's1', 'meituan');
CHK('P-10 同表重导 ⇒ _id 集合逐字节相同（且非空）', idA === idB && idA.length > 0, true);

/* =========================================================================
 * 汇总
 * ====================================================================== */
SEC('汇总');
const sum = `总览：${PASS}/${PASS + FAIL} 通过 · FAIL=${FAIL}`;
OUT.push(sum); console.log('\n' + sum);

fs.writeFileSync(path.join(__dirname, 'recalc_anchors_formc_parse.out.txt'),
  OUT.join('\n') + '\n', 'utf8');
process.exitCode = FAIL === 0 ? 0 : 1;
