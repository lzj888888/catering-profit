// _r121_mut.js —— R102/R117 变异回灌（证明守卫不是假绿）
// 纪律：逐条独立、改前备份、改后必还原、还原后逐字节 md5 校验。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const NODE = process.execPath;
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const F = {
  svc: 'cloudfunctions/checkQuota/service.js',
  col: 'cloudfunctions/initDb/collections.js',
  cq: 'cloudfunctions/checkQuota/index.js',
  gsl: 'cloudfunctions/getShopList/index.js',
  biz: 'specs/dev-specs/商业化方案_v1.4_融合版.md',
  card: 'pages/card/index.js',
};
const GUARD = { R102: 'tools/check_quota_limits.js', R117: 'tools/check_free_shop_limit.js' };

/** 变异定义：file / 纯函数 text→text / 期望守卫 / 期望红的断言标记 */
const MUT = [
  ['M1', 'R102', F.svc, (t) => t + "\nconst FREE_LIMIT = { shop: 1, cost_card: 3 };\n", 'L2r 反向断言', '插回 FREE_LIMIT 常量'],
  ['M2', 'R102', F.svc, (t) => t + "\nconst X = { cost_card: 3 };\n", 'L2r 反向断言', '插回 cost_card 字面量'],
  ['M3', 'R102', F.col, (t) => t.replace('cost_card: 5', 'cost_card: 3'), 'L5', '配置值被改回 3'],
  ['M4', 'R102', F.col, (t) => t.replace("plan_id: 'plan_free'", "plan_id: 'plan_free_x'"), 'L2-①', '单源 plan_free 行改名'],
  ['M5', 'R102', F.biz, (t) => t.replace('| **M3 菜品成本卡** | ⚠️ 限 **5 张**（按 `card_id` 去重，版本不计）', '| **M3 菜品成本卡** | ⚠️ 限 **3 张**（按 `card_id` 去重，版本不计）'), 'L11-②', '声明处表格行回退 3 张（L5 弱面漏网 → L11 补口抓）'],
  ['M6', 'R102', F.col, (t) => t.replace("    plan_id: 'plan_free',", "    plan_id: 'plan_free',\n    plan_id: 'plan_free',"), 'L10', 'plan_free 出现两处'],
  ['M7', 'R117', F.gsl, (t) => t + "\nconst FREE_SHOP_LIMIT = 1;\n", 'A4', '插回 FREE_SHOP_LIMIT 常量（硬编码复发）'],
  ['M8', 'R117', F.cq, (t) => t.split('plan_free').join('freeplanX'), 'A3', '消费者丢掉 plan_free 配置键（改成不含子串的名字）'],
  ['M9', 'R117', F.col, (t) => t.replace("plan_id: 'plan_free'", "plan_id: 'plan_free_x'"), 'A2', '单源行改名 ⇒ 解析失败'],
  ['M10', 'R117', F.gsl, (t) => t.replace('\n    free_limit: freeShopLimit,', ''), 'A5-①', '删掉 free_limit 出参'],
  ['M11', 'R117', F.card, (t) => t + "\nconst FREE_SHOP_LIMIT = 1;\n", 'A6-①', '前端复制该口径'],
  // —— 不得误杀（恒绿对照）
  ['N1', 'R102', F.svc, (t) => t + "\n// 历史说明：旧值 cost_card: 3 已配置化\n", null, '（对照·恒绿）注释里出现旧值不得误杀'],
  ['N2', 'R117', F.gsl, (t) => t.split('freeShopLimit').join('shopCap'), null, '（对照·恒绿）等价的局部变量改名不得误杀'],
];

function run(guard) {
  try {
    const out = execFileSync(NODE, [guard], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status === undefined ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

let ok = 0, ng = 0;
const backups = new Map();
for (const [id, gname, rel, fn, expectMark, desc] of MUT) {
  const abs = path.join(ROOT, rel);
  if (!backups.has(abs)) backups.set(abs, fs.readFileSync(abs, 'utf8'));
  const before = fs.readFileSync(abs, 'utf8');
  const mutated = fn(before);
  if (mutated === before) { console.log(`❌ ${id} 变异未生效（替换串未命中）：${rel}`); ng++; continue; }
  fs.writeFileSync(abs, mutated, 'utf8');
  const r = run(GUARD[gname]);
  fs.writeFileSync(abs, before, 'utf8');                                    // 立即还原
  const back = fs.readFileSync(abs, 'utf8');
  const restored = md5(back) === md5(before);
  const hit = expectMark ? r.out.includes(expectMark) : true;
  const expectRed = expectMark !== null;
  const verdict = expectRed ? (r.rc !== 0 && hit) : (r.rc === 0);
  if (verdict && restored) { ok++; console.log(`✅ ${id} [${gname}] ${desc} ⇒ RC=${r.rc}${expectRed ? ` 且点名「${expectMark}」` : ''}；还原 md5 ✓`); }
  else {
    ng++;
    console.log(`❌ ${id} [${gname}] ${desc} ⇒ RC=${r.rc}（期望 ${expectRed ? '≠0' : '=0'}）mark=${hit} restore=${restored}`);
    r.out.split(/\r?\n/).filter((l) => l.includes('❌')).slice(0, 6).forEach((l) => console.log('      ' + l.trim()));
  }
}
// —— 全局还原校验
let allBack = true;
for (const [abs, t] of backups) {
  const cur = fs.readFileSync(abs, 'utf8');
  if (md5(cur) !== md5(t)) { allBack = false; console.log(`❌ 未还原：${abs}`); }
}
console.log(`\n===== 变异回灌：${ok} 如期 / ${ng} 异常（共 ${MUT.length}）｜全局还原 ${allBack ? '逐字节一致 ✓' : '✗'} =====`);
process.exit(ng === 0 && allBack ? 0 : 1);
