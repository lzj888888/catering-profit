// verify_all.js —— 仓库根一键串联校验器
// 运行：node verify_all.js
// 串联：45 个套件 = 6 个 specs 套件（门禁 A–L + seed/poc1-4）+ 批次0~7 代码自测（batch0/1/2/3/4/5/6/7）
//       + 静态路径检查（tools/check_requires.js）+ 页面声明守卫（tools/check_pages.js，R44）
//       + 合规守卫（tools/check_compliance.js，R42）。
// ⚠️ 新增/删除套件时必须同步改上面这句数量，否则 `SUITES.length` 与注释不符（R21）。
// 用同一个 node（process.execPath）跑子进程，避免多解释器/环境问题。
// ⚠️ 不在 CI 之外假定任何 secrets；纯本地静态 + 单测。

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const NODE = process.execPath; // 当前执行的 node，子进程复用

// [展示名, 相对根的路径]
const SUITES = [
  ['门禁 A-L',            'specs/dev-specs/prototype/check_error_codes.js'],
  ['verify_seed_data',    'specs/dev-specs/prototype/verify_seed_data.js'],
  ['test_poc1',           'specs/dev-specs/prototype/test_poc1.js'],
  ['test_poc2',           'specs/dev-specs/prototype/test_poc2.js'],
  ['test_poc3',           'specs/dev-specs/prototype/test_poc3.js'],
  ['test_poc4',           'specs/dev-specs/prototype/test_poc4.js'],
  ['batch0 代码自测',     'cloudfunctions/common/__tests__/batch0_selfcheck.js'],
  ['batch1 代码自测',     'cloudfunctions/calcMonthlyProfit/selftest.js'],
  ['batch2 代码自测',     'cloudfunctions/calcAmortize/selftest.js'],
  ['静态路径检查',        'tools/check_requires.js'],
  ['页面声明守卫 R44',    'tools/check_pages.js'],
  ['合规守卫 R42',        'tools/check_compliance.js'],
  // ===== 批次 3 · POC2 BOM 两层 / 循环拦截 / 快照（7 个云函数各自单测）=====
  ['batch3-calcBom',      'cloudfunctions/calcBom/selftest.js'],
  ['batch3-detectCycle',  'cloudfunctions/detectCycle/selftest.js'],
  ['batch3-saveMaterial', 'cloudfunctions/saveMaterial/selftest.js'],
  ['batch3-saveCostCard', 'cloudfunctions/saveCostCard/selftest.js'],
  ['batch3-syncCostCard', 'cloudfunctions/syncCostCard/selftest.js'],
  ['batch3-getMaterial',  'cloudfunctions/getMaterial/selftest.js'],
  ['batch3-getCostCard',  'cloudfunctions/getCostCard/selftest.js'],
  // ===== 批次 4 · M1 结账归档 + M2 沙盘 + 摊销 + 账保存（各自单测）=====
  ['batch4-archiveMonth', 'cloudfunctions/archiveMonth/selftest.js'],
  ['batch4-calcSandbox',  'cloudfunctions/calcSandbox/selftest.js'],
  ['batch4-getAmortSchedule', 'cloudfunctions/getAmortSchedule/selftest.js'],
  ['batch4-saveLedger',   'cloudfunctions/saveLedger/selftest.js'],
  // ===== 批次 5 · 付费全流程（配额 + 订单 + 回调 + 权益 + 提醒 + 订单记录）=====
  ['batch5-checkQuota',        'cloudfunctions/checkQuota/selftest.js'],
  ['batch5-payCreateOrder',    'cloudfunctions/payCreateOrder/selftest.js'],
  ['batch5-payCallback',       'cloudfunctions/payCallback/selftest.js'],
  ['batch5-payQueryEntitlement', 'cloudfunctions/payQueryEntitlement/selftest.js'],
  ['batch5-payRenew',          'cloudfunctions/payRenew/selftest.js'],
  ['batch5-payExpireNotify',   'cloudfunctions/payExpireNotify/selftest.js'],
  ['batch5-payOrderList',      'cloudfunctions/payOrderList/selftest.js'],
  // ===== 批次 6 · 管理后台（鉴权 / 调权 / 录单 / 退款 / 导出）=====
  ['batch6-adminInit',          'cloudfunctions/adminInit/selftest.js'],
  ['batch6-adminLogin',         'cloudfunctions/adminLogin/selftest.js'],
  ['batch6-adminRefreshToken',  'cloudfunctions/adminRefreshToken/selftest.js'],
  ['batch6-adminLogout',        'cloudfunctions/adminLogout/selftest.js'],
  ['batch6-adminRevokeToken',   'cloudfunctions/adminRevokeToken/selftest.js'],
  ['batch6-adminQueryUser',     'cloudfunctions/adminQueryUser/selftest.js'],
  ['batch6-adminGrantEntitlement', 'cloudfunctions/adminGrantEntitlement/selftest.js'],
  ['batch6-adminManualOrder',   'cloudfunctions/adminManualOrder/selftest.js'],
  ['batch6-adminOrderList',     'cloudfunctions/adminOrderList/selftest.js'],
  ['batch6-adminRefundMark',    'cloudfunctions/adminRefundMark/selftest.js'],
  ['batch6-adminExport',        'cloudfunctions/adminExport/selftest.js'],
  // ===== 批次 7 · 体验打磨（表单校验 / 防重复 / 多店铺 / 导出 / 注销）=====
  ['batch7-getShopList',     'cloudfunctions/getShopList/selftest.js'],
  ['batch7-exportData',      'cloudfunctions/exportData/selftest.js'],
  ['batch7-deleteAccount',   'cloudfunctions/deleteAccount/selftest.js'],
  ['batch7-utils',           'utils/selftest_batch7.js'],
  // 后续批次的套件在此追加即可（如 batch2_selfcheck ...）；追加后记得同步头部注释里的套件数量。
];

let failed = 0;
for (const [name, rel] of SUITES) {
  const fp = path.join(ROOT, rel);
  process.stdout.write(`\n===== [${name}] ${rel} =====\n`);
  try {
    const out = execFileSync(NODE, [fp], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(out);
    process.stdout.write(`  [${name}] ✅ PASS\n`);
  } catch (e) {
    failed++;
    const why = e.code ? e.code : ('exit=' + e.status);
    process.stdout.write(`  [${name}] ❌ FAIL (${why})\n`);
    if (!e.stdout && !e.stderr) {
      process.stdout.write(`      ↳ 子进程未产出输出：${String(e.message).split('\n')[0]}\n`);
    }
    if (e.stdout) process.stdout.write(e.stdout.toString());
    if (e.stderr) process.stderr.write(e.stderr.toString());
  }
}

process.stdout.write(`\n===== 总览：${SUITES.length - failed}/${SUITES.length} 套件通过 =====\n`);
process.exit(failed === 0 ? 0 : 1);
