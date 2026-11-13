'use strict';
// tools/check_r714_decisions.js ——【R726】R714 算钱口径守卫（防「一行字传递」漂移）
// 运行：node tools/check_r714_decisions.js      （EXIT 0 = 全绿）
//
// 为什么要有这个守卫：R714（考题实测报告）的结论从未进机器台账，只靠 R715/R718/R719
//   各轮报告末尾一行「R714 三件待拍板仍未动」传递 ⇒ 三份报告里的「三件」不是同一组：
//     R715 §三  = A 外卖本单售价 / B 售价加权 / C 同名卡
//     R718:147  = 售价加权 / 同名卡 / reconcile NaN
//     R719:201  = 售价加权 / 同名卡 / reconcile NaN
//   A 已在 R716 做掉却没人销账，第三件被静默换成 E-6。无单一真源 ⇒ 口径会漂。
//   ⇒ 本守卫把「口径名单」钉成台账 id 集合，并**真跑产品代码**核对状态，不再读报告的字面。
//
// 守什么（判行为，不判字面）：
//   A 名单：四张分票在台账里，id 唯一、status 合法、每条都有证据与下一步/修法证据。
//   B 落地：E-6 三种非法 coverage 一律抑制（require 真模块跑）；
//           E-1 明示文案双副本逐字一致 + wxml 渲染 + t 映射登记；
//           E-2 同名卡文案含「只会算到其中一张」的后果语义。
//   C 反恒真：合成样本证明判据能红；守卫不得因为「扫描面空了」而恒绿。
//
// ⚠️ 不挂 verify_all 之外的任何扫描清单改动；新增文案键不得照抄「唯一声明处」类标记串。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

let pass = 0;
const bad = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('   ✅ ' + name); }
  else { bad.push(name); console.log('   ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

// ============ 可复算的判据（合成样本复算 ⇒ 不是藏在流程里的恒真）============
const IDS = ['R3-9', 'R3-10', 'R3-11', 'R3-12'];
const STATUS_RULE = { 'R3-9': 'deferred', 'R3-10': 'fixed', 'R3-11': 'fixed', 'R3-12': 'fixed' };

/** 名单完整性：四票各一次、状态符合本轮决策、每条有证据；返回问题数组 */
function judgeLedger(d) {
  const p = [];
  if (!d || !Array.isArray(d.findings)) return ['台账不可解析'];
  IDS.forEach((id) => {
    const hit = d.findings.filter((f) => f && f.id === id);
    if (hit.length !== 1) { p.push(id + ':条数=' + hit.length); return; }
    const f = hit[0];
    if (f.status !== STATUS_RULE[id]) p.push(id + ':状态=' + f.status);
    if (!f.evidence || !String(f.evidence).trim()) p.push(id + ':证据缺失');
    if (f.status === 'fixed' && !f.fix_evidence) p.push(id + ':修了没证据');
    if (f.status === 'deferred' && (!f.priority || !f.next_action)) p.push(id + ':待办没主人');
  });
  if (d.cross_review && d.cross_review.total !== d.findings.length) p.push('meta总数≠条目数');
  return p;
}

/** 行为判据：非法 coverage 是否一律被抑制（跑真模块，不读源码字面） */
function judgeCoverageFinite(reconcile) {
  const evil = [NaN, Infinity, 'abc'];
  const good = [1, 0.8];
  const out = { evil: [], good: [] };
  for (const c of evil) {
    const r = reconcile({ menuPct: 40, actualPct: 55, coverage: c, incomeFen: 100000 });
    out.evil.push({ c: String(c), suppressed: r.suppressed, diffPp: r.diffPp });
  }
  for (const c of good) {
    const r = reconcile({ menuPct: 40, actualPct: 55, coverage: c, incomeFen: 100000 });
    out.good.push({ c: String(c), suppressed: r.suppressed, diffPp: r.diffPp });
  }
  return out;
}

/** 文案判据：从产品源码解析事实，再与单源比对（两侧都来自产品侧，不手抄常量清单） */
function judgeWording(termsA, termsB, pageJs, pageWxml) {
  const val = (src, key) => {
    const m = new RegExp('(?:^|\\n)\\s*' + key + ":\\s*'([^']*)'", 'm').exec(src);
    return m ? m[1] : null;
  };
  const note = val(termsA, 'reconMenuPriceNote');
  const noteB = val(termsB, 'reconMenuPriceNote');
  const dup = val(termsA, 'dupCardTip');
  const dupB = val(termsB, 'dupCardTip');
  return {
    mirror: md5(termsA) === md5(termsB),
    noteInTerms: !!note && /售价估算/.test(note) && /不等于/.test(note),
    noteSame: note !== null && note === noteB,
    noteInPage: /reconMenuPriceNote:\s*TERMS\.card\.reconMenuPriceNote/.test(pageJs)
      && /\{\{t\.reconMenuPriceNote\}\}/.test(pageWxml),
    dupHasConsequence: !!dup && /只会算到其中一张/.test(dup) && /0 销量/.test(dup),
    dupSame: dup !== null && dup === dupB,
  };
}

// ⚠️ 顶部**不得**用 ==== 装饰横幅 —— R66「段标题下零断言即判红」（见 tools/check_formc_parse.js:17）。
console.log('\nR726 · R714 算钱口径守卫（名单 / 落地 / 反恒真）');

// ---------- A 名单 ----------
let data = null;
try { data = JSON.parse(rd('review/evidence/r721_findings.json')); } catch (e) { /* 下面判红 */ }
const issues = judgeLedger(data);
console.log('\n===== A. 口径名单（台账单一真源）=====');
ok('A-① 台账在场可解析，且 R714 四张分票齐全', !!data && Array.isArray(data.findings) && data.findings.length >= 17,
  data && data.findings ? String(data.findings.length) : '读不到');
ok('A-② 四票各一次、状态符合决策、证据/下一步齐备', issues.length === 0, issues.slice(0, 4).join(' | '));
ok('A-③ 「三件」不再是含糊一行字：E-1/E-2/E-6 各自独立成票且 id 可查',
  !!data && ['R3-9', 'R3-10', 'R3-11'].every((id) => {
    const f = data.findings.find((x) => x.id === id);
    return f && /E-[126]/.test(String(f.title));
  }));
ok('A-④ 漂移本身有票（R3-12），且写明 R715 三条 ≠ R718/R719 三条',
  !!data && (() => {
    const f = data.findings.find((x) => x.id === 'R3-12');
    return f && /漂移/.test(String(f.title)) && /R715/.test(String(f.evidence)) && /R718/.test(String(f.evidence));
  })());

// ---------- B 落地（真跑产品代码）----------
console.log('\n===== B. 代码落地（判行为，不判字面）=====');
const RD = require(path.join(ROOT, 'utils/reconDerive.js'));
const cov = judgeCoverageFinite(RD.reconcile);
ok('B-① 🔴 E-6：NaN / Infinity / "abc" 三种非法 coverage 一律抑制且 diffPp=null',
  cov.evil.length === 3 && cov.evil.every((x) => x.suppressed === true && x.diffPp === null),
  JSON.stringify(cov.evil));
ok('B-② 反恒真：合法 coverage（1 / 0.8）仍正常出结论 ⇒ B-① 不是「永远抑制」的假绿',
  cov.good.length === 2 && cov.good.every((x) => x.suppressed === false && x.diffPp === 15),
  JSON.stringify(cov.good));
ok('B-③ 低覆盖率 0.25 仍判 coverage_low（既有闸门没被改坏）',
  RD.reconcile({ menuPct: 40, actualPct: 55, coverage: 0.25, incomeFen: 100000 }).reason === 'coverage_low');

const tA = rd('miniprogram/i18n/terms.js');
const tB = rd('specs/dev-specs/i18n/terms.js');
const pJs = rd('subpkg/tools/recon/index.js');
const pWxml = rd('subpkg/tools/recon/index.wxml');
const w = judgeWording(tA, tB, pJs, pWxml);
ok('B-④ terms 双副本逐字一致（md5）', w.mirror, md5(tA) + ' / ' + md5(tB));
ok('B-⑤ 🔴 E-1：明示文案讲清「按售价估算 / 不等于实际菜结构」，双副本同值',
  w.noteInTerms && w.noteSame);
ok('B-⑥ E-1 文案真上屏：t 映射登记 + wxml 渲染（防加了文案却静默空白）', w.noteInPage);
ok('B-⑦ 🔴 E-2：同名卡文案含后果「只会算到其中一张 / 0 销量」，双副本同值',
  w.dupHasConsequence && w.dupSame);

// ---------- C 反恒真（合成样本：判据必须能红）----------
console.log('\n===== C. 反恒真（合成坏样本必须被抓）=====');
const good = judgeLedger(data);
const badNoTicket = judgeLedger(Object.assign({}, data, { findings: data.findings.filter((f) => f.id !== 'R3-11') }));
const badStatus = judgeLedger(Object.assign({}, data, {
  findings: data.findings.map((f) => f.id === 'R3-9' ? Object.assign({}, f, { status: 'fixed', fix_evidence: '', next_action: '' }) : f),
}));
const badNoEvidence = judgeLedger(Object.assign({}, data, {
  findings: data.findings.map((f) => f.id === 'R3-10' ? Object.assign({}, f, { evidence: '' }) : f),
}));
ok('C-① 好样本零问题 / 抽掉一张票⇒抓到 / 状态造假⇒抓到 / 证据清空⇒抓到',
  good.length === 0 && badNoTicket.length > 0 && badStatus.length > 0 && badNoEvidence.length > 0,
  'good=' + good.length + ' noTicket=' + badNoTicket.length + ' badStatus=' + badStatus.length + ' noEvidence=' + badNoEvidence.length);

// 文案判据的合成反例：只差被测项，证明不是恒真
const wNoNote = judgeWording(tA.replace(/售价估算/g, '随便算算'), tB, pJs, pWxml);
const wNoRender = judgeWording(tA, tB, pJs.replace('reconMenuPriceNote: TERMS.card.reconMenuPriceNote,', ''), pWxml);
const wNoDupConsequence = judgeWording(tA.replace(/导入销量时只会算到其中一张[^']*/, ''), tB, pJs, pWxml);
ok('C-② 文案判据非恒真：删「售价估算」⇒红 / 断 t 映射⇒红 / 删同名卡后果⇒红',
  w.noteInTerms && !wNoNote.noteInTerms && w.noteInPage && !wNoRender.noteInPage
  && w.dupHasConsequence && !wNoDupConsequence.dupHasConsequence);

// 行为判据的合成反例：把「永远抑制」的实现喂进来，B-② 必须抓到
const alwaysSuppress = () => ({ suppressed: true, diffPp: null, reason: 'coverage_missing' });
const covFake = judgeCoverageFinite(alwaysSuppress);
ok('C-③ 行为判据非恒真：喂一个「永远抑制」的假实现 ⇒ B-② 的反恒真腿能识别',
  covFake.evil.every((x) => x.suppressed) && covFake.good.some((x) => x.suppressed === true && x.diffPp === null));

console.log('\n============================================================');
console.log('===== R714 算钱口径守卫结果：' + pass + ' 通过 / ' + bad.length + ' 失败 =====');
if (bad.length) {
  bad.forEach((p) => console.log('   ❌ ' + p));
  process.exit(1);
}
process.exit(0);
