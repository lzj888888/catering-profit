#!/usr/bin/env node
// tools/check_matrix_validate.js —— M2「场景矩阵」逐行入参校验守卫（R297 · 第二轮查缺补漏）
//
// 为什么需要这一层（R297 第二轮实测坐实的真漏洞，不是猜的）：
//   `cloudfunctions/calcSandbox/index.js` 的 `action:'matrix'`（G1 场景矩阵，免费引流）分支，
//   改前**完全绕过 validateInput** —— 直接 `arr.map((c) => calcSandbox(c))` 把前端送来的裸 clean 喂引擎。
//   而矩阵页四档维度（房租/人数/毛利率/目标利润）是**自由文本**：`onDimInput` 只管存，
//   `onGenerate` 只判 `isFinite` ⇒ 老板填「毛利率 150」/「房租 -8000」一路静默到云。
//   实测（探针 `_probe_tmp/r297_matrix_robust.js`，基准保本 46111.12 元）：
//     毛利率 150      ⇒ 保本 **18444.45** 元（合理值应为拒答）
//     房租 -8000      ⇒ 保本 **19444.45** 元
//     fixedItems 缺失 ⇒ 保本 **2777.78** 元
//     years 缺失/为 0 ⇒ 建店投入**完全不摊**（引擎 `if (years > 0)`）⇒ 保本 49111→46333（−5.7%）
//   全部**零报错**，且偏差方向一律是「保本更低 = 更好看」—— 正是最危险的一类。
//   同族病第三次出现：**单源（`validate.js`）写了，但被另一条入口架空成死代码**。
//
// 修法（本守卫锁死的东西）：
//   · `calcSandbox/validate.js`：字段级判据**只有 `checkClean` 一份**，
//     wire 入口 `validateInput` 与 clean 入口 `validateClean` **共用**（禁止复制第二套）
//   · `index.js` matrix 分支：逐行 `validateClean` ⇒ 算不出的档位给 **null + rejected 人话**，
//     **绝不用一个能算但错的数顶上**；全部算不出 ⇒ 响亮 fail
//   · `pages/sandbox/matrix.js`：`badDimOf()` 在发起前挡一道 + `toRow` 对 null 给占位行
//
// 判据（P/A/B/C/D 五段，fail-closed；解析不到即判红）：
//   P 前置    文件在位、导出 validateClean、matrix 分支真的调它、页面有 badDimOf
//   A 反静默  10 个非法/边界 clean 直接跑 validateClean（真执行，非文本匹配）
//   B 单源    validateInput 与 validateClean 都调用 checkClean（防两份判据漂移）
//   C 变异    绕过 validateClean 直接 calcSandbox **确实能算出数** ⇒ 证明本守卫不是空转
//   D 护栏    页面层前置校验/空档不误判/扫描面非空/断言数下界
//
// 运行：node tools/check_matrix_validate.js   （由 verify_all.js 的 [matrix-validate] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF_VALIDATE = 'cloudfunctions/calcSandbox/validate.js';
const CF_INDEX = 'cloudfunctions/calcSandbox/index.js';
const PAGE = 'pages/sandbox/matrix.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ============ P 前置 ============
sec('P 前置（文件在位 / 导出齐全 / 接线真实）');
let V = null, SVC = null, ok = true;
try { V = require(path.join(ROOT, CF_VALIDATE)); } catch (e) { ok = false; check('P-① 可读 calcSandbox/validate.js', false, String(e.message)); }
try { SVC = require(path.join(ROOT, 'cloudfunctions/calcSandbox/service.js')); } catch (e) { ok = false; check('P-② 可读 calcSandbox/service.js', false, String(e.message)); }
if (ok) check('P-① cloudfunctions/calcSandbox/validate.js 可 require', true);
if (ok) check('P-② cloudfunctions/calcSandbox/service.js 可 require', true);
check('P-③ validate.js 导出 validateClean', !!(V && typeof V.validateClean === 'function'), typeof (V && V.validateClean));
check('P-④ validate.js 仍导出 validateInput（旧入口不许丢）', !!(V && typeof V.validateInput === 'function'));
check('P-⑤ service 导出 calcSandbox', !!(SVC && typeof SVC.calcSandbox === 'function'));

const vSrc = ok ? readRel(CF_VALIDATE) : '';
const iSrc = ok ? readRel(CF_INDEX) : '';
const pSrc = ok ? readRel(PAGE) : '';
const mxAt = iSrc.indexOf("action === 'matrix'");
check('P-⑥ index.js 仍有 matrix action 分支', mxAt > 0);
const mxBody = mxAt > 0 ? iSrc.slice(mxAt, iSrc.indexOf('const shopId', mxAt) > 0 ? iSrc.indexOf('const shopId', mxAt) : iSrc.length) : '';
check('P-⑦ matrix 分支真的调用了 validateClean（防"写了没人用"）', /validateClean\s*\(/.test(mxBody));
check('P-⑧ matrix 分支仍批量复用引擎 calcSandbox（引擎零改）', /calcSandbox\s*\(/.test(mxBody));
check('P-⑨ matrix 分支把算不出的档位置为 null（不静默编数）', /return\s+null/.test(mxBody));
check('P-⑩ 页面 pages/sandbox/matrix.js 有 badDimOf 维度体检', /badDimOf\s*\(/.test(pSrc));
check('P-⑪ onGenerate 真的调用了 badDimOf（防"函数写了没人用"）',
  /badDimOf\s*\(\s*\)/.test(stripComments(pSrc).slice(stripComments(pSrc).indexOf('async onGenerate'))));
check('P-⑫ toRow 对 res 为空有占位行（旧码直接解引用 ⇒ 整张矩阵崩成"出错"）',
  /if\s*\(\s*!res\s*\)/.test(stripComments(pSrc)));

// ============ A 行为级：非法档位必须被拒（真执行） ============
sec('A 反静默：非法 clean 必须被 validateClean 拒（真跑，非文本匹配）');
const y2f = (y) => Math.round(Number(y) * 100);
const base = () => ({
  cityTier: 'tier23',
  bizType: 'fastfood',
  fixedItems: [{ key: 'rent', fen: y2f(8000) }, { key: 'labor', fen: y2f(18000) }],
  varItems: [],
  buildItems: [{ key: 'other', fen: y2f(60000), years: 3 }],
  grossMarginPct: 60,
  targetProfitFen: y2f(20000),
  expectedRevenueFen: 0,
});
const BAD = [
  ['A-① 毛利率 150（>100）', (c) => { c.grossMarginPct = 150; return c; }],
  ['A-② 毛利率 -20', (c) => { c.grossMarginPct = -20; return c; }],
  ['A-③ 房租为负', (c) => { c.fixedItems[0].fen = -y2f(8000); return c; }],
  ['A-④ 变效率 300（>100）', (c) => { c.varItems = [{ key: 'other', pct: 300 }]; return c; }],
  ['A-⑤ 年限 0（清空）', (c) => { c.buildItems[0].years = 0; return c; }],
  ['A-⑥ 年限 99（>20）', (c) => { c.buildItems[0].years = 99; return c; }],
  ['A-⑦ fixedItems 缺失', (c) => { delete c.fixedItems; return c; }],
  ['A-⑧ bizType 非法', (c) => { c.bizType = 'noodle_shop'; return c; }],
  ['A-⑨ cityTier 非法', (c) => { c.cityTier = 'mars'; return c; }],
  ['A-⑩ 费用 key 重复（指标对照会串）', (c) => { c.fixedItems.push({ key: 'rent', fen: y2f(100) }); return c; }],
];
for (const [name, mut] of BAD) {
  let r = null;
  try { r = V.validateClean(mut(base())); } catch (e) { r = null; }
  check(name + ' ⇒ 必须拒', !!(r && r.error), r && r.error ? r.msg : '未拒（会静默产数）');
}
// 正样本：合法与"应补默认值"的必须放行
const GOOD = [
  ['A-⑪ 合法基准', (c) => c],
  ['A-⑫ 年限缺失 ⇒ 补单源默认（与单算同口径）', (c) => { delete c.buildItems[0].years; return c; }],
  ['A-⑬ 毛利率 0（边界合法，引擎自会 fail-closed）', (c) => { c.grossMarginPct = 0; return c; }],
  ['A-⑭ 无 mode（矩阵页不发 mode ⇒ 按 forward）', (c) => { delete c.mode; return c; }],
];
for (const [name, mut] of GOOD) {
  let r = null;
  try { r = V.validateClean(mut(base())); } catch (e) { r = null; }
  check(name + ' ⇒ 必须放行', !!(r && !r.error), r && r.error ? r.msg : 'ok');
}

// ============ B 单源：两个入口共用 checkClean ============
sec('B 单源：wire 入口与 clean 入口共用同一套字段级判据');
const vs = stripComments(vSrc);
check('B-① 存在 checkClean 单一实现', /function\s+checkClean\s*\(/.test(vs));
const viBody = vs.slice(vs.indexOf('function validateInput'), vs.indexOf('module.exports'));
check('B-② validateInput 调用 checkClean（不许自己再写一套）', /checkClean\s*\(/.test(viBody));
const vcBody = vs.slice(vs.indexOf('function validateClean'), vs.indexOf('function validateInput'));
check('B-③ validateClean 调用 checkClean', /checkClean\s*\(/.test(vcBody));
// 反向：validateInput 体内不得再出现内联的「不在白名单」类判据（那就是第二套口径）
check('B-④ validateInput 体内无第二套白名单判据（防双份口径漂移）',
  !/不在白名单/.test(viBody), viBody.includes('不在白名单') ? '发现内联白名单判据' : '仅走 checkClean');
check('B-⑤ 年限上下界常量只有一处定义（MAX_BUILD_YEARS）',
  (vs.match(/MAX_BUILD_YEARS\s*=/g) || []).length === 1,
  `出现 ${(vs.match(/MAX_BUILD_YEARS\s*=/g) || []).length} 次`);

// ============ C 变异互证：证明"不校验就会静默产数"（守卫不是空转） ============
sec('C 变异互证：绕过校验直接喂引擎（复刻改前代码）确实能算出数');
{
  const bad150 = (() => { const c = base(); c.grossMarginPct = 150; return c; })();
  const raw = SVC.calcSandbox(bad150);
  const be = raw && raw.break_even_monthly_fen;
  check('C-① 改前路径（无校验）对毛利率 150 仍会算出数字 ⇒ 证明校验证据有效',
    Number.isFinite(Number(be)), `保本 ${(Number(be) / 100).toFixed(2)} 元（修复后应为拒答）`);
  const legal = SVC.calcSandbox(V.validateClean(base()).clean);
  check('C-② 合法档位修复前后同数（修复没改变正常结果）',
    String(legal.break_even_monthly_fen) === String(SVC.calcSandbox(base()).break_even_monthly_fen),
    `${(legal.break_even_monthly_fen / 100).toFixed(2)} 元`);
  const noYears = (() => { const c = base(); delete c.buildItems[0].years; return c; })();
  const ny = SVC.calcSandbox(noYears);
  check('C-③ 引擎对 years 缺失确实「完全不摊」（方向：保本偏低）',
    Number(ny.build_amort_monthly_fen) === 0,
    `月摊销 ${(Number(ny.build_amort_monthly_fen) / 100).toFixed(2)} 元 / 保本 ${(ny.break_even_monthly_fen / 100).toFixed(2)} 元`);
}

// ============ D 自失效护栏 ============
sec('D 自失效护栏（页面层 / 扫描面 / 断言数下界）');
const ps = stripComments(pSrc);
check('D-① 页面对毛利率真判 0~100 上界（防只判下界）', /毛利率['"]?\s*,\s*0\s*,\s*100/.test(ps));
check('D-② 页面对房租/人数/目标利润判非负', /房租['"]?\s*,\s*0\s*,/.test(ps) && /人数['"]?\s*,\s*0\s*,/.test(ps));
check('D-③ badDimOf 跳过空档（不把"没填"误判成越界）', /raw\s*===\s*['"]{2}/.test(ps) || /===\s*''/.test(ps));
check('D-④ 扫描面非空（负样本 ≥ 8 且正样本 ≥ 3）', BAD.length >= 8 && GOOD.length >= 4,
  `负 ${BAD.length} / 正 ${GOOD.length}`);
check('D-⑤ 云端把 rejected 明细返回前端（静默丢档即红）', /rejected/.test(iSrc));
check('D-⑥ 本守卫断言数 ≥ 20（非恒真证明力下界）', pass >= 20, `当前累计 ${pass} 条`);

console.log(`\n===== 矩阵逐行校验守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
