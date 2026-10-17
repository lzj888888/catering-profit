#!/usr/bin/env node
/**
 * check_money_precision.js —— 「元 → 分」十进制精度守卫（R298 · B2，round298）
 *
 * ===== 为什么立这条 =====
 * 全仓铁律（core/01 架构总览 §1）：「金额 = 整数分，禁 JS Number 原生浮点运算」。
 * 而「元 → 分」是**唯一必须做一次浮点乘法**的边界（× 100），也就是精度最容易丢的地方。
 * 裸写 `Math.round(<元> * 100)` 在 IEEE754 下的真实后果（实测）：
 *   · 三位小数全域 18 万点，裸写错 **1147 点**（0.145→14 / 0.285→28 / 1.005→100 真值 101 …）
 *   · 成本引擎路径 qty×(净料万分之元) 600 万组合错 **3528 处**
 *   · 方向**恒为偏小**（少算成本/少算收入），且**零报错** —— 典型「静默错账」。
 *   · ⚠️ 免责面：**两位小数（老板日常输入形态）穷举 100 万点原本就 0 错** ⇒ 本判据不是
 *     "整个金额体系都错了"，而是"**非两位小数的边界输入会静默少 1 分**"。
 * 根因：`yuan * 100` 的二进制结果可能**略小于**十进制真值（如 1.005*100 = 100.49999999999999），
 *       `Math.round` 于是向下取整。修法：先 `toFixed(10)` 消掉 1e-13 量级浮点噪声（不动真实半步）。
 *
 * ===== 判据为什么要从「白名单」升级成「登记清单」（R298-B2 补漏，实测教训）=====
 * 初版判据 = 「标识符命中 /yuan|price|amount|money/i 才算」+ 正则要求标识符**紧邻** `* 100`。
 * 实测**观测覆盖率只有 22.1%**（可见 17 处 / 面内真值 77→78 处）：
 *   · 形态漏：`(...) * 100`（括号形态）连正则都不匹配 ⇒ 13 处真·元→分从未被看见；
 *   · 命名漏：`net` / `n` / `c.sum` / `matchedRevenue` … 不在白名单 ⇒ 6 处从未被看见；
 *   · 字面量漏：`448 * 100` 既非标识符也非括号 ⇒ 第 78 处（本补漏脚本对账才暴露）。
 *   ⇒ **判据的实际覆盖面由"命名习惯 / 书写形态"决定，不由语义决定** —— 与 D1「术语值当机器键」、
 *     B2「单源零消费者」**同型**：规范写了，但判据能被实现方式静默绕过。
 * 正解 ⇒ **登记清单（fail-closed）**：扫描面扩到**全部 `* 100`**（三形态桶），**废弃白名单**，
 *   每一处都必须在 REGISTRY 里**具名登记 kind + 语义理由**；未登记 / 登记失效 / 计数不符 ⇒ **一律判红**。
 *   这样"新增一处裸换算"必然转红，命名习惯再也无法让判据静默失效。
 *
 * ===== 判据（S / A / B / C / D 五组）=====
 *   S 扫描面：实现文件在面内 · 单源导出非退化 · 前端可解析 · 文件数/命中数下界 · **三形态桶穷尽**
 *   A 行为：两位小数穷举零漂移 · 三位小数半步十进制正确 · 分↔元往返恒等 · 边界值
 *   B 双副本等价：前端 ≡ 云端（合法域）+ 非法域差异必须存在（fail-soft / fail-closed）
 *   C 登记清单（fail-closed）：未登记⇒红 · 登记失效⇒红 · 总数守恒 · money 类必须安全形态 ·
 *                            防退化下界 · note 不许空话 · kind 只准四值 · 单源/三副本同源
 *   D 自证：喂旧实现判不安全 · 喂新实现判安全 · 反向护栏（分→万分不得判 money）·
 *          **对账函数本身做变异**（漏登记/多登记/计数错必须分辨）+ 断言数下界
 *
 * ⚠️ 判据纪律：判**行为与形态**，不判单一字面 —— 三份成本引擎副本允许排版不同（见 R131 parity）。
 * 运行：node tools/check_money_precision.js          # 校验（exit 0/1）
 *       node tools/check_money_precision.js --list   # 列全部命中点 live 行号（维护用）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');
const SRC_MONEY = path.join(CF, 'common', 'money.js');
const SRC_API = path.join(ROOT, 'utils', 'api.js');

// 扫描面：剔派生副本（cx_* 由 sync_common 从 common/ 派生，判单源只看源）、证据、探针、规格原型
const SKIP_DIRS = ['node_modules', 'miniprogram_npm', '.git', '.workbuddy', '_probe_tmp',
  'prototype', 'review', 'specs', 'tools'];

const MIN_FILES = 200;        // 实测 314 —— 取保守下沿
const MIN_HITS = 70;          // 全部 `* 100` 实测 78 —— 取保守下沿
const MIN_MONEY = 34;         // kind=money 实测 37 —— 取保守下沿（防"批量改标成 ratio"绕过）
const MIN_ASSERT = 30;        // 断言数下界（实测值的保守下沿）

// ============================================================================
// 登记清单（**人工面，逐条写语义理由**）
//   kind 只准四值：
//     money      = 元 ⇄ 分 的金额换算（元→整数分、元→2 位小数）⇒ **必须十进制安全形态**
//     ratio      = 比率/百分数/计数等**非金额**数值的缩放或归一 ⇒ 登记即可
//     scaled_int = **整数分** → 更大整数单位（×100 精确，浮点无损）⇒ 登记即可
//     token      = 非数值用途（造唯一串等）⇒ 登记即可
//   键 = `<形态>|<归一化匹配文本>|#<同键序号>`；形态 ∈ IDENT / PAREN / LITERAL。
//   🔴 键**不含行号**（行号随无关编辑漂移）；增删一处命中会移位后续 #N ⇒ 判红要求重登记（这是有意的）。
//   🔴 登记失效（键在面内已不存在）也让判红 —— 与 `check_idempotency.js::EXEMPT_KEY` 同款机制。
// ============================================================================
const REGISTRY = {
  'cloudfunctions/calcBom/selftest.js': {
    'LITERAL|448 * 100|#1': ['scaled_int', '虚拟红油底料：448（整数分）×100 → 万分之元；整数乘精确，非元→分'],
    'PAREN|) * 100|#1': ['money', 'R38 变异回验的「逐行 round」错式（lineNetCostYuan 返回元 → 分）'],
  },
  'cloudfunctions/calcBom/service.js': {
    'IDENT|yuan * 100|#1': ['money', '成本引擎：行净料成本（元）→ 整数分'],
    'IDENT|detailSumYuan * 100|#1': ['money', '成本引擎：明细高精度合计（元）→ 整数分，禁止逐行 round'],
    'IDENT|rawTotalYuan * 100|#1': ['money', '成本引擎：原辅料合计（元）→ 整数分（落库值）'],
  },
  'cloudfunctions/calcBom/validate.js': {
    'IDENT|src.auxYuan * 100|#1': ['money', '入参宽松通道：辅料（元）→ 分，与 aux_fen 二选一'],
    'IDENT|src.priceYuan * 100|#1': ['money', '入参宽松通道：售价（元）→ 分，与 price_fen 二选一'],
  },
  'cloudfunctions/calcMonthlyProfit/service.js': {
    'PAREN|) * 100|#1': ['ratio', '毛利率：毛利（分）÷ 收入（分）→ 百分数，分子分母同单位'],
    'PAREN|) * 100|#2': ['ratio', 'rounded2()：百分数保留 2 位小数；⚠️ `+Number.EPSILON` 容差已退化（见下）'],
  },
  'cloudfunctions/calcSandbox/service.js': {
    'IDENT|n * 100|#1': ['ratio', 'round2()：反推派生量（月客流/日均客流/翻台）保留 2 位小数；⚠️ `+1e-9` 容差 >167773 失效'],
  },
  'cloudfunctions/common/comboDerive.js': {
    'PAREN|) * 100|#1': ['scaled_int', 'fenToWan()：整数分 ×100 → 万分之元（1 分 = 100 万分），精确'],
  },
  'cloudfunctions/common/indicatorRef.js': {
    'PAREN|) * 100|#1': ['ratio', '细项占收入比：分 ÷ 分 → 百分数'],
  },
  'cloudfunctions/common/money.js': {
    'IDENT|yuan * 100|#1': ['money', '**单源** yuanToFen：全仓元→分唯一权威实现'],
  },
  'cloudfunctions/exportData/index.js': {
    'PAREN|) * 100|#1': ['ratio', '导出毛利率：毛利 ÷ 收入 → 百分数'],
    'PAREN|) * 100|#2': ['ratio', '导出毛利率位归一保留 2 位；⚠️ `+Number.EPSILON` 容差已退化（见下）'],
  },
  'cloudfunctions/getDishReview/service.js': {
    'IDENT|matchedRevenue * 100|#1': ['ratio', 'A 档覆盖率：已匹配销售额 ÷ 总销售额 → 百分数'],
    'IDENT|numC * 100|#1': ['ratio', 'C 档覆盖率：已建卡道数 ÷ 总道数 → 百分数'],
    'PAREN|) * 100|#1': ['ratio', '人均毛利贡献率：(售价−成本) ÷ 售价 → 百分数（分/分）'],
    'IDENT|perCapitaCostFen * 100|#1': ['ratio', '实际人均成本率：人均成本 ÷ 人均售价 → 百分数'],
    'IDENT|BENCH.low * 100|#1': ['ratio', '成本率基准带下界：比率 → 百分数'],
    'IDENT|BENCH.mid * 100|#1': ['ratio', '成本率基准带中位：比率 → 百分数'],
    'IDENT|BENCH.high * 100|#1': ['ratio', '成本率基准带上界：比率 → 百分数'],
  },
  'cloudfunctions/getLedger/index.js': {
    'PAREN|) * 100|#1': ['ratio', '推广费占收入比：分 ÷ 分 → 百分数'],
  },
  'cloudfunctions/getLedger/service.js': {
    'PAREN|) * 100|#1': ['ratio', '毛利率：毛利 ÷ 收入 → 百分数'],
    'PAREN|) * 100|#2': ['ratio', '毛利率展示值位归一；⚠️ `+Number.EPSILON` 容差已退化（见下）'],
  },
  'cloudfunctions/importSalesBill/service.js': {
    'IDENT|net * 100|#1': ['money', '平台账单「结算金额」（元）→ 分，落库 amount_fen'],
    'PAREN|) * 100|#1': ['money', '形态 C 收入（元）→ 分，落 external_sales_daily.amount_fen'],
    'PAREN|) * 100|#2': ['money', '形态 C 销售额（元）→ 分'],
    'PAREN|) * 100|#3': ['money', '形态 C 优惠额（元）→ 分'],
    'PAREN|) * 100|#4': ['money', '美团销量表 amount_fen = 销售额（元）× 100（v1.7 C-3）'],
  },
  'cloudfunctions/saveCostCard/index.js': {
    'IDENT|result.unit_cost_fen * 100|#1': ['scaled_int', '单份半成品成本：整数分 → 万分（1 分 = 100 万分），精确'],
  },
  'cloudfunctions/saveCostCard/service.js': {
    'IDENT|yuan * 100|#1': ['money', '成本引擎：行净料成本（元）→ 整数分'],
    'IDENT|detailSumYuan * 100|#1': ['money', '成本引擎：明细高精度合计（元）→ 整数分'],
    'IDENT|rawTotalYuan * 100|#1': ['money', '成本引擎：原辅料合计（元）→ 整数分（落库值）'],
  },
  'cloudfunctions/saveCostCard/validate.js': {
    'IDENT|card.auxYuan * 100|#1': ['money', '入参宽松通道：辅料（元）→ 分'],
    'IDENT|card.priceYuan * 100|#1': ['money', '入参宽松通道：售价（元）→ 分'],
    'IDENT|card.activity_price_yuan * 100|#1': ['money', '入参宽松通道：活动价（元）→ 分'],
  },
  'cloudfunctions/saveLedger/service.js': {
    'PAREN|) * 100|#1': ['ratio', '毛利率：毛利 ÷ 收入 → 百分数'],
    'PAREN|) * 100|#2': ['ratio', '毛利率展示值位归一；⚠️ `+Number.EPSILON` 容差已退化（见下）'],
  },
  'cloudfunctions/savePlan/service.js': {
    'IDENT|n * 100|#1': ['ratio', 'round2()：反推派生量保留 2 位小数；⚠️ `+1e-9` 容差 >167773 失效'],
  },
  'cloudfunctions/syncCostCard/index.js': {
    'IDENT|result.unit_cost_fen * 100|#1': ['scaled_int', '单份半成品成本：整数分 → 万分，精确'],
  },
  'cloudfunctions/syncCostCard/service.js': {
    'IDENT|yuan * 100|#1': ['money', '成本引擎：行净料成本（元）→ 整数分'],
    'IDENT|detailSumYuan * 100|#1': ['money', '成本引擎：明细高精度合计（元）→ 整数分'],
    'IDENT|rawTotalYuan * 100|#1': ['money', '成本引擎：原辅料合计（元）→ 整数分（落库值）'],
  },
  'pages/card/edit.js': {
    'IDENT|priceYuan * 100|#1': ['money', '团购试算：售价（元）→ 分'],
    'PAREN|) * 100|#1': ['money', '团购试算：优惠额（元）→ 分（老板手输，可带三位小数 ⇒ 真风险面）'],
    'PAREN|) * 100|#2': ['money', '团购试算：堂食价（元）→ 分（老板手输）'],
    'PAREN|) * 100|#3': ['scaled_int', '规格行 net_unit_cost：整数分 → 万分（与成本引擎同口径）'],
    'IDENT|yuan * 100|#1': ['money', 'specPriceFen()：规格售价（元）→ 分；⚠️ 第 4 份元→分实现（收敛待判）'],
    'PAREN|) * 100|#4': ['money', '售价低于成本预警：售价（元）→ 分（老板手输）'],
  },
  'pages/card/version.js': {
    'PAREN|) * 100|#1': ['ratio', '版本趋势柱高：值 ÷ 最大值 → 百分比高度（纯展示）'],
  },
  'pages/m3/dishreview/index.js': {
    'IDENT|rankedFen * 100|#1': ['ratio', '覆盖率（金额口径）：已匹配 ÷ 全部 → 百分数'],
  },
  'pages/material/edit.js': {
    'PAREN|) * 100|#1': ['money', '原料采购价（元）→ 分（老板手输）'],
  },
  'pages/month/result.js': {
    'PAREN|) * 100|#1': ['ratio', '真实占比：真值 ÷ 收入 → 百分数（分/分）'],
  },
  'pages/sandbox/index.js': {
    'IDENT|marginPct * 100|#1': ['token', '敏感度试算的 client_request_id 唯一串，非金额数值用途'],
    'IDENT|baseBreak * 100|#1': ['ratio', '敏感度：保本额变动率 → 百分数'],
    'IDENT|x * 100|#1': ['ratio', 'r2()：渠道佣金占比保留 2 位小数（值域 [0,100]）；⚠️ `+1e-9` 容差 >167773 失效'],
    'PAREN|) * 100|#1': ['ratio', '翻台率 = 目标客流 ÷ 座位数，保留 2 位小数（非金额）'],
    'IDENT|d.margin_rate_ratio * 100|#1': ['ratio', '毛利率比率 → 百分数展示（保留 1 位）'],
  },
  'pages/sandbox/matrix.js': {
    'IDENT|meta.rent * 100|#1': ['money', '房租（元）→ 分；🔴 原式连取整都没有 ⇒ 分非整数，违约铁律（B2 已修）'],
    'IDENT|targetMonthly * 100|#1': ['ratio', '缓冲率：(目标 − 保本) ÷ 目标 → 百分数'],
    'IDENT|bestRow.targetMonthly * 100|#1': ['ratio', '最佳档缓冲率：(目标 − 保本) ÷ 目标 → 百分数'],
  },
  'pages/takeaway/index.js': {
    'PAREN|) * 100|#1': ['money', '外卖组装订单本地 fen()：元 → 分（打包费/单价等老板手输）'],
    'PAREN|) * 100|#2': ['money', '目标利润（元）→ 分（老板手输）'],
  },
  'utils/api.js': {
    'IDENT|n * 100|#1': ['money', '**前端单源** yuanToFen：全仓前端元→分唯一权威实现'],
  },
  'utils/billParse.js': {
    'IDENT|net * 100|#1': ['money', '账单解析「结算金额」（元）→ 分；与 importSalesBill 同源重复实现'],
  },
  'utils/bizPreset.js': {
    'IDENT|n * 100|#1': ['money', 'fenOf()：元 → 分；⚠️ 第 3 份元→分实现（前端未走 api.yuanToFen，收敛待判）'],
  },
  'utils/calc.js': {
    'PAREN|) * 100|#1': ['ratio', '利润率：利润 ÷ 收入 → 百分数'],
    'PAREN|) * 100|#2': ['ratio', '毛利率：毛利 ÷ 收入 → 百分数'],
  },
  'utils/dineChannels.js': {
    'IDENT|c.sum * 100|#1': ['money', '多渠道金额求和多行时归一到 2 位小数（元语义）'],
  },
  'utils/grouponDerive.js': {
    'PAREN|) * 100|#1': ['ratio', '团购净得率：净得 ÷ 售价 → 百分数（分/分）'],
    'PAREN|) * 100|#2': ['ratio', '团购利润率：利润 ÷ 净得 → 百分数（分/分）'],
  },
  'utils/materialBatch.js': {
    'PAREN|) * 100|#1': ['money', '批量导原料单价（元）→ 分（Excel 导入，可带三位小数 ⇒ 真风险面）'],
  },
  'utils/reconDerive.js': {
    'IDENT|n * 100|#1': ['ratio', 'round2()：标准菜单毛利率等百分数保留 2 位；⚠️ `+1e-9` 容差 >167773 失效'],
    'PAREN|) * 100|#1': ['ratio', '标准菜单毛利率 (1 − 成本 ÷ 售价) → 百分数'],
    'PAREN|) * 100|#2': ['ratio', '外卖毛利率 (收入 − 食品成本) ÷ 收入 → 百分数'],
  },
  'utils/shareSplit.js': {
    'IDENT|totalPct * 100|#1': ['ratio', 'R307 占比合计归一到 2 位小数（33.3+33.3+33.4 的浮点尾差）—— **不是**元→分'],
    'IDENT|pct * 100|#1': ['ratio', 'R307 占比归一到 2 位小数后回报 —— **不是**元→分'],
    'IDENT|unitGrossFen * 100|#1': ['ratio', 'R307 单份毛利率：毛利 ÷ 售价 → 百分数 —— **不是**元→分'],
  },
  'utils/importSanity.js': {
    'IDENT|avgYuan * 100|#1': ['ratio', 'R303 一级校验：均价（元）归一到 2 位小数后再回报 —— **不是**元→分换算'],
  },
  'utils/takeaway.js': {
    'PAREN|) * 100|#1': ['money', '外卖对账差额（元）归一到 2 位小数'],
    'PAREN|) * 100|#2': ['money', '打包费合计（元）归一到 2 位小数'],
    'PAREN|) * 100|#3': ['ratio', 'R302 外卖到手账：到手率 = 到手额 ÷ 外卖营收 → 百分数（**不是**元→分换算）'],
  },
};

const KINDS = ['money', 'ratio', 'scaled_int', 'token'];

// ============================================================================
// 扫描器：全部 `* 100`，三形态桶（互斥、须穷尽）
// ============================================================================
const RE_ANY = /\*\s*100(?![\d.])/g;
const FORMS = [
  ['IDENT', /([A-Za-z_$][A-Za-z0-9_$.]*)\s*\*\s*100(?![\d.])/g],
  ['PAREN', /\)\s*\*\s*100(?![\d.])/g],
  ['LITERAL', /(\d+(?:\.\d+)?)\s*\*\s*100(?![\d.])/g],
];
// 十进制安全形态：`Math.round(Number((<乘积>).toFixed(10)))`
// 🔴 不能用"定宽窗口正则"判（R298-B2 首跑踩到）：`Number((lineNetCostYuan(a, b) * 100)...` 里
//    操作数**自身含括号**，按位置取前 24 字符会拿不到包裹前缀 ⇒ 已修好的点被误判"不安全"。
//    正解：先用规范包裹正则求出**内层区间**，再判命中是否**落在区间内**（区间包含，与书写形态无关）。
const SAFE_WRAP = /Math\.round\(\s*Number\(\s*\(([^;]{1,300}?)\)\s*\.toFixed\(\s*10\s*\)\s*\)/g;
const SAFE_HEAD = /^Math\.round\(\s*Number\(\s*\(/;

/** 求全部「规范包裹」的内层区间 [start, end) */
function safeRanges(code) {
  const out = [];
  SAFE_WRAP.lastIndex = 0;
  let m;
  while ((m = SAFE_WRAP.exec(code)) !== null) {
    const head = m[0].match(SAFE_HEAD);
    if (!head) continue;
    const s = m.index + head[0].length;
    out.push([s, s + m[1].length]);
  }
  return out;
}

let pass = 0;
let failN = 0;
const ok = (id, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✅ ' + id + (detail ? '  (' + detail + ')' : '')); }
  else { failN += 1; console.log('  ❌ ' + id + (detail ? '  (' + detail + ')' : '')); }
};
const section = (t) => console.log('\n===== ' + t + ' =====');

function walkJs(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (SKIP_DIRS.indexOf(e.name) >= 0) continue; walkJs(p, out); }
    else if (e.name.endsWith('.js') && e.name.indexOf('cx_') !== 0) out.push(p);
  }
  return out;
}

/** 剥注释（保留行号）—— 判据只看代码，注释里的示例不得顶数 */
function stripComments(src) {
  const s = String(src);
  const noBlock = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
}

/**
 * 扫描一个文件的全部 `* 100` 命中点。
 * @returns {{hits:Array, anyCount:number, ranges:Array}} hits: {form,expr,pos,end,line,key,safe}
 */
function scanAll(code, rel) {
  const found = [];
  for (const [form, re] of FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      found.push({ form, expr: m[0].replace(/\s+/g, ' ').trim(), pos: m.index, end: m.index + m[0].length });
    }
  }
  found.sort((a, b) => a.pos - b.pos);
  const ranges = safeRanges(code);
  const seq = {};
  for (const h of found) {
    const base = h.form + '|' + h.expr;
    seq[base] = (seq[base] || 0) + 1;
    h.key = base + '|#' + seq[base];
    h.line = code.slice(0, h.pos).split('\n').length;
    h.rel = rel;                       // 🔴 必须带上 —— 首跑漏了它，失败信息成了 `@undefined:24`
    // 十进制安全判定：命中必须**落在某个规范包裹的内层区间内**
    h.safe = ranges.some((r) => h.pos >= r[0] && h.end <= r[1]);
  }
  RE_ANY.lastIndex = 0;
  let anyCount = 0;
  while (RE_ANY.exec(code) !== null) anyCount++;
  return { hits: found, anyCount: anyCount, ranges: ranges };
}

/** 清单对账（纯函数 ⇒ 可被变异自证直接喂假数据） */
function reconcile(actualMap, expectedMap) {
  const unregistered = [];
  const stale = [];
  actualMap.forEach((v, k) => { if (!expectedMap.has(k)) unregistered.push(k + '  @' + v.rel + ':' + v.line); });
  expectedMap.forEach((v, k) => { if (!actualMap.has(k)) stale.push(k); });
  return { unregistered, stale, sizeOk: actualMap.size === expectedMap.size };
}

/** 从 cloudfunctions/common/money.js 真 require（它只依赖 ./errors，可独立加载） */
function loadCloud() {
  delete require.cache[require.resolve(SRC_MONEY)];
  return require(SRC_MONEY);
}

/** 从前端 utils/api.js 提取 yuanToFen 函数体（该文件顶层依赖 wx / getApp，不能整体 require） */
function loadFrontYuanToFen() {
  const src = fs.readFileSync(SRC_API, 'utf8');
  const m = /yuanToFen\s*\(\s*yuanInput\s*\)\s*\{([\s\S]*?)\n\s{2}\}/.exec(src);
  if (!m) return null;
  return new Function('yuanInput', m[1]);   // eslint-disable-line no-new-func
}

const cloud = loadCloud();
const front = loadFrontYuanToFen();

// ============================================================
section('S. 扫描面（fail-closed 防退化）');
ok('S-① 两份实现文件都在面内',
  fs.existsSync(SRC_MONEY) && fs.existsSync(SRC_API),
  'money.js=' + fs.existsSync(SRC_MONEY) + ' api.js=' + fs.existsSync(SRC_API));
const EXPORTS = Object.keys(cloud).sort();
ok('S-② 单源导出符号非退化（≥4 个）', EXPORTS.length >= 4, EXPORTS.join(' / '));
ok('S-③ 前端 yuanToFen 可解析（非 null）', typeof front === 'function', typeof front);

const allFiles = walkJs(ROOT, []);
ok('S-④ 扫描面文件数下界 ≥ ' + MIN_FILES, allFiles.length >= MIN_FILES, '实测 ' + allFiles.length);

const actualMap = new Map();   // key -> {rel, line, form, expr, safe}
let anyTotal = 0;
let coveredTotal = 0;
const notExhaustive = [];
for (const f of allFiles) {
  let src = '';
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const { hits, anyCount } = scanAll(stripComments(src), rel);
  anyTotal += anyCount;
  coveredTotal += hits.length;
  if (anyCount !== hits.length) notExhaustive.push(rel + '(any=' + anyCount + ',三桶=' + hits.length + ')');
  for (const h of hits) actualMap.set(rel + '::' + h.key, h);
}
ok('S-⑤ 全部 `* 100` 被三形态桶穷尽（IDENT+PAREN+LITERAL）',
  notExhaustive.length === 0 && anyTotal === coveredTotal,
  notExhaustive.length ? ('未穷尽：' + notExhaustive.slice(0, 5).join(' ; ')) : ('共 ' + anyTotal + ' 处，全部归类'));
ok('S-⑥ 全部 `* 100` 命中数下界 ≥ ' + MIN_HITS, actualMap.size >= MIN_HITS, '实测 ' + actualMap.size);

// ============================================================
section('A. 行为：十进制安全（真跑函数，不静态推断）');

// A-① 两位小数穷举零漂移（证"日常输入形态不受影响"）
let a1bad = 0;
const A1N = 200000;
for (let f = 0; f <= A1N; f++) {
  if (cloud.yuanToFen(f / 100) !== f) a1bad++;
}
ok('A-① 两位小数穷举 ' + A1N + ' 点零漂移（云端单源）', a1bad === 0, '偏差 ' + a1bad + ' 点');

// A-② 三位小数半步必须十进制正确
const HALF = [1.005, 8.575, 1.015, 4.015, 5.015, 0.145, 0.285, 0.565, 0.575, 2.675, 12.345, 99.995];
const halfWant = [101, 858, 102, 402, 502, 15, 29, 57, 58, 268, 1235, 10000];
let a2bad = 0;
const a2detail = [];
HALF.forEach((y, i) => {
  const got = cloud.yuanToFen(y);
  if (got !== halfWant[i]) { a2bad++; a2detail.push(y + ' 得 ' + got + ' 应 ' + halfWant[i]); }
});
ok('A-② 三位小数半步十进制正确（' + HALF.length + ' 点）', a2bad === 0, a2bad ? a2detail.join(' ; ') : '全对');

// A-③ 分 → 元 → 分 往返恒等
let a3bad = 0;
for (let f = 0; f <= 300000; f += 13) {
  if (cloud.yuanToFen(cloud.fenToYuan(f)) !== f) a3bad++;
}
ok('A-③ 分↔元往返恒等（步长 13）', a3bad === 0, '偏差 ' + a3bad + ' 点');

// A-④ 边界
const edgeOk = cloud.yuanToFen(0) === 0 && cloud.yuanToFen(1e-7) === 0
  && cloud.yuanToFen(123456789.01) === 12345678901;
ok('A-④ 边界值（0 / 1e-7 / 大额）', edgeOk,
  '0 得 ' + cloud.yuanToFen(0) + ' ; 1e-7 得 ' + cloud.yuanToFen(1e-7) + ' ; 大额 得 ' + cloud.yuanToFen(123456789.01));

// ============================================================
section('B. 双副本等价（前端 ≡ 云端，合法输入域）');
// ⚠️ 测例域必须**含三位小数半步域**：只测两位小数时两份实现天然等价 ⇒ 变异实测**不转红**
//    （技能 §10.6「变异太弱」）。
let b1bad = 0;
const b1sample = [];
for (let f = 0; f <= 500000; f++) {
  const yuan = f / 100;                 // 两位小数（日常形态）
  if (cloud.yuanToFen(yuan) !== front(yuan)) {
    b1bad++;
    if (b1sample.length < 4) b1sample.push('两位 ' + yuan);
  }
}
for (let f = 0; f <= 300000; f++) {
  const yuan = f / 1000;                // 三位小数（含半步 —— 两份实现会分歧的地方）
  if (cloud.yuanToFen(yuan) !== front(yuan)) {
    b1bad++;
    if (b1sample.length < 4) b1sample.push('三位 ' + yuan + ' 云=' + cloud.yuanToFen(yuan) + ' 端=' + front(yuan));
  }
}
ok('B-① 合法域 80 万点（两位 + 三位）两份逐点相等', b1bad === 0, b1bad ? b1sample.join(' | ') : '0 处差异');

// B-② 非法/负值域的行为差异**必须存在**（前端 fail-soft；云端只拦"非数"、不拦负数）
let frontNeg = false;
let frontStr = false;
let cloudStrThrows = false;
let negDiffers = false;
try { frontNeg = front(-1) === 0; } catch (e) { frontNeg = false; }
try { frontStr = front('') === 0; } catch (e) { frontStr = false; }
try { cloud.yuanToFen(''); } catch (e) { cloudStrThrows = true; }
try { negDiffers = front(-1) !== cloud.yuanToFen(-1); } catch (e) { negDiffers = false; }
ok('B-② 差异精确落在非法域（前端 fail-soft 返 0 / 云端非数 fail-closed 抛错）',
  frontNeg && frontStr && cloudStrThrows && negDiffers,
  '前 -1 得 0:' + frontNeg + ' 前空串得 0:' + frontStr + ' 云空串抛:' + cloudStrThrows + ' 负数两端不同:' + negDiffers);

// ============================================================
section('C. 登记清单（fail-closed）：面内每一处 `* 100` 都必须具名登记');
const expectedMap = new Map();
const kindCount = { money: 0, ratio: 0, scaled_int: 0, token: 0 };
const badKind = [];
const badNote = [];
for (const rel of Object.keys(REGISTRY)) {
  const group = REGISTRY[rel];
  for (const inner of Object.keys(group)) {
    const entry = group[inner];
    const kind = entry[0];
    const note = entry[1];
    const key = rel + '::' + inner;
    expectedMap.set(key, { kind, note, rel });
    if (KINDS.indexOf(kind) < 0) badKind.push(key + ' kind=' + kind);
    else kindCount[kind] += 1;
    if (typeof note !== 'string' || note.replace(/\s/g, '').length < 10) badNote.push(key);
  }
}

const rec = reconcile(actualMap, expectedMap);
ok('C-① 面内每一处 `* 100` 都已登记（未登记 ⇒ 红）',
  rec.unregistered.length === 0,
  rec.unregistered.length ? ('未登记 ' + rec.unregistered.length + ' 处：' + rec.unregistered.slice(0, 4).join(' | '))
    : ('已登记 ' + expectedMap.size + ' 处'));
ok('C-② 每条登记仍对应到一处真实命中（登记失效/重复 ⇒ 红）',
  rec.stale.length === 0,
  rec.stale.length ? ('失效登记 ' + rec.stale.length + ' 条：' + rec.stale.slice(0, 4).join(' | ')) : '无失效登记');
ok('C-③ 命中数与登记数守恒', rec.sizeOk,
  '命中 ' + actualMap.size + ' / 登记 ' + expectedMap.size);

const unsafeMoney = [];
actualMap.forEach((h, k) => {
  const e = expectedMap.get(k);
  if (e && e.kind === 'money' && !h.safe) unsafeMoney.push(k + '  @' + h.rel + ':' + h.line);
});
ok('C-④ kind=money 的每一处都是十进制安全形态', unsafeMoney.length === 0,
  unsafeMoney.length ? ('不安全 ' + unsafeMoney.length + ' 处：' + unsafeMoney.slice(0, 4).join(' | '))
    : ('money 类 ' + kindCount.money + ' 处全安全'));

ok('C-⑤ 防退化：money 类下界 ≥ ' + MIN_MONEY + '（防"批量改标成 ratio 绕过"）',
  kindCount.money >= MIN_MONEY, '实测 ' + kindCount.money);
ok('C-⑥ 四类 kind 均非空（登记不许单调一类）',
  KINDS.every((k) => kindCount[k] > 0),
  KINDS.map((k) => k + '=' + kindCount[k]).join(' / '));
ok('C-⑦ 登记 kind 只准四值（防打字错）', badKind.length === 0,
  badKind.length ? badKind.slice(0, 4).join(' | ') : '全部合法');
ok('C-⑧ 登记理由不许空话（去空白后 ≥10 字符）', badNote.length === 0,
  badNote.length ? badNote.slice(0, 4).join(' | ') : '全部有理由');

// C-⑨ 单源实现本身必须十进制安全
const moneyCode = stripComments(fs.readFileSync(SRC_MONEY, 'utf8'));
ok('C-⑨ 单源 money.js::yuanToFen 含 toFixed(10)',
  /yuanToFen[\s\S]{0,600}?toFixed\(\s*10\s*\)/.test(moneyCode), '已检');

// C-⑩ 三份成本引擎副本口径同源（都含 toFixed(10) 的元→分）
const ENGINE3 = ['calcBom', 'saveCostCard', 'syncCostCard'];
const engineHit = ENGINE3.map((f) => {
  const p = path.join(CF, f, 'service.js');
  const { hits } = scanAll(stripComments(fs.readFileSync(p, 'utf8')), f);
  const money = hits.filter((h) => h.expr.indexOf('Yuan * 100') >= 0 || h.expr.indexOf('yuan * 100') >= 0);
  return { fn: f, n: money.length, allSafe: money.length >= 3 && money.every((h) => h.safe) };
});
ok('C-⑩ 成本引擎三副本元→分同源且安全', engineHit.every((e) => e.allSafe),
  engineHit.map((e) => e.fn + ' ' + e.n + ' 处').join(' ; '));

// ============================================================
section('D. 自证：判定与对账函数有分辨力（正负样本 + 变异）');
const OLD_IMPL = 'const a = Math.round(yuan * 100);';
const NEW_IMPL = 'const a = Math.round(Number((yuan * 100).toFixed(10)));';
const sOld = scanAll(OLD_IMPL, 'x').hits;
const sNew = scanAll(NEW_IMPL, 'x').hits;
const sOldP = scanAll('const a = Math.round((net == null ? 0 : net) * 100);', 'x').hits;
const sParen = scanAll('const a = Math.round(Number(((net == null ? 0 : net) * 100).toFixed(10)));', 'x').hits;
ok('D-① 喂旧实现（标识符形态）⇒ 判定不安全', sOld.length === 1 && sOld[0].safe === false,
  '命中 ' + sOld.length + ' 处，safe=' + (sOld[0] ? sOld[0].safe : '无'));
ok('D-② 喂新实现（标识符形态）⇒ 判定安全', sNew.length === 1 && sNew[0].safe === true,
  '命中 ' + sNew.length + ' 处，safe=' + (sNew[0] ? sNew[0].safe : '无'));
ok('D-③ 括号形态：旧式判不安全 / 新式判安全（初版守卫**完全看不见**这一形态）',
  sOldP.length === 1 && sOldP[0].safe === false && sParen.length === 1 && sParen[0].safe === true,
  '旧式 ' + sOldP.length + ' 处 safe=' + (sOldP[0] ? sOldP[0].safe : '无')
  + ' / 新式 ' + sParen.length + ' 处 safe=' + (sParen[0] ? sParen[0].safe : '无'));

const sFen = scanAll('const a = Math.round(unit_cost_fen * 100);', 'x').hits;
ok('D-④ 反向护栏：非元语义（分→万分）不得被判 money —— 由登记 kind 决定义务',
  sFen.length === 1 && sFen[0].safe === false && REGISTRY['cloudfunctions/saveCostCard/index.js']['IDENT|result.unit_cost_fen * 100|#1'][0] === 'scaled_int',
  '命中 ' + sFen.length + ' 处，登记 kind=scaled_int ⇒ 不要求安全形态');

// D-⑤ 变异：对账函数本身必须能分辨「漏登记 / 多登记 / 计数不符」
const fakeActual = new Map([['f.js::IDENT|x * 100|#1', { rel: 'f.js', line: 1 }]]);
const fakeExpected = new Map([['f.js::IDENT|x * 100|#1', { kind: 'money', rel: 'f.js' }]]);
const mut1 = reconcile(new Map([...fakeActual, ['f.js::IDENT|y * 100|#1', { rel: 'f.js', line: 2 }]]), fakeExpected);
const mut2 = reconcile(fakeActual, new Map([...fakeExpected, ['f.js::IDENT|y * 100|#1', { kind: 'ratio', rel: 'f.js' }]]));
const mut3 = reconcile(fakeActual, fakeExpected);
ok('D-⑤ 对账分辨力：新增未登记 ⇒ 点名红', mut1.unregistered.length === 1 && mut1.stale.length === 0 && !mut1.sizeOk,
  '未登记 ' + mut1.unregistered.length + ' / 失效 ' + mut1.stale.length);
ok('D-⑥ 对账分辨力：登记失效 ⇒ 点名红', mut2.stale.length === 1 && mut2.unregistered.length === 0 && !mut2.sizeOk,
  '未登记 ' + mut2.unregistered.length + ' / 失效 ' + mut2.stale.length);
ok('D-⑦ 对账分辨力：完全一致 ⇒ 判绿（防"恒红"）', mut3.unregistered.length === 0 && mut3.stale.length === 0 && mut3.sizeOk,
  'sizeOk=' + mut3.sizeOk);
ok('D-⑧ 断言数下界 ≥ ' + MIN_ASSERT, pass + failN + 1 >= MIN_ASSERT, '实测 ' + (pass + failN + 1));

if (process.argv.indexOf('--list') >= 0) {
  section('--list：全部命中点 live 行号');
  const rows = [];
  actualMap.forEach((h, k) => {
    const e = expectedMap.get(k);
    rows.push({ rel: h.rel, line: h.line, kind: e ? e.kind : '<未登记>', safe: h.safe, expr: h.expr });
  });
  rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : a.line - b.line));
  rows.forEach((r) => console.log('  ' + (r.kind === 'money' && !r.safe ? '❌' : '  ') + ' ' + r.rel + ':' + r.line
    + '  [' + r.kind + '] ' + r.expr + (r.safe ? '  (safe)' : '')));
}

console.log('\n===== R298 金额精度守卫：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
