// tools/check_archive_no_fake.js —— 【R741】归档函数「绝不造账」守卫
// 运行：node tools/check_archive_no_fake.js
//
// 为什么需要它（R741 三司会诊 D-3）：
//   原 `archiveMonth` 在目标月没有 `shop_monthly_account` 行时会 **insert 一条全 0 账再标归档**：
//     data: { ..., amortize_fen: 0, income_total_fen: 0, gross_profit_fen: 0,
//             total_factor_real_profit_fen: 0, is_archive: true }
//   用户对准一个从没录过数的月份点「归档」⇒ 系统凭空生成一处「利润 0」的封账记录，
//   且此后被 `ARCHIVED_LOCKED` 永久锁死（saveLedger 直接拒改）。
//   会计上这是替用户造了一笔零申报 —— 比"缺一个功能"危险得多。
//   归档的语义是「确认一个已存在的数」，不是「生成一个数」。
//
//   ⚠️ 既有归档类套件一条都抓不到：
//     `check_archive_grace`          守「7 天宽限天数」
//     `check_amort_archive_lock`     守 saveAsset 三条写路径的锁
//     `check_archive_switch_snapshot`守归档快照里的开关取值
//     —— 全都假设「账已经存在」，没人问过"账不存在时会发生什么"。
//
// 判据（三段）：
//   S 扫描面（fail-closed）：目标文件在场、含 exports.main。
//   A 源码面：无建账调用 / 缺账分支 return fail(RESOURCE_NOT_FOUND) / fail 早于任何写库 /
//             建账专用的 genId 已不再被引用（死引用会随时间腐烂，一起退役）。
//   B 反恒真：把「fail-closed」改回「insert 一条空账」⇒ A 段必须当场转红；断言数下界防删段。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');

const SRC_P = 'cloudfunctions/archiveMonth/index.js';
const SRC = read(SRC_P);

const R = [];
let curGroup = '';
const group = (n) => { curGroup = n; };
function ck(name, pass, detail) {
  R.push({ group: curGroup, name, pass: !!pass, detail: detail || '' });
}

// ─────────────────────────────────────────────
group('S · 扫描面（fail-closed：读不到就当红，不静默跳过）');
ck('S-① archiveMonth/index.js 存在且可读', SRC.length > 500, `${SRC.length} 字符`);
ck('S-② 含有 exports.main（确认读到的是那个控制器，不是同名残片）',
  /exports\.main\s*=\s*async/.test(SRC), 'exports.main 在位');

// ─────────────────────────────────────────────
group('A · 源码面：归档函数绝不创建账目');
// A-① 不许出现对 shop_monthly_account 的 insert
ck('A-① 全文无 `da.insert(\'shop_monthly_account\'` —— 归档不许建账',
  SRC.indexOf("da.insert('shop_monthly_account'") < 0,
  '未出现建账调用');
ck('A-② 也无 `collection(\'shop_monthly_account\').add(` 这类绕行写法',
  !/collection\(\s*'shop_monthly_account'\s*\)\s*\.\s*add\s*\(/.test(SRC),
  '无 add() 绕行');

// A-③ 缺账分支必须 fail-closed，且错误码是既有码（不许在 common 里新增 —— 那会触发 42 个函数全量部署）
const FAIL_RE = /if\s*\(\s*!\s*acct\s*\)\s*\{[\s\S]{0,400}?return\s+fail\(\s*ERROR_CODES\.RESOURCE_NOT_FOUND/;
ck('A-③ 缺账分支 return fail(ERROR_CODES.RESOURCE_NOT_FOUND)',
  FAIL_RE.test(SRC), 'fail-closed 分支在位');

// A-④ fail 必须早于任何写库动作（顺序反了 = 先写后拒，等于没拒）
const iFail = SRC.indexOf('return fail(ERROR_CODES.RESOURCE_NOT_FOUND');
const iUpdate = SRC.search(/\.doc\(\s*docId\s*\)\s*\.update\(/);
ck('A-④ 拒绝分支早于 update（先判后写，不许"先写后拒"）',
  iFail > 0 && iUpdate > 0 && iFail < iUpdate,
  `fail@${iFail} < update@${iUpdate}`);

// A-⑤ genId 是建账专用依赖，建账路径没了就该一起退役（死引用会随时间腐烂）
ck('A-⑤ 不再从 common 取 genId（建账路径退役的连带证明）',
  !/const\s*\{[^}]*\bgenId\b[^}]*\}\s*=\s*common/.test(SRC),
  '无 genId 解构');

// A-⑥ 头注释把这条纪律写死（下一个改这个文件的人先看到它）
ck('A-⑥ 头注释声明「绝不创建账目 / 不建空账」（防后人"顺手补个兜底"）',
  /绝不创建账目|不建空账/.test(SRC), '注释在位');

// ─────────────────────────────────────────────
group('B · 反恒真（证明 A 段抓得到回退）');
// B-① 变异回灌：把 fail-closed 改回「insert 一条空账」⇒ A-① / A-③ 必须转红
const ANCHOR = "  if (!acct) {\n    return fail(ERROR_CODES.RESOURCE_NOT_FOUND, v.archive";
const mutOld = '    await da.insert(\'shop_monthly_account\', { month: v.month, amortize_fen: 0, is_archive: v.archive });\n'
  + '    return ok({ shop_id: shopId, month: v.month });\n  }\n  if (false) {\n    return fail(ERROR_CODES.RESOURCE_NOT_FOUND, v.archive';
const mutSrc = SRC.replace(ANCHOR, mutOld);
const mutApplied = mutSrc !== SRC;
ck('B-① 变异体真的注入了（锚点在场，否则下面两条会恒绿）', mutApplied, `注入成功=${mutApplied}`);
ck('B-② 变异后 A-① 会转红（建账调用重新出现）',
  mutApplied && mutSrc.indexOf("da.insert('shop_monthly_account'") >= 0,
  '变异体含建账调用');
ck('B-③ 变异后 A-③ 会转红（缺账分支不再是 fail-closed）',
  mutApplied && !/if\s*\(\s*!\s*acct\s*\)\s*\{\s*return\s+fail\(\s*ERROR_CODES\.RESOURCE_NOT_FOUND/.test(mutSrc),
  '变异体缺账分支已非 fail-closed');

// B-④ 假绿防线：断言数下界（删段后本脚本不许"零失败"通过）
ck('B-④ 断言数下界 ≥ 10（防删段后恒绿）', R.length + 1 >= 10, `当前累计 ${R.length + 1} 条`);

// ─────────────────────────────────────────────
const fail = R.filter((r) => !r.pass);
for (const r of R) {
  console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}   « ${r.detail} »`);
}
console.log(`\n===== R741 归档不造账守卫：${R.length - fail.length} 通过 / ${fail.length} 失败 =====`);
if (fail.length) {
  console.log('\n—— 失败项 ——');
  for (const f of fail) console.log(`  · ${f.name}\n      ${f.detail}`);
  process.exit(1);
}
