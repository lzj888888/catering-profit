// probe_xlsx_chain.js —— 本地验证「xlsx → bufferToMatrix → billParse → 锚点」整条链路
//
// 【为什么需要它】
//   云端 `xlsx` 依赖是阶段①（批次 F）**唯一未验环节**：
//     · 「部署成功」只证明代码传上去了，**不证明 xlsx 能在云端跑**；
//     · `cli` 无 `invoke` 子命令 ⇒ 命令行拿不到运行结果（技能 miniprogram-cloud-deploy §7）。
//   本探针把「xlsx API 用错」（read 选项 / sheet_to_json 参数）这类风险**在本地提前暴露**，
//   不必等到真机才发现。若云端最终报 `Cannot find module 'xlsx'`，那是**安装**问题；
//   若报解析结果不对，就是**用法**问题 —— 两者靠本探针可以分辨。
//
// 【为什么不复制逻辑】
//   本探针 `require` 生产的 `cloudfunctions/importSalesBill/service.js`（**不是重写一遍**）
//   ⇒ 验的是云端将要执行的那份真代码。
//
// 用法（xlsx 装在仓库外，避免污染仓库）：
//   NODE_PATH=/tmp/xlsxprobe/node_modules node review/evidence/r181m_docs/probe_xlsx_chain.js

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SVC = path.join(REPO, 'cloudfunctions', 'importSalesBill', 'service.js');
const FIX = path.join(REPO, 'review', 'evidence', 'r181l_stage1_import_feed', 'fixtures');

const { bufferToMatrix, detectPlatform, guessHeader, parseBillMatrix } = require(SVC);

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  if (got === want) { pass += 1; console.log(`  ✅ ${name} = ${got}`); }
  else { fails.push(name); console.log(`  ❌ ${name} = ${got}（期望 ${want}）`); }
};

const CASES = [
  { file: '淘宝闪购.xlsx', rowCount: 156, amountFen: 377965, qty: 150, label: '淘宝闪购 2026-08' },
  { file: '09bbd01042244a1fa98e0d0f1963211b.xlsx', rowCount: 50, amountFen: 182664, qty: 50, label: '美团 2026-08（须按交易类型筛）' },
];

console.log('===== R181m · xlsx 链路本地探针（require 生产 service.js）=====');
console.log('service.js =', SVC);

for (const c of CASES) {
  const p = path.join(FIX, c.file);
  console.log(`\n[${c.label}] ${c.file}`);
  if (!fs.existsSync(p)) { fails.push(c.file + ' 缺文件'); console.log('  ❌ 文件不存在：' + p); continue; }
  const buf = fs.readFileSync(p);
  console.log(`  源文件 ${buf.length} 字节`);

  let doc;
  try {
    doc = bufferToMatrix(buf);
  } catch (e) {
    fails.push(c.file + ' bufferToMatrix 抛异常');
    console.log('  ❌ bufferToMatrix 抛异常：' + e.message);
    continue;
  }
  const names = Object.keys(doc.sheets || {});
  console.log(`  sheets(${names.length})：${names.slice(0, 6).join(' / ')}${names.length > 6 ? ' …' : ''}`);

  // ⚠️ 关键：`parseBillMatrix(matrix, opts)` 的 `platform` **必须从 opts 传入**
  //    （service.js:75 `const platform = (opts && opts.platform) || null;`）。
  //    漏传 ⇒ `SHEET[null]` = undefined ⇒ 零行（本探针初版就踩了这个，0/2 假红）。
  //    所以顺序必须是：bufferToMatrix → 逐 sheet detectPlatform → 带 platform 解析。
  let platform = null;
  let hitNm = null;
  for (const nm of names) {
    const rows = (doc.sheets[nm] && doc.sheets[nm].rows) || [];
    const hdr = (rows[guessHeader(rows)] || []).map((s) => (s == null ? '' : String(s).trim()));
    const p = detectPlatform(hdr);
    if (p) { platform = p; hitNm = nm; break; }
  }
  if (!platform) { fails.push(c.file + ' detectPlatform 认不出平台'); console.log('  ❌ 所有 sheet 都认不出平台'); continue; }
  console.log(`  认到平台：${platform}（明细表 = ${hitNm}）`);

  const r = parseBillMatrix(doc, { platform });
  const hit = { nm: hitNm, r };
  if (!hit.r || !hit.r.totals || hit.r.totals.rowCount === 0) {
    fails.push(c.file + ' 解析零行'); console.log('  ❌ 解析出零行'); continue;
  }

  eq(`${c.label} rowCount`, hit.r.totals.rowCount, c.rowCount);
  eq(`${c.label} amountFen`, hit.r.totals.amountFen, c.amountFen);
  eq(`${c.label} qty`, hit.r.totals.qty, c.qty);
}

console.log(`\n===== 结果：${pass} 通过 / ${fails.length} 失败 =====`);
if (fails.length) console.log('失败项：' + fails.join(' | '));
process.exit(fails.length ? 1 : 0);
