// review/evidence/r242_jd_bill/probe_jd_sku_variant.js —— 带数据的京东 SKU 合成变体灌生产链（实测误判后果）
// ⚠️ 输入是**合成变体**（mk_jd_sku_variant.js 生成），不是真实平台文件。
// 正确口径：JD0001 到手 78.70（88.00-8.80-0.50）· JD0002 72.00 · 合计 150.70 · **订单数 2**
// 运行：node probe_jd_sku_variant.js
//
// ⚠️⚠️ ERRATA（R242e）—— 本文件与 probe_jd_parse.js 犯同一个结构错：
//   第 21 行 `const doc = { sheets: names.map(...) }` 是**数组**，生产按字符串键取 ⇒ 恒 undefined
//   ⇒ 本文件跑出的「0 行」是**探针 bug**，不是代码行为。
//   ✅ 修正后的真实结果见 `probe_jd_fixed.js` 用例 D：
//      detectPlatform='taobao' · parseBillMatrix → amountFen=15070 / **qty=4（应=2，虚高一倍）** / **bizDate=""（空）**
//      ⇒ 门禁以 SCHEMA_BIZDATE+REQUIRED_BIZDATE fail-closed 拦下。
const fs = require('fs');
const path = require('path');
const Module = require('module');
const WS = 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules';
const o = Module._resolveFilename;
Module._resolveFilename = function (r) { if (r === 'xlsx') return require.resolve(path.join(WS, 'xlsx')); return o.apply(this, arguments); };
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const S = require(path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js'));
const BP = require(path.join(ROOT, 'utils', 'billParse.js'));
const G = require(path.join(ROOT, 'utils', 'gradeGate.js'));

const F = path.join(__dirname, '_variant_jd_sku_withdata.xlsx');
const mx = S.bufferToMatrix(fs.readFileSync(F));
const names = Object.keys(mx.sheets);
const rows = mx.sheets[names[0]].rows;
console.log('变体 sheet =', JSON.stringify(names), '| 行数 =', rows.length, '（1 表头 + 4 数据）');

const hi = BP.guessHeader(rows);
const plat = BP.detectPlatform(rows[hi]);
console.log('[1] guessHeader = 第' + (hi + 1) + '行 · detectPlatform =', JSON.stringify(plat));

const doc = { sheets: names.map((n) => ({ name: n, rows: mx.sheets[n].rows })) };

// 模拟"页面导入"：把 detectPlatform 的结果当 platform 传进解析器（这是生产路径的真实行为）
console.log('\n[2] parseBillMatrix(doc, { platform: ' + JSON.stringify(plat) + ' })：');
let parsed = null;
try { parsed = BP.parseBillMatrix(doc, { platform: plat }); } catch (e) { console.log('    抛错：', e.message); }
if (parsed) {
  console.log('     totals =', JSON.stringify(parsed.totals));
  console.log('     rows   =', JSON.stringify(parsed.rows));
  console.log('     months =', JSON.stringify(parsed.months));
  console.log('     excludedReason =', JSON.stringify(parsed.excludedReason));
  console.log();
  console.log('     ⚖️ 对照正确口径：amountFen 应=15070 · qty 应=2 · bizDate 应=2026-09-30');
  console.log('     ⇒ 实测 qty =', parsed.totals.qty, '（虚高', parsed.totals.qty - 2, '）');
  console.log('     ⇒ 实测 bizDate =', JSON.stringify(parsed.rows.map((r) => r.bizDate)));
}

// [3] 甲级门禁（带 shop_id，模拟页面导入的真实上下文）
try {
  const gate = G.checkGradeA({ platform: plat, matrix: doc, totals: parsed && parsed.totals, shop_id: 'shop_mu6j87v1itrs' }, S.SALES_SCHEMA);
  console.log('\n[3] checkGradeA（带 shop_id）→ pass =', gate.pass, '| level =', gate.level);
  console.log('    failures =', JSON.stringify(gate.failures));
} catch (e) { console.log('\n[3] checkGradeA 抛错：', (e && e.message) || e); }
