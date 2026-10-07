// tools/check_formc_shape.js —— R232 形态 C（外卖「商品销量」）判定守卫（v1.7 C-1/C-2）
// 运行：node tools/check_formc_shape.js   （由 verify_all.js 的 [formc-shape] 套件调用）
//
// ===== 为什么需要它 =====
// v1.6 §3.4 把形态 C 的判定列名写死成 `'商品销量'`，而**真样例的列名是 `销量`**
// ⇒ 原样启用则形态 C **永远判不出**（fail-closed ⇒ 用户拿外卖表只得到「这张表不认识」）。
// 这是「已实现但错」的同族病（与 C-9/C-10/C-11 同为 R232 端到端审查所出）。
// ⇒ 本守卫把「判得出 C + 不误判 A」钉死，防止将来有人把规则收窄回去。
//
// ===== 🔴 输出纪律 =====
// 顶部横幅**不得**用 `===== … =====` 装饰：R66 的 SECTION_HEAD 会把它识别成
// 一个「零 ✅ 的段标题」（非末段不豁免）⇒ 断言全绿也判红。保持纯文本。
//
// ===== 🔴 判据纪律：判行为不判字面 =====
// 不查源码里有没有 `'销量'` 这个字符串（注释里有就会被骗过，V4 实证），
// 而是**构造只有 '销量'、没有 '商品销量' 的真表结构喂进生产函数**，断言它判得出形态 C。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVC_REL = 'cloudfunctions/importSalesBill/service.js';
const DUMP_REL = 'review/evidence/r232_formc_sample/formc_cells.txt';
const DUMP_A_REL = 'review/evidence/r226_sales_sample/dish.txt';
const SPEC_REL = 'specs/dev-specs/core/开发规范v1.7_ModuleM3增量_M3.33形态C订正.md';

let pass = 0, failN = 0;
const sec = (t) => console.log('\n===== ' + t + ' =====');
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ---------- 加载生产 service.js（stub xlsx）----------
let S = null;
{
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  try { S = require(path.join(ROOT, SVC_REL)); } catch (e) { S = null; }
  finally { Module._load = orig; }
}

// ---------- dump 解析（与 R231 锚点同款）----------
function parseDump(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const rows = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.match(/^R(\d+)\s*\|\s?(.*)$/);
    if (!m) continue;
    let body = m[2];
    if (body.endsWith(' | ')) body = body.slice(0, -3);
    else if (body.endsWith(' |')) body = body.slice(0, -2);
    rows.push({ r: Number(m[1]), cells: body.split(' | ').map((s) => s.trim()) });
  }
  return rows;
}
const toMatrix = (rows) => {
  if (!rows.length) return [];
  const m = new Array(Math.max(...rows.map((x) => x.r))).fill(null);
  for (const x of rows) m[x.r - 1] = x.cells.slice();
  return m;
};

const rd = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '');
const hasDumpC = fs.existsSync(path.join(ROOT, DUMP_REL));
const hasDumpA = fs.existsSync(path.join(ROOT, DUMP_A_REL));

console.log('# R232 形态C 判定守卫 —— 判得出 C + 不误判 A（v1.7 C-1：真样例列名是「销量」不是「商品销量」）');

sec('① 真样例判定（fail-closed · 数据缺失即红，不许静默跳过）');
check('1-① 形态C 逐格 dump 在场（缺失则本守卫失去意义）', hasDumpC, DUMP_REL);
check('1-② 形态A 逐格 dump 在场（用于不误判反例）', hasDumpA, DUMP_A_REL);
check('1-③ 生产 service.js 可加载', !!S, S ? 'loaded' : '🔴 加载失败');

const C_M = hasDumpC ? toMatrix(parseDump(path.join(ROOT, DUMP_REL))) : [];
const A_M = hasDumpA ? toMatrix(parseDump(path.join(ROOT, DUMP_A_REL))) : [];
const C_HDR = (C_M[0] || []).map((x) => (x == null ? '' : String(x).trim()));

check('1-④ 🔴 生产 detectDishShape(形态C真矩阵) === waimai_goods（收窄回只看「商品销量」即红）',
  !!(S && C_M.length && S.detectDishShape(C_M) === 'waimai_goods'),
  S && C_M.length ? String(S.detectDishShape(C_M)) : '🔴 数据/模块缺失');
check('1-⑤ 生产 detectDishShape(形态A真矩阵) === dish_sales（不得被误判成 C）',
  !!(S && A_M.length && S.detectDishShape(A_M) === 'dish_sales'),
  S && A_M.length ? String(S.detectDishShape(A_M)) : '🔴 数据/模块缺失');

sec('② 自失效护栏（样本有效性 —— 防止本守卫恒绿）');
check('2-① 形态C 真表头含「销量」', C_HDR.indexOf('销量') >= 0, C_HDR.indexOf('销量') >= 0 ? '✓' : '🔴 不在场');
check('2-② 🔴 形态C 真表头**不含**「商品销量」（正是 v1.6 判不出的原因 ⇒ 样本有区分力）',
  C_HDR.indexOf('商品销量') < 0, C_HDR.indexOf('商品销量') < 0 ? '✓' : '🔴 在场（样本失去区分力）');
check('2-③ 形态C 真表头含「商品名称」+「销售额」（C-1 的三个必要条件齐备）',
  C_HDR.indexOf('商品名称') >= 0 && C_HDR.indexOf('销售额') >= 0,
  '商品名称 ' + (C_HDR.indexOf('商品名称') >= 0 ? '✓' : '✗') + ' / 销售额 ' + (C_HDR.indexOf('销售额') >= 0 ? '✓' : '✗'));

sec('③ 不误判（构造表 · 三条边界）');
// ③-a：只有「销量」没有「商品销量」的最小表 ⇒ 必须判出 C（若有人把别名删掉即红）
const minC = [
  ['日期', '商品名称', '销量', '销售额'],
  null,
  null,
];
check('3-① 最小表（仅含「销量」、无「商品销量」）⇒ 判出 waimai_goods',
  !!(S && S.detectDishShape(minC) === 'waimai_goods'), S ? String(S.detectDishShape(minC)) : '🔴 无模块');
// ③-b：同表但 R2 含「销售方式」⇒ 不得判 C（区分项生效）
const minCWithA = [
  ['日期', '商品名称', '销量', '销售额'],
  ['销售方式：【单品+套餐明细】'],
  null,
];
check('3-② 同表但 R2 含「销售方式」⇒ **不得**判 C（区分项生效）',
  !!(S && S.detectDishShape(minCWithA) !== 'waimai_goods'), S ? String(S.detectDishShape(minCWithA)) : '🔴 无模块');
// ③-c：只有「商品销量」（旧列名）也仍要判出 C（向后兼容 v1.6 的表述）
const minOld = [['商品名称', '商品销量', '销售额'], null, null];
check('3-③ 旧列名「商品销量」的表同样判出 C（向后兼容）',
  !!(S && S.detectDishShape(minOld) === 'waimai_goods'), S ? String(S.detectDishShape(minOld)) : '🔴 无模块');
// ③-d：缺「销售额」⇒ 不得判 C（精度条件生效，避免把任意商品表都认成 C）
const minNoSales = [['商品名称', '销量'], null, null];
check('3-④ 缺「销售额」⇒ **不得**判 C（精度条件生效）',
  !!(S && S.detectDishShape(minNoSales) !== 'waimai_goods'), S ? String(S.detectDishShape(minNoSales)) : '🔴 无模块');

sec('④ 条款落地（规范件在场 · 禁用「订单交易额」不得被删）');
const spec = rd(SPEC_REL);
check('4-① v1.7 形态C 订正规范在场', spec.length > 0, SPEC_REL);
// ⚠️ 判据不得写成「文件里出现过『订单交易额』且含『严禁/禁止』」—— 那样太宽松：
//    规范里红线 / 列清单等多处都提到该列，删掉**任一条**禁用句判据仍恒绿（V5 实证打不红）。
//    ⇒ 改为按**具体条款锚点**判定：§5.2 的「严禁取用」句 + 红线 R232-1 行，两处缺一即红。
const hasWarn52 = spec.indexOf('严禁取用') >= 0;
const hasRedLine = /R232-1[^\n]*订单交易额/.test(spec) || /订单交易额[^\n]*禁止/.test(spec);
check('4-② 规范 §5.2 明文「严禁取用」订单交易额（整单口径 ⇒ 重复计钱）',
  hasWarn52, hasWarn52 ? '✓' : '🔴 §5.2 禁用句被删/被改');
check('4-③ 规范红线 R232-1 明文禁止订单交易额作为 amount',
  hasRedLine, hasRedLine ? '✓' : '🔴 红线条目被删/被改');

console.log(`\n===== 形态C 判定守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
