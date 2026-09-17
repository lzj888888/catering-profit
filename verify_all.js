// verify_all.js —— 仓库根一键串联校验器
// 运行：node verify_all.js
// 串联：53 个套件 = 6 个 specs 套件（门禁 A–L + seed/poc1-4）+ 批次0~7 代码自测（batch0/1/2/3/4/5/6/7，
//       含 batch4 六函数补齐 R57）+ 静态路径检查（tools/check_requires.js）+ 页面声明守卫（tools/check_pages.js，R44）
//       + 合规守卫（tools/check_compliance.js，R42）+ 单源派生守卫（tools/check_admincore.js，R50）
//       + 自测形状守卫（tools/check_selftest_shape.js，R66：顶层 IIFE ≤1 / exit 仅在末块）
//       + batch7 前端工具套件（tools/selftest_batch7.js，R55 移入 tools/ 以免随小程序包发布）。
//       🔒 另：本文件对**每个套件的 stdout**做「段标题下零断言即判红」审计（R66 主体，见 auditAssertions）。
// 🔒 上面这句数量由本文件内的 guardSuiteCount() **自动校验**（R59）；改这句以外的任何套件增删都会立刻转红。
// ⚠️ 另有两处在重启键 specs/dev-specs/★知识存储点_2026-09-10.md（§1.1 一键校验入口行 + 「套件数会漂」行），
//    那两处仍是**人工面**，改 SUITES 后须手动跟（A–L 无一组能发现重启键自相矛盾）。
// 用同一个 node（process.execPath）跑子进程，避免多解释器/环境问题。
// ⚠️ 不在 CI 之外假定任何 secrets；纯本地静态 + 单测。

const { execFileSync } = require('child_process');
const fs = require('fs');
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
  ['单源派生守卫 R50',    'tools/check_admincore.js'],
  ['自测形状守卫 R66/67/68', 'tools/check_selftest_shape.js'],
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
  // ===== batch4 补齐（R57）：此前只有结构类检查覆盖、行为无机器断言 =====
  ['batch4-getLedger',      'cloudfunctions/getLedger/selftest.js'],
  ['batch4-getMonthList',   'cloudfunctions/getMonthList/selftest.js'],
  ['batch4-getShopContext', 'cloudfunctions/getShopContext/selftest.js'],
  ['batch4-getCardVersions', 'cloudfunctions/getCardVersions/selftest.js'],
  ['batch4-saveAsset',      'cloudfunctions/saveAsset/selftest.js'],
  ['batch4-saveShopSetting', 'cloudfunctions/saveShopSetting/selftest.js'],
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
  ['batch7-utils',           'tools/selftest_batch7.js'],
  // 后续批次的套件在此追加即可（如 batch2_selfcheck ...）；追加后记得同步头部注释里的套件数量。
];

// 🔒 R59 守卫（自校验）：头部注释「// 串联：N 个套件」必须 ≡ SUITES.length。
// 背景：R21 与 R59 两次都是「增删了套件、忘改注释」⇒ 注释成了不可信的第二个事实源。
// 这里把注释变成被机器校验的对象，从此不再依赖人工记性（同 R50「单源派生」思路）。
(function guardSuiteCount() {
  const src = fs.readFileSync(__filename, 'utf8');
  const m = /^\/\/ 串联：(\d+)\s*个套件/m.exec(src);
  if (!m) {
    process.stdout.write('\n❌ [suite-count] 头部注释缺少「// 串联：N 个套件」一句或格式已变，R59 守卫无法工作\n');
    process.exit(1);
  }
  if (Number(m[1]) !== SUITES.length) {
    process.stdout.write(`\n❌ [suite-count] 头部注释写 ${m[1]} 个套件，实际 SUITES = ${SUITES.length} 个`
      + '（R21/R59：增删套件必须同步该注释）\n');
    process.exit(1);
  }
  process.stdout.write(`\n✅ [suite-count] 头部注释 ≡ SUITES.length = ${SUITES.length}（R59 守卫）\n`);
})();

// 🔒 R66 主体（运行期）：对**每个套件的 stdout** 做「段标题下零断言」审计。
// 背景（R65）：adminExport/selftest.js 曾因「两个顶层 IIFE + 抢先 process.exit」把 R49 段十余条断言腰斩，
//   而该套件 **exit 0、总览全绿** ⇒ 光看退出码/总览**发现不了「断言静默不跑」**。
// 规则：段标题下 ✅ == 0 → 该套件判红并点名标题。
//   ⚠️ 必须豁免「末段汇总行」：每个自测末尾都有 `===== xxx 自测结果：N 通过 / 0 失败 =====`，
//      它本身就是段标题形态、其下天然无 ✅。**按字面规则直接实现会误报 44/52**（本仓实测）。
//   ⚠️ 同理不可写成「任何标题下都必须有 ✅」。豁免条件收紧为：**末段** 且标题含 `N 通过 / M 失败`。
//   兜底：整个套件 ✅ == 0 → 判红（"一条断言都没跑"的终态）。
// 段标题形态仓内并存三种（实测）：`===== x =====` / `========== x ==========` / `--- x ---`（外加门禁用的 ══）。
//   ⚠️ 分隔符与标题之间的空格**可有可无**（仓内两种写法并存：`===== CSV 转义 =====` 与
//      `===== §2.9 角色控权（…）=====`）。首版要求必须有空格 ⇒ 紧贴写法的段**整段识别不到**，
//      故障段恰好落在这一类里 ⇒ 变异回灌仍报绿（实测）。别把 `[ \t]*` 改回 `[ \t]+`。
// 🔒 约定（R66 配套，**已成文**）：套件断言一律以 **✅** 标记。本判据与该符号绑定 ——
//      改用其它符号会被判成「零断言段」= **假红**（方向保守：宁可红，不可漏跑）；
//      写新套件/新段时请沿用 ✅，否则须同时改这里。
const SECTION_HEAD = /^(={3,}|-{3,}|─{3,}|═{3,})[ \t]*(.*?)[ \t]*(={3,}|-{3,}|─{3,}|═{3,})[ \t]*$/;
const SUMMARY_TAIL = /通过\s*\/\s*\d+\s*失败/;
const isDelimOnly = (s) => s === '' || /^[=\-─═]+$/.test(s);
function auditAssertions(out) {
  const text = String(out);
  const secs = [];
  let cur = null;
  for (const ln of text.split(/\r?\n/)) {
    const h = SECTION_HEAD.exec(ln);
    if (h && !isDelimOnly(h[2].trim())) {
      if (cur) secs.push(cur);
      cur = { title: h[2].trim(), marks: (ln.match(/✅/g) || []).length }; // 标题行自身的 ✅ 计入本段
    } else if (cur) { cur.marks += (ln.match(/✅/g) || []).length; }
  }
  if (cur) secs.push(cur);
  const total = (text.match(/✅/g) || []).length;
  const zero = secs.filter((s, i) => s.marks === 0
    && !(i === secs.length - 1 && SUMMARY_TAIL.test(s.title)));
  return { total, zero, sections: secs.length };
}

let failed = 0;
for (const [name, rel] of SUITES) {
  const fp = path.join(ROOT, rel);
  process.stdout.write(`\n===== [${name}] ${rel} =====\n`);
  try {
    const out = execFileSync(NODE, [fp], { cwd: ROOT, encoding: 'utf8' });
    const audit = auditAssertions(out);   // 🔒 R66：即使 exit 0 也要审「断言是否真跑了」
    process.stdout.write(out);
    if (audit.zero.length) {
      failed++;
      process.stdout.write(`  [${name}] ❌ FAIL (R66 段标题下零断言：`
        + audit.zero.map((z) => `「${z.title}」`).join('、') + ')  ← 断言疑似静默未跑\n');
    } else if (audit.total === 0) {
      failed++;
      process.stdout.write(`  [${name}] ❌ FAIL (R66 整段 0 条 ✅ 断言 —— 疑似全程未执行)\n`);
    } else {
      process.stdout.write(`  [${name}] ✅ PASS  (✅ ${audit.total} 条`
        + (audit.sections ? ` / 段 ${audit.sections}` : '') + ')\n');
    }
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
