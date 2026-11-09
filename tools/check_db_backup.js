// tools/check_db_backup.js —— 数据库自动备份守卫（R652）
//
// 为什么这条必须守：备份是**唯一一个"错了要到灾难那天才知道"的功能**。
//   平时它静默跑着，谁也不知道有没有效；等真要恢复时才发现"某个集合从来没备过"。
//
// 最有价值的一条是 B-②：**集合清单从建库单源动态取**，而不是在备份函数里硬抄一遍。
//   硬抄的清单会漂 —— 以后有人加了新集合（比如 shop_xxx），备份面不会自动跟上，
//   而"少备一张表"平时完全看不出来。这里直接比对单源，漏了当场红。

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const BK = fs.readFileSync(path.join(ROOT, 'cloudfunctions/dbBackup/index.js'), 'utf8');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudfunctions/dbBackup/config.json'), 'utf8'));

console.log('\n===== B 触发器 =====');
const trig = (CFG.triggers || [])[0] || {};
ok('B-① 存在定时触发器', !!trig.name && trig.type === 'timer', JSON.stringify(trig));
ok('B-② 🔴 每月 1 日 10:00（7 段 cron：秒 分 时 日 月 周 年）',
  String(trig.config || '').trim() === '0 0 10 1 * * *', trig.config);
ok('B-③ 是月度而不是每天（每天备会把云存储迅速堆满）',
  String(trig.config || '').split(/\s+/)[3] === '1');

console.log('\n===== B 备份面 ≡ 建库单源（漏一张表就是灾难）=====');
// 从 initDb 单源取集合键（形如 `  shop_cost_card: [`）
const IDB = fs.readFileSync(path.join(ROOT, 'cloudfunctions/initDb/collections.js'), 'utf8');
const src = (IDB.match(/^ {2}([a-z][a-z0-9_]*):\s*\[/gm) || []).map((l) => l.trim().replace(/:\s*\[$/, ''));
const uniq = Array.from(new Set(src));

// 备份清单里的键
const listed = (BK.match(/'([a-z][a-z0-9_]*)'/g) || []).map((s) => s.replace(/'/g, ''));
const BACKUP_SET = new Set(listed);
const SKIP_SET = new Set((BK.match(/const SKIP = new Set\(\[([^\]]*)\]\)/) || [])[1] ? (BK.match(/const SKIP = new Set\(\[([^\]]*)\]\)/)[1].match(/'([a-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, '')) : []);

const missing = uniq.filter((c) => !BACKUP_SET.has(c) && !SKIP_SET.has(c));
ok('B-④ 🔴 建库里每个集合都在备份面里（漏掉即红 —— 这是本守卫的核心）',
  missing.length === 0, missing.length ? '漏备：' + missing.join(', ') : uniq.length + ' 个集合全覆盖');
ok('B-⑤ 跳过的集合必须在 SKIP 里显式登记（不许"悄悄不备"）',
  SKIP_SET.size === 1 && SKIP_SET.has('rate_limit_counter'), 'SKIP=' + Array.from(SKIP_SET).join(','));

console.log('\n===== B 三条红线（代码层）=====');
ok('B-⑥ 🔴 红线①：每张表开始前检查时间预算（事中检查＝已经卡住了）',
  /BUDGET_MS/.test(BK) && /Date\.now\(\) - t0 > BUDGET_MS/.test(BK));
ok('B-⑦ 超预算时把剩余集合记进 pending 并回报（不许静默少备）',
  /pending\.push/.test(BK) && /pending: pending\.length/.test(BK));
ok('B-⑧ 🔴 红线②：单表失败不拖垮整体（try/catch 后继续下一张）',
  /catch \(e\) \{[\s\S]{0,200}failed\.push/.test(BK));
ok('B-⑨ 🔴 红线③：备份只读业务库、只写云存储（不许写回业务集合）',
  !/\.add\(/.test(BK) && !/\.update\(/.test(BK) && !/\.remove\(/.test(BK) && /cloud\.uploadFile/.test(BK));

console.log('\n===== B 数据完整性 =====');
ok('B-⑩ 分页读（云开发单次上限 100，不一次性拉全库）',
  /PAGE = 100/.test(BK) && /\.skip\(p \* PAGE\)\.limit\(PAGE\)/.test(BK));
ok('B-⑪ 超过页数上限要显式标 truncated（静默截断＝以为备全了其实没有）',
  /truncated = true/.test(BK) && /truncated: truncated/.test(BK));
ok('B-⑫ 单集合单文件（不打包成一坨：大了会传失败，坏了也不好单独重备）',
  /backup\/' \+ stamp \+ '\/' \+ c \+ '\.json'/.test(BK));
ok('B-⑬ 备份带上 row_count 与时间戳（日后核对"这份备全了吗"）',
  /row_count: rows\.length/.test(BK) && /backed_up_at/.test(BK));
ok('B-⑭ 失败/未完成在日志里显眼（否则"备份跑了"会一直看起来是绿的）',
  /console\.error\('\[dbBackup\] 失败集合/.test(BK) && /console\.error\('\[dbBackup\] 未完成/.test(BK));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
