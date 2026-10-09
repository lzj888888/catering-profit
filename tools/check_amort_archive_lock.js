// tools/check_amort_archive_lock.js —— 【R256】摊销资产「增/删/改」三条写路径的归档锁守卫
// 运行：node tools/check_amort_archive_lock.js
//
// 为什么需要它（缺口是**生产代码注释自己点名**的，不是推断）：
//   `cloudfunctions/saveAsset/index.js` 原文写着「本轮只给『删除』加锁；编辑 / 新增摊销的同类缺口
//   **仍然存在**」。而摊销资产从 start_month 起**逐月**产生摊销 ⇒
//     ① 编辑（改金额 / 起摊月 / 月数）= 改动它覆盖到的**每一个月**的账；
//     ② 新增一笔 start_month 早于已归档月的摊销 = 在**已封账的月份里凭空产生**摊销。
//   两者都让「已归档 = 只读」这条封账承诺失效 ⇒ M1 利润可被事后改动（数据可信度红线）。
//   ⚠️ 既有 160 个套件**一条都抓不到**：`check_archive_grace` 守的是「归档宽限天数」口径，
//     与「某条写路径有没有上锁」不是同一层 ⇒ 只能新建。
//
// 判据（四段，形态照 gate-suite-checklist §0）：
//   S 扫描面（fail-closed）：三份目标文件在场、index.js 真 require 了 service、三个锁函数都在。
//   A 源码面：删除路径锁不回退 + **编辑 / 新增两路径都真的上了锁** + 锁的位置早于写库 +
//             区间锁是比较 `>=` 而不是等值（防退化成「只看 start_month」）。
//   B 行为面：真调生产纯函数 `decideArchiveLock`，钉死「编辑取**更早起摊月**」等六组语义。
//   C 自失效 / 反恒真：影子样本（虚构的无锁源码 / 只取新起摊月的假实现）必须判红。
//
// ⚠️ 诚实边界：A 段是源码形态（改措辞会转红，属"判字面"）；B 段是行为（判语义）。两条路线互补，
//    与 R255「写侧键 ≡ 读侧键」同一手法。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions', 'saveAsset');
const IDX = path.join(CF, 'index.js');
const SVC = path.join(CF, 'service.js');
const VALIDATE = path.join(CF, 'validate.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? '  (' + detail + ')' : '')); }
}
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };

console.log('===== S 扫描面（fail-closed）=====');
const idx = read(IDX);
const svc = read(SVC);
const val = read(VALIDATE);
check('S-① saveAsset/index.js 在场且非空', idx.length > 500, idx.length + 'B');
check('S-② saveAsset/service.js 在场且非空（R256 新增的纯函数层）', svc.length > 300, svc.length + 'B');
check('S-③ saveAsset/validate.js 在场（扫描面没写错）', val.length > 100, val.length + 'B');
check('S-④ index.js 真 require 了 ./service（不是死文件）', /require\(['"]\.\/service['"]\)/.test(idx),
  String(/require\(['"]\.\/service['"]\)/.test(idx)));
for (const fn of ['archiveLocked', 'amortArchiveLocked', 'applyLockPlan']) {
  check(`S-⑤ 锁函数「${fn}」在 index.js 内确有定义/调用`, idx.indexOf(fn) >= 0, String(idx.indexOf(fn) >= 0));
}
const SVC2 = require(path.join(CF, 'service.js'));

console.log('\n===== A 源码面：三条写路径都上锁 =====');
check('A-① 删除路径的区间锁未回退（基线）',
  /amortArchiveLocked\(da,\s*shopId,\s*exist\.start_month\)/.test(idx),
  String(/amortArchiveLocked\(da,\s*shopId,\s*exist\.start_month\)/.test(idx)));
check('A-② 编辑路径：按既有 + 本次两侧算锁计划',
  /S\.decideArchiveLock\(exist\.mode,\s*exist\.start_month,\s*a\.mode,\s*a\.start_month\)/.test(idx),
  String(/S\.decideArchiveLock\(exist\.mode,\s*exist\.start_month,\s*a\.mode,\s*a\.start_month\)/.test(idx)));
check('A-③ 编辑路径：锁计划真的被应用（不是算了不用）',
  /applyLockPlan\(da,\s*shopId,\s*editPlan/.test(idx), String(/applyLockPlan\(da,\s*shopId,\s*editPlan/.test(idx)));
check('A-④ 新增路径：也算了锁计划',
  /S\.decideArchiveLock\(null,\s*null,\s*a\.mode,\s*a\.start_month\)/.test(idx),
  String(/S\.decideArchiveLock\(null,\s*null,\s*a\.mode,\s*a\.start_month\)/.test(idx)));
check('A-⑤ 新增路径：锁计划真的被应用',
  /applyLockPlan\(da,\s*shopId,\s*addPlan/.test(idx), String(/applyLockPlan\(da,\s*shopId,\s*addPlan/.test(idx)));

// 位置铁律：锁必须早于写库（拒绝来得太晚 = 账已经改了）
// 🔴 锚点必须**落在本分支内**：删除分支也有 `.update(` 且在文件更靠前的位置，
//    首版判据取 `idx.indexOf('.update(')` ⇒ 拿到删除分支的行号 ⇒ 把真实现判成"锁在写库之后"（假红）。
const iEditLock = idx.indexOf('applyLockPlan(da, shopId, editPlan');
const iPatch = idx.indexOf('const patch = {');                       // 编辑分支的 patch 起点
const iEditWrite = idx.indexOf('.update(', iPatch);                  // patch 之后的第一处写库
check('A-⑥ 编辑：锁早于本分支的 .update()（锚点落在编辑分支内）',
  iEditLock >= 0 && iPatch >= 0 && iEditWrite > iEditLock,
  `lock@${iEditLock} < patch@${iPatch} < write@${iEditWrite}`);
const iAddLock = idx.indexOf('applyLockPlan(da, shopId, addPlan');
const iAddWrite = idx.indexOf('da.insert(', iAddLock);               // 锁之后的第一处 insert
check('A-⑦ 新增：锁早于本分支的 da.insert()（锚点落在新增分支内）',
  iAddLock >= 0 && iAddWrite > iAddLock,
  `lock@${iAddLock} < write@${iAddWrite}`);

// 区间锁语义：必须是「已归档月 >= start」的比较，不能退化成只看 start_month 的等值
check('A-⑧ 区间锁用 >= 比较（不是等值 ⇒ 不会退化成只看 start_month）',
  /r\.is_archive\s*&&\s*String\(r\.month \|\| ''\)\s*>=\s*String\(startMonth\)/.test(idx),
  String(/r\.is_archive\s*&&\s*String\(r\.month \|\| ''\)\s*>=\s*String\(startMonth\)/.test(idx)));
check('A-⑨ 归档行判定是严格等值 is_archive（软删过滤口径一致）', /r\.is_archive\s*&&/.test(idx),
  String(/r\.is_archive\s*&&/.test(idx)));

console.log('\n===== B 行为面：真调生产纯函数 decideArchiveLock =====');
const p1 = SVC2.decideArchiveLock('amort', '2026-03', 'amort', '2026-08');
check('B-① 编辑 amort 起摊月 3→8：锁更早的 3 月（改向后也会动到已算过的月）',
  p1.amortStart === '2026-03', JSON.stringify(p1));
const p2 = SVC2.decideArchiveLock('amort', '2026-08', 'amort', '2026-03');
check('B-② 编辑 amort 起摊月 8→3：锁更早的 3 月（改向前）', p2.amortStart === '2026-03', JSON.stringify(p2));
const p3 = SVC2.decideArchiveLock(null, null, 'amort', '2026-03');
check('B-③ 新增摊销：走区间锁、不产生单月锁',
  p3.amortStart === '2026-03' && p3.lumpMonths.length === 0, JSON.stringify(p3));
const p4 = SVC2.decideArchiveLock(null, null, 'lump', '2026-03');
check('B-④ 新增一次性投入：走单月锁、不产生区间锁',
  p4.lumpMonths.join(',') === '2026-03' && p4.amortStart === '', JSON.stringify(p4));
const p5 = SVC2.decideArchiveLock('lump', '2026-05', 'amort', '2026-03');
check('B-⑤ lump→amort 改模式：新旧两侧都要锁（单月 + 区间）',
  p5.lumpMonths.join(',') === '2026-05' && p5.amortStart === '2026-03', JSON.stringify(p5));
const p6 = SVC2.decideArchiveLock('amort', '2026-03', 'lump', '2026-09');
check('B-⑥ amort→lump 改模式：同样两侧都锁',
  p6.lumpMonths.join(',') === '2026-09' && p6.amortStart === '2026-03', JSON.stringify(p6));
const p7 = SVC2.decideArchiveLock(null, null, 'amort', '');
check('B-⑦ 空起摊月 ⇒ 不产生任何锁（非恒真：不是永远有锁）',
  p7.amortStart === '' && p7.lumpMonths.length === 0, JSON.stringify(p7));
const p8 = SVC2.decideArchiveLock('lump', '2026-05', 'lump', '2026-09');
check('B-⑧ lump→lump：两个月都锁且不重复', p8.lumpMonths.join(',') === '2026-05,2026-09', JSON.stringify(p8));

console.log('\n===== C 自失效 / 反恒真 =====');
// 影子①：把「无锁」的旧形态源码喂给同一套解析器 ⇒ 必须判不出「编辑已上锁」
const hasEditLock = (src) => /S\.decideArchiveLock\(exist\.mode/.test(src) && /applyLockPlan\(da,\s*shopId,\s*editPlan/.test(src);
const OLD_SRC = 'const exist = await da.get("shop_amortize", a.asset_id);\n'
  + 'await db.collection("shop_amortize").doc(exist._id).update({ data: patch });';
check('C-① 影子：R256 之前的旧编辑形态（无锁）⇒ 解析器必须判"未上锁"（证明有分辨力）',
  hasEditLock(OLD_SRC) === false, String(hasEditLock(OLD_SRC)));
check('C-② 影子：当前真实源码 ⇒ 解析器判"已上锁"（正负互证）', hasEditLock(idx) === true, String(hasEditLock(idx)));
// 影子②：「只取新起摊月」的假实现 ⇒ B-① 那条判据必须失效（证明样本有分辨力）
const fakeOnlyNew = (oldStart, newStart) => newStart;
check('C-③ 影子：只取新起摊月的假实现在 3→8 样本上给出 2026-08 ≠ 期望 2026-03（样本有分辨力）',
  fakeOnlyNew('2026-03', '2026-08') !== p1.amortStart,
  `假=${fakeOnlyNew('2026-03', '2026-08')} 真=${p1.amortStart}`);
check('C-④ 断言数下界 ≥ 12（防删段后恒绿）', (pass + failN) >= 12, `本段前累计 ${pass + failN} 条`);

console.log(`\n===== R256 摊销归档锁守卫：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
