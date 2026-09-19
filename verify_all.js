// verify_all.js —— 仓库根一键串联校验器
// 运行：node verify_all.js
// 串联：66 个套件 = 6 个 specs 套件（门禁 A–L + seed/poc1-4）+ 批次0~7 代码自测（batch0/1/2/3/4/5/6/7，
//       含 batch4 六函数补齐 R57）+ 静态路径检查（tools/check_requires.js）+ 页面声明守卫（tools/check_pages.js，R44）
//       + 合规守卫（tools/check_compliance.js，R42）+ 单源派生守卫（tools/check_admincore.js，R50）
//       + 自测形状守卫（tools/check_selftest_shape.js，R66：顶层 IIFE ≤1 / exit 仅在末块）
//       + 幂等覆盖守卫（tools/check_idempotency.js，R73：契约「+幂等」逐函数对照 / 预检早于写的顺序不变量 /
//         登记同源 shopKey / 装饰性 idempotency_key 检出；判据来源 = 契约表本身，不手抄清单）
//       + 建库单源同步守卫（tools/check_schema_sync.js，R74：单源 collections.js ≡ 镜像 init_db.js 的
//         集合与索引清单 / 三份文档里写死的索引计数与逐条对照表 ≡ 单源；字面量解析 fail-closed）
//       + 交接面引用位置守卫（tools/check_handoff_paths.js，R77：协议/手册里的「报告在哪」必须给
//         **可解析绝对路径**且**真实存在**，并显式点名两个同名诱饵；根因=此前从没人验证过那个路径）
//       + 核对单派生守卫（tools/gen_index_checklist.js --check，R79：**整份**派生件重算逐字比对，
//         含剥 BOM + CRLF 归一 + 末尾空白归一；根因=核对单此前不在任何守卫扫描面内，
//         改单源却不重跑 ⇒ 它会静默停在旧计数，而全套 56 个套件全绿）
//       + 已证伪短语守卫（tools/check_stale_claims.js，R85：**已证伪的说法必须带上下文标记**，
//         政策类须带政策标记；按**概念**而非句式命中 ⇒ R84 那种「同一概念换了说法」不会再漏。
//         根因=R60/R77/R82/R84 四次都是审定式断言的时效性没人守、且四次都靠人 grep）
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
  ['幂等覆盖守卫 R73',    'tools/check_idempotency.js'],
  ['建库单源同步守卫 R74', 'tools/check_schema_sync.js'],
  ['交接面引用位置守卫 R77', 'tools/check_handoff_paths.js'],
  // ===== 核对单派生守卫（R79 · 复审方 round33 裁定「方案②」）=====
  // 用**整份重算逐字比对**覆盖派生件 —— S4 那种"抽数字比对"覆盖不了 §3 那 40 行正文，
  // 而那才是人真正照着操作的部分。硬要求：剥 BOM + CRLF 归一（不归一 ⇒ 入库后首次拉取假红）。
  ['核对单派生守卫 R79', 'tools/gen_index_checklist.js', ['--check']],
  // ===== 已证伪短语守卫（R85 · 复审方 round36 提议，本轮提前做）=====
  // 目的：R60/R77/R82/R84 四次都是「否定式断言的时效性没人守」，且四次都靠人 grep。
  // 判据不是"句子长什么样"，而是"概念 + 上下文标记" —— 已证伪说法必须带豁免标记，
  // 政策类必须带政策标记 ⇒ 引述天然放行，不必要求写作者改写措辞去躲关键词。
  ['已证伪短语守卫 R85', 'tools/check_stale_claims.js'],
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
  // ===== 批次 8 · UI 走查修复（result 三态 / amortize 初值 / 月份占位 / 两 key 拆分 / tab 不满宽 / 按钮抽类）=====
  ['batch8-ui-fix',          'tools/selftest_ui_fix.js'],
  // ===== 批次 8b · 功能补齐（A1 费用四大类 / A2 二级细项 / A3 分类种子 / B1 年月 picker / C1 mine 三 cell / D1 结果下钻 / E1 引导文案 / F1 术语统一）=====
  ['batch8b-features',       'tools/selftest_batch8b.js'],
  // ===== 批次 8c · 用户两大诉求（H1 摊销资产多次采购「二次摊销」/ H2 填表引导：每类口径 + 填写口径折叠块）=====
  ['batch8c-amort-batches',  'tools/selftest_batch8c.js'],
  // ===== 上线前 AD 缺口补齐（G1 字号 / G2 触控 / G3 adjust-position / G4 热更新 / G5 头像昵称 / G6 触觉反馈 / G7 场景值 / G8 断网提示 + debounce 清理）=====
  ['ad-gates',               'tools/selftest_ad_gates.js'],
  // ===== R95 证据文件留证元信息（纯读声明 vs 写入痕迹须自洽 / 前置时刻 ≤ 采集时刻）=====
  ['evidence-meta',          'tools/check_evidence_meta.js'],
  // ===== R97 跨函数数据契约（da.get 的 _id vs 业务主键兜底 / 同义字段在 DB 读取点必须兼容）=====
  ['data-contract',          'tools/check_data_contract.js'],
  // ===== R45 iOS 虚拟支付入口（付费入口必须做 iOS 过滤，防 iOS 端可下单被审核拒）=====
  ['ios-pay-guard',          'tools/check_ios_pay.js'],
  // ===== 环境 ID 就绪（env.js 占位符静默回落缺口：ACTIVE_ENV 切 prod 而 ID 未填 ⇒ 全站云调用瘫痪且无告警）=====
  ['env-ready',              'tools/check_env_ready.js'],
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

// 🔒 R92 守卫（自校验）：SUITES 里登记的**每个套件文件都必须已纳入 git 索引**（`git ls-files` 命中）。
// 背景（R92，复审方发现）：AD 缺口 G1~G8 在工作树里全修好了、`verify_all` 也跑出「62/62」，
//   但**代码一个都没提交** ⇒ ① 远端那份是 61 套件且没有 AD 守卫，② 更糟的是它**不会红**：
//   R59 的 guardSuiteCount 比的是「同一份文件内注释数 ≡ SUITES 长度」，未提交时照样 62 ≡ 62。
//   这是 R67 的镜像：那次是「接线了没文件」，这次是「登记了没提交」。
// ⇒ 判据必须是**仓库事实**（git 索引），不能是文件系统事实（存在即算）。
// fail-closed：git 不可用 / 不在仓库内 ⇒ 直接判红（宁可挡住，不放过"证据与被证物分离"）。
(function guardSuiteTracked() {
  let tracked;
  try {
    tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean)
    );
  } catch (e) {
    process.stdout.write('\n❌ [suite-tracked] `git ls-files` 执行失败（不在 git 仓库 / git 不可用）'
      + ' —— 无法确认套件文件是否已入库，按 fail-closed 判红。\n');
    process.exit(1);
  }
  const missing = SUITES
    .map((s) => s[1])
    .filter((rel) => rel && !tracked.has(rel.replace(/\\/g, '/')));
  if (missing.length) {
    process.stdout.write(`\n❌ [suite-tracked] 以下 ${missing.length} 个已登记套件**未纳入 git 索引**（R92：登记了没提交 ⇒ `
      + '远端复现不出这些成绩，且 R59 不会红）：\n');
    missing.forEach((rel) => process.stdout.write('   ' + rel + '\n'));
    process.stdout.write('   处置：先 `git add` 并提交这些文件，再跑本校验器。\n');
    process.exit(1);
  }
  process.stdout.write(`✅ [suite-tracked] ${SUITES.length} 个套件文件全部已入库（R92 守卫）\n`);
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
// 🔒 R69（运行期，可选补强）：套件输出必须「走完收尾」—— 末尾 3 个非空行须含 `N 通过`。
//   背景：末块内提前 `process.exit` 时输出被**腰斩在汇总行之前**；若被截断的区间恰好每段都留下过断言，
//   R66 的「段内 ✅==0」就抓不到 ⇒ 需要"收尾行"这个**独立**信号（与 R66 互补）。
//   ⚠️ 实测（2026-09-17，逐套件直采各自 stdout）：**6 个套件不以 `N 通过` 收尾** —— 4 个守卫类各以
//   `✅ …校验通过` 收尾、batch1 用 `✅ 12/12 锚点…全数通过`、门禁 A–L 的 `✅ 全部断言通过` 打在**第 17 行**
//   （明细之前，不在末尾）。⇒ **字面实现会误报 6 个**。
//   处理 = 显式豁免清单 `NO_SUMMARY_TAIL`（逐个写理由），并让**新增套件若既无汇总行又不在清单内 → 判红**
//   （fail-closed：不许"静默不合规"，要么补一条 `N 通过 / M 失败` 收尾行、要么在此显式登记）。
const TAIL_SUMMARY = /\d+\s*通过/;
// ⚠️ 本清单**按路径**登记：移动/改名套件时，若它在此清单内**必须同步改这里的路径**，
//   否则豁免静默失效、该套件转红（方向保守 = 响亮失败而非漏检，但会白折腾一轮）。
//   前例：R55 把 `utils/selftest_batch7.js` 移到了 `tools/`。
//   （复审方 round30 §2 观察；不建议改成按 basename 匹配——那会放松判据。）
const NO_SUMMARY_TAIL = new Set([
  'specs/dev-specs/prototype/check_error_codes.js', // 门禁 A–L：`✅ 全部断言通过` 在第 17 行，其后才是 A–L 逐组明细
  'cloudfunctions/calcMonthlyProfit/selftest.js',   // 收尾 = `✅ 12/12 锚点 + … 全数通过`（写作 12/12，非 "N 通过"）
  'tools/check_requires.js',                        // 收尾 = `✅ 相对 require 全部可解析（扫描 603 个…）`
  'tools/check_pages.js',                           // 收尾 = `✅ 页面声明校验通过（…）`
  'tools/check_compliance.js',                      // 收尾 = `✅ 合规校验通过（…）`
  'tools/check_admincore.js',                       // 收尾 = `✅ 单源派生校验通过：11 份…`
]);
const isDelimOnly = (s) => s === '' || /^[=\-─═]+$/.test(s);
function auditAssertions(out, rel) {
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
  // R69：末尾 3 个非空行须含 `N 通过`；不在 NO_SUMMARY_TAIL 里又不满足 ⇒ 判"未走完收尾"
  // R70（复审方 round30 提出）：「末尾 3 行」窗口过宽 —— 若某套件**中途**打印过形如 `N 通过` 的行，
  //   且提前退出落在该行之后 3 行以内，窗口仍能命中 ⇒ R69 放行。本仓确有这种中途行：
  //   adminExport 的 `==== adminExport R49 子测：30 通过 / 0 失败 ====` 出现在最终汇总行**之前**。
  //   ⇒ 收紧为「**忽略纯分隔线后的最后 1 行**」，窗口 3 → 1。
  //   零豁免成本（复审方逐套件实测，本侧复核）：剔除纯分隔线后取末行，不满足项恰好仍是原 6 项 ——
  //   verify_seed_data 的末行是纯分隔线 `====…====`，其 `48 通过 / 0 失败` 在上方 2 行，剔掉即自然通过。
  const isDelimRow = (s) => /^[=\-─═\s]{3,}$/.test(s);
  const tail1 = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !isDelimRow(l)).slice(-1);
  const tail = tail1.some((l) => TAIL_SUMMARY.test(l)) || NO_SUMMARY_TAIL.has(rel);
  return { total, zero, sections: secs.length, tail };
}

let failed = 0;
// 第三元素 = 传给该套件的额外 argv（目前只有核对单派生守卫需要 `--check`）。
//   为什么必须显式传：那份文件是**同一份、两种模式** —— 默认模式是"渲染并写出核对单"，
//   若不加 `--check` 就挂进来，每跑一次 verify_all 都会把核对单**覆写一遍**（还顺带
//   改掉时间戳，让"有人偷偷改过"这件事永远无法被发现）。
for (const [name, rel, extra] of SUITES) {
  const fp = path.join(ROOT, rel);
  const argStr = extra && extra.length ? ' ' + extra.join(' ') : '';
  process.stdout.write(`\n===== [${name}] ${rel}${argStr} =====\n`);
  try {
    const out = execFileSync(NODE, [fp].concat(extra || []), { cwd: ROOT, encoding: 'utf8' });
    const audit = auditAssertions(out, rel);   // 🔒 R66/R69：即使 exit 0 也要审「断言是否真跑了 / 是否走完收尾」
    process.stdout.write(out);
    if (audit.zero.length) {
      failed++;
      process.stdout.write(`  [${name}] ❌ FAIL (R66 段标题下零断言：`
        + audit.zero.map((z) => `「${z.title}」`).join('、') + ')  ← 断言疑似静默未跑\n');
    } else if (!audit.tail) {
      failed++;
      process.stdout.write(`  [${name}] ❌ FAIL (R69 输出未走完收尾：末尾 3 行无「N 通过」且不在 NO_SUMMARY_TAIL 内`
        + '  ← 疑似提前退出；要么补一条 `N 通过 / M 失败` 收尾行，要么在 NO_SUMMARY_TAIL 显式登记)\n');
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
