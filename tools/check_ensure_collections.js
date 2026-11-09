// tools/check_ensure_collections.js —— 建集合入口守卫（R655）
//
// 为什么需要这个函数而不是去控制台点：
//   ① `rate_limit_counter` 云端不存在 ⇒ 频控一直 fail open；
//   ② prod 环境的 `initDb` 有环境门禁（含 `prod` 子串一律拒绝，这是**政策**）
//      ⇒ prod 建集合此前没有脚本化入口，也留不下可复核的痕迹。
//
// 本守卫盯三件事：
//   ① 白名单 ≡ 建库单源（漏一个就建不出来，多一个就是私开通道）
//   ② 安全红线：拒用户端 / 只建不删 / 白名单外显式拒绝
//   ③ 幂等：已存在的集合不许报错

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const SRC = fs.readFileSync(path.join(ROOT, 'cloudfunctions/ensureCollections/index.js'), 'utf8');
const IDB = fs.readFileSync(path.join(ROOT, 'cloudfunctions/initDb/collections.js'), 'utf8');

console.log('\n===== C 白名单 ≡ 建库单源 =====');
// ⚠️ 白名单是「一行写多个」的形式（'a', 'b', 'c',），按整行匹配会全漏 —— 首跑就这么错过一次。
//   正解：先截出 const COLLECTIONS = [ ... ]; 块，再抓块内所有单引号字符串。
const block = (SRC.match(/const COLLECTIONS = \[([\s\S]*?)\n\];/) || [])[1] || '';
const listed = Array.from(new Set((block.match(/'([a-z][a-z0-9_]*)'/g) || []).map((x) => x.replace(/'/g, ''))));
const srcCols = Array.from(new Set((IDB.match(/^ {2}([a-z][a-z0-9_]*):\s*\[/gm) || []).map((l) => l.trim().replace(/:\s*\[$/, ''))));
const missInFn = srcCols.filter((c) => listed.indexOf(c) < 0);
ok('C-① 🔴 建库里每个集合都在建集合白名单里（漏一个 = 那个集合永远建不出来）',
  missInFn.length === 0, missInFn.length ? '漏：' + missInFn.join(', ') : srcCols.length + ' 个全覆盖');
const extraInFn = listed.filter((c) => srcCols.indexOf(c) < 0);
ok('C-② 白名单里没有建库单源之外的集合（私开通道 = 能建单源不知道的表）',
  extraInFn.length === 0, extraInFn.length ? '多出：' + extraInFn.join(', ') : '无多余');
ok('C-③ rate_limit_counter 在白名单里（这是本次要建的那个）', listed.indexOf('rate_limit_counter') >= 0);

console.log('\n===== C 安全红线 =====');
ok('C-④ 🔴 拒用户端调用（有 OPENID 即拒，R215 定式）',
  /ctx[.]OPENID/.test(SRC) && /FORBIDDEN/.test(SRC));
ok('C-⑤ 🔴 只建不删：全文件不得出现 deleteCollection / drop',
  !/deleteCollection|dropCollection|[.]remove[(]/.test(SRC));
ok('C-⑥ 🔴 白名单外显式拒绝并回报（不静默丢弃）',
  /rejected/.test(SRC) && /rejected[.]push|indexOf\(c\) < 0/.test(SRC));
ok('C-⑦ 幂等：已存在的集合视为成功，不报错（重复跑不该红）',
  /exist|already|ResourceUnavailable/i.test(SRC) && /existed[.]push/.test(SRC));

console.log('\n===== C 可复核 =====');
ok('C-⑧ 返回值带 created / existed / failed（建了哪些有据可查，不靠人眼）',
  /created: created/.test(SRC) && /existed: existed/.test(SRC) && /failed: failed/.test(SRC));
ok('C-⑨ 日志显式打成功/失败（否则"跑过了"会一直看起来是绿的）',
  /console[.]log\('\[ensureCollections\]/.test(SRC) && /console[.]error\('\[ensureCollections\]/.test(SRC));
ok('C-⑩ 可指定只建某几个（不传 = 建全部，用于 prod 初始化）',
  /event[.]collections/.test(SRC) && /Array[.]isArray/.test(SRC));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
