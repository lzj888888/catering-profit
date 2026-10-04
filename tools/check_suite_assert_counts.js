/**
 * check_suite_assert_counts.js —— 套件断言数口径守卫（R107，round73）
 *
 * 背景（同族病第 15 例，与 round69 第 13 例「验收自检通过数 48 vs 41」同型、且是它的**泛化**）：
 *   仓内多处 .md 把各套件的断言数写成**创建时**的值，而这些套件此后一直在加断言：
 *     · `tools/selftest_ui_fix.js`    文档 27  → 实跑 **31**
 *     · `tools/selftest_batch8b.js`   文档 48  → 实跑 **104**
 *     · `tools/selftest_batch8c.js`   文档 56  → 实跑 **57**
 *   （其余 `selftest_ad_gates` 24 / `check_ios_pay` 6 / `check_env_ready` 11 与文档一致 ⇒ 未漂移）
 *   round69 的 R105 只守住了 `verify_seed_data` **一个**脚本，其余套件仍是零守卫的人工面。
 *
 * 后果（为什么必须守，与第 13 例同）：断言数是**下界** —— 写成 27 而实跑 31 时，
 *   删掉 4 条断言文档仍说「27 条符合预期」 ⇒ 4 条断言静默丢失而门禁照旧判绿。
 *
 * 判据（四条腿）：
 *   ① 实算单源：**实跑**每个套件脚本并解析其 stdout 的 `N 通过 / M 失败`（不抄字面量，fail-closed，rc≠0 即红）。
 *   ② 唯一声明处：`★知识存储点` 内的语义标记 `套件断言数口径（唯一声明处）`，一行列出 `key`=N。
 *   ③ 声明 ≡ 实跑：逐个 key 比对（缺 key / 多 key / 值不符皆红）。
 *   ④ 前提守卫（证明本守卫不是恒真）：实跑集合非空且 ≥6 个；历史面确有旧值命中（排除面没打错）。
 *
 * ⚠️ 已知坑的对应处理：
 *   · 坑⑭/⑯ 裸扫数字必误杀：当前态引用面只作**弱面**打印 ⚠️ 明示、不判红；硬判据只认唯一声明处。
 *   · 坑⑱ `git ls-files` 只扫 index：扫描面一律**工作树递归**，不用 git。
 *   · 坑⑮ 标记词自指：声明行只允许 1 处（A7 单源不扩散），且扫描面排除 `tools/`（守卫自身）。
 *   · CJK 路径：重启键文件名以 `★知识存储点` 前缀在 `specs/dev-specs/` 下实找，不硬编码全名。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const DECL_MARK = '套件断言数口径（唯一声明处）';
const SPEC_DIR = path.join(ROOT, 'specs', 'dev-specs');

// 受守套件：全部来自 verify_all.js 的 SUITES，实跑即取真值
const CASES = [
  { key: 'selftest_ui_fix', rel: 'tools/selftest_ui_fix.js' },
  { key: 'selftest_ad_gates', rel: 'tools/selftest_ad_gates.js' },
  { key: 'selftest_batch8b', rel: 'tools/selftest_batch8b.js' },
  { key: 'selftest_batch8c', rel: 'tools/selftest_batch8c.js' },
  { key: 'check_ios_pay', rel: 'tools/check_ios_pay.js' },
  { key: 'check_env_ready', rel: 'tools/check_env_ready.js' },
  // R85 扩面（round85）：外卖段自测原不在受守集合内 ⇒ 本轮实测 60 条而文档写 43 条、零守卫；
  //   与 round73 立本守卫的根因同族（文档写低 = 下界保护失效）⇒ 纳入。
  { key: 'selftest_r85', rel: 'tools/selftest_r85.js' },
  // R115 扩面（round86）：主题色单源守卫同批纳入 —— 该守卫初版 A3-③ 即被变异 M3 判出**恒真断言**
  //   （声称「防 EXTS 被改小」而实现恒真）⇒ 断言数必须受守，否则「改小扫描面/删断言」静默通过。
  { key: 'check_theme_color', rel: 'tools/check_theme_color.js' },
  // 坑⑱ 元守卫（round87）：SUITES 覆盖守卫自身**不在受守集合内** ⇒ 它 round86 断言数 8→10 无人校验，
  //   而它恰恰是「防判据漏挂 SUITES」的元守卫（第 4 例）；删它一条断言就少守一类漏挂 ⇒ 纳入下界保护。
  { key: 'check_suite_coverage', rel: 'tools/check_suite_coverage.js' },
  // R119 扩面（round92）：金额框同行守卫同批纳入 —— 它守「金额框被同层元素挤窄」这个已复发三次的布局病，
  //   而 A3 的下界护栏与 A4 的正负样本正是它的「非恒真」证明；断言数不受守则改小下界同样无人知。
  { key: 'check_amount_input_row', rel: 'tools/check_amount_input_row.js' },
  // R120 扩面（round93）：粘贴形态用例表守卫同批纳入 —— 它的 A0 表宽护栏（用例条数/B 组 ≥4/C 组 ≥3）
  //   与 A6 前提证明正是「非恒真」的凭据；断言数不受守则「删掉 A0 一道护栏 + 从表里删 5 条用例」
  //   就等于把守卫悄悄改小，而门禁照旧判绿（与 round73 立本守卫的根因同族）。
  { key: 'check_takeaway_paste_cases', rel: 'tools/check_takeaway_paste_cases.js' },
  // R121 扩面（round97）：费用项清单守卫同批纳入 —— 它的 E5 下界护栏（总项数 ≥20 / 每类 ≥2）与
  //   E6 前提证明正是「非恒真」的凭据；断言数不受守则「删掉下界 + 删一处副本比对」同样静默通过。
  { key: 'check_expense_item_seed', rel: 'tools/check_expense_item_seed.js' },
  // R123 扩面（round100）：WXML 结构完整性守卫同批纳入 —— 它是**唯一有两个独立判据**的守卫
  //   （A 裸属性行 / B 标签配平），删掉其中任一条 ⇒ 实跑通过数 2→1，**仍 > 0**
  //   ⇒ A0-② 的「通过数为 0」下界抓不到，只有本守卫的 A2「声明 ≡ 实跑」能发现。
  //   （对照：R122 `check_js_syntax` 只有单一判据，删掉即 pass=0、A0-② 当场转红，故不必另立声明。）
  { key: 'check_wxml_structure', rel: 'tools/check_wxml_structure.js' },
  // R125 扩面（round109）：流程出口与折叠守卫同批纳入 —— 它的 S5 断言数下界（≥20）与 S2 四组
  //   正负样本互证正是「非恒真」的凭据；断言数不受守则「删掉两组正负样本」就等于把守卫悄悄改小
  //   （判据仍全绿而证明力归零），与 round73 立本守卫的根因同族。
  { key: 'check_flow_entry_and_fold', rel: 'tools/check_flow_entry_and_fold.js' },
  // R126 扩面（round110）：餐饮指标参考库口径守卫同批纳入 —— 它的 D-① 比较器 5 组正负样本互证、
  //   D-② 真实数据变异互证、D-③ 逐项比较对数下界、D-⑤ 断言数下界正是「非恒真」的凭据；
  //   而 A/B 两组是本库**核心权威值**的双向与三方比对 —— 断言数不受守则「删掉一个城市的系数比对
  //   或删掉一条红线三方腿」就等于把守卫悄悄改小（判据仍全绿而证明力归零），与 round73 同族。
  { key: 'check_indicator_ref', rel: 'tools/check_indicator_ref.js' },
  // R127 扩面（round111）：对外文案面「零食材成本率」守卫同批纳入 —— 它的 D-① 剥注释器 5 例、
  //   D-② 词族 5 例正负样本互证与 D-③~D-⑤ 三道下界正是「非恒真」的凭据；断言数不受守则
  //   「删掉 5 例正负样本」就等于把守卫悄悄改小（判据仍全绿而证明力归零），与 round73 同族。
  { key: 'check_m2_no_cost_rate', rel: 'tools/check_m2_no_cost_rate.js' },
  // round114 扩面：**云函数 selftest 的断言数此前零守卫**（`check_fn_selftest_counts.js` 只守
  //   POC2 七函数，calcSandbox 是后加的批次 4，不在其集合内）—— round113 它 46→53、
  //   round114 又 53→66，两次都无人校验。它满足「非恒真」条件：66 条里删掉一批仍 > 0 ⇒
  //   A0-② 的「通过数为 0」下界抓不到，只有本守卫的 A2「声明 ≡ 实跑」能发现。
  { key: 'calcSandbox_selftest', rel: 'cloudfunctions/calcSandbox/selftest.js' },
  // R128 扩面（round114）：M2「参考值不预填」守卫同批纳入 —— 它的 D 段四组正负样本互证
  //   （剥注释器 / 判别器 / bodyOf 锚定义不锚调用 / value 提取器）与 E 段断言数下界正是
  //   「非恒真」的凭据；断言数不受守则「删掉两组正负样本」就等于把守卫悄悄改小
  //   （判据仍全绿而证明力归零），与 round73 立本守卫的根因同族。
  { key: 'check_m2_ref_not_prefill', rel: 'tools/check_m2_ref_not_prefill.js' },
  // R129 扩面（round115）：M1「台账细项 → 指标归属」守卫同批纳入 —— 它的 D 段 8 组正负样本互证
  //   （引号感知剥注释器 / 硬编码百分比判别器 / 细项名漏名比对器）与 E 段断言数下界正是「非恒真」的凭据；
  //   断言数不受守则「删掉几组样本 + 调低下界」就等于把守卫惄惄改小（判据仍全绿而证明力归零）。
  { key: 'check_m1_indicator_view', rel: 'tools/check_m1_indicator_view.js' },
  { key: 'check_doc_id_write', rel: 'tools/check_doc_id_write.js' },
  // R131 扩面（round129）：M3 引擎副本等价守卫纳入下界保护 —— 它的 D 段四条反恒真
  //   （输入敏感 ×2 / 变体偏移 1 分必须判不等 / mode 非法三副本均抛错）正是「非恒真」的凭据；
  //   断言数不受守则「删掉反恒真段 + 调低下界」就等于把守卫悄悄改小（判据仍全绿而证明力归零）。
  { key: 'check_m3_engine_parity', rel: 'tools/check_m3_engine_parity.js' },
  { key: 'check_modal_button_len', rel: 'tools/check_modal_button_len.js' },
  { key: 'check_dish_category_free', rel: 'tools/check_dish_category_free.js' },
  { key: 'check_unit_convert', rel: 'tools/check_unit_convert.js' },   // 17 条（含 C2b 语义等价影子）
  // R150 扩面（round150）：多规格派生层守卫同批纳入 —— 它的 L3 三条腿恒等（全 1 / 压力样本 / 空系数表）、
  //   A-e 半份五项锚点与 C1~C4 反恒真正是「非恒真」的凭据；断言数不受守则「删掉压力样本腿 +
  //   删掉一条影子」就等于把守卫悄悄改小（判据仍全绿而证明力归零），与 round73 立本守卫的根因同族。
  { key: 'check_spec_derive', rel: 'tools/check_spec_derive.js' },     // 24 条（含 C1~C4 影子）
  // R151 扩面（round151）：单位池 / 计量族 / 单价单位守卫同批纳入 —— 它的 L3 单源自洽
  //   （两池逐项同源 / 倍率表全覆盖 / 族表全覆盖）与 C1~C6 反恒真正是「非恒真」的凭据；
  //   断言数不受守则「删掉一条影子 + 调低下界」就等于把守卫悄悄改小（判据仍全绿而证明力归零）。
  { key: 'check_unit_family', rel: 'tools/check_unit_family.js' },     // 75 条（含 C1~C37 影子；round152 加 ⑩~⑬ 与 C7~C12；round153 加 ⑭~⑳ 与 C13~C23；round155 加 ㉑~㉕/整包口径 与 C24~C37）
  { key: 'check_list_query_limit', rel: 'tools/check_list_query_limit.js' }, // 22 条（R154：L1~L5 + S1~S3 + C1~C7 反恒真含替身正负样本；R157 加 L6/L7 + C8~C11：listAll 必须真的分页取全 + 调用点不得回退 list）
  { key: 'check_list_ux', rel: 'tools/check_list_ux.js' },               // 32 条（R156：L1~L6 + S1~S3 + C1~C6 反恒真影子样本）
  { key: 'check_index_field_alignment', rel: 'tools/check_index_field_alignment.js' }, // 11 条（R157：L1 化石索引 + L2 锚点对齐 + L3 字段真在用 + S1~S3 + C1~C3 反恒真）
  { key: 'check_snapshot_fields', rel: 'tools/check_snapshot_fields.js' }, // 16 条（R144：L1 读侧全集 + L2 写侧全集 + L3 两读侧集合≡ + L4 fail-soft + L5 Controller + L6 validate 区间 + S1~S2 + C1~C3 反恒真）
  { key: 'check_paywall_coverage', rel: 'tools/check_paywall_coverage.js' }, // 13 条（R159：L1 三单源解析 + L2 能力⊆放行 + L3 放行有文案 + L4 四字段非空 + L5 影子正负 + L6 云函数双向 + L7 自失效护栏）
  // round181c 扩面：M3.16 套餐（引用型卡）守卫同批纳入 —— 它的 A-a/A-b/A-c 三锚点（成本 1275 分 /
  //   锁子卡版本 1275→1508 / 禁嵌套与版本无效）与「把子卡成本当 net_unit_cost 喂同一个 `calcCostCard`、
  //   引擎一字不改」的入参变换证明，正是本守卫要求的「非恒真」凭据；而 17 条断言删掉一批仍 > 0
  //   ⇒ A0-② 的「通过数为 0」下界抓不到，只有 A2「声明 ≡ 实跑」能发现 ⇒ 断言数必须受守（与 round73 同族）。
  { key: 'selftest_m3_combo', rel: 'tools/selftest_m3_combo.js' },
  // round181g 扩面：M3.20 词库/模板（批次 B 收尾）守卫同批纳入 —— 与 m3-combo 同族理由：
  //   L-a~L-g 七组锚点（规模 67 / 必含 8 条 / 别名命中 / 绝不自动替换 / 单位池 ∈ PURCHASE_UNITS /
  //   模板 20 道无价格 / applyTemplate 只返回行名·用量·单位）是「非恒真」凭据；而 21 条删一批仍 > 0
  //   ⇒ A0-② 的「通过数为 0」下界抓不到，只有 A2「声明 ≡ 实跑」能发现。
  { key: 'selftest_m3_lexicon', rel: 'tools/selftest_m3_lexicon.js' }, // 21 条（M3.20：L-a~L-g）
  // round181h 扩面：M3.17 外卖单均试算（v1.2 批次 D）守卫同批纳入 —— 与 m3-combo / m3-lexicon 同族理由：
  //   T-a~T-g 七组锚点（佣金基数不含打包费 / 固定佣金保底不生效 / 到手≠总额双口径 / 反算挂牌价 /
  //   输出隔离 M1 月度字段）是「非恒真」凭据；而 21 条删掉一批仍 > 0
  //   ⇒ A0-② 的「通过数为 0」下界抓不到，只有 A2「声明 ≡ 实跑」能发现。
  { key: 'selftest_m3_takeaway', rel: 'tools/selftest_m3_takeaway.js' }, // 21 条（M3.17：T-a~T-g）
  { key: 'selftest_m3_impact', rel: 'tools/selftest_m3_impact.js' }, // 17 条（M3.19：C-a/C-a2/C-b/dry-run）
  { key: 'selftest_m3_recon', rel: 'tools/selftest_m3_recon.js' }, // 16 条（M3.21：D 锚点 + 闸门）
  { key: 'selftest_bill_parse', rel: 'tools/selftest_bill_parse.js' }, // 15 条（批次 F：平台判定 + 两锚点）
  { key: 'selftest_grade_gate', rel: 'tools/selftest_grade_gate.js' }, // 11 条（批次 F：甲级三门）
  // round181p 扩面：打包体积 / ignore 规则守卫同批纳入 —— 它的 S 段三道自失效护栏（扫描面非退化 / 关键入口在包内 / 匹配器四类正负样本互证）与 P-②「预算常量 < 微信硬上限」正是「非恒真」凭据；而 11 条删掉一批仍 > 0 ⇒ A0-② 的「通过数为 0」下界抓不到，只有 A2「声明 ≡ 实跑」能发现（与 round73 立本守卫的根因同族）。
  { key: 'check_pack_size', rel: 'tools/check_pack_size.js' }, // 11 条（R182：S1~S3 + P-①~③ + G-①~④）
  { key: 'selftest_m3_per100g', rel: 'tools/selftest_m3_per100g.js' }, // 7 条（M3.31：A-d 锚点 975/876 + 反例 + findPreset 键名严格）
  { key: 'check_spec_per100g_identity', rel: 'tools/check_spec_per100g_identity.js' }, // 6 条（R141：P1 存在 + P2 全1 + P3 反恒真 + P4 unit_label + 反向×2）
  // R194 扩面：鉴权返回形状守卫同批纳入 —— 它的 G1/G6 两条扫描面下界护栏正是「非恒真」凭据；
  //   断言数不受守则「把 20 处调用点判据改回 owner.code / 删掉 G2 分支遍历」同样静默通过。
  { key: 'check_auth_guard_shape', rel: 'tools/check_auth_guard_shape.js' }, // 17 条（R194：G1 扫描面非退化 / G2 分支带 error / G3 无 ok()·fail() / G4 派生同形 / G5 锚点在场 / G6 调用点形状）
  { key: 'check_tabbar', rel: 'tools/check_tabbar.js' },
  { key: 'check_material_batch', rel: 'tools/check_material_batch.js' }, // 23 条（R204：A 解析行为 9 / B 页面接线 8 / C 护栏 4 / D 正负样本 2）
  { key: 'check_home_ui_v3', rel: 'tools/check_home_ui_v3.js' }, // 29 条（R207：S 护栏 5 / A 头卡 10 / B 口径 4 / C 模块卡与入口保全 7 / D 全局单源 3）
  { key: 'check_shop_lifecycle', rel: 'tools/check_shop_lifecycle.js' }, // 29 条（R208：S 护栏 4 / A 配额语义 5（实跑 decideDelete）/ B 删空不死锁 6 / C 入口不藏 10 / D 文案对齐 4）
];

const HIST = ['原写', '此前', '曾写', '旧值', '历史', 'round', '轮次', '演进'];
const NEAR = 120;

let pass = 0, fail = 0;
const ok = (id, msg) => { pass++; console.log('  ✅ ' + id + ' ' + msg); };
const no = (id, msg) => { fail++; console.log('  ❌ ' + id + ' ' + msg); };
const section = (t) => console.log('\n===== ' + t + ' =====');
const readAbs = (abs) => fs.readFileSync(abs, 'utf8');

/** 工作树递归扫 .md（坑⑱：不用 git ls-files） */
function scanMd() {
  const out = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'tools', 'cloudfunctions', 'miniprogram'].includes(e.name)) continue;
        walk(abs);
      } else if (e.name.endsWith('.md')) out.push(abs);
    }
  };
  walk(ROOT);
  return out;
}

/** 找重启键（CJK 文件名，按前缀实找） */
function findRestartDoc() {
  let ents = [];
  try { ents = fs.readdirSync(SPEC_DIR); } catch (e) { return null; }
  const hit = ents.filter((n) => n.startsWith('★知识存储点'));
  return hit.length ? path.join(SPEC_DIR, hit[0]) : null;
}

// ============ A0 实算单源：真跑每个套件 ============
section('A0 实算单源（逐个真跑套件脚本，不抄字面量）');
const actual = {};
let runErr = 0;
for (const c of CASES) {
  try {
    const out = execFileSync(NODE, [path.join(ROOT, c.rel)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = /(\d+)\s*通过\s*\/\s*(\d+)\s*失败/.exec(out);
    if (!m) { no('A0-' + c.key, `stdout 里解析不到「N 通过 / M 失败」(${c.rel})`); runErr++; continue; }
    actual[c.key] = Number(m[1]);
    console.log(`  · ${c.rel} → ${actual[c.key]} 通过`);
  } catch (e) {
    no('A0-' + c.key, `实跑失败 rc≠0（${c.rel}）`); runErr++;
  }
}
if (runErr === 0) ok('A0-①', `${CASES.length} 个套件全部实跑成功（rc=0）且解析到通过数`);
if (Object.values(actual).every((v) => v > 0)) ok('A0-②', '各套件通过数均 > 0（下界非空）');
else no('A0-②', '存在通过数为 0 的套件 ⇒ 实算不可信');

// ============ A1 唯一声明处 ============
section('A1 唯一声明处（重启键内的语义标记行）');
const restartAbs = findRestartDoc();
if (!restartAbs) { no('A1-①', '未找到 ★知识存储点_*.md（CJK 路径解析失败）'); }
const restartTxt = restartAbs ? readAbs(restartAbs) : '';
const declLines = restartTxt.split(/\r?\n/).filter((l) => l.includes(DECL_MARK));
if (restartAbs) {
  if (declLines.length === 1) ok('A1-①', `唯一声明处存在且仅 1 行（${path.basename(restartAbs)}）`);
  else no('A1-①', `声明行数为 ${declLines.length}（须恰为 1）`);
}

// 解析 `key`=N
const decl = {};
if (declLines.length === 1) {
  const re = /`?([A-Za-z0-9_]+)`?\s*=\s*(\d+)/g;
  let m;
  while ((m = re.exec(declLines[0])) !== null) decl[m[1]] = Number(m[2]);
}
section('A2 声明 ≡ 实跑（逐 key 比对）');
for (const c of CASES) {
  if (!(c.key in decl)) { no('A2-' + c.key, `声明行缺少 \`${c.key}\` 的断言数`); continue; }
  if (decl[c.key] === actual[c.key]) ok('A2-' + c.key, `声明 ${decl[c.key]} ≡ 实跑 ${actual[c.key]}`);
  else no('A2-' + c.key, `声明 ${decl[c.key]} ≠ 实跑 ${actual[c.key]}`);
}

// ============ A5 前提守卫（非恒真）============
section('A5 前提守卫（证明本守卫不是恒真）');
if (CASES.length >= 6) ok('A5-①', `受守套件 ${CASES.length} 个 ≥ 6（集合被改小即转红）`);
else no('A5-①', `受守套件仅 ${CASES.length} 个 < 6 ⇒ 覆盖面不足`);
const extra = Object.keys(decl).filter((k) => !CASES.some((c) => c.key === k));
if (extra.length === 0) ok('A5-②', '声明行无受守集合外的多余 key');
else no('A5-②', `声明行含未受守 key：${extra.join(', ')}`);

// A6 历史面非空（证明 HIST/排除面确实放过旧值，排除面写错会转红）
const allMd = restartAbs ? scanMd() : [];
let histHits = 0;
for (const abs of allMd) {
  if (abs === restartAbs) continue;          // 声明处自身不计
  if (!/review[\\/]/.test(abs)) continue;    // 历史陈述集中在 review/
  const t = readAbs(abs);
  for (const line of t.split(/\r?\n/)) {
    if (!/selftest_ui_fix|selftest_batch8b/.test(line)) continue;
    if (/27\s*(条|\s*\/\s*27)|48\s*条/.test(line)) { histHits++; break; }
  }
}
if (histHits >= 1) ok('A6-①', `历史面命中 ${histHits} 份旧值陈述（HIST 排除确实生效）`);
else no('A6-①', '历史面零命中 ⇒ 排除面可能打错，守卫前提失效');

// ============ A7 单源不扩散 ============
section('A7 单源不扩散');
const spread = allMd.filter((abs) => abs !== restartAbs && readAbs(abs).includes(DECL_MARK));
if (spread.length === 0) ok('A7-①', '仅重启键一处自称本口径单源');
else no('A7-①', `另有 ${spread.length} 处自称本口径单源：${spread.map((a) => path.relative(ROOT, a).replace(/\\/g, '/')).join(', ')}`);

// ============ W 弱面（只明示，不判红）============
section('W 弱面：specs 内当前态引用与实跑不符（明示，不判红）');
let weak = 0;
for (const abs of allMd) {
  if (!/specs[\\/]/.test(abs)) continue;
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const t = readAbs(abs);
  t.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(DECL_MARK)) return;
    if (HIST.some((w) => line.includes(w))) return;
    for (const c of CASES) {
      const kp = line.indexOf(c.key);
      if (kp < 0) continue;
      const m = /(\d+)\s*(?:条|通过|\s*\/\s*\d+\s*全绿)/.exec(line.slice(kp, kp + NEAR));
      if (!m) continue;
      // 「新增 N 条」是**增量**口径，不是全集 ⇒ 跳过（坑⑭ 同族：裸扫数字必误杀）
      if (/新增/.test(line.slice(Math.max(0, kp - 30), kp + m.index))) continue;
      const v = Number(m[1]);
      if (v !== actual[c.key]) {
        weak++;
        console.log(`  ⚠️ ${rel}:${i + 1} ${c.key} 写 ${v} / 实跑 ${actual[c.key]}`);
      }
    }
  });
}
if (weak === 0) console.log('  （无不符）');
console.log(`  · 弱面共 ${weak} 条（只明示，不判红 —— 可能是子集/另一口径）`);
ok('W-①', `弱面扫描完成：${weak} 条明示（弱面只提示、不判红）`);

console.log(`\n===== 套件断言数口径守卫结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
