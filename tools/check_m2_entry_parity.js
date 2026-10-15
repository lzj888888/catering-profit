#!/usr/bin/env node
// tools/check_m2_entry_parity.js —— M2 两条入口「判据等价」守卫（R297 · 第三轮查缺补漏）
//
// 为什么需要这一层（R297 第三轮实测坐实的真漏洞）：
//   M2 的同一套测算参数有**两条入库路径**：
//     ① `calcSandbox`（算 / 不写库）—— 判据在 `calcSandbox/validate.js::checkClean`
//     ② `savePlan`（**服务端自算快照**后落库）—— 判据在 `savePlan/validate.js`，**原实现只判 isFinite**
//   于是第二条入口把第一条的判据**整个绕开**（同族病第四例；前三例见 calcSandbox/validate.js 头注）。
//   实测（探针 `_probe_tmp/r297_saveplan_range.js`）：毛利率 150 ⇒ savePlan **放行**，
//   内联引擎算出快照保本 **18444.45** 元（正常 42564.11）并**落库成"方案"**，
//   方案列表 / 多方案对比页从此拿这个假数字当数。
//   而 `pages/sandbox/index.js::onSavePlan` **不要求先算成功**（只校验方案名）⇒ 老板填 150、
//   点计算报错、但"保存"照样成功 ⇒ 静默错账落盘。
//
// 为什么是「副本 + 守卫钉等价」而不是共享文件：
//   每个云函数是**独立上传包**，`savePlan` 不能 require `calcSandbox` 的 validate.js
//   ⇒ 与 `utils/bizPreset.js::BUILD_DEFAULT_YEARS` 前端副本同一范式：**副本 + 机器钉等价**。
//   本守卫的核心断言就是「同一张用例表双跑 ⇒ 判决必须一致」，漂移即红。
//
// 判据（P/A/B/C/D 五段，fail-closed）：
//   P 前置    两个 validate 可 require、savePlan 有 checkParamRanges、页面有 badParamOf 且两个入口都调
//   A 等价    12 用例「同表双跑」：calcSandbox 判决 ≡ savePlan 判决（拒/放行必须同向）
//   B 反静默  savePlan 对 9 类越界**逐个**必须拒（真执行）
//   C 变异    绕过 savePlan 校验直接跑 paramToClean + 内联引擎 ⇒ 150 确实算出 18444（证据有效）
//   D 单源    savePlan 白名单取自 indicatorRef（不硬编码枚举）/ 上限常量各一处 / 扫描面非空 / 断言数下界
//
// 运行：node tools/check_m2_entry_parity.js   （由 verify_all.js 的 [m2-entry-parity] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CF = (p) => path.join(ROOT, 'cloudfunctions', p);
const SP_VALIDATE = 'cloudfunctions/savePlan/validate.js';
const SP_INDEX = 'cloudfunctions/savePlan/index.js';
const SP_MAP = 'cloudfunctions/savePlan/paramMap.js';
const SANDBOX_PAGE = 'pages/sandbox/index.js';

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
sec('P 前置（可 require / 判据函数在位 / 接线真实）');
let SV = null, SS = null, PM = null, SP = null, okAll = true;
try { SV = require(CF('calcSandbox/validate.js')); } catch (e) { okAll = false; check('P-① 可读 calcSandbox/validate.js', false, e.message); }
try { SS = require(CF('savePlan/validate.js')); } catch (e) { okAll = false; check('P-② 可读 savePlan/validate.js', false, e.message); }
try { PM = require(CF('savePlan/paramMap.js')); } catch (e) { okAll = false; check('P-③ 可读 savePlan/paramMap.js', false, e.message); }
try { SP = require(CF('savePlan/service.js')); } catch (e) { okAll = false; check('P-④ 可读 savePlan/service.js', false, e.message); }
if (okAll) check('P-①~④ 四个模块均可 require', true, 'calcSandbox/validate · savePlan/validate · paramMap · service');
check('P-⑤ calcSandbox 导出 validateClean', !!(SV && typeof SV.validateClean === 'function'));
check('P-⑥ savePlan 导出 validateInput', !!(SS && typeof SS.validateInput === 'function'));
check('P-⑦ savePlan/service 导出 calcSandbox（内联引擎副本）', !!(SP && typeof SP.calcSandbox === 'function'));

const spSrc = okAll ? readRel(SP_VALIDATE) : '';
const sps = stripComments(spSrc);
check('P-⑧ savePlan/validate.js 存在范围判据函数 checkParamRanges', /function\s+checkParamRanges\s*\(/.test(sps));
check('P-⑨ 且 validateInput 真的调用了它（防"写了没人用"）',
  /checkParamRanges\s*\(/.test(sps.slice(sps.indexOf('function validateInput'))));
const pageSrc = okAll ? stripComments(readRel(SANDBOX_PAGE)) : '';
check('P-⑩ 沙盘页有 badParamOf 体检', /badParamOf\s*\(/.test(pageSrc));
check('P-⑪ 计算入口（onCalcPresetFwd）调了 badParamOf',
  /this\.badParamOf\s*\(/.test(pageSrc.slice(pageSrc.indexOf('async onCalcPresetFwd'))));
check('P-⑫ 保存入口（onSavePlan）调了 badParamOf —— 保存不许绕过体检',
  /this\.badParamOf\s*\(/.test(pageSrc.slice(pageSrc.indexOf('async onSavePlan'), pageSrc.indexOf('async onSavePlan') + 900)));
check('P-⑬ savePlan/index.js 服务端自算快照（故越界值会变成假快照落库）',
  /calcSandbox\s*\(/.test(readRel(SP_INDEX)));

// ============ 用例表：同一逻辑输入 → 两条入口各自的 payload ============
const y2f = (y) => Math.round(Number(y) * 100);
// spec: { marginPct, rentFen, buildYears, varPct, fixKey, bizType, dupKey, revMode }
function cleanOf(s) {
  return {
    mode: s.revMode ? 'reverse' : 'forward',
    cityTier: 'tier23',
    bizType: s.bizType || 'fastfood',
    buildItems: [{ key: 'other', fen: y2f(60000), years: s.buildYears }],
    fixedItems: [{ key: s.fixKey || 'rent', fen: s.rentFen === undefined ? y2f(8000) : s.rentFen }].concat(
      s.dupKey ? [{ key: s.dupKey, fen: y2f(100) }] : []
    ),
    varItems: s.varPct === undefined ? [] : [{ key: 'other', pct: s.varPct }],
    grossMarginPct: s.marginPct === undefined ? 65 : s.marginPct,
    targetProfitFen: y2f(20000),
    expectedRevenueFen: 0,
    rev_price_fen: s.revMode ? y2f(45) : 0,
    seats: s.revMode ? 20 : 0,
    open_days: s.revMode ? 30 : 0,
    target_rent_rate: s.revMode ? 12 : 0,
    pixel_eff_fen: 0,
  };
}
function paramOf(s) {
  const c = cleanOf(s);
  return {
    mode: c.mode,
    city_tier: c.cityTier,
    biz_type: c.bizType,
    build_items: c.buildItems,
    fixed_items: c.fixedItems,
    var_items: c.varItems,
    gross_margin_pct: c.grossMarginPct,
    target_profit_fen: c.targetProfitFen,
    expected_revenue_fen: c.expectedRevenueFen,
    rev_price_fen: c.rev_price_fen,
    seats: c.seats,
    open_days: c.open_days,
    target_rent_rate: c.target_rent_rate,
    pixel_eff_fen: c.pixel_eff_fen,
  };
}
const verdictCalc = (s) => {
  try { return !!SV.validateClean(cleanOf(s)).error; } catch (e) { return 'THROW'; }
};
const verdictSave = (s) => {
  try {
    const v = SS.validateInput({ shop_id: 'probe-shop', plan: { sandbox_type: 'biz_sim', name: '探针', param_json: paramOf(s) } });
    return !!v.error;
  } catch (e) { return 'THROW'; }
};

// ============ A 同表双跑：判决必须一致 ============
sec('A 等价：同一张用例表双跑，calcSandbox 判决 ≡ savePlan 判决');
const CASES = [
  ['A-① 合法（毛利率 65 / 正数房租 / 年限 3）', {}],
  ['A-② 毛利率 150（>100）', { marginPct: 150 }],
  ['A-③ 毛利率 -20', { marginPct: -20 }],
  ['A-④ 毛利率 100.5（非整但越界）', { marginPct: 100.5 }],
  ['A-⑤ 毛利率 0（边界合法）', { marginPct: 0 }],
  ['A-⑥ 毛利率 100（边界合法）', { marginPct: 100 }],
  ['A-⑦ 房租为负', { rentFen: -y2f(8000) }],
  ['A-⑧ 年限 0', { buildYears: 0 }],
  ['A-⑨ 年限 99（>20）', { buildYears: 99 }],
  ['A-⑩ 年限 2.5（非整数）', { buildYears: 2.5 }],
  ['A-⑪ 变效率 300（>100）', { varPct: 300 }],
  ['A-⑫ bizType 非法', { bizType: 'noodle_shop' }],
  ['A-⑬ 费用 key 重复', { fixKey: 'labor', dupKey: 'labor' }],
  ['A-⑭ 反推模式（合法，固定支出不含 rent）', { revMode: true, marginPct: 60, fixKey: 'labor' }],
  ['A-⑯ 反推模式却填了 rent（重复计租）⇒ 两入口都应拒', { revMode: true, marginPct: 60 }],
  ['A-⑰ 年限缺失（两入口都应归一后放行）', { buildYears: undefined }],
];
let same = 0;
for (const [name, spec] of CASES) {
  const a = verdictCalc(spec), b = verdictSave(spec);
  const eq = a === b;
  if (eq) same++;
  check(name + ' —— 两入口判决一致', eq, eq ? (a ? '都拒' : '都放行') : `calcSandbox=${a} / savePlan=${b}`);
}
check('A-⑮ 用例表非退化（≥12 例且一致率 = 全表）', CASES.length >= 12 && same === CASES.length, `${same}/${CASES.length} 一致`);

// ============ B savePlan 逐个拒（真执行） ============
sec('B 反静默：savePlan 必须逐个拒掉越界（原实现全部放行）');
const MUST_REJECT = [
  ['B-① 毛利率 150 ⇒ 拒（原：放行并算出假快照 18444）', { marginPct: 150 }],
  ['B-② 毛利率 100.5 ⇒ 拒', { marginPct: 100.5 }],
  ['B-③ 毛利率 -20 ⇒ 拒', { marginPct: -20 }],
  ['B-④ 房租为负 ⇒ 拒', { rentFen: -y2f(8000) }],
  ['B-⑤ 年限 0 ⇒ 拒', { buildYears: 0 }],
  ['B-⑥ 年限 99 ⇒ 拒', { buildYears: 99 }],
  ['B-⑦ 变效率 300 ⇒ 拒', { varPct: 300 }],
  ['B-⑧ bizType 不在白名单 ⇒ 拒', { bizType: 'noodle_shop' }],
  ['B-⑨ 固定费用 key 重复 ⇒ 拒', { fixKey: 'labor', dupKey: 'labor' }],
];
for (const [name, spec] of MUST_REJECT) {
  const v = verdictSave(spec);
  check(name, v === true, v === true ? '已拒' : `未拒（v=${v}）`);
}
// 正样本：合法 / 年限缺省必须放行
const vLegal = SS.validateInput({ shop_id: 's', plan: { sandbox_type: 'biz_sim', name: 'n', param_json: paramOf({}) } });
check('B-⑩ 合法参数 ⇒ 放行（不许误杀）', !!(vLegal && !vLegal.error));
{
  const pj = paramOf({}); delete pj.build_items[0].years;   // 年限缺失
  const v2 = SS.validateInput({ shop_id: 's', plan: { sandbox_type: 'biz_sim', name: 'n', param_json: pj } });
  check('B-⑪ 年限缺失 ⇒ 补单源默认后放行（归一，不是拒绝）', !!(v2 && !v2.error),
    v2 && !v2.error ? `归一为 ${v2.plan.param_json.build_items[0].years} 年` : String(v2 && v2.msg));
}

// ============ C 变异互证：绕开校验就真有假快照 ============
sec('C 变异互证：绕过 savePlan 校验（复刻改前行为）确实产出假快照');
{
  const beOf = (pj) => {
    try {
      const r = SP.calcSandbox(PM.paramToClean(pj));
      return r && r.break_even_monthly_fen;
    } catch (e) { return null; }
  };
  const bad150 = beOf(paramOf({ marginPct: 150 }));
  const legal = beOf(paramOf({ marginPct: 65 }));
  check('C-① 改前路径（无范围判据）对毛利率 150 照样算出快照 ⇒ 证明证据有效',
    Number.isFinite(Number(bad150)) && Number(bad150) > 0,
    bad150 == null ? '未算出' : `150 ⇒ ${(Number(bad150) / 100).toFixed(2)} 元 / 合法 65 ⇒ ${(Number(legal) / 100).toFixed(2)} 元`);
  check('C-② 假快照比合法值**低**（方向 = 更好看 ⇒ 会误导决策）',
    Number(bad150) < Number(legal), `${(Number(bad150) / 100).toFixed(2)} < ${(Number(legal) / 100).toFixed(2)}`);
  // C-③ 归一后同数：两条入口对「年限缺失」都应补成单源默认 3 年 ⇒ 快照必须完全相同
  const pjNoYears = paramOf({}); delete pjNoYears.build_items[0].years;
  const vN = SS.validateInput({ shop_id: 's', plan: { sandbox_type: 'biz_sim', name: 'n', param_json: pjNoYears } });
  const cN = SV.validateClean(cleanOf({ buildYears: undefined }));
  const beSave = vN.error ? null : SP.calcSandbox(PM.paramToClean(vN.plan.param_json)).break_even_monthly_fen;
  const beCalc = cN.error ? null : SP.calcSandbox(cN.clean).break_even_monthly_fen;
  check('C-③ 年限缺失时两入口归一后**同数**（savePlan≡calcSandbox）',
    beSave != null && String(beSave) === String(beCalc),
    `savePlan ${beSave == null ? 'null' : (Number(beSave) / 100).toFixed(2)} / calcSandbox ${beCalc == null ? 'null' : (Number(beCalc) / 100).toFixed(2)} 元`);
}

// ============ D 自失效护栏 ============
sec('D 自失效护栏（单源 / 常量单处 / 扫描面 / 断言数下界）');
check('D-① savePlan 的白名单取自 indicatorRef（不硬编码业态/费用枚举）',
  /indicatorRef\.(BIZ_KEYS|CITY_KEYS|FIXED_KEYS|VAR_KEYS|BUILD_KEYS)/.test(sps),
  '白名单单源');
check('D-② savePlan 不出现硬编码的业态枚举（防第二份口径）',
  !/['"]fastfood['"]\s*,\s*['"]dining['"]/.test(sps));
check('D-③ 年限上限常量在 savePlan 内只定义一处（MAX_BUILD_YEARS）',
  (sps.match(/MAX_BUILD_YEARS\s*=/g) || []).length === 1,
  `出现 ${(sps.match(/MAX_BUILD_YEARS\s*=/g) || []).length} 次`);
check('D-④ 清单上限常量在 savePlan 内只定义一处（MAX_ITEMS）',
  (sps.match(/MAX_ITEMS\s*=/g) || []).length === 1,
  `出现 ${(sps.match(/MAX_ITEMS\s*=/g) || []).length} 次`);
check('D-⑤ 扫描面非空（用例表 + 必拒表都达下界）',
  CASES.length >= 12 && MUST_REJECT.length >= 8, `用例 ${CASES.length} / 必拒 ${MUST_REJECT.length}`);
check('D-⑥ 本守卫断言数 ≥ 25（非恒真证明力下界）', pass >= 25, `当前累计 ${pass} 条`);

console.log(`\n===== M2 入口判据等价守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
