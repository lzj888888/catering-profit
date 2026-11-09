// tools/check_paywall_tracking.js —— 付费漏斗埋点守卫（R663 · 队列 #117）
//
// 起点是一个真问题：`utils/track.js`（R646 建的最小埋点）**建好后全仓零调用**。
// 这不是第一次 —— R396 `anomalyRules`、R613 诊断引擎、R623 的文案，都是"能力写了、没人用"。
// ⇒ 本守卫的第一条不是"埋点对不对"，而是"**它到底有没有被调用**"。
//
// 三条设计理由（都有代价，记下来防以后改错）：
//   ① 埋点必须在**唯一入口**（paywall.js），不是 12 个页面各写一遍 —— 漏一个就断层；
//   ② 只许传**枚举**，禁传金额/菜名 —— 埋点不该成为第二个数据收集口（隐私政策待填，是上线阻塞项）；
//   ③ 必须**静默失败** —— 埋点挂了不能让老板的复制/保存跟着报错。

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAWALL = read('utils/paywall.js');
const TRACK = read('utils/track.js');

// 生产调用点 = 除 track.js 自身与 __tests__ 之外，任何 require 它的地方
function prodCallers() {
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + name.name;
      if (name.isDirectory()) {
        if (['node_modules', '__tests__', '.git'].indexOf(name.name) >= 0) continue;
        walk(rel);
      } else if (/\.js$/.test(name.name)) {
        const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        if (/require\(['"][^'"]*track\.js['"]\)/.test(t)) hits.push(rel);
      }
    }
  };
  ['utils', 'subpkg', 'pages'].forEach((d) => { try { walk(d); } catch (e) { /* 目录不存在就跳过 */ } });
  return hits;
}

console.log('\n===== T 首要判据：埋点能力到底有没有被用 =====');
const callers = prodCallers();
ok('T-① 🔴 `track.js` 有生产调用（不是只建了文件就完事）',
  callers.length > 0, callers.length ? callers.join(', ') : '零调用 —— 这正是 R663 要修的起点');
ok('T-② 埋点接在**唯一入口** paywall.js，而不是散在各页面',
  callers.indexOf('utils/paywall.js') >= 0);

console.log('\n===== T 漏斗三节点都在 =====');
ok('T-③ `paywall_show`（墙被请求）', /track\('paywall_show'/.test(PAWALL));
ok('T-④ `free_limit_hit`（配额撞顶 —— 免费期唯一真会触发的节点）',
  /track\('free_limit_hit'/.test(PAWALL));
ok('T-⑤ `paywall_ios_blocked`（iOS 被挡要和"不想买"分开记，否则转化率会误判）',
  /track\('paywall_ios_blocked'/.test(PAWALL));

console.log('\n===== T 隐私与稳定性硬约束 =====');
// props 只许枚举：事件名之后的第二个参数里不许出现金额/名称类字段
const propsBlocks = (PAWALL.match(/track\('[a-z_]+',\s*\{[^}]*\}/g) || []);
const badProps = propsBlocks.filter((b) => /price|amount|fen|yuan|name|dish|shop_id|openid/i.test(b));
ok('T-⑥ 🔴 埋点 props 只传枚举，禁传金额/菜名/身份标识（隐私政策待填，不能新开收集口）',
  badProps.length === 0, badProps.length ? badProps.join(' | ') : '共 ' + propsBlocks.length + ' 处 props 均合规');
ok('T-⑦ `paywall_show` 发生在类型校验之后（非法类型不该计入漏斗）',
  PAWALL.indexOf("PAYWALL_TYPES.indexOf(type) < 0") < PAWALL.indexOf("track('paywall_show'"));
ok('T-⑧ 🔴 track 自身静默失败（埋点挂了不许影响主流程）',
  /try\s*\{/.test(TRACK) && /catch/.test(TRACK) && !/throw/.test(TRACK));
ok('T-⑨ 事件名不超 24 字符（`wx.reportAnalytics` 上限，超了会被截断成另一个事件）',
  ['paywall_show', 'free_limit_hit', 'paywall_ios_blocked'].every((e) => e.length <= 24));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
