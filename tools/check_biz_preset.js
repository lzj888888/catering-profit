#!/usr/bin/env node
// tools/check_biz_preset.js —— M2v1.3 业态参数包守卫（新增 · 七组 S/A/B/C/D/E/F）
// 运行：node tools/check_biz_preset.js   （由 verify_all.js 的 [biz-preset] 套件调用）
//
// 为什么需要它（R182「判据存在 ≠ 被执行」同族）：业态参数包的取值/形态/城市系数全是
// 契约里的硬规则（开发规范 v1.3 §三），此前零机器判据 ⇒ 写错/漏乘/自创数值无人报警。
// 六组判据（全部 fail-closed：读不到 / 解析不到即判红）：
//   S 扫描面   bizPreset.js 存在 + 预设数 ≥ 4 + **城市系数双副本逐值 ≡ 生产源** + 断言数下界（防"扫空 ⇒ 恒绿"）
//   A 主分类   每个预设 bizKey ∈ indicatorRef.js::BIZ_KEYS（4 类，从源文件解析，不硬编码）
//   B 整套独立 每个预设 params/costMeta 自包含，禁止引用别的预设（跨业态继承会抹平差异）
//   C 形态合法 form ∈ 五形态；参数完备：fixed(src≠U)⇒defaultYuan / area_linear⇒base+perSqm /
//     headcount_linear⇒params.laborUnitYuan / revenue_rate⇒pct / step⇒steps 非空
//   D L1/L2禁入 index.wxml 的 L1/L2 区块不得把 坪效/目标租金率/翻台率 当输入框
//   E 回本 único出口 cash 回本算式全仓只出现一次且在 utils/bizPreset.js；pages/** 不得复算
//   F R237   桌数换算（单桌座位数）/ 翻台口径分组 / 三档阈值 / 空值护栏 / **三档文案去承诺词**
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIZ_PRESET = path.join(ROOT, 'utils', 'bizPreset.js');
const INDICATOR = path.join(ROOT, 'cloudfunctions', 'common', 'indicatorRef.js');
const PAGE_WXML = path.join(ROOT, 'pages', 'sandbox', 'index.wxml');
const TERMS = path.join(ROOT, 'miniprogram', 'i18n', 'terms.js');

const FORMS = ['fixed', 'area_linear', 'headcount_linear', 'labor_total', 'energy_split', 'fixed_opt', 'revenue_rate', 'step'];

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');
const readOr = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
function stripJs(s) {
  let out = '', i = 0, st = null;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (st) { out += c; if (c === '\\') { out += d || ''; i += 2; continue; } if (c === st) st = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { st = c; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// ============ S 扫描面（fail-closed）============
sec('S · 扫描面（bizPreset 存在 / 预设数 ≥4 / 断言数下界）');
const bizSrc = readOr(BIZ_PRESET);
check('S-① utils/bizPreset.js 存在且非空', !!bizSrc && bizSrc.length > 2000, bizSrc ? bizSrc.length + ' 字符' : '读不到');

let BIZ_PRESETS = null, CITY_COEF = null, paybackCash = null, findPreset = null, assembleItems = null;
try { ({ BIZ_PRESETS, CITY_COEF, paybackCash, findPreset, assembleItems } = require(BIZ_PRESET)); } catch (e) { BIZ_PRESETS = null; }
check('S-② bizPreset 可 require 且导出 BIZ_PRESETS / CITY_COEF',
  Array.isArray(BIZ_PRESETS) && !!CITY_COEF, BIZ_PRESETS ? `预设 ${BIZ_PRESETS.length} 个` : 'require 失败');
check('S-③ 预设数 ≥ 4', Array.isArray(BIZ_PRESETS) && BIZ_PRESETS.length >= 4, BIZ_PRESETS ? BIZ_PRESETS.length + ' 个' : '0');
check('S-④ CITY_COEF 三档都带 rent+labor 双键',
  !!CITY_COEF && ['tier1', 'tier23', 'county'].every((k) => CITY_COEF[k] && CITY_COEF[k].rent != null && CITY_COEF[k].labor != null),
  'tier1/county 双键须在（漏乘 labor ⇒ 一线退回二三线）');

// 🔴 S-⑤ / S-⑥ 城市系数双副本守卫（R230 验收后加严 —— 变异实测「前端 tier1.rent 1.20→1.25」时
//   `check_biz_preset` 13/0 + `selfcheck_bizPreset` 25/0 **双双全绿** ⇒ 缺口真实存在）：
//   前端 `CITY_COEF` 是**复刻**（前端不便 require 云函数，规范 §4.3 允许）⇒ 数值漂移必须有人守。
//   漂移后果：前端展示的固定成本 / 保本点与云端引擎（用 `CITY_TIERS`）算的**不是同一个数**，
//   用户看到的数是"假算"的，且**静默**（S-④ 只验双键在场，`check_indicator_ref` 只验生产源内部 code≡JSON）。
//   判据分两条：S-⑤ 解析面非退化（解析不到即红，防"扫空 ⇒ 恒绿"）/ S-⑥ 逐档逐键相等。
{
  const indSrcS = readOr(INDICATOR) || '';
  const seg = /const\s+CITY_TIERS\s*=\s*\[([\s\S]*?)\];/.exec(indSrcS);
  const tiers = [];
  if (seg) {
    const re = /\{\s*key:\s*'([^']+)'\s*,\s*coef:\s*\{\s*rent:\s*([\d.]+)\s*,\s*labor:\s*([\d.]+)\s*\}\s*\}/g;
    let m;
    while ((m = re.exec(seg[1]))) tiers.push({ key: m[1], rent: Number(m[2]), labor: Number(m[3]) });
  }
  check('S-⑤ 从 indicatorRef.js 解析出 CITY_TIERS 三档（扫描面非退化）', tiers.length === 3,
    tiers.length ? tiers.map((t) => t.key).join('/') : '解析不到 ⇒ fail-closed');
  const drift = [];
  for (const t of tiers) {
    const c = CITY_COEF && CITY_COEF[t.key];
    if (!c) { drift.push(t.key + ' 前端缺档'); continue; }
    if (c.rent !== t.rent) drift.push(`${t.key}.rent 前端 ${c.rent} ≠ 源 ${t.rent}`);
    if (c.labor !== t.labor) drift.push(`${t.key}.labor 前端 ${c.labor} ≠ 源 ${t.labor}`);
  }
  check('S-⑥ 前端 CITY_COEF 逐值 ≡ 生产源 CITY_TIERS（防复刻漂移）',
    tiers.length === 3 && drift.length === 0,
    drift.length ? '漂移：' + drift.join(' | ') : `${tiers.length} 档 × (rent,labor) 全等`);
}

// ============ A 主分类合法性（从 indicatorRef 解析，不硬编码）============
sec('A · 主分类 ∈ indicatorRef.js::BIZ_KEYS');
const indSrc = readOr(INDICATOR) || '';
const bizKeysMatch = /const\s+BIZ_KEYS\s*=\s*\[([^\]]*)\]/.exec(indSrc);
const BIZ_KEYS = bizKeysMatch
  ? bizKeysMatch[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  : [];
check('A-① 从 indicatorRef.js 解析出 BIZ_KEYS（4 类 + 通用兜底 other = 5）', BIZ_KEYS.length === 5, BIZ_KEYS.join('/'));
if (Array.isArray(BIZ_PRESETS)) {
  const bad = BIZ_PRESETS.filter((p) => BIZ_KEYS.indexOf(p.bizKey) < 0);
  check('A-② 每个预设 bizKey ∈ BIZ_KEYS（无第 5 类）', bad.length === 0,
    bad.length ? '越界：' + bad.map((p) => p.presetKey + '=' + p.bizKey).join(' | ') : `${BIZ_PRESETS.length} 个全合规`);
}

// ============ B 整套独立（禁跨预设继承）============
sec('B · 每个预设自包含（禁引用别的预设）');
{
  const keys = (BIZ_PRESETS || []).map((p) => p.presetKey);
  const bad = (BIZ_PRESETS || []).filter((p) => {
    const s = JSON.stringify(p);
    // 🔴 精确匹配：仅当某预设把「别的预设的 presetKey」当成自己的 presetKey/bizKey **字段值**时，
    //   才算"引用别的预设"。旧实现用整串 indexOf ⇒ 每个预设 costMeta 都含 itemKey:'other'，
    //   而 'other' 现也是预设 key ⇒ 全误报。itemKey:'other'（杂支损耗项）与预设 key 同词不同义，必须排除。
    return keys.some((k) => k !== p.presetKey
      && new RegExp('"(presetKey|bizKey)":"' + k + '"').test(s));
  });
  check('B-① 无预设引用别的预设的 presetKey', bad.length === 0,
    bad.length ? bad.map((p) => p.presetKey).join(' | ') : '整套独立');
}

// ============ C 形态合法性 + 参数完备 ============
sec('C · costMeta 形态 ∈ 五形态 + 参数完备（缺一即 NaN）');
{
  let badForm = 0, badParam = [];
  for (const p of (BIZ_PRESETS || [])) {
    for (const m of (p.costMeta || [])) {
      if (FORMS.indexOf(m.form) < 0) { badForm++; continue; }
      const lacks =
        (m.form === 'fixed' && m.src !== 'U' && m.defaultYuan == null && m.derivedFrom !== 'rent_rate')
        || (m.form === 'area_linear' && (m.baseYuan == null || m.perSqmYuan == null))
        || (m.form === 'headcount_linear' && !(p.params && p.params.laborUnitYuan))
        || (m.form === 'revenue_rate' && m.pct == null)
        || (m.form === 'step' && !(Array.isArray(m.steps) && m.steps.length));
      if (lacks) badParam.push(`${p.presetKey}.${m.itemKey}[${m.form}]`);
    }
  }
  check('C-① 全部 form ∈ 五形态', badForm === 0, badForm ? badForm + ' 处' : '五形态');
  check('C-② 全部 costMeta 参数完备', badParam.length === 0, badParam.length ? '缺参：' + badParam.join(' | ') : '完备');
}

// ============ D L1/L2 禁入项：坪效 / 目标租金率 / 翻台 不得作输入 ============
sec('D · index.wxml L1/L2 不得把 坪效/目标租金率/翻台率 当输入框');
{
  const wxml = readOr(PAGE_WXML) || '';
  // L1/L2 = 从 id="l1l2" 锚点到 id="l3-pro"(专业参数) 锚点之间。
  //   反推 tab 是另一「模式」（反推需 坪效/租金率 作输入），不在 L1/L2 披露面内，故不扫描。
  const a1 = wxml.indexOf('id="l1l2"');
  const a2 = wxml.indexOf('id="l3-pro"');
  const region = (a1 >= 0 && a2 >= 0 && a1 < a2) ? wxml.slice(a1, a2) : '';
  const banned = /value\s*=\s*"\{\{[^"]*(pixelEff|rentRate|turn)[^"]*\}\}"/;
  const hits = [];
  const re = /<input\b[^>]*>/g; let m;
  while ((m = re.exec(region))) if (banned.test(m[0])) hits.push(m[0]);
  check('D-① L1/L2 区块（l1l2→l3-pro）无 坪效/租金率/翻台 输入框', hits.length === 0,
    hits.length ? hits.join(' | ') : (region ? 'L1/L2 锚点存在，区间内零命中' : '未定位 l1l2→l3-pro 锚点（fail-closed）'));
}

// ============ E 回本口径唯一出口（只在 utils/bizPreset.js，pages 不复算）============
sec('E · cash 回本算式全仓只出现一次且在 utils/ 内');
{
  const bpJs = stripJs(readOr(BIZ_PRESET) || '');
  check('E-① bizPreset 含 paybackCash 定义', /function\s+paybackCash\s*\(/.test(bpJs) || /paybackCash\s*=\s*function/.test(bpJs), 'paybackCash 在');
  // 🔴 判**行为**不判字面（R230 回灌 M7 实测：旧版靠 `[\s\S]{0,80}` 窗口匹配，会被 `round1` 里的
  //    `+ 1e-9` 与函数签名 `(…, buildAmortMonthlyFen)` 跨结构"假命中" ⇒ 「+ 改 -」静默漏网）
  //    实跑锚点：26.2万 分 ÷ (1.6万 分 + 0.61万 分) = 26200000 / 2210000 = 11.855 ⇒ 11.9
  //    （把 `+` 改成 `-` ⇒ 26200000 / 990000 = 26.5 ≠ 11.9 ⇒ 判红）
  const cashProbe = typeof paybackCash === 'function' ? paybackCash(26200000, 1600000, 610000) : null;
  check('E-② paybackCash 语义 = 投资 ÷ (月净利 + 月摊销)（实跑锚点 11.9）',
    cashProbe === 11.9, 'paybackCash(26.2万, 1.6万, 0.61万) = ' + cashProbe + ' 月（应为 11.9）');
  // pages/** 不得复算：禁出现「buildTotal ÷ (target + amort)」或对该三个引擎字段做算术
  const PAGES = path.join(ROOT, 'pages');
  const cashViolation = [];
  const cashPattern = /target_profit_fen\s*\+\s*build_amort_monthly_fen|targetProfitFen\s*\+\s*buildAmortMonthlyFen|build_total_fen\s*\/|buildTotalFen\s*\/\s*\(/;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      const code = stripJs(readOr(p) || '');
      if (cashPattern.test(code)) cashViolation.push(rel);
    }
  })(PAGES);
  check('E-③ pages/** 无 cash 回本算式（只有 paybackCash 调用是允许的）', cashViolation.length === 0,
    cashViolation.length ? '复算：' + cashViolation.join(', ') : 'pages 零复算');
}

// ============ F R237：桌数换算 + 翻台口径分组 + 三档阈值（前端纯函数，零引擎参与）============
sec('F · R237 桌数换算 + 翻台口径分组 + 三档阈值');
// 🔴 为什么必须守这三个纯函数：它们决定**页面上说什么** —— 叫不叫「翻台」、算术上难不难、
//   「几桌 × 几座」。改动它们不会有任何报错，只会让文案 / 分档**静默变错**
//   （本仓最典型的静默缺陷面，见 `check_m2_biz_inputs.js` 的立据）。
// ⚠️ F-③ 是**锚点脚本抓出来的真缺陷**（review/evidence/r237_m2_turn/recalc_anchors.js）：
//    `Number(null) === 0` 且 `Number('') === 0` ⇒ 引擎红警时返回的 `turn_rate: null`
//    会被分档成 **'easy'**，页面就会写「这个水平，正常做着就能到」
//    —— 把"算不出来"说成"很轻松"，是本轮最坏的一类静默错。故必须有空值护栏。
let seatsPerTableOf = null, turnModeOf = null, turnLevelOf = null;
try { ({ seatsPerTableOf, turnModeOf, turnLevelOf } = require(BIZ_PRESET)); } catch (e) { seatsPerTableOf = null; }
check('F-⓪ bizPreset 导出 R237 三个纯函数（解析不到即判红，否则 F-①~④ 会静默恒真）',
  !!(seatsPerTableOf && turnModeOf && turnLevelOf));
if (seatsPerTableOf && turnModeOf && turnLevelOf) {
  check('F-① 单桌座位数：快餐 2 / 正餐 4 / 火锅 4 / 茶饮 2，未知业态兜底 4（不得 0 / NaN）',
    seatsPerTableOf('fastfood') === 2 && seatsPerTableOf('dining') === 4
    && seatsPerTableOf('hotpot') === 4 && seatsPerTableOf('cafe') === 2
    && seatsPerTableOf('nope') === 4,
    ['fastfood', 'dining', 'hotpot', 'cafe', 'nope'].map((k) => k + '=' + seatsPerTableOf(k)).join(' '));
  check('F-② 翻台口径分组：火锅/正餐 = table（**可说「翻台」**）/ 快餐/茶饮 = seat（**禁用「翻台」**）',
    turnModeOf('hotpot') === 'table' && turnModeOf('dining') === 'table'
    && turnModeOf('fastfood') === 'seat' && turnModeOf('cafe') === 'seat',
    ['hotpot', 'dining', 'fastfood', 'cafe'].map((k) => k + '=' + turnModeOf(k)).join(' '));
  check('F-③ 🔴 空值不得被分档（Number(null)===0 会把"算不出来"说成"很轻松"）',
    turnLevelOf('seat', null) === '' && turnLevelOf('seat', undefined) === ''
    && turnLevelOf('seat', '') === '' && turnLevelOf('seat', NaN) === '',
    'null/undefined/空串/NaN ⇒ 全部空串（页面据此不渲染难度行）');
  check('F-④ 三档阈值边界：桌 ≤1.8 / ≤2.8；座位 ≤2.5 / ≤4.0',
    turnLevelOf('table', 1.8) === 'easy' && turnLevelOf('table', 2.81) === 'hard'
    && turnLevelOf('seat', 2.5) === 'easy' && turnLevelOf('seat', 4.01) === 'hard',
    '桌 1.8/2.81 = ' + turnLevelOf('table', 1.8) + '/' + turnLevelOf('table', 2.81)
    + ' · 座位 2.5/4.01 = ' + turnLevelOf('seat', 2.5) + '/' + turnLevelOf('seat', 4.01));
}
// 🔴 F-⑤（R237-followup）：三档难度文案**不得替老板下"生意好坏"的判决**。
//   李老师 2026-10-08 原话：「不要过多让翻台率去佐证生意好坏」。
//   首版文案踩了这条：`turnLevelEasy = '这个水平，正常做着就能到'` —— 它既是**乐观承诺**
//   （把"目标要求"说成"你能做到"），又是**拿自定值下的判决**：
//   判它的阈值（1.8/2.8 · 2.5/4.0）与喂它的单桌座位数（2/4/4/2）**两处都是自定值、零权威源**。
//   ⇒ 改为「目标要求」表述（反推出来的门槛，不是生意诊断）。
//   判据两条（任一不成立即红）：① 三个键都在且非空（缺键 ⇒ 页面渲染空行 = 静默空白）
//                              ② 不得含承诺/判决词（黑名单；文案类只此一法）
const termsSrc = readOr(TERMS) || '';
const lvKeys = ['turnLevelEasy', 'turnLevelOk', 'turnLevelHard'];
const lvText = lvKeys.map((k) => {
  const m = termsSrc.match(new RegExp(k + ":\\s*'([^']*)'"));
  return m ? m[1] : null;
});
const PROMISE = /就能到|轻松|稳赚|包赚|包您|保证|肯定赚|一定赚/;
check('F-⑤ 🔴 三档难度文案不得含"生意承诺/判决"词（须为"目标要求"表述）',
  lvText.every((s) => s && s.length > 0) && !lvText.some((s) => PROMISE.test(s)),
  lvText.map((s, i) => ['easy', 'ok', 'hard'][i] + '=' + (s === null ? '（键缺失）' : s)).join(' · '));

// ============ G R293：占比一律取 BANDS 指数（禁自定）============
// 🔴 为什么必须守（李老师 2026-10-14 原话：「咱们数据库有的指数，比如各种占比，按咱们的指数走」）：
//   `utils/bizPreset.js` 是**前端文件、不便 require 云函数** ⇒ BANDS 只能以「数字」形式落在这里。
//   数字一旦落下来就可能与单源**静默漂移**（改了 BANDS、这里没跟 ⇒ 老板看到的占比仍是旧口径，
//   且**零报错**：数字合法、装配通过、引擎照算）。S-⑤/S-⑥ 只守了 CITY_COEF，占比这一族此前裸奔。
//   判据两条：① 毛利率必须落在 BANDS 带内（带外 ⇒ 老板一进来就被误判"偏低/偏高"）；
//            ② `derivedFrom:'rent_rate'` 的 rentPct 必须 ≡ BANDS 中值之比（容差 ±1，取整误差）。
sec('G · R293 预设占比 ≡ BANDS 指数派生（禁自定）');
{
  const indSrcG = readOr(INDICATOR) || '';
  const segG = /const\s+BANDS\s*=\s*\{([\s\S]*?)\n\};/.exec(indSrcG);
  const BANDS = {};
  if (segG) {
    const lineRe = /^\s*(\w+):\s*\{([^}]*)\}/gm;
    let m;
    while ((m = lineRe.exec(segG[1]))) {
      const o = {};
      const kvRe = /(\w+):\s*\[([\d.]+),\s*([\d.]+)\]/g;
      let k;
      while ((k = kvRe.exec(m[2]))) o[k[1]] = { mid: (Number(k[2]) + Number(k[3])) / 2, lo: Number(k[2]), hi: Number(k[3]) };
      BANDS[m[1]] = o;
    }
  }
  const bandKeys = Object.keys(BANDS);
  check('G-① 从 indicatorRef.js 解析出 BANDS（5 业态 × 6 指标；解析不到即红，防"扫空恒绿"）',
    bandKeys.length === 5 && bandKeys.every((k) => Object.keys(BANDS[k]).length === 6),
    bandKeys.length ? bandKeys.map((k) => k + '(' + Object.keys(BANDS[k]).length + ')').join(' ') : '解析不到 ⇒ fail-closed');

  if (bandKeys.length === 5 && Array.isArray(BIZ_PRESETS)) {
    const outGm = [], outPct = [];
    for (const raw0 of BIZ_PRESETS) {
      // 🔴 R332：兜底条目（其他快餐/其他火锅…）只写 base，参数靠继承 ⇒ 必须看**合并后的生效值**，
      //   否则会被误判成"缺毛利率"。判据要守的是生效值，不是字面定义。
      const p = (findPreset && findPreset(raw0.presetKey)) || raw0;
      const b = BANDS[p.bizKey];
      if (!b) { outGm.push(p.presetKey + ' 业态无带'); continue; }
      const gm = p.params && p.params.grossMarginPct ? Number(p.params.grossMarginPct.v) : null;
      if (gm == null) { outGm.push(p.presetKey + ' 缺毛利率'); continue; }
      if (!(gm >= b.grossMargin.lo && gm <= b.grossMargin.hi)) {
        outGm.push(`${p.presetKey} 毛利率 ${gm}% ∉ [${b.grossMargin.lo},${b.grossMargin.hi}]`);
      }
      for (const m of (p.costMeta || [])) {
        if (m.derivedFrom !== 'rent_rate') continue;
        const indKey = m.itemKey === 'utility' ? 'energy' : (m.itemKey === 'manage' ? 'manage' : null);
        if (!indKey) continue;
        const want = Math.round(b[indKey].mid / b.rent.mid * 100);
        if (Math.abs(Number(m.rentPct) - want) > 1) {
          outPct.push(`${p.presetKey}.${m.itemKey} rentPct ${m.rentPct} ≠ BANDS 推导 ${want}`);
        }
        if (m.src === 'E') outPct.push(`${p.presetKey}.${m.itemKey} src 仍是 'E'（自定占比）⇒ 应为 'B'`);
      }
    }
    check('G-② 每个预设毛利率 ∈ BANDS.grossMargin 带内（带外 ⇒ 老板被误判"毛利率偏低"）',
      outGm.length === 0, outGm.length ? '越界：' + outGm.join(' | ') : `${BIZ_PRESETS.length} 个全在带内`);
    check('G-③ 🔴 rentPct ≡ BANDS 中值之比（rentPct = BANDS[ind]中值 ÷ BANDS.rent中值 × 100，±1）',
      outPct.length === 0, outPct.length ? '漂移：' + outPct.join(' | ') : '全部 ≡ BANDS 派生（零自定占比）');

    // ===== H 组（R332）：业态两级化 =====
    //   失效方式：① 某大类没有兜底 ⇒ 老板找不到自己的店，被迫选错细分（保本跟着错）
    //            ② 兜底偷偷复制一套参数 ⇒ 改大类时两处漂移（继承形同虚设）
    //            ③ 两个细分同名 ⇒ 老板看不出区别（矩阵页原先就是这么坏的）
    if (Array.isArray(BIZ_PRESETS) && findPreset) {
      for (const bk of ['fastfood', 'hotpot', 'dining', 'cafe']) {
        const hit = BIZ_PRESETS.filter((x) => x.presetKey === bk + '_other')[0];
        check('H-① ' + bk + ' 有「其他XX」兜底（找不到自己的店时仍有正确的大类参数）',
          !!hit && hit.bizKey === bk, hit ? ('bizKey=' + hit.bizKey) : '缺 ' + bk + '_other');
      }

      const copied = BIZ_PRESETS.filter((x) => x.base && (x.params || x.costMeta || x.buildRef));
      check('H-② 兜底条目不得自带 params/costMeta/buildRef（否则就是复制，继承等于没做）',
        copied.length === 0, copied.length ? '自带参数：' + copied.map((x) => x.presetKey).join(' | ') : '全部只写 base');

      const badBase = BIZ_PRESETS.filter((x) => x.base && !BIZ_PRESETS.some((y) => y.presetKey === x.base));
      check('H-③ base 必须指向真实存在的条目（写错 ⇒ 参数取不到、静默回落）',
        badBase.length === 0, badBase.length ? '悬空 base：' + badBase.map((x) => x.presetKey + '→' + x.base).join(' | ') : '全部可解析');

      const merged = BIZ_PRESETS.filter((x) => x.base).map((x) => findPreset(x.presetKey));
      const badMerge = merged.filter((m) => !m || !m.params || !m.params.grossMarginPct || !(m.costMeta && m.costMeta.length));
      check('H-④ 继承必须真的生效（合并后要有毛利率与成本结构，否则装配时静默缺项）',
        badMerge.length === 0, badMerge.length ? '合并后缺参数 ' + badMerge.length + ' 个' : merged.length + ' 个兜底全部合并成功');

      let T2 = null;
      try { T2 = require(path.join(__dirname, '../miniprogram/i18n/terms.js')).TERMS; } catch (e) { T2 = null; }
      const subMap = T2 && T2.m2 && T2.m2.bizPresets;
      if (subMap) {
        const missing = BIZ_PRESETS.filter((x) => !subMap[x.presetKey]).map((x) => x.presetKey);
        const vals = BIZ_PRESETS.map((x) => subMap[x.presetKey]).filter(Boolean);
        const dup = vals.filter((v, i) => vals.indexOf(v) !== i);
        // H-⑥ 🔴 R334：老板填的「人工每月总额」必须处处生效。
        //   火锅类 labor 是 form='fixed' + defaultYuan=25000，旧逻辑不看 laborTotalYuan
        //   ⇒ 填 12000 仍按 25000 算（实测复现，属"填了不生效"）。
        if (assembleItems && CITY_COEF) {
          const hp = findPreset('hotpot_half_self');
          const out = assembleItems(hp, {
            area: 60, rentYuan: 5000, laborTotalYuan: 12000,
            fixedYuan: { rent: 5000 }, buildItems: [],
          }, CITY_COEF.tier23);
          const labYuan = out.fixedItems.filter((x) => x.key === 'labor')
            .reduce((acc, b) => acc + b.fen, 0) / 100;
          check('H-⑥ 填了人工总额必须压过参数包固定额（火锅类 form=fixed 会吞掉用户输入）',
            labYuan === 12000, '实测 ' + labYuan + ' 元（应 12000）');
        }

        check('H-⑤ 每个业态都有显示名且互不重复（同名 ⇒ 老板看不出区别）',
          missing.length === 0 && dup.length === 0,
          (missing.length ? '缺名：' + missing.join(' | ') : '') + (dup.length ? ' 重名：' + dup.join(' | ') : '')
            || (BIZ_PRESETS.length + ' 个名字全不同'));
      }
    }
  }
}

// 断言数下界（用于 check_suite_assert_counts 登记；file 末尾打印「N 通过 / M 失败」）
console.log(`\n===== 业态参数包守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);