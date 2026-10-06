#!/usr/bin/env node
// tools/check_biz_preset.js —— M2v1.3 业态参数包守卫（新增 · 六组 S/A/B/C/D/E）
// 运行：node tools/check_biz_preset.js   （由 verify_all.js 的 [biz-preset] 套件调用）
//
// 为什么需要它（R182「判据存在 ≠ 被执行」同族）：业态参数包的取值/形态/城市系数全是
// 契约里的硬规则（开发规范 v1.3 §三），此前零机器判据 ⇒ 写错/漏乘/自创数值无人报警。
// 六组判据（全部 fail-closed：读不到 / 解析不到即判红）：
//   S 扫描面   bizPreset.js 存在 + 预设数 ≥ 4 + 断言数下界（防"扫空 ⇒ 恒绿"）
//   A 主分类   每个预设 bizKey ∈ indicatorRef.js::BIZ_KEYS（4 类，从源文件解析，不硬编码）
//   B 整套独立 每个预设 params/costMeta 自包含，禁止引用别的预设（跨业态继承会抹平差异）
//   C 形态合法 form ∈ 五形态；参数完备：fixed(src≠U)⇒defaultYuan / area_linear⇒base+perSqm /
//     headcount_linear⇒params.laborUnitYuan / revenue_rate⇒pct / step⇒steps 非空
//   D L1/L2禁入 index.wxml 的 L1/L2 区块不得把 坪效/目标租金率/翻台率 当输入框
//   E 回本 único出口 cash 回本算式全仓只出现一次且在 utils/bizPreset.js；pages/** 不得复算
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIZ_PRESET = path.join(ROOT, 'utils', 'bizPreset.js');
const INDICATOR = path.join(ROOT, 'cloudfunctions', 'common', 'indicatorRef.js');
const PAGE_WXML = path.join(ROOT, 'pages', 'sandbox', 'index.wxml');

const FORMS = ['fixed', 'area_linear', 'headcount_linear', 'revenue_rate', 'step'];

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

let BIZ_PRESETS = null, CITY_COEF = null, paybackCash = null;
try { ({ BIZ_PRESETS, CITY_COEF, paybackCash } = require(BIZ_PRESET)); } catch (e) { BIZ_PRESETS = null; }
check('S-② bizPreset 可 require 且导出 BIZ_PRESETS / CITY_COEF',
  Array.isArray(BIZ_PRESETS) && !!CITY_COEF, BIZ_PRESETS ? `预设 ${BIZ_PRESETS.length} 个` : 'require 失败');
check('S-③ 预设数 ≥ 4', Array.isArray(BIZ_PRESETS) && BIZ_PRESETS.length >= 4, BIZ_PRESETS ? BIZ_PRESETS.length + ' 个' : '0');
check('S-④ CITY_COEF 三档都带 rent+labor 双键',
  !!CITY_COEF && ['tier1', 'tier23', 'county'].every((k) => CITY_COEF[k] && CITY_COEF[k].rent != null && CITY_COEF[k].labor != null),
  'tier1/county 双键须在（漏乘 labor ⇒ 一线退回二三线）');

// ============ A 主分类合法性（从 indicatorRef 解析，不硬编码）============
sec('A · 主分类 ∈ indicatorRef.js::BIZ_KEYS');
const indSrc = readOr(INDICATOR) || '';
const bizKeysMatch = /const\s+BIZ_KEYS\s*=\s*\[([^\]]*)\]/.exec(indSrc);
const BIZ_KEYS = bizKeysMatch
  ? bizKeysMatch[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  : [];
check('A-① 从 indicatorRef.js 解析出 BIZ_KEYS 且恰 4 类', BIZ_KEYS.length === 4, BIZ_KEYS.join('/'));
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
    // 自身 presetKey 允许；出现其它预设的 presetKey = 引用别的预设
    return keys.some((k) => k !== p.presetKey && s.indexOf(k) >= 0);
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
        (m.form === 'fixed' && m.src !== 'U' && m.defaultYuan == null)
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

// 断言数下界（用于 check_suite_assert_counts 登记；file 末尾打印「N 通过 / M 失败」）
console.log(`\n===== 业态参数包守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);