#!/usr/bin/env node
// tools/check_indicator_ref.js —— 餐饮指标参考库口径守卫（R126 · 同族病第 29 例）
//
// 为什么需要这一层（2026-09-23 round110）：
//   M2（开店盈亏平衡点测算）v2 新增「餐饮指标参考库」—— **分业态 × 分城市层级**的参考带 +
//   城市系数 + 红线副本。它落在**两处**、且两处是同一事实的两个副本：
//     · 机器面 `cloudfunctions/common/indicatorRef.js`（云函数实际跑的那份）
//     · 人读面 `specs/dev-specs/core/开发规范v1.0_ModuleM2_选址沙盘.md` §M2.4b 的权威 JSON
//   —— 规范里那段 JSON 是**给人看的**（写码方拿它当基线、李老师拿它验收），代码里那段是**给机器跑的**。
//   改任一侧，另一侧静默过期，而门禁全绿。与 round61「套件数」/ round64「红线条数」/ R111「红线阈值」
//   同族（第 29 例）：**人工陈述面 ≡ 实然**，零机器校验。
//
// 本守卫比前 28 例多做两件事（只比数字守不住这段口径）：
//   ① **三方对齐**：`REDLINE` 段是 M1.6「经营红线阈值口径（唯一声明处）」的**引用副本**
//      ⇒ code REDLINE ≡ M2.4b JSON.redline ≡ M1.6 声明行，**三方**逐项（含浮点值）。
//   ② **行为级口径**：M2.4b 正文写死了四条语义 ——
//      「食材/能耗/管理/推广**不随城市调整**」、「房租/人工乘城市系数」、
//      「level 边界（cost 超上限 25% 内 = warn / gain 低于下限 15% 内 = warn）」、
//      「**未填 ≠ 0 元**（na）」⇒ 这些用 JSON 数字比不出来，只能调函数断言行为。
//
// 判据（P/A/B/C/D 五段，全部 fail-closed；解析不到即判红，不许静默放行）：
//   P 前置    M2 规范可读 / 权威 JSON 标记唯一 / JSON 可解析含三段 / 代码模块三段齐
//   A 双向    城市系数（3 档）/ 参考带（4 业态 × 6 项）/ 红线（4 项）**逐项双向**
//             （双向 = 两侧 key 集合也必须相等 ⇒ 「哪边多写了一个」同样转红）
//   B 三方    红线：M1.6 声明 ≡ M2.4b JSON ≡ code REDLINE。
//             ⚠️ round111 起**不再有** `food = 100 − 毛利率` 的派生桥 —— 指标口径已统一到
//             `grossMargin`（同向同值，两侧直接比）。B-③ 兼作**反向护栏**：谁把口径改回成本率即转红。
//   C 行为    城市敏感性（敏感项乘系数 / 不敏感项三档同值）/ 浮点容差钉死样本 /
//             level 边界 / redlineOf 映射 / evaluateIndicators 语义样本 / 未填 = na
//   D 护栏    比较器正负样本互证（证明它既不恒真也不恒红）/ 逐项比较对数下界 /
//             断言数下界 / 扫描面（两份文档必须命中）
//   W 弱面    全仓其它 .md 提到本库的地方（只明示、不判红 —— 坑⑭ 裸扫必误杀）
//
// ⚠️ 已知坑的对应处理：
//   · 坑⑭/⑯ 裸扫数字必误杀：硬判据只认「M2.4b 标记块」与「M1.6 声明行」两处**带语义标记**的锚点；
//     其余（正文举例、历史演进链）一律落弱面只 ⚠️ 明示。
//   · 坑⑱ `git ls-files` 只扫 index：本守卫**不依赖 git**，直接 fs 读工作树（工作树 = 事实）。
//   · round110 E3 浮点坑：`25 × 1.15 = 28.749999999999996` ⇒ 裸 `Math.round(n*10)/10` 得 28.7
//     而手算 28.8。C-③ 把这条钉成**固定样本**（含十进制容差 1e-9），防有人把它"优化"回裸 round。
//
// 运行：node tools/check_indicator_ref.js   （由 verify_all.js 的 [indicator-ref] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const M2 = 'specs/dev-specs/core/开发规范v1.0_ModuleM2_选址沙盘.md';
const M1 = 'specs/dev-specs/core/开发规范v1.0_ModuleM1_月度盈利核算.md';
const CODE = 'cloudfunctions/common/indicatorRef.js';
const JSON_MARK = '以下 JSON 为全仓唯一权威值';
const M1_MARK = '经营红线阈值口径（唯一声明处）';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============ 通用：深度逐项比较（**导出成函数**，以便对变异样本做正负互证）============
// 返回差异清单（空数组 = 完全相同）。双向：A 侧独有与 B 侧独有**都**报。
function diffDeep(a, b, p, out) {
  const acc = out || [];
  const P = p || '$';
  const isObj = (x) => x !== null && typeof x === 'object';
  if (!isObj(a) || !isObj(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) acc.push(`${P} 期望 ${JSON.stringify(a)} / 实得 ${JSON.stringify(b)}`);
    return acc;
  }
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) { acc.push(`${P} 类型不一致（数组 vs 对象）`); return acc; }
  if (aArr) {
    if (a.length !== b.length) acc.push(`${P} 长度不一致：期望 ${a.length} / 实得 ${b.length}`);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) diffDeep(a[i], b[i], `${P}[${i}]`, acc);
    return acc;
  }
  for (const k of Object.keys(a)) {
    if (!(k in b)) { acc.push(`${P}.${k} 仅单侧 A 有（值 ${JSON.stringify(a[k])}）`); continue; }
    diffDeep(a[k], b[k], `${P}.${k}`, acc);
  }
  for (const k of Object.keys(b)) if (!(k in a)) acc.push(`${P}.${k} 仅单侧 B 有（值 ${JSON.stringify(b[k])}）`);
  return acc;
}

/** 从 .md 里抽出紧跟某标记的 ```json 代码块（fail-closed：找不到返回 null）。 */
function extractJsonAfter(md, mark) {
  const lines = md.split(/\r?\n/);
  const iMark = lines.findIndex((l) => l.includes(mark));
  if (iMark < 0) return null;
  let i = iMark;
  while (i < lines.length && lines[i].trim() !== '```json') i++;
  if (i >= lines.length) return null;
  const start = i + 1;
  let j = start;
  while (j < lines.length && lines[j].trim() !== '```') j++;
  if (j >= lines.length) return null;
  return lines.slice(start, j).join('\n');
}

// ============ P 前置（fail-closed）============
sec('P 前置（fail-closed：读不到 / 解析不出即判红）');
let m2 = '', m1 = '', code = null;
try { m2 = readRel(M2); } catch (e) { /* 下面判红 */ }
try { m1 = readRel(M1); } catch (e) { /* 下面判红 */ }
try { code = require(path.join(ROOT, CODE)); } catch (e) { code = null; }

check('P-① M2 规范可读', !!m2, m2 ? `${M2}（${m2.length} 字符）` : `读不到 ${M2}`);
check('P-② M1 规范可读', !!m1, m1 ? `${M1}（${m1.length} 字符）` : `读不到 ${M1}`);
check('P-③ 代码单源可 require', !!code, code ? CODE : `${CODE} require 失败`);

const jsonTxt = m2 ? extractJsonAfter(m2, JSON_MARK) : null;
let spec = null;
try { spec = jsonTxt ? JSON.parse(jsonTxt) : null; } catch (e) { spec = null; }
check('P-④ M2.4b 权威 JSON 块可解析', !!spec, spec ? `键：${Object.keys(spec).join('/')}` : '未找到或 JSON 语法错误');
// 标记唯一性（单源不扩散）：M2 规范内恰 1 处，且全仓 specs 无第二处自称
const markHits = m2.split(/\r?\n/).filter((l) => l.includes(JSON_MARK)).length;
check('P-⑤ 权威 JSON 标记在 M2 规范内恰 1 处', markHits === 1, `实得 ${markHits} 处`);

if (!spec || !code) {
  console.log(`\n===== 餐饮指标参考库口径守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  console.log('   ❌ 前置失败（规范 JSON 或代码单源不可用）⇒ 后续判据无意义，直接判红（fail-closed）');
  process.exit(1);
}

// ============ A 双向逐项：代码 ≡ 规范 JSON ============
sec('A 双向逐项：代码单源 ≡ M2.4b 权威 JSON');

// 代码侧整形（把 CITY_TIERS 数组折成与 JSON 同形的对象，便于逐键比对）
const codeCity = {};
for (const t of code.CITY_TIERS) codeCity[t.key] = { rent: t.coef.rent, labor: t.coef.labor };

let pairCount = 0;
const countPairs = (o) => {
  if (Array.isArray(o)) { o.forEach(countPairs); return; }
  if (o !== null && typeof o === 'object') { Object.keys(o).forEach((k) => countPairs(o[k])); return; }
  pairCount++;
};

// A-① 城市系数（3 档 × {rent,labor}）
check('A-① spec 含 cityCoef / bands / redline 三段',
  !!spec.cityCoef && !!spec.bands && !!spec.redline,
  Object.keys(spec).join(' / '));
for (const [key, want] of [['tier1', spec.cityCoef], ['tier23', spec.cityCoef], ['county', spec.cityCoef]]) {
  if (!want) break;
  const d = diffDeep(want[key], codeCity[key], `cityCoef.${key}`);
  check(`A-② 城市系数 ${key} 双向一致`, d.length === 0, d.length ? d.join('；') : JSON.stringify(codeCity[key]));
  countPairs(want[key]);
}

// A-③ 参考带（4 业态 × 6 项 × [lo,hi]）
for (const biz of Object.keys(spec.bands)) {
  const d = diffDeep(spec.bands[biz], code.BANDS[biz], `bands.${biz}`);
  check(`A-③ 参考带 ${biz} 双向一致`, d.length === 0, d.length ? d.join('；') : '6 项 × [lo,hi] 全等');
  countPairs(spec.bands[biz]);
}
// 业态键集合双向（防「代码多一个业态、规范没写」这类隐性漏）
{
  const d = diffDeep(
    Object.keys(spec.bands).sort(), Object.keys(code.BANDS).sort(), 'bands 业态键集合');
  check('A-④ 业态键集合双向一致', d.length === 0, d.length ? d.join('；') : Object.keys(code.BANDS).join('/'));
}

// A-⑤ 红线（4 项）
{
  const d = diffDeep(spec.redline, code.REDLINE, 'redline');
  check('A-⑤ 红线段双向一致', d.length === 0, d.length ? d.join('；') : JSON.stringify(code.REDLINE));
  countPairs(spec.redline);
}

// A-⑥ 指标元数据键集合 ≡ 参考带键集合（INDICATORS 引用不存在的带名 = 隐性空带）
{
  const d = diffDeep(code.IND_KEYS.slice().sort(), code.BAND_KEYS.slice().sort(), 'INDICATORS 键 ≡ BAND_KEYS');
  check('A-⑥ INDICATORS 指标键集合 ≡ 参考带键集合', d.length === 0,
    d.length ? d.join('；') : code.IND_KEYS.join('/'));
}

// ============ B 三方对齐：红线（code ≡ M2 JSON ≡ M1.6 声明）============
sec('B 三方对齐：红线 code REDLINE ≡ M2.4b JSON ≡ M1.6 唯一声明处');
const CN2KEY = { '房租占比': 'rent', '人工占比': 'labor', '菜品毛利率': 'grossMargin', '食材损耗率': 'loss' };
const m1DeclLine = m1.split(/\r?\n/).find((l) => l.includes(M1_MARK));
const m1Decl = {};
if (m1DeclLine) {
  const re = /(房租占比|人工占比|菜品毛利率|食材损耗率)\s*\*\*(\d+)\*\*/g;
  let mm; while ((mm = re.exec(m1DeclLine)) !== null) m1Decl[CN2KEY[mm[1]]] = Number(mm[2]);
}
check('B-① M1.6 声明行可解析（4 项）', Object.keys(m1Decl).length === 4,
  Object.keys(m1Decl).length === 4 ? JSON.stringify(m1Decl) : `M1.6 声明行解析到 ${Object.keys(m1Decl).length} 项`);

for (const k of ['rent', 'labor', 'grossMargin', 'loss']) {
  const decl = m1Decl[k], sp = spec.redline[k], cd = code.REDLINE[k];
  check(`B-② 红线 ${k} 三方一致（声明/规范/代码）`,
    decl !== undefined && decl === sp && decl === cd,
    `声明 ${decl} / 规范 ${sp} / 代码 ${cd}`);
}
// round111：指标口径统一到毛利率 ⇒ 不再有 100 − x 派生桥，两侧**同向同值**直接比。
// 本条兼作**反向护栏**：若有人把 grossMargin 又换回成本率口径（redlineOf 返回 45）即转红。
check('B-③ 毛利率警戒线 = 55（同向同值 · 无 100−x 派生桥 · 旧键 food 已废）',
  code.redlineOf('grossMargin') === code.REDLINE.grossMargin
  && code.redlineOf('grossMargin') === 55
  && code.redlineOf('food') === null,
  `redlineOf('grossMargin')=${code.redlineOf('grossMargin')} / REDLINE.grossMargin=${code.REDLINE.grossMargin} / 旧键 'food'=${code.redlineOf('food')}`);

// ============ C 行为级口径（JSON 数字比不出来的四条语义）============
sec('C 行为级口径：城市敏感性 / 浮点容差 / level 边界 / 未填 ≠ 0');
const round1 = (n) => Math.round(n * 10 + 1e-9) / 10;
const TIERS = code.CITY_KEYS;

// C-① 不随城市调整的四项：三档同值（且 = 参考带原值）
const INSENSITIVE = code.INDICATORS.filter((i) => !i.citySensitive).map((i) => i.key);
check('C-① 不敏感项恰为 grossMargin/energy/manage/mkt 四项', INSENSITIVE.slice().sort().join('/') === 'energy/grossMargin/manage/mkt',
  INSENSITIVE.join('/'));
for (const biz of code.BIZ_KEYS) {
  let bad = [];
  for (const ind of INSENSITIVE) {
    const base = code.bandOf(biz, ind, 'tier23');
    for (const t of TIERS) {
      const b = code.bandOf(biz, ind, t);
      if (!base || !b || b.lo !== base.lo || b.hi !== base.hi || b.coef !== 1) {
        bad.push(`${ind}@${t}(${b ? b.lo + '~' + b.hi + ' coef' + b.coef : 'null'})`);
      }
    }
  }
  check(`C-② ${biz} 不敏感项三档同值（毛利率不随城市变）`, bad.length === 0, bad.length ? bad.join('，') : '4 项 × 3 档全等');
}

// C-③ 敏感项（rent/labor）逐档乘系数一致
for (const ind of ['rent', 'labor']) {
  const bad = [];
  for (const biz of code.BIZ_KEYS) {
    const raw = code.BANDS[biz][ind];
    for (const t of TIERS) {
      const coef = code.CITY_TIERS.find((x) => x.key === t).coef[ind];
      const b = code.bandOf(biz, ind, t);
      const want = { lo: round1(raw[0] * coef), hi: round1(raw[1] * coef), coef };
      if (!b || b.lo !== want.lo || b.hi !== want.hi || b.coef !== want.coef) {
        bad.push(`${biz}@${t} 期望 ${want.lo}~${want.hi}(×${coef}) 实得 ${b ? b.lo + '~' + b.hi + '(×' + b.coef + ')' : 'null'}`);
      }
    }
  }
  check(`C-③ ${ind} 三档均乘城市系数`, bad.length === 0, bad.length ? bad.join('；') : '4 业态 × 3 档全等');
}

// C-④ 浮点容差钉死样本（round110 立 · round113 **换样本**）
//      25 × 1.15 的二进制表示是 28.749999999999996（×10 = 287.49999999999994 ⇒ 裸 round 得 28.7）。
//      round113 把 dining.labor 从 [25,35] 改成 [17,22] 后，"25"这个锚点没了 ⇒ 换成 17：
//      17 × 1.15 = 19.549999999999997（×10 = 195.49999999999997 ⇒ 裸 round 得 19.5）⇒ **陷阱形态完全一致**。
//      ⚠️ 换样本时必须重新验算"裸 round 真的会错"，否则这条断言会**退化成恒真**
//        （记忆纪律「守卫四反恒真要件」：判据须有鉴别力，正负样本互证）。
{
  const b = code.bandOf('dining', 'labor', 'tier1');
  const naked = Math.round(17 * 1.15 * 10) / 10;   // 反面样本：不带 1e-9 容差
  check('C-④ 浮点容差：dining.labor@tier1 下限 = 19.6（裸 round 会得 19.5）',
    b && b.lo === 19.6 && naked === 19.5,
    `实得 ${b && b.lo} / 裸 round 反面样本 ${naked}`);
}
// C-⑤ 另一条浮点边界：fastfood.rent@county = [5,10] × 0.75 ⇒ 3.8 / 7.5
{
  const b = code.bandOf('fastfood', 'rent', 'county');
  check('C-⑤ 浮点容差：fastfood.rent@county = 3.8 ~ 7.5', !!b && b.lo === 3.8 && b.hi === 7.5,
    b ? `${b.lo} ~ ${b.hi}` : 'null');
}

// C-⑥ level 边界（cost / gain 两个方向 + na）
{
  const lo = 10, hi = 20;
  const cases = [
    ['cost 低于下限 = good', code.levelOf(9.9, lo, hi, 'cost') === 'good'],
    ['cost 恰好下限 = good', code.levelOf(lo, lo, hi, 'cost') === 'good'],
    ['cost 恰好上限 = ok', code.levelOf(hi, lo, hi, 'cost') === 'ok'],
    ['cost 超上限 25% 内 = warn', code.levelOf(hi * 1.25, lo, hi, 'cost') === 'warn'],
    ['cost 超上限 25% 外 = bad', code.levelOf(hi * 1.25 + 0.01, lo, hi, 'cost') === 'bad'],
    ['gain 高于上限 = good', code.levelOf(hi + 0.1, lo, hi, 'gain') === 'good'],
    ['gain 恰好下限 = ok', code.levelOf(lo, lo, hi, 'gain') === 'ok'],
    ['gain 低于下限 15% 内 = warn', code.levelOf(lo * 0.85, lo, hi, 'gain') === 'warn'],
    ['gain 低于下限 15% 外 = bad', code.levelOf(lo * 0.85 - 0.01, lo, hi, 'gain') === 'bad'],
    ['未填（null）= na', code.levelOf(null, lo, hi, 'cost') === 'na'],
  ];
  const bad = cases.filter((c) => !c[1]).map((c) => c[0]);
  check('C-⑥ level 边界 10 例（cost 4 + gain 4 + 边界 2）', bad.length === 0,
    bad.length ? '不符：' + bad.join('；') : '10/10 全中');
}

// C-⑦ redlineOf 映射（rent/labor/grossMargin 有值，其余 null；**旧键 'food' 必须已废**）
{
  const want = { rent: code.REDLINE.rent, labor: code.REDLINE.labor, grossMargin: code.REDLINE.grossMargin, energy: null, manage: null, mkt: null, food: null };
  const bad = Object.keys(want).filter((k) => code.redlineOf(k) !== want[k]);
  check('C-⑦ redlineOf 映射（rent/labor/grossMargin 有值 · 其余 null · 旧键 food 已废）', bad.length === 0,
    bad.length ? bad.map((k) => `${k}=${code.redlineOf(k)}`).join('，') : JSON.stringify(want));
}

// C-⑧ evaluateIndicators 语义样本（dining @ tier23，营业额 10,000 元）
{
  const got = code.evaluateIndicators({
    bizKey: 'dining', cityKey: 'tier23',
    revenueFen: 1000000,                                   // 10,000.00 元
    fixedFen: { rent: 100000, labor: 150000, utility: 30000, manage: 50000 },
    grossMarginPct: 65, platformPct: 15,
  });
  const by = {};
  got.forEach((r) => { by[r.key] = r; });
  // 期望：**毛利率 65%（dining 带 55~65 ⇒ 达上限 good —— gain 方向越高越好）**
  //       房租 10%（dining 带 8~15 ⇒ ok，未过 15 警戒线）/ 人工 15%（带 25~35 ⇒ good）
  //       能耗 3%（带 3~5 ⇒ good）/ 管理 5%（带 5~10 ⇒ good）
  //       营销 15%（带 5~10，超上限 25%（12.5）之外 ⇒ bad）
  const want = { grossMargin: ['65', 'good'], rent: ['10', 'ok'], labor: ['15', 'good'], energy: ['3', 'good'], manage: ['5', 'good'], mkt: ['15', 'bad'] };
  const bad = Object.keys(want).filter((k) => !by[k] || String(by[k].pct) !== want[k][0] || by[k].level !== want[k][1]);
  check('C-⑧ evaluateIndicators 语义样本 6 项（占比 + 评级）', bad.length === 0,
    bad.length ? bad.map((k) => `${k}=${by[k] ? by[k].pct + '/' + by[k].level : 'null'}`).join('，')
      : '6/6 全中（含营销 15% 判 bad）');
  check('C-⑨ 房租 10% 未触警戒线 · 含 redline 透出', by.rent && by.rent.redlineHit === false && by.rent.redline === code.REDLINE.rent,
    by.rent ? `redline=${by.rent.redline} / hit=${by.rent.redlineHit}` : '无 rent 结果');
}

// C-⑩ 未填 ≠ 0 元（缺 utility ⇒ pct null 且 level na，不得按 0 处理）
{
  const got = code.evaluateIndicators({
    bizKey: 'dining', cityKey: 'tier23', revenueFen: 1000000,
    fixedFen: { rent: 100000, labor: 150000, manage: 50000 },   // 故意不给 utility
    grossMarginPct: 65, platformPct: 15,
  });
  const en = got.find((r) => r.key === 'energy');
  check('C-⑩ 未填项 ⇒ pct=null / level=na（不按 0 元处理）',
    !!en && en.pct === null && en.level === 'na', en ? `pct=${en.pct} / level=${en.level}` : '未产出 energy 行');
}

// C-⑪ round111 口径统一护栏（这条守的是"口径不被改回去"，不只是值）：
//     `grossMargin` 必须①存在②dir=gain③取值 = **用户直填的毛利率**（不是 100 − 毛利率）
//     ④旧键 `food` 必须已消失。若谁把它改回成本率口径，本条立刻转红。
{
  const got = code.evaluateIndicators({
    bizKey: 'dining', cityKey: 'tier23', revenueFen: 1000000,
    fixedFen: { rent: 100000 }, grossMarginPct: 65, platformPct: 0,
  });
  const gm = got.find((r) => r.key === 'grossMargin');
  const old = got.find((r) => r.key === 'food');
  const gainKeys = code.INDICATORS.filter((i) => i.dir === 'gain').map((i) => i.key).join('/');
  check('C-⑪ 口径统一：键=grossMargin / dir=gain / 值=直填 65（非 100−65=35）/ 旧键 food 已废',
    !!gm && !old && gm.pct === 65 && gainKeys === 'grossMargin',
    gm ? `pct=${gm.pct}（应 65）· 旧键 food ${old ? '仍存在 ⚠️' : '已废'} · gain 项 [${gainKeys}]`
      : '未产出 grossMargin 行');
}

// C-⑫ 🔴 参考带 ↔ 警戒线**不得自相矛盾**（round113 立）
//   由来：round113 复核发现 dining.labor 原为 [25,35]，而本仓 REDLINE.labor = 20
//        ⇒ 人工 25% 的正餐店 `level=good`（≤ lo）**且** `redlineHit=true`（> 20）—— 同一条指标两个相反结论。
//   判据（纯函数级，不依赖任何数值表）：
//     · cost 类：good 的门槛是 `pct ≤ lo`，命中警戒是 `pct > REDLINE`
//               ⇒ 若 `lo > REDLINE`，取 pct = lo 即两结论并存 ⇒ **必须 lo ≤ REDLINE**。
//     · gain 类：good 的门槛是 `pct ≥ hi`，命中警戒是 `pct < REDLINE`
//               ⇒ 若 `hi < REDLINE`，取 pct = hi 即并存 ⇒ **必须 hi ≥ REDLINE**。
//   ⚠️ 只对**基准档（tier23，系数 1）**成立：tier1 的 labor 系数 1.15 会合法地把 hi 抬过通用警戒线
//      （一线人工绝对成本高，[E1] 待校准），那不是矛盾 —— 故本断言只用基准档 BANDS 原值。
{
  const bad = [];
  for (const biz of code.BIZ_KEYS) {
    for (const ind of code.INDICATORS) {
      const rl = code.redlineOf(ind.key);
      const band = code.BANDS[biz][ind.key];
      if (rl == null || !band) continue;            // 无警戒线的指标（energy/manage/mkt）不适用
      const lo = band[0], hi = band[1];
      if (ind.dir === 'cost' && lo > rl) bad.push(`${biz}.${ind.key} lo ${lo} > 警戒 ${rl}`);
      if (ind.dir === 'gain' && hi < rl) bad.push(`${biz}.${ind.key} hi ${hi} < 警戒 ${rl}`);
    }
  }
  check('C-⑫ 🔴 带 vs 警戒线不自相矛盾（cost 类 lo ≤ 警戒 · gain 类 hi ≥ 警戒）',
    bad.length === 0, bad.length ? '矛盾：' + bad.join('；') : '四业态 × 3 个有警戒线的指标全过');
}

// ============ E 对外文案面（round111：客户看不懂「食材成本率」）============
sec('E 对外文案面：用户可见处不得出现「食材成本率」');
// 为什么单列一段：round111 李老师的原话是「尽量统一到毛利率，避免食材成本率，**客户看不懂**」——
//   这是**产品口径要求**，改错了不会让任何数字出错，只会让文案退回老说法 ⇒ 数字类判据全抓不到。
//   所以必须直接扫**文案源**。
// ⚠️ 扫描前必须**剥注释**：本仓多处注释里正当地提到"食材成本率"（含本守卫上方与 indicatorRef 顶部说明），
//    裸扫必误杀（记忆纪律「扫描/计数类守卫先剥注释再数」）。
const VISIBLE = [
  'pages/sandbox/index.wxml',
  'pages/sandbox/index.js',
  'miniprogram/i18n/terms.js',
  'specs/dev-specs/i18n/terms.js',
];
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释（js/wxss）
  .replace(/<!--[\s\S]*?-->/g, '')       // html/wxml 注释
  .replace(/^[ \t]*\/\/.*$/gm, '');      // 行注释
// 🔴 判据必须是**词族，不是单词**（此条由 round111 回灌 A9 实测抓出，初版判据面写窄了）：
//   初版只查「食材成本率」5 个字；而 A9 把滑杆小字改回「食材成本**占**售价 35%」——
//   一个"率"字都没有 ⇒ **漏网**。而那句话恰恰是 round111 从 UI 上删掉的原话。
//   ⇒ 改查"率类表述族"：`食材成本[率占比]` + 独立的 `食材占比`。
//   ⚠️ 但**不能**裸禁「食材成本」四个字：terms 的 marginTip **正当**写着
//   「不用另填食材成本，它会随毛利率自动折算」（解释为什么没有食材输入框）⇒ 会误杀。
//   词族恰好把两者分开 —— marginTip 的「食材成本」后跟「，」，不匹配 `[率占比]`（E-③ 第四例守着这条）。
const BANNED_RE = /食材成本[率占比]|食材占比/;
{
  const bad = [];
  for (const rel of VISIBLE) {
    let raw = '';
    try { raw = readRel(rel); } catch (e) { bad.push(rel + '（读不到）'); continue; }
    stripComments(raw).split(/\r?\n/).forEach((l, i) => {
      if (BANNED_RE.test(l)) bad.push(`${rel}:${i + 1} 「${l.trim().slice(0, 80)}」`);
    });
  }
  check('E-① 四个用户可见面（剥注释后）零「食材成本率 / 食材成本占… / 食材占比」类表述',
    bad.length === 0, bad.length ? bad.join('；') : '4 份文件全扫，0 命中');

  // 前提（防本条"剥了个寂寞"而误杀注释，或反过来漏扫）—— 剥注释器正负样本互证：
  // 三种注释形态（行 / 块 / html）里的词必须**被剥掉**；而**字符串字面量里的必须保留**（那才是真命中）。
  const t1 = stripComments('// 这里写食材成本率\nconst a = 1;');
  const t2 = stripComments('/* 食材成本率 */ const b = 2;');
  const t3 = stripComments('<!-- 食材成本率 --><view/>');
  const t4 = stripComments('const c = "食材成本率";');
  check('E-② 剥注释器正负样本互证（行/块/html 注释被剥 · 字符串里保留）',
    !t1.includes('食材成本率') && !t2.includes('食材成本率') && !t3.includes('食材成本率')
    && t4.includes('食材成本率'),
    `行[${t1.includes('食材成本率') ? '未剥⚠️' : '剥'}] 块[${t2.includes('食材成本率') ? '未剥⚠️' : '剥'}]`
    + ` html[${t3.includes('食材成本率') ? '未剥⚠️' : '剥'}] 字符串[${t4.includes('食材成本率') ? '保留✅' : '误剥⚠️'}]`);

  // E-③ 词族判据正负样本互证（证明判据面既没写窄、也没写宽）
  const cases = [
    ['「食材成本率」命中', BANNED_RE.test('食材成本率')],
    ['「食材成本占售价 35%」命中（= A9 漏网的那种写法）', BANNED_RE.test('食材成本占售价')],
    ['「食材占比」命中', BANNED_RE.test('食材占比')],
    ['「食材成本比例」命中', BANNED_RE.test('食材成本比例')],
    ['正当表述「不用另填食材成本，它会随毛利率自动折算」**不**命中',
      !BANNED_RE.test('不用另填食材成本，它会随毛利率自动折算')],
  ];
  const badC = cases.filter((c) => !c[1]).map((c) => c[0]);
  check('E-③ 词族判据正负样本互证 5 例（4 命中 + 1 不误杀）', badC.length === 0,
    badC.length ? '不符：' + badC.join('；') : '5/5 如期');
}

// ============ D 自失效护栏（证明本守卫既不恒真也不恒红）============
sec('D 自失效护栏（正负样本互证 + 下界）');

// D-① 比较器正负样本（5 组：同 → 空；改数 / 改数组元素 / 缺键 / 多键 → 报出）
{
  const cases = [
    ['同值 ⇒ 零差异', diffDeep({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }).length === 0],
    ['改数 ⇒ 报出', diffDeep({ a: 1 }, { a: 2 }).length === 1],
    ['数组元素改 ⇒ 报出', diffDeep({ a: [1, 2] }, { a: [1, 3] }).length === 1],
    ['A 侧缺键 ⇒ 报出', diffDeep({ a: 1 }, {}).length === 1],
    ['B 侧多键 ⇒ 报出（双向）', diffDeep({}, { a: 1 }).length === 1],
  ];
  const bad = cases.filter((c) => !c[1]).map((c) => c[0]);
  check('D-① 比较器正负样本互证 5 组', bad.length === 0, bad.length ? '失败：' + bad.join('；') : '5/5 如期');
}

// D-② 用**真实数据**做一次正负互证：原样本零差异 / 变异样本必报出
{
  const mutate = JSON.parse(JSON.stringify(spec.bands));
  mutate.dining.rent[1] = 16;                       // 把 15 改成 16
  const dSame = diffDeep(spec.bands, code.BANDS, 'bands');
  const dMut = diffDeep(mutate, code.BANDS, 'bands');
  check('D-② 原样本零差异 / 变异样本必报出', dSame.length === 0 && dMut.length >= 1,
    `原 ${dSame.length} 条 · 变异 ${dMut.length} 条（${dMut[0] || '-'}）`);
}

// D-③ 逐项比较对数下界（比较面被悄悄写窄即转红）
{
  const total = pairCount;   // cityCoef 6 + bands 24 + redline 4 已累计
  check('D-③ 逐项比较对数 ≥ 34（系数6 + 带24 + 红线4）', total >= 34, `实得 ${total} 对`);
}

// D-④ 前提守卫：两份目标文档必须在扫描面内（路径写错即转红）
check('D-④ 扫描面含 M2/M1 两份目标规范', m2.length > 0 && m1.length > 0 && !!m1DeclLine,
  'M2.4b 权威 JSON + M1.6 声明行均在面内');

// D-⑤ 断言数下界（防「删掉几组正负样本」把守卫悄悄改小）
// ⚠️ 下界取**实测值的保守下沿**（本行执行时刻实测 40 条）—— 初版估算 45 被本行当场转红，
//    这正是下界护栏的作用；改它就等于改守卫强度，故同步登记进重启键「套件断言数口径」唯一声明处。
check('D-⑤ 本守卫断言数 ≥ 38（非恒真证明力下界）', pass >= 38, `当前累计 ${pass} 条`);

// ============ W 弱面（只明示不判红）============
sec('W 弱面（其它 .md 提及本库，只明示不判红）');
{
  const hits = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (['node_modules', '.git', 'tools'].includes(e.name)) continue; walk(abs); }
      else if (e.name.endsWith('.md')) {
        let t = ''; try { t = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
        if (t.includes('indicatorRef')) hits.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
      }
    }
  };
  walk(ROOT);
  check('W-① 弱面扫描完成（提及 indicatorRef 的 .md）', true,
    `${hits.length} 份：${hits.slice(0, 4).join('、')}${hits.length > 4 ? ' …' : ''}（只明示不判红）`);
}

console.log(`\n===== 餐饮指标参考库口径守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
