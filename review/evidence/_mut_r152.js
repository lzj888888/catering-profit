'use strict';
// R152 变异回灌：证明 tools/check_unit_family.js 新增的四条（⑩~⑬）真的能抓错（不是假绿）
//   ⑩ chips 默认收起    ⑪ 选完自动收起    ⑫ 手改保护    ⑬ 换算系数「可手改」可见信号（双副本）
// 铁律：每条独立、锚点强制命中 1 次、跑完立刻还原、还原后 md5 全等。
// 组A = 把源码改回错误写法 ⇒ **必须转红**；组B = 语义等价改写 ⇒ **必须仍绿**（判行为不判文本）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const OUT = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_m3/r152_tmp/';
const GUARD = 'tools/check_unit_family.js';
const ME = 'pages/material/edit.js';
const TM_A = 'miniprogram/i18n/terms.js';
const TM_B = 'specs/dev-specs/i18n/terms.js';

const rd = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const wr = (rel, s) => fs.writeFileSync(path.join(REPO, rel), s, 'utf8');
const md5 = (rel) => crypto.createHash('md5').update(fs.readFileSync(path.join(REPO, rel))).digest('hex');

function runGuard() {
  let out = '', rc = 0;
  try { out = execFileSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: REPO }); }
  catch (e) { rc = (e.status == null ? -1 : e.status); out = (e.stdout || '') + (e.stderr || ''); }
  return { rc, out };
}
const judge = (out) => out.split(/\r?\n/).filter((l) => l.includes('❌'));

const MUTS = [
  // ---- 组A：错误写法 ⇒ 必须转红 ----
  { id: 'M1', name: 'chips 默认改回展开（14 项占屏回归）', file: ME,
    from: '    unitChipsOpen: false,',
    to: '    unitChipsOpen: true,', expectRed: true, want: 'unitChipsOpen: true' },
  { id: 'M2', name: 'pickUnit 去掉自动收起（要用户再点 ▾）', file: ME,
    from: '    const patch = { purchase_unit: u, unitChipsOpen: false };',
    to: '    const patch = { purchase_unit: u };', expectRed: true, want: '选完不收起' },
  { id: 'M3', name: 'pickUnit 去掉手改保护（手改值被建议值冲掉）', file: ME,
    from: '    if (sug != null && !this.data.convertTouched) patch.convert_factor = String(sug);',
    to: '    if (sug != null) patch.convert_factor = String(sug);', expectRed: true, want: 'convertTouched' },
  { id: 'M4', name: '术语 A 副本去掉「可手改」信号', file: TM_A,
    from: '（净料口径 · 可手改）', to: '（净料口径）', expectRed: true, want: 'A 副本' },
  { id: 'M5', name: '术语 B 副本去掉「可手改」信号（只改一份也要红）', file: TM_B,
    from: '（净料口径 · 可手改）', to: '（净料口径）', expectRed: true, want: 'B 副本' },
  // ---- 组B：语义等价改写 ⇒ 必须仍绿 ----
  { id: 'B1', name: 'patch 里两个键换顺序（等价）', file: ME,
    from: '    const patch = { purchase_unit: u, unitChipsOpen: false };',
    to: '    const patch = { unitChipsOpen: false, purchase_unit: u };', expectRed: false, want: '' },
  { id: 'B2', name: 'onConvert 里两个键换顺序（等价）', file: ME,
    from: '    this.setData({ convert_factor: e.detail.value, convertTouched: true }, () => this.refreshUnitHint());',
    to: '    this.setData({ convertTouched: true, convert_factor: e.detail.value }, () => this.refreshUnitHint());', expectRed: false, want: '' },
  { id: 'B3', name: '提示文案换标点但仍含「手改」（等价）', file: TM_A,
    from: '（净料口径 · 可手改）', to: '（净料口径，可手改）', expectRed: false, want: '' },
];

fs.mkdirSync(OUT, { recursive: true });
const base = {};
[...new Set(MUTS.map((m) => m.file))].forEach((f) => { base[f] = md5(f); });

let pass = 0, fail = 0;
const log = [];
log.push('===== R152 变异回灌（守卫 tools/check_unit_family.js 新增 ⑩~⑬）=====');

const pre = runGuard();
log.push('[基线] rc=' + pre.rc + ' | ❌ ' + judge(pre.out).length + ' 条');
if (pre.rc !== 0) { log.push('!! 基线非绿，回灌无意义 —— 中止'); fail++; }

for (const m of MUTS) {
  const orig = rd(m.file);
  const cnt = orig.split(m.from).length - 1;
  if (cnt !== 1) { log.push('❌ ' + m.id + ' 锚点命中 ' + cnt + ' 次（期望 1）—— 跳过'); fail++; continue; }
  wr(m.file, orig.replace(m.from, m.to));
  let r;
  try { r = runGuard(); } catch (e) { r = { rc: -1, out: String(e && e.message) }; }
  wr(m.file, orig);
  const restored = md5(m.file) === base[m.file];
  const badLines = judge(r.out);
  const hitWant = m.want ? r.out.includes(m.want) : false;
  const okExpect = (m.expectRed ? (r.rc !== 0) : (r.rc === 0));
  const good = okExpect && restored && (m.expectRed ? hitWant : true);
  if (good) pass++; else fail++;
  log.push((good ? '✅ ' : '❌ ') + m.id + ' ' + m.name
    + ' | rc=' + r.rc + ' | 期望' + (m.expectRed ? '红' : '绿')
    + ' | 点名=' + (badLines.length ? badLines[0].trim().slice(0, 110) : '(无)')
    + ' | 命中关键词[' + m.want + ']=' + hitWant
    + ' | 还原md5全等=' + restored);
}

const post = runGuard();
log.push('[还原后基线] rc=' + post.rc + ' | ❌ ' + judge(post.out).length + ' 条');
const allRestored = Object.keys(base).every((f) => md5(f) === base[f]);
log.push('全部受改文件 md5 全等 = ' + allRestored);
if (!allRestored || post.rc !== 0) fail++;
log.push('');
log.push('===== 变异回灌结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
const text = log.join('\n') + '\n';
fs.writeFileSync(OUT + 'mutation_r152.txt', text, 'utf8');
console.log(text);
