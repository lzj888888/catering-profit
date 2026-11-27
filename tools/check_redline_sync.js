#!/usr/bin/env node
// tools/check_redline_sync.js —— 红线「中文文案 ↔ 判据常量」一致性守卫（R777 · 2026-11-27，第 344 套件）
//
// 🔴 为什么需要这一层：这是本仓第 N 例「文案飘了没人看」。
//   R772 我把结果页 sigR6 改成「租约不到 1 年到期、涨幅超过三成」，
//   而 R6 判据当时还是 `m <= 3 && inc >= 20 && r < 0` —— **文案改了、代码没改**。
//   后果：老板看到"会触发"的解释，实际条件差三倍；反过来该触发的店又没报。
//   同族前例：sigR2 写着「连亏超过可扛上限」，而 R615 早把这个概念删了。
//   这两次都是**人工翻代码翻出来的**，不是机器抓的 —— 那就一定会再犯第四次。
//
// 本守卫的做法（关键设计）：
//   1. 阈值不在文案里"另存一份"，而是集中在引擎 `REDLINE_TH`；
//   2. 守卫**从中文文案里把数字抽出来**（支持 "1 年"→12 月、"三成"→30、"4 倍"→4、
//      "两成"→20、"这个月"→1 等中文表达），再与常量逐条比对；
//   3. 反向再查一遍**引擎源码**：REDLINES 区内不许出现裸阈值比较（必须走 REDLINE_TH），
//      否则"常量改了但判据还留着老数字"照样能过 B 段。
//
// 为什么要反向那条：只查文案 → 有人改判据不改文案能过；只查源码 → 有人改文案不改判据能过。
// 两头都钉住，才叫一致。
//
// 运行：node tools/check_redline_sync.js   （由 verify_all.js 的 [redline-sync] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const READ = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

const ENG = require(path.join(ROOT, 'cloudfunctions/common/diagnosisEngine.js'));
const { TERMS } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const SIG = TERMS.diagResult || {};
const TH = ENG.REDLINE_TH;

// ============ 一、中文数字抽取器 ============
// 顺序很重要：先匹配带单位的（"1 年"/"三成"），再匹配普通阿拉伯数字，避免"1 年"被当成 1。
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
// 口语单位：老板话里"这个月"就是"不到 1 个月"，不是在说日历月
const ALIAS = { 这个月: 1, 下个月: 1, 一个月: 1 };

function extractNumbers(text) {
  const t = String(text || '');
  const out = [];
  const push = (v, why) => { if (isFinite(v)) out.push({ v, why }); };

  // 「N 年」→ 月数（"不到 1 年" = 12 个月上限）
  let m;
  const reYear = /(\d+(?:\.\d+)?|[零一二两三四五六七八九十半])\s*年/g;
  while ((m = reYear.exec(t))) {
    const n = /^\d/.test(m[1]) ? parseFloat(m[1]) : CN_DIGIT[m[1]];
    push(n * 12, m[0] + '→月');
  }
  // 「N 成」→ 百分比
  const reCheng = /([零一二两三四五六七八九十])\s*成/g;
  while ((m = reCheng.exec(t))) push(CN_DIGIT[m[1]] * 10, m[0] + '→%');

  // 「N 个月」/「N 倍」/「N%」→ 原值
  const reUnit = /(\d+(?:\.\d+)?)\s*(个月|倍|%)/g;
  while ((m = reUnit.exec(t))) push(parseFloat(m[1]), m[0]);

  // 口语别名
  Object.keys(ALIAS).forEach((k) => { if (t.indexOf(k) >= 0) push(ALIAS[k], k + '→月'); });

  return out;
}

// ============ 二、A 段：抽取器自证 ============
sec('A · 抽取器自证（先证明它能抓，再拿它判别人）');

const posCases = [
  ['不到 1 年到期', 12], ['涨幅超过三成', 30], ['超过 4 倍', 4],
  ['两成', 20], ['撑不过 3 个月', 3], ['净利率还不到 5%', 5], ['账上的钱撑不过这个月', 1],
];
const posOk = posCases.every(([txt, want]) => extractNumbers(txt).some((x) => x.v === want));
ok('A-① 正样本必中：7 种中文阈值表达都能抽出正确数值', posOk,
  posCases.map(([t, w]) => `${t}→${w}`).join(' / '));

// 负样本：不含阈值的句子不得抽出数字（否则 B 段会拿噪声去比）
const negCases = ['客流在持续减少，不是淡旺季波动', '顾客卡里没有未消费的余额'];
const negOk = negCases.every((t) => extractNumbers(t).length === 0);
ok('A-② 负样本不误杀：无数字的文案抽出 0 个值', negOk,
  negCases.map((t) => `「${t.slice(0, 10)}…」→${extractNumbers(t).length}`).join(' / '));

// ============ 三、B 段：文案数字 == 判据常量 ============
sec('B · 逐条比对：文案里说的数，必须就是判据里用的数');

// 每条红线声明「哪些文案键」+「对应哪些常量字段」
//   （R3 是枚举、无数字阈值，不参与 B 段但参与 D 段的存在性检查）
const PLAN = [
  { code: 'R1', keys: ['sigR1'], fields: ['months'] },
  { code: 'R2', keys: ['sigR2'], fields: ['bleedPct'] },
  { code: 'R4', keys: ['sigR4', null], fields: ['lookbackMonths'] }, // sigR4 与补录问法共用窗口
  { code: 'R5', keys: ['sigR5'], fields: ['months'] },
  { code: 'R6', keys: ['sigR6'], fields: ['leaseMonths', 'increasePct', 'netMarginPct'] },
  { code: 'R7', keys: ['sigR7'], fields: ['ratio'] },
];

PLAN.forEach(({ code, keys, fields }) => {
  const th = TH[code] || {};
  const allowed = fields.map((f) => th[f]).filter((v) => typeof v === 'number');
  const texts = keys.filter(Boolean).map((k) => SIG[k]).filter((v) => typeof v === 'string');
  const found = [];
  texts.forEach((t) => extractNumbers(t).forEach((x) => found.push(x)));

  if (fields[0] === 'lookbackMonths') {
    // R4 额外查补录问法（时间窗口是"提问侧"的约束，两边必须同一个数）
    const hint = (TERMS.diagInput || {}).foodSafetyHint || '';
    extractNumbers(hint).forEach((x) => found.push({ v: x.v, why: '问法·' + x.why }));
  }

  const bad = found.filter((x) => allowed.indexOf(x.v) < 0);
  const desc = found.length ? found.map((x) => `${x.v}(${x.why})`).join(' ') : '无数字';
  ok(`B-${code} 文案数字 ∈ 判据常量 {${allowed.join(', ')}}`, found.length > 0 && bad.length === 0,
    bad.length ? `多出 ${bad.map((x) => x.v).join(',')} ≠ 常量` : desc);
});

// ============ 四、C 段：引擎源码里不许有裸阈值 ============
sec('C · 反向：REDLINES 区内不许出现裸阈值比较（必须走 REDLINE_TH）');

const src = READ('cloudfunctions/common/diagnosisEngine.js');
const segStart = src.indexOf('const REDLINES = [');
// 只取 REDLINES 数组本身（到它自己的 `];` 为止）——往后 extends 到 evaluateDiagnosis，
// 那里有 `score < 80`（短板阈值）之类与红线无关的比较，会被误判成裸阈值。
const segEnd = src.indexOf('\n];', segStart);
// 🔴 必须先剥注释：说明性注释里天然会写「改前是 m<=3 / inc>=20」这类历史记录，
//   直接扫源码会把它们当成裸阈值误杀（check_copy_compliance 头注释记过同一个坑）。
//   剥注释时保留行号（换成等长空行）以便报错定位。
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\w])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}
const seg = segStart >= 0 && segEnd > segStart ? stripComments(src.slice(segStart, segEnd)) : '';

// 只抓"非 0 的比较"：`<= 0` / `< 0` 是符号判断（亏/没亏），不是阈值，必须放行
const naked = [];
const reCmp = (/[<>]=?\s*(\d+(?:\.\d+)?)/g);
let cm;
while ((cm = reCmp.exec(seg))) {
  const v = parseFloat(cm[1]);
  if (v !== 0) {
    const ctx = seg.slice(Math.max(0, cm.index - 40), cm.index + 20).replace(/\s+/g, ' ');
    naked.push(`${cm[0]} @ …${ctx}…`);
  }
}
ok('C-① REDLINES 区内无非 0 的裸阈值比较', naked.length === 0,
  naked.length ? naked.slice(0, 3).join(' | ') : '全部走 REDLINE_TH');

ok('C-② REDLINE_TH 已导出且字段齐备（R1~R7 全在）',
  !!TH && ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'].every((k) => TH[k] && typeof TH[k] === 'object'),
  TH ? Object.keys(TH).join(',') : '未导出');

ok('C-③ 聚合入口已导出 REDLINE_TH（同 genId 教训：漏导 ⇒ 云端 TypeError）',
  /REDLINE_TH:\s*require\('\.\/diagnosisEngine'\)\.REDLINE_TH/.test(READ('cloudfunctions/common/index.js')),
  'common/index.js');

// ============ 五、D 段：覆盖面自证 ============
sec('D · 覆盖面自证（防止有人加了一条红线却忘了配文案/常量）');

const engCodes = (ENG.REDLINES || []).map((r) => r.code);
ok('D-① 引擎红线 = 文案键 = 常量表，三方编号完全一致',
  JSON.stringify(engCodes) === JSON.stringify(Object.keys(TH))
  && engCodes.every((c) => Object.prototype.hasOwnProperty.call(SIG, 'sig' + c)),
  `引擎[${engCodes.join(',')}] 常量[${Object.keys(TH || {}).join(',')}]`);

ok('D-② 双副本 terms 字节一致（页面与规格各一份，改一处不改另一处 = 静默分裂）',
  fs.readFileSync(path.join(ROOT, 'miniprogram/i18n/terms.js')).equals(
    fs.readFileSync(path.join(ROOT, 'specs/dev-specs/i18n/terms.js'))),
  'miniprogram ≡ specs/dev-specs');

ok('D-③ 红线文案里不得出现「可扛上限」这类已撤销概念（R615 已删，R772 才发现还挂在 R2 上）',
  !JSON.stringify(SIG).includes('可扛上限'), 'R2 文案已改口径');

// ============ 汇总 ============
console.log(`\n===== 红线文案与判据一致性守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
