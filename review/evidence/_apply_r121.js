// _r121_apply.js —— A2 文档面收口：09-24 M3 v1.1 · D12（M3 免费 3 → 5 张）全量落盘
// 纪律：每条替换必须「唯一命中」，任一失败或非唯一 ⇒ 整体不写盘（dry-run 也是全量先验）。
// 用法：node _r121_apply.js            → dry-run（只报告）
//       node _r121_apply.js --apply    → 落盘
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const APPLY = process.argv.includes('--apply');

const D = 'specs/dev-specs/delivery/';
const R = [
  // ============ F1 商业化方案_v1.4_融合版.md（= 额度唯一声明处）============
  ['specs/dev-specs/商业化方案_v1.4_融合版.md',
    '| ③ | M3 免费张数 | ✅ **5 张** |',
    '| ③ | M3 免费张数 | ✅ **5 张**（**M3 v1.1 · D12**，2026-09-24 由 **3 张**上调；v1.3 曾由 8 张改回 PRD 原值 3 张） |',
    'F1-① 拍板③ 补沿革（值已由前一轮改 5，本轮补溯源）'],
  ['specs/dev-specs/商业化方案_v1.4_融合版.md',
    '| **M3 菜品成本卡** | ⚠️ 限 **3 张**（按 `card_id` 去重，版本不计）',
    '| **M3 菜品成本卡** | ⚠️ 限 **5 张**（按 `card_id` 去重，版本不计）',
    'F1-② 权限矩阵·免费档 M3 3→5'],
  ['specs/dev-specs/商业化方案_v1.4_融合版.md',
    'M3 已有 3 张卡，点【新建成本卡】→ 弹窗',
    'M3 已有 5 张卡，点【新建成本卡】→ 弹窗',
    'F1-③ 付费弹窗触发场景 M3 3→5'],
  ['specs/dev-specs/商业化方案_v1.4_融合版.md',
    '；M3 限 3 张 + 禁止所有导出（含单张 PDF）',
    '；M3 限 5 张 + 禁止所有导出（含单张 PDF）',
    'F1-④ 上线清单勾选 M3 3→5'],
  ['specs/dev-specs/商业化方案_v1.4_融合版.md',
    '- 免费额度（M1 1 店 / M3 3 张）**不定时重置**',
    '- 免费额度（M1 1 店 / M3 5 张）**不定时重置**',
    'F1-⑤ 重置规则 M3 3→5'],

  // ============ F2 ★知识存储点（重启键）============
  ['specs/dev-specs/★知识存储点_2026-09-10.md',
    '7 函数 selftest 合计 **108** 项（含 R81 回归断言；旧值 83 已随 `saveCostCard` 29、`calcBom` 40 增长，round74 实跑核准）',
    '7 函数 selftest 合计 **114** 项（含 R81 回归断言；旧值 83 已随 `saveCostCard` 29→35、`calcBom` 40 增长，round74 实跑核准、round121 M3 v1.1 批次 A1 后复算）',
    'F2-① R108 声明处 108→114（saveCostCard 29→35）'],
  ['specs/dev-specs/★知识存储点_2026-09-10.md',
    '按 `user_id` 跨店共享——M1=1 账套 / **M3=3 卡 / 第 4 张触发**',
    '按 `shop_id` 统计（M3 v1.1 · 批次 A1 实测口径：`shop_cost_card` 无 `user_id` 字段、只有 `created_by`；免费档仅 1 账套 ⇒ 按店 ≡ 按用户）——M1=1 账套 / **M3=5 卡 / 第 6 张触发**',
    'F2-② 配额维度 (user_id→shop_id) + M3 3→5 卡/第6张'],
  ['specs/dev-specs/★知识存储点_2026-09-10.md',
    '已回退至 v1.4 终稿的 **3 张**（重启键 §7.1③/§7.2 为准）。',
    '已回退至 v1.4 终稿的 **3 张**；**2026-09-24 再变更：M3 v1.1 · D12 正式上调为 5 张／第 6 张触发**（配置值，权威源 `feature_permissions.plan_free.limits`）—— §7.1③/§7.2 已同步。',
    'F2-③ §5.5 决策4 尾巴补 09-24 变更'],
  ['specs/dev-specs/★知识存储点_2026-09-10.md',
    '（iOS 支付通道实测降级 / 私域手动退款 / 回调幂等 / 过期重购起点 / 软删不占配额 / 发票凭证），核心定价不变',
    '（iOS 支付通道实测降级 / 私域手动退款 / 回调幂等 / 过期重购起点 / 软删不占配额 / 发票凭证），核心定价不变 → **2026-09-24 · M3 v1.1（D12）**：M3 免费 **3 → 5 张**（额度**配置化**至 `feature_permissions.plan_free.limits`，写侧由 `saveCostCard` 真拦截），其余定价不变',
    'F2-④ §7 演进链补 M3 v1.1 D12'],
  ['specs/dev-specs/★知识存储点_2026-09-10.md',
    '| ③ | M3 免费张数 | ✅ **3 张**（v1.3 由 8 张改回 PRD 原值） |',
    '| ③ | M3 免费张数 | ✅ **5 张**（**2026-09-24 · M3 v1.1 · D12** 由 3 张上调；v1.3 曾由 8 张改回 PRD 原值 3 张） |',
    'F2-⑤ §7.1 拍板③ 3→5（带溯源）'],
  ['specs/dev-specs/★知识存储点_2026-09-10.md',
    '｜M3 限 **3 张**＋**导出全禁（含单张 PDF，仅付费解锁）**',
    '｜M3 限 **5 张**＋**导出全禁（含单张 PDF，仅付费解锁）**',
    'F2-⑥ §7.2 权限矩阵 3→5'],
  ['specs/dev-specs/★知识存储点_2026-09-10.md',
    '已**回退至 3 张/第4张**（批次 5 §2.1.1 + 重启键 §5.5 决策4 同步）。',
    '已**回退至 3 张/第4张**（批次 5 §2.1.1 + 重启键 §5.5 决策4 同步）。→ **2026-09-24 再变更**：M3 v1.1 · D12 正式将 M3 免费由 3 张/第4张 **上调为 5 张/第6张触发**，并**配置化**至 `feature_permissions.plan_free.limits`（权威值以该配置为准）。',
    'F2-⑦ §附 历史修正条补 09-24 变更'],

  // ============ F3 门禁 A–L（specs/prototype/check_error_codes.js）============
  ['specs/dev-specs/prototype/check_error_codes.js',
    String.raw`{ re: /免费\s*≤\s*3/, tip: '仅 M3 免费 3 张；M2 不限套，不得写「免费≤3」' },`,
    String.raw`{ re: /免费\s*≤\s*3/, tip: 'M3 免费 = 5 张（配置下发）；M2 不限套，不得写「免费≤3」' },`,
    'F3-① D 类 tip 3→5（禁「免费≤3」规则本身保留）'],
  ['specs/dev-specs/prototype/check_error_codes.js',
    String.raw`{ re: /M3[^。；\n]{0,14}8\s*张/, tip: 'M3 应为 3 张，8 张是 v1.1 过期值' },`,
    String.raw`{ re: /M3[^。；\n]{0,14}8\s*张/, tip: 'M3 免费 = 5 张（配置）；8 张是 v1.1 过期值' },`,
    'F3-② D 类 tip 3→5（禁「M3…8 张」规则保留）'],
  ['specs/dev-specs/prototype/check_error_codes.js',
    '（如 core/13「M1=1 账套、M3=3 张、M2 不限套」），漏了它混排行就不会被切分。',
    '（如 core/13「M1=1 账套、M3=5 张、M2 不限套」），漏了它混排行就不会被切分。',
    'F3-③ 注释举例 3→5'],
  ['specs/dev-specs/prototype/check_error_codes.js',
    "console.log('  · D 类（配额旧值）   → 改回 v1.4 口径：M1=1 账套 / M3=3 张 / M2 不限套；导出全禁');",
    "console.log('  · D 类（配额旧值）   → 改回现行口径：M1=1 账套 / M3=5 张（2026-09-24 起配置下发）/ M2 不限套；导出全禁');",
    'F3-④ 结语口径 3→5'],

  // ============ F4/F5 terms.js 双副本 ============
  ['miniprogram/i18n/terms.js',
    "    addCostCard: '+ 新增菜品', // M3，免费限 3 张，第 4 张触发 paywall.saveLimit",
    "    addCostCard: '+ 新增菜品', // M3，免费张数由配置下发（plan_free.limits），超限触发 paywall.saveLimit",
    'F4-① 按钮注释去硬编码数字'],
  ['miniprogram/i18n/terms.js',
    "'免费版可建 1 家店铺 / 3 个菜品。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。'",
    "'免费版可建 1 家店铺、菜品数量有限。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。'",
    'F4-② 付费墙正文去「3 个菜品」（用户可见文案）'],
  ['specs/dev-specs/i18n/terms.js',
    "    addCostCard: '+ 新增菜品', // M3，免费限 3 张，第 4 张触发 paywall.saveLimit",
    "    addCostCard: '+ 新增菜品', // M3，免费张数由配置下发（plan_free.limits），超限触发 paywall.saveLimit",
    'F5-① 副本·按钮注释'],
  ['specs/dev-specs/i18n/terms.js',
    "'免费版可建 1 家店铺 / 3 个菜品。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。'",
    "'免费版可建 1 家店铺、菜品数量有限。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。'",
    'F5-② 副本·付费墙正文'],

  // ============ F6 批次5 投喂包 ============
  [D + '批次5_提示词_可直接复制.txt',
    '| **保存超限**（M1 第 2 家店 / M3 第 4 张卡，即超出 3 张免费） | ✅ 触发 |',
    '| **保存超限**（M1 第 2 家店 / M3 第 6 张卡，即超出 5 张免费） | ✅ 触发 |',
    'F6-① 触发场景'],
  [D + '批次5_提示词_可直接复制.txt',
    'M3 = 每用户 **3 张免费成本卡**（第 4 张触发）；',
    'M3 = 每用户 **5 张免费成本卡**（第 6 张触发）；',
    'F6-② 具体额度'],
  [D + '批次5_提示词_可直接复制.txt',
    '- **与硬上限区分**：免费额度（1/3/3）是付费墙阈值；',
    '- **与硬上限区分**：免费额度（M1=1 / M3=5，M2 不限）是付费墙阈值；',
    'F6-③ 硬上限区分·消除含义不明的 1/3/3'],
  [D + '批次5_提示词_可直接复制.txt',
    '正文「免费版可建 1 家店铺 / 3 张成本卡。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。」',
    '正文「免费版可建 1 家店铺、菜品数量有限。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。」',
    'F6-④ 弹窗正文文案'],

  // ============ F7 8 批自包含投喂包 ============
  [D + 'inscode喂投包_8批_自包含完整版.md',
    '| **保存超限**（M1 第 2 家店 / M3 第 4 张卡，即超出 3 张免费） | ✅ 触发 |',
    '| **保存超限**（M1 第 2 家店 / M3 第 6 张卡，即超出 5 张免费） | ✅ 触发 |',
    'F7-① 触发场景'],
  [D + 'inscode喂投包_8批_自包含完整版.md',
    'M3 = 每用户 **3 张免费成本卡**（第 4 张触发）；',
    'M3 = 每用户 **5 张免费成本卡**（第 6 张触发）；',
    'F7-② 具体额度'],
  [D + 'inscode喂投包_8批_自包含完整版.md',
    '- **与硬上限区分**：免费额度（1/3/3）是付费墙阈值；',
    '- **与硬上限区分**：免费额度（M1=1 / M3=5，M2 不限）是付费墙阈值；',
    'F7-③ 硬上限区分'],
  [D + 'inscode喂投包_8批_自包含完整版.md',
    '正文「免费版可建 1 家店铺 / 3 张成本卡。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。」',
    '正文「免费版可建 1 家店铺、菜品数量有限。开通真实利润后不限数量，还能用库存倒轧算真实消耗，结果更准。」',
    'F7-④ 弹窗正文文案'],

  // ============ F8 verify_all.js 套件描述注释 ============
  ['verify_all.js',
    '同族病第 10 例：免费/硬上限额度是**收钱口径**，单源 = checkQuota/service.js 的',
    '同族病第 10 例：免费/硬上限额度是**收钱口径**，单源 = initDb/collections.js 的',
    'F8-① R102 描述·单源改配置种子'],
  ['verify_all.js',
    'FREE_LIMIT{shop:1,cost_card:3} / HARD_LIMIT{shop:200,cost_card:2000}，',
    "SEED_FEATURES 中 plan_id='plan_free' 行 limits{shop:1,cost_card:5,hard_shop:200,hard_card:2000}（round121 起**配置化**），",
    'F8-② R102 描述·额度值'],
  ['verify_all.js',
    'v1.3 已改 3），而**同文件** :55/:64/:117 三处写 3、代码也是 3 ⇒ 上线前核对清单自相矛盾。',
    'v1.3 改 3、2026-09-24 M3 v1.1 · D12 再调 5），而**同文件** :55/:64/:117 三处已同步 5 ⇒ 上线前核对清单与配置不一致即红。',
    'F8-③ R102 描述·沿革'],
  ['verify_all.js',
    '裸扫「N 张」必误杀（OBSOLETE 历史版、演进链「8→3」、「第 4 张触发」序号、core/12 的云资源「硬上限」）',
    '裸扫「N 张」必误杀（OBSOLETE 历史版、演进链「8→3→5」、「第 6 张触发」序号、core/12 的云资源「硬上限」）',
    'F8-④ R102 描述·命中示例'],
  ['verify_all.js',
    '两个互不引用的硬编码点（checkQuota::FREE_LIMIT.shop 与 getShopList::FREE_SHOP_LIMIT），',
    '两个互不引用的硬编码点（checkQuota::FREE_LIMIT.shop 与 getShopList::FREE_SHOP_LIMIT）；批次 A1 配置化后两者都读 feature_permissions.plan_free.limits ⇒ 旧判据退化为恒真，',
    'F8-⑤ R117 描述·病因'],
  ['verify_all.js',
    'R102 的 SRC_REL 写死 checkQuota ⇒ 第二点零守卫 ⇒ 改一侧门禁全绿而展示与拦截分叉。',
    '故 R117 改为「三处消费者必须引用同一配置键」+ 反向断言「不得再现额度字面量」（M3.22#9）。',
    'F8-⑥ R117 描述·新判据'],

  // ============ F9 core/13 裁决登记（A2 #11）============
  ['specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md',
    '## 🟡 待裁决 · 写码基线 M3.7 的配额实现指令与权威单源不一致（round79 防回潮扫描发现）',
    '## ✅ 已裁决 · 写码基线 M3.7 的配额实现指令与权威单源不一致（round79 发现 / 2026-09-24 round118 拍板 · round121 落地）',
    'F9-① 标题 待裁决→已裁决'],
  ['specs/dev-specs/core/13_上线前查缺补漏_决策与待办总览.md',
    '**为何本轮不代修**：这是「保留 Service 层常量、只改基线措辞」与「给 `subscription_plan` 加额度字段并改造\n`checkQuota`」两条路线的取舍，属**口径裁决**，按团队约定不代选方案。\n\n**当前是否已有错误数据**：**没有**。额度计数由 `check_quota_limits.js` 守在 `checkQuota` 常量上，\n任一侧单方面改动都会被当场判红 ⇒ 不会静默算错。真实代价是**写码方照基线改造时白费一轮并与守卫对撞**。\n\n**待李老师二选一**：\n① 以 `checkQuota` 常量为准 ⇒ 只改基线措辞（改动面最小）；\n② 走配置化 ⇒ 先给 `subscription_plan` 加额度字段，再同步改 `checkQuota`、`check_quota_limits.js`、\n商业化权威终稿与本基线四处。',
    '> ⚠️ **以下为裁决前记录，保留追溯**。\n\n**当时为何未代修**：这是「保留 Service 层常量、只改基线措辞」与「加额度配置字段并改造 `checkQuota`」\n两条路线的取舍，属**口径裁决**。\n\n**当时是否已有错误数据**：**没有数值错误**；但 round118 补的两维新证据表明**写侧零拦截**\n（配额只提示不拦截，绕过前端即可无限建卡）—— 那才是「付费墙失效」的直接原因。\n\n**✅ 已裁决（2026-09-24 · round118 拍板 / round121 落地）→ 路线 ②「配置化」**，\n但**落点不是 `subscription_plan`，而是 `feature_permissions.plan_free.limits`**。\n原因：`subscription_plan` 是**付费套餐价格表**，`payCreateOrder` 按 `plan_id` 读它下单 ⇒ 塞免费档会让免费档变成可下单的付费档。\n详见 `specs/dev-specs/core/开发规范v1.1_ModuleM3增量_套餐外卖多规格与留存对照.md` §M3.22 二。\n\n- **12 项改造清单 + 额度取值**：见该规范 §M3.22 三/四 —— **M3 免费 3 → 5 张**（配置值）、M1 账套 1（不变）、硬上限 200 / 2000（不变）。\n- **守卫改造**：R102 `tools/check_quota_limits.js` 单源迁至配置种子 + **反向断言**（额度字面量再现即判红）；R117 `tools/check_free_shop_limit.js` 改为「引用同一配置键 + 反向断言」。\n- **落地证据**：批次 A1 已投喂并独立验收（round121）；全量门禁见 `review/evidence/gate_r121.txt`。\n- ⚠️ **本基线（`开发规范v1.0_ModuleM3_菜品成本卡.md`）本体一字不动**；其 M3.7 措辞以 §M3.22 二的**勘误替代**为准（`subscription_plan` → `feature_permissions.plan_free.limits`）。',
    'F9-② 裁决登记正文'],
];

// —— 执行（先全量验，再全量写）——
function eolOf(t) { return t.includes('\r\n') ? '\r\n' : '\n'; }
const plan = [];
let bad = 0;
for (const [rel, oldRaw, newRaw, label] of R) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.log(`❌ [${label}] 文件不存在：${rel}`); bad++; continue; }
  const t = fs.readFileSync(abs, 'utf8');
  const eol = eolOf(t);
  const oldS = oldRaw.split('\n').join(eol);
  const newS = newRaw.split('\n').join(eol);
  const n = t.split(oldS).length - 1;
  if (n !== 1) { console.log(`❌ [${label}] 命中 ${n} 次（要求恰 1）：${rel}`); bad++; continue; }
  const i = t.indexOf(oldS);
  plan.push({ rel, abs, oldS, newS, label, i });
  console.log(`✅ [${label}] ${rel}  @${i}`);
}
if (bad) { console.log(`\n===== 预检失败 ${bad} 条 ⇒ 整体不写盘 =====`); process.exit(1); }
console.log(`\n===== 预检通过 ${plan.length} 条 =====`);
if (!APPLY) { console.log('（dry-run；加 --apply 落盘）'); process.exit(0); }

// 按文件分组、**同文件内按位置倒序**写入（避免偏移互相影响）
const byFile = new Map();
for (const p of plan) { if (!byFile.has(p.abs)) byFile.set(p.abs, []); byFile.get(p.abs).push(p); }
const written = [];
for (const [abs, list] of byFile) {
  let t = fs.readFileSync(abs, 'utf8');
  list.sort((a, b) => b.i - a.i);           // 倒序（串行，防偏移）
  for (const p of list) {
    const again = t.split(p.oldS).length - 1;
    if (again !== 1) { console.log(`❌ 落盘二次校验失败 [${p.label}] 命中 ${again}`); process.exit(2); }
    t = t.replace(p.oldS, p.newS);
  }
  fs.writeFileSync(abs, t, 'utf8');
  written.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
  console.log(`💾 已写 ${written[written.length - 1]}（${list.length} 处）`);
}
console.log(`\n===== 落盘完成：${written.length} 个文件 / ${plan.length} 处 =====`);
