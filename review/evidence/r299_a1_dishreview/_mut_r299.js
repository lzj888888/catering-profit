// review/evidence/r299_a1_dishreview/_mut_r299.js —— R299 守卫「变异回灌」证明（非恒真）
//
// 纪律（与 R298Y 同一套）：
//   · **单点变异**：每次只改一处；
//   · 替换串**未逐字命中即 `exit 2`**（防"改错地方还以为证明了"）；
//   · 命中处数必须**恰 1**（否则不算单点）；
//   · **就地改 + 立即还原 + sha256 逐字节复核**（防残留污染真实交付）；
//   · 还原后必须**复跑归绿**，否则视为未还原。
//
// 覆盖：3 条真缺陷的原样复现（D1 命名空间 / D3 返回不刷新 / D2 截断不告知）+ 新守卫的 fail-closed 腿。
// 用法：仓库根 `node review/evidence/r299_a1_dishreview/_mut_r299.js`
//       （证据重定向：`> review/evidence/r299_a1_dishreview/mutation_r299.txt 2>&1`）

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = process.cwd();
const G1 = 'tools/check_dishreview_engine.js';
const G2 = 'tools/check_truncated_surfaced.js';
const G3 = 'tools/check_paywall_coverage.js';
const G4 = 'tools/check_fn_contract_params.js';

const sha = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
const absOf = (rel) => path.join(ROOT, rel);

const MUTS = [
  // ===== 守卫 1（check_dishreview_engine）：覆盖率「道数」命名空间 =====
  {
    id: 'M1',
    desc: 'D1 原样复现：覆盖率把**堂食**一侧的去重实参换回 `.name`（成本卡名命名空间）',
    file: 'pages/m3/dishreview/index.js',
    from: '    dineIn.forEach((x) => dishKeys.add(x.dishKey));',
    to: '    dineIn.forEach((x) => dishKeys.add(x.name));',
    guard: G1,
    expect: [/12-④/],
  },
  {
    id: 'M2',
    desc: 'D1 原样复现：未匹配一侧换回 `.name`（与堂食混算 ⇒「共 N 道 / 已算 M 道」一起错）',
    file: 'pages/m3/dishreview/index.js',
    from: '    const unmatchedKeys = new Set(unmatched.map((x) => x.dishKey));',
    to: '    const unmatchedKeys = new Set(unmatched.map((x) => x.name));',
    guard: G1,
    expect: [/12-④/],
  },
  {
    id: 'M3',
    desc: 'D1 前置腿：fmtRanked 不再带出 `dishKey`（前端拿不到菜品身份）',
    file: 'pages/m3/dishreview/index.js',
    from: "      dishKey: x.dish_key || x.name || '',\n",
    to: '',
    guard: G1,
    expect: [/12-④/],
  },
  {
    id: 'M4',
    desc: 'D3 原样复现：onShow 退回「只在 locked 时重载」（去建卡回来页面不刷新）',
    file: 'pages/m3/dishreview/index.js',
    from: "    if (this.data.locked) { this.init(); return; }   // 从付费弹窗返回后重试\n    if (this._shown) this.load();\n    this._shown = true;",
    to: '    if (this.data.locked) this.init();   // 从付费弹窗返回后重试',
    guard: G1,
    expect: [/12-⑬/],
  },

  // ===== 守卫 2（check_truncated_surfaced）：出参 truncated 消费面 =====
  {
    id: 'M5',
    desc: 'D2 原样复现：manageShop::onStats 不再回 `truncated`（删除确认框的"后果量级"被低估且零提示）',
    file: 'cloudfunctions/manageShop/index.js',
    from: '    truncated: !!st.truncated,\n',
    to: '',
    guard: G2,
    expect: [/①-c/],
  },
  {
    id: 'M6',
    desc: '生产者面：getSalesBills 出参删掉**简写属性** `truncated,`（首版只认冒号时正是此漏）',
    file: 'cloudfunctions/getSalesBills/index.js',
    from: '    truncated,\n',
    to: '',
    guard: G2,
    expect: [/①-d/],
  },
  {
    id: 'M7',
    desc: '消费者面 fail-closed：删掉 dishreview 的 dataHealth 引入（该页整体不再消费 truncated）',
    file: 'pages/m3/dishreview/index.js',
    from: "const dh = require('../../../utils/dataHealth.js');",
    to: "const dh = {};",
    guard: G2,
    expect: [/③-c/],
  },
  {
    id: 'M8',
    desc: '登记表**空转键**：往 EXEMPT 塞一个"存在但根本没碰过 emitter"的文件 ⇒ ③-f 必须判红',
    file: 'tools/check_truncated_surfaced.js',
    from: "  'pages/card/edit.js': 'getCostCard 仅取模板 / 子卡候选供选择，不渲染\"本店全部卡\"清单、不输出总数、不进金额计算',\n};",
    to: "  'pages/card/edit.js': 'getCostCard 仅取模板 / 子卡候选供选择，不渲染\"本店全部卡\"清单、不输出总数、不进金额计算',\n  'pages/index/index.js': '假的空转登记项（变异用）',\n};",
    guard: G2,
    expect: [/③-f/],
  },

  // ===== 守卫 1（check_dishreview_engine）· R299-Q 新增腿 =====
  {
    id: 'M9',
    desc: 'Q1 原样复现：删掉汇总卡的标题行（"全渠道合计"被读成堂食小计）',
    file: 'pages/m3/dishreview/index.wxml',
    from: '    <view class="section-title">{{t.reviewTotals}}</view>\n',
    to: '',
    guard: G1,
    expect: [/12-⑮/],
  },
  {
    id: 'M10',
    desc: 'Q3 反向：hub.js 撤回消费（该页把 length 当**精确张数**渲染 ⇒ 不许豁免）',
    file: 'pages/m3/hub.js',
    from: "const dh = require('../../utils/dataHealth.js');",
    to: "const dh = {};",
    guard: G2,
    expect: [/③-c/],
  },

  // ===== 守卫 3（check_paywall_coverage L8）· R299-A1② 新增 =====
  {
    id: 'M11',
    desc: 'T4 原样复现：反算不再过付费墙（同页「计算」过了、反算没过）',
    file: 'pages/takeaway/index.js',
    from: "  async onReverse() {\n    const ent = await fetchEntitlement().catch(() => null);\n    if (!ent || !ent.is_active) {\n      openPaywall('takeaway', { shopId: (getApp().globalData && getApp().globalData.shop_id) || '' });\n      return;\n    }\n",
    to: '  async onReverse() {\n',
    guard: G3,
    expect: [/L8-①/],
  },
  {
    id: 'M12',
    desc: 'T3 原样复现：反算改回读 `this.data.result`（未点计算时成本取 0 ⇒ 挂牌价偏低）',
    file: 'pages/takeaway/index.js',
    from: '    const cur = calcTakeawayOrder(order, (id) => this.lookup(id));',
    to: '    const cur = this.data.result || { cash: { dish_cost_fen: 0, pack_cost_fen: 0 } };',
    guard: G3,
    expect: [/L8-④/],
  },

  // ===== 守卫 4（check_fn_contract_params）· R301 新增 =====
  {
    id: 'M13',
    desc: 'R301 原样复现（**新守卫**）：实现不再读契约入参 `biz_date_from` ⇒ 契约与实现分歧重现',
    file: 'cloudfunctions/getDishReview/index.js',
    from: '  const bizFrom = event && event.biz_date_from;\n',
    to: '',
    guard: G4,
    expect: [/②-a/],
  },
  {
    id: 'M14',
    desc: 'R301 原样复现（**复盘页守卫**）：实现不再读契约入参 ⇒ 14-① 必须红（同一次变异两条判据都抓）',
    file: 'cloudfunctions/getDishReview/index.js',
    from: '  const bizFrom = event && event.biz_date_from;\n',
    to: '',
    guard: G1,
    expect: [/14-①/],
  },
  {
    id: 'M15',
    desc: 'R301 反向：前端 load() 不再传区间（回到 `{}`）⇒ 跨月累计这个缺陷会悄悄回来',
    file: 'pages/m3/dishreview/index.js',
    from: "    const d = await api.call('getDishReview', { biz_date_from: rng.from, biz_date_to: rng.to });",
    to: "    const d = await api.call('getDishReview', {});",
    guard: G1,
    expect: [/14-⑤/],
  },
  {
    id: 'M16',
    desc: 'R301 行为面：`filterByRange` 过滤后仍回原全集 ⇒ 14-③ 的行为判据必须红',
    file: 'cloudfunctions/getDishReview/service.js',
    from: '  return { rows, from: f, to: t, days: countDataDays(rows) };',
    to: '  return { rows: rows0, from: f, to: t, days: countDataDays(rows) };',
    guard: G1,
    expect: [/14-③/],
  },
];

const results = [];
let hard = 0;

// 🔴 R299 实测教训：**SIGTERM 下 `finally` 不执行** ⇒ 变异会**留在工作树里**。
//   本轮首跑被工具超时 SIGTERM 打断，M8 往守卫的 EXEMPT 表注入的"空转键"就**没被还原**，
//   导致第二次跑时 M8 的 `from` 串不再命中（EXIT2）、且后续所有变异都"复绿=false"。
//   ⇒ 加信号处理器：收到 TERM/INT 先把**当前正在变异的那份文件**写回原文，再退出。
let pending = null;   // { abs, orig }
function restorePending() {
  if (pending) {
    try { fs.writeFileSync(pending.abs, pending.orig, 'utf8'); console.log('\n⚠️ 收到信号 ⇒ 已还原 ' + path.relative(ROOT, pending.abs)); } catch (e) { /* 尽力而为 */ }
    pending = null;
  }
}
process.on('SIGTERM', () => { restorePending(); process.exit(3); });
process.on('SIGINT', () => { restorePending(); process.exit(3); });

for (const m of MUTS) {
  const abs = absOf(m.file);
  const orig = fs.readFileSync(abs, 'utf8');
  const before = sha(abs);
  console.log('\n--- ' + m.id + ' · ' + m.desc);
  console.log('    文件：' + m.file);
  if (orig.indexOf(m.from) < 0) {
    console.log('    ❌ EXIT2 替换串**未逐字命中** ⇒ 本变异作废（不许"改错地方还以为证明了"）');
    hard = 2;
    continue;
  }
  const occurrences = orig.split(m.from).length - 1;
  if (occurrences !== 1) {
    console.log('    ❌ EXIT2 替换串命中 ' + occurrences + ' 处（要求恰 1 处）⇒ 非单点变异');
    hard = 2;
    continue;
  }
  let r = null;
  try {
    pending = { abs, orig };
    fs.writeFileSync(abs, orig.split(m.from).join(m.to), 'utf8');
    const res = cp.spawnSync(process.execPath, [m.guard], { cwd: ROOT, encoding: 'utf8' });
    r = { code: res.status, out: String(res.stdout || '') + String(res.stderr || '') };
  } finally {
    fs.writeFileSync(abs, orig, 'utf8');
    pending = null;
  }
  const after = sha(abs);
  const restored = (after === before);
  const red = r.code !== 0;
  const expectHit = m.expect.every((re) => re.test(r.out));
  const alsoOk = (m.alsoGreen || []).every((re) => re.test(r.out));
  const res2 = cp.spawnSync(process.execPath, [m.guard], { cwd: ROOT, encoding: 'utf8' });
  const backGreen = res2.status === 0;
  const okAll = restored && red && expectHit && alsoOk && backGreen;
  if (!okAll) hard = Math.max(hard, 1);
  results.push({ id: m.id, restored, red, expectHit, alsoOk, backGreen, code: r.code });
  console.log('    守卫 RC=' + r.code + '（须非 0）· 点名腿命中=' + expectHit + ' · 保留腿仍绿=' + alsoOk
    + ' · 还原 sha 一致=' + restored + ' · 还原后复跑归绿=' + backGreen + '  ⇒ ' + (okAll ? 'PASS' : 'FAIL'));
  if (!expectHit) {
    console.log('    —— 守卫输出末尾 ——');
    console.log(r.out.split('\n').slice(-12).map((l) => '      ' + l).join('\n'));
  }
}

console.log('\n===== R299 变异回灌汇总 =====');
for (const x of results) {
  console.log((x.restored && x.red && x.expectHit && x.alsoOk && x.backGreen ? '✅ ' : '❌ ') + x.id
    + '  RC=' + x.code + ' 还原=' + x.restored + ' 点名=' + x.expectHit + ' 保留腿=' + x.alsoOk + ' 复绿=' + x.backGreen);
}
const good = results.filter((x) => x.restored && x.red && x.expectHit && x.alsoOk && x.backGreen).length;
console.log('变异 ' + good + '/' + MUTS.length + ' 全部：真红 + 点名腿命中 + 保留腿仍绿 + 逐字节还原 + 还原后归绿');
console.log('结论：两个守卫均**非恒真**，且守的是真实回归（D1 命名空间 / D3 返回不刷新 / D2 截断不告知 原样复现）');
process.exit(hard === 0 && good === MUTS.length ? 0 : (hard === 2 ? 2 : 1));
