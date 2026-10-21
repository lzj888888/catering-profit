#!/usr/bin/env node
// tools/check_yield_rate_range.js —— M3「出成率」上界守卫（R297 · 第一轮查缺补漏）
//
// 为什么需要这一层（R297 实测坐实的真漏洞，不是猜的）：
//   净料单位成本 = **单价 ÷ 出成率**（`subpkg/biz/card/edit.js::manualNetUnitWan`）。
//   原写法 `const y = Number(yieldRate) || 100;` 只兜了 0 / NaN / 空串，**没有上界**。
//   老板填 150 ⇒ 成本被 ÷1.5 ⇒ 实测（R297 探针 `review/evidence` 口径）：
//     60 元/斤的牛肉、每份 200 克 —— 单份成本 24.00 ⇒ **16.00 元（−33.3%）**，
//     毛利率 64.71% ⇒ **76.47%（相对虚高 18.2%）**，而全程**零报错**。
//   这是最危险的一类错：老板看到的不是"算不出来"，而是一个**好看的假数字**。
//
//   更隐蔽的是「单源被架空」：云端 `saveCostCard/validate.js` 里那条
//     `yield_rate ∈ (0,100]` 校验**永远走不到** —— 前端只送 `net_unit_cost` 快照，
//     出成率根本不上云 ⇒ 云端守不住（与 R297 建店年限同一族：单源写了，被前端架空成死代码）。
//     ⚠️ 原料档案侧（`saveMaterial/validate.js`）**有**这条校验 ⇒ 那边是"报错"而非静默错账，
//     但它的 msg 到不了用户眼前（R271：`utils/api.js:47` 把 fail 的 msg 覆盖成通用文案）
//     ⇒ 老板只看到一句"出错了"，不知道是哪一格。故前端也必须前置给人话。
//
// 修法（本守卫锁死的东西）：
//   · 唯一入口 `utils/units.js::yieldRateOf(raw)`：未填=100（不折损）；**越界/非法=null（不静默编数）**
//   · `subpkg/biz/card/edit.js`：`manualNetUnitWan` 用它 + `badYieldOf()` 在反算/保存两条路前置拦截
//   · `subpkg/biz/material/edit.js`：保存前同样前置，给人话提示
//   · 术语 `TERMS.card.yieldRangeErr` 双副本一致
//
// 判据（P/A/B/C/D 五段，fail-closed；解析不到即判红）：
//   P 前置    units 可 require 且导出 yieldRateOf / 两个页面可读 / 术语双副本可读且一致
//   A 行为    yieldRateOf 十一例（空=100 / 合法 / 0 / 负 / 150 / 1000 / NaN / 小数 / 带空格）
//   B 反裸兜  pages 剥注释后零「Number(yield…) || 100」旧裸兜写法（含正则正负样本互证）
//   C 接线    两页**真的**调用了 units.yieldRateOf（防"函数写了没人用"）
//   D 护栏    云端 (0,100] 校验仍存在（单源不被删）+ 扫描面非空 + 断言数下界
//
// 运行：node tools/check_yield_rate_range.js   （由 verify_all.js 的 [yield-rate-range] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UNITS = 'utils/units.js';
const CARD_EDIT = 'subpkg/biz/card/edit.js';
const MAT_EDIT = 'subpkg/biz/material/edit.js';
const TERMS_A = 'miniprogram/i18n/terms.js';
const TERMS_B = 'specs/dev-specs/i18n/terms.js';
const CF_VALIDATE = 'cloudfunctions/saveMaterial/validate.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

// ============ P 前置（fail-closed）============
sec('P 前置（fail-closed：读不到 / require 不出即判红）');
let units = null;
try { units = require(path.join(ROOT, UNITS)); } catch (e) { units = null; }
check('P-① utils/units.js 可 require', !!units, units ? UNITS : `${UNITS} require 失败`);
check('P-② 导出 yieldRateOf', !!units && typeof units.yieldRateOf === 'function', typeof (units && units.yieldRateOf));

let card = '', mat = '', termsA = '', termsB = '', cfv = '';
try { card = readRel(CARD_EDIT); } catch (e) { card = ''; }
try { mat = readRel(MAT_EDIT); } catch (e) { mat = ''; }
try { termsA = readRel(TERMS_A); } catch (e) { termsA = ''; }
try { termsB = readRel(TERMS_B); } catch (e) { termsB = ''; }
try { cfv = readRel(CF_VALIDATE); } catch (e) { cfv = ''; }
check('P-③ 两个录入页可读', !!card && !!mat, `${CARD_EDIT} ${card.length} 字符 / ${MAT_EDIT} ${mat.length} 字符`);
check('P-④ 术语双副本可读', !!termsA && !!termsB, `${TERMS_A} / ${TERMS_B}`);
check('P-⑤ 🔴 术语双副本**逐字节**一致（副本漂移即红）', termsA === termsB && termsA.length > 0,
  termsA === termsB ? `${termsA.length} 字符全等` : `不一致（${termsA.length} vs ${termsB.length}）`);
check('P-⑥ 云端 saveMaterial 校验可读', !!cfv, `${CF_VALIDATE} ${cfv.length} 字符`);

if (!units || typeof units.yieldRateOf !== 'function' || !card || !mat || termsA !== termsB) {
  console.log(`\n===== 出成率上界守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败 ⇒ 后续判据无意义，直接判红（fail-closed）');
  process.exit(1);
}

// ============ A 行为级：yieldRateOf 十一例 ============
sec('A 行为级：yieldRateOf 归一（未填=100 / 合法 / 0 / 负 / 越界 / NaN / 小数 / 空格）');
{
  const Y = units.yieldRateOf;
  const cases = [
    ['未填（空串）⇒ 100（不折损，与预填默认同义）', Y('') === 100],
    ['null ⇒ 100', Y(null) === 100],
    ['undefined ⇒ 100', Y(undefined) === 100],
    ['100 ⇒ 100', Y('100') === 100],
    ['数字 100 ⇒ 100', Y(100) === 100],
    ['带空格 " 80 " ⇒ 80', Y(' 80 ') === 80],
    ['小数 99.5 ⇒ 99.5', Y('99.5') === 99.5],
    ['零头 0.5 ⇒ 0.5（合法下沿，不静默当 100）', Y('0.5') === 0.5],
    ['🔴 0 ⇒ null（不得静默回落 100）', Y('0') === null],
    ['🔴 负数 −5 ⇒ null', Y('-5') === null],
    ['🔴🔴 150 ⇒ null（R297 漏洞本体：旧行为是 ÷1.5 低估成本）', Y(150) === null],
    ['🔴 1000 ⇒ null（夸张值同样不得放行）', Y('1000') === null],
    ['🔴 非数字 "abc" ⇒ null', Y('abc') === null],
  ];
  const bad = cases.filter((c) => !c[1]).map((c) => c[0]);
  check(`A-① yieldRateOf ${cases.length} 例全中`, bad.length === 0,
    bad.length ? '不符：' + bad.join('；') : `${cases.length}/${cases.length}`);
  // A-② 正向钉死：证明「填 150」这条路径**真的**不再产出可用数字
  check('A-② 🔴 越界样本三连（150/1000/−5）全部 = null（漏洞正向钉死）',
    Y(150) === null && Y('1000') === null && Y('-5') === null,
    `150→${Y(150)} / 1000→${Y('1000')} / -5→${Y('-5')}`);
  // A-③ 反向护栏：合法区间**不得**被误杀（101 个整数采样，仅 1~100 放行）
  {
    const wrong = [];
    for (let n = -10; n <= 110; n++) {
      const got = Y(String(n));
      const want = (n >= 1 && n <= 100) ? n : null;
      if (got !== want) wrong.push(`${n}→${got}(应 ${want})`);
    }
    check('A-③ 整区间 −10~110 逐点扫描（仅 1~100 放行，其余 null）', wrong.length === 0,
      wrong.length ? '误判：' + wrong.slice(0, 8).join('，') : '121 点全对');
  }
}

// ============ B 反裸兜：页面层零旧写法 ============
sec('B 反裸兜：页面层零「Number(yield…) || 100」旧写法');
const RE_BARE = /Number\s*\(\s*[^()]*[Yy]ield[^()]*\)\s*\|\|\s*100(?![\d.])/;
{
  const hits = [];
  for (const [rel, txt] of [[CARD_EDIT, card], [MAT_EDIT, mat]]) {
    stripComments(txt).split(/\r?\n/).forEach((l, i) => {
      if (RE_BARE.test(l)) hits.push(`${rel}:${i + 1} 「${l.trim().slice(0, 70)}」`);
    });
  }
  check('B-① 两个录入页零旧裸兜（剥注释后）', hits.length === 0, hits.length ? hits.join('；') : '2 份全扫，0 命中');

  const pos = [
    ['旧写法 Number(yieldRate) || 100 命中', RE_BARE.test('const y = Number(yieldRate) || 100;')],
    ['旧写法 Number(this.data.yield_rate) || 100 命中', RE_BARE.test('yield_rate: Number(this.data.yield_rate) || 100,')],
  ];
  const neg = [
    ['新写法 units.yieldRateOf(...) 不命中', !RE_BARE.test('const y = units.yieldRateOf(yieldRate);')],
    ['普通 || 100 兜底（非 yield）不命中', !RE_BARE.test('const x = Number(foo) || 100;')],
  ];
  const badC = pos.concat(neg).filter((c) => !c[1]).map((c) => c[0]);
  check(`B-② 判据正负样本互证 ${pos.length + neg.length} 例`, badC.length === 0,
    badC.length ? '失败：' + badC.join('；') : `${pos.length + neg.length}/${pos.length + neg.length} 如期`);
  check('B-③ 剥注释器互证（注释里的旧写法被剥 · 代码里保留）',
    !RE_BARE.test(stripComments('// const y = Number(yieldRate) || 100;\nconst a=1;'))
    && RE_BARE.test(stripComments('const y = Number(yieldRate) || 100;')),
    '行注释[剥] 代码[保留✅]');
}

// ============ C 接线：两页真的调用了新入口 ============
sec('C 接线：调用点真的存在（防「函数写了没人用」）');
{
  const cnt = (s) => (s.match(/yieldRateOf/g) || []).length;
  const cCnt = cnt(stripComments(card)), mCnt = cnt(stripComments(mat));
  check('C-① 菜品卡页 ≥2 处调用（manualNetUnitWan + badYieldOf）', cCnt >= 2, `实得 ${cCnt} 处`);
  check('C-② 原料档案页 ≥1 处调用', mCnt >= 1, `实得 ${mCnt} 处`);
  check('C-③ 术语 yieldRangeErr 在两页均有引用',
    stripComments(card).includes('yieldRangeErr') && stripComments(mat).includes('yieldRangeErr'),
    '两页均引用（提示走人话，不复用"单价"误导文案）');
  check('C-④ 术语 yieldRangeErr 已登记（双副本）',
    termsA.includes('yieldRangeErr'), 'terms 双副本均已登记');
  // C-⑤ 反算 / 保存两条路都要拦（只拦一条 = 另一条照样算错）
  check('C-⑤ 🔴 反算（buildCalcLines）与保存（doSave）两条路都前置拦截',
    /buildCalcLines\(\)\s*\{[\s\S]{0,400}?badYieldOf/.test(stripComments(card))
    && /async doSave\(\)\s*\{[\s\S]{0,400}?badYieldOf/.test(stripComments(card)),
    '两条路均命中 badYieldOf 前置');
}

// ============ E 五副本夹紧：netUnitCostWan 出成率/换算系数 fail-closed ============
// 🔴 R298（D2）：五份 netUnitCostWan（calcBom/getMaterial/saveCostCard/saveMaterial/syncCostCard）
//   原实现是**裸除** —— `(price/100)/cf/(yieldRate/100)`：出成率 0 ⇒ ÷0 = Infinity；
//   缺失/空串 ⇒ NaN；>100 ⇒ 成本被低估（R297 前端已拦，**云端无 validate 兜底**的手工行路径仍可达）。
//   夹紧口径与前端 `utils/units.js::yieldRateOf` 一致：越界/缺失 ⇒ 100（不折损，中性）；换算系数 ≤0 ⇒ 1。
//   本段判据：① 五副本都能解析求值；② 合法域输出与裸公式**完全一致**（证夹紧没改合法路径）；
//   ③ 越界/缺失输出**有限**且等于夹紧值；④ 裸实现在边界样本上与新实现**有差异**（证判据非恒真）。
sec('E 五副本夹紧：netUnitCostWan 出成率/换算系数 fail-closed（口径同 yieldRateOf：未填=100）');
const NFUW_FILES = [
  'cloudfunctions/calcBom/service.js',
  'cloudfunctions/getMaterial/service.js',
  'cloudfunctions/saveCostCard/service.js',
  'cloudfunctions/saveMaterial/service.js',
  'cloudfunctions/syncCostCard/service.js',
];
function loadNucw(rel) {
  let raw = '';
  try { raw = readRel(rel); } catch (e) { return null; }
  const body = (raw.match(/function netUnitCostWan\s*\([^)]*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  const helper = (raw.match(/function purchasePerGramYuan\s*\([^)]*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  if (!body) return null;
  try { return new Function(helper + '\n' + body + '\nreturn netUnitCostWan;')(); } catch (e) { return null; }
}
const NU = NFUW_FILES.map(loadNucw);
check('E-① 五副本均可解析并求值（fail-closed：读不到 / 求不出即红）',
  NU.every((f) => typeof f === 'function'),
  NU.map((f, i) => (typeof f === 'function' ? 'ok' : NFUW_FILES[i])).join(' / '));

// E-② 合法域：五副本输出一致、且等于裸公式 —— 证明夹紧**未改合法路径行为**
{
  const LEGAL = [[1500, 500, 90, 333], [2000, 500, 90, 444], [448, 1, 100, 44800], [1000, 500, 100, 200]];
  const bad = [];
  for (const c of LEGAL) {
    for (let i = 0; i < NU.length; i++) {
      const got = NU[i] ? NU[i](c[0], c[1], c[2]) : NaN;
      if (got !== c[3]) bad.push(NFUW_FILES[i] + '(' + c[0] + ',' + c[1] + ',' + c[2] + ')=' + got + '(应 ' + c[3] + ')');
    }
  }
  check('E-② 合法域 ' + LEGAL.length + ' 组 × 5 副本 = ' + (LEGAL.length * 5) + ' 点全中（合法路径零漂移）',
    bad.length === 0, bad.length ? bad.slice(0, 6).join('；') : '全中');
}

// E-③ 越界/缺失：输出必须**有限**，且等于「夹紧后」的值（出成率→100 / 换算系数→1）
{
  const CASES = [
    [1500, 500, 0, 300, '出成率 0'],
    [1500, 500, undefined, 300, '出成率缺失'],
    [1500, 500, '', 300, '出成率空串'],
    [1500, 500, 'abc', 300, '出成率非数'],
    [1500, 500, -5, 300, '出成率负数'],
    [1500, 500, 150, 300, '出成率 >100（原算法给 200）'],
    [1500, 500, 1000, 300, '出成率夸张值'],
    [1500, 0, 100, 150000, '换算系数 0'],
    [1500, null, 100, 150000, '换算系数 null'],
    [1500, -2, 100, 150000, '换算系数负'],
  ];
  const bad = [];
  for (const c of CASES) {
    for (let i = 0; i < NU.length; i++) {
      const got = NU[i] ? NU[i](c[0], c[1], c[2]) : NaN;
      if (!Number.isFinite(got) || got !== c[3]) {
        bad.push('副本' + i + '(' + c[0] + ',' + c[1] + ',' + c[2] + ')=' + got + '(应 ' + c[3] + ')[' + c[4] + ']');
      }
    }
  }
  check('E-③ 越界/缺失 ' + CASES.length + ' 组 × 5 副本 = ' + (CASES.length * 5) + ' 点全部有限且夹紧到位（禁 Infinity / NaN）',
    bad.length === 0, bad.length ? bad.slice(0, 6).join('；') : (CASES.length * 5) + ' 点全中');
}

// E-④ 鉴别力钉死：裸实现（无夹紧）在边界样本上必须与新实现**不同** —— 证明 E-③ 不是恒真
{
  const bare = (p, cf, y) => Math.round((p / 100) / cf / (y / 100) * 10000);
  const NU0 = NU[0] || (() => NaN);
  const PROBES = [[1500, 500, 0], [1500, 500, 150], [1500, 500, ''], [1500, 0, 100]];
  const diff = PROBES.filter((c) => !Object.is(bare(c[0], c[1], c[2]), NU0(c[0], c[1], c[2]))).length;
  check('E-④ 裸实现与夹紧实现在 4 个边界样本上全部有差异（判据有鉴别力）', diff === PROBES.length,
    '差异 ' + diff + '/4（如 出成率0 ⇒ 裸 ' + bare(1500, 500, 0) + ' vs 夹紧 ' + NU0(1500, 500, 0) + '）');
}

// ============ D 自失效护栏 ============
sec('D 自失效护栏（云端单源 / 扫描面 / 断言数下界）');
// D-① 云端 (0,100] 校验必须还在（单源不被删）
check('D-① 云端 saveMaterial 仍校验 yield_rate ∈ (0,100]',
  /yield_rate[^\n]*\(0,\s*100\]/.test(cfv), '单源校验在位（不得被当成"反正前端会拦"删掉）');
// D-② 变异互证：把 yieldRateOf 的上界拿掉 ⇒ A-③ 必须能报出
{
  const fake = (raw) => {
    const s = String(raw === undefined || raw === null ? '' : raw).trim();
    if (s === '') return 100;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;     // 变异版：**没有上界**
  };
  let diff = 0;
  for (let n = 1; n <= 110; n++) if (fake(String(n)) !== units.yieldRateOf(String(n))) diff++;
  check('D-② 变异互证：去掉上界的实现与本实现在 1~110 区间有差异（判据有鉴别力）',
    diff >= 10, `差异 ${diff} 点（如 150→${fake('150')} vs ${units.yieldRateOf('150')}）`);
}
check('D-③ 本守卫断言数 ≥ 12（非恒真证明力下界）', pass >= 12, `当前累计 ${pass} 条`);

console.log(`\n===== 出成率上界守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
