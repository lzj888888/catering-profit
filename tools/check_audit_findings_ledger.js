// tools/check_audit_findings_ledger.js ——【R721】审计发现台账守卫
// 运行：node tools/check_audit_findings_ledger.js      （EXIT 0 = 全绿）
//
// 李老师 2026-11-12：「除了我们正常审计还有什么方法……有没有好几个人一起审、
//   审完挑毛病这种交叉方式……怎么样别留隐患，你想方案，因为你现在是总设计师。」
//
// ===== 本守卫守的不是「有没有 bug」，是「发现会不会悄悄消失」=====
//   交叉审会一次性产出十几条发现，其中大部分当场修不完。
//   最危险的不是「没修」，是三个月后没人记得它存在、或台账写着 fixed 但源码根本没动。
//   ⇒ 把每次交叉审的发现落成机器台账 review/evidence/r721_findings.json，由本守卫天天盯：
//     ① 每条必须有证据 file:line + 来源 + 核实状态；
//     ② status 只允许 fixed / deferred（词表白名单）；status=fixed 必须有 fix_evidence，
//        且 L-⑦ 会去**产品源码核对状态不是嘴上说说**；
//     ③ status=deferred 必须有 priority + next_action（不许挂着没下一步）；
//     ④ 准备修的条目必须记录「唱反调」结论（防确认偏误被抹掉）；
//     ⑤ 门禁盲区（零桩页 >0，口径 tools/scan_zero_stub_pages.js）必须在台账里对应一条 P0/P1 待办；
//     ⑥ 判据自身用合成坏样本做反恒真，防「恒真橡皮章」。
//
// ⚠️ 台账是 append-only 的**发现档案**：条目只能改 status，不许删。
//    以后每轮交叉审新增条目时同步更新 meta.cross_review 计数。

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('   ✅ ' + name); }
  else { problems.push(name); console.log('   ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

const LEDGER_REL = 'review/evidence/r721_findings.json';
const DESIGN_REL = 'review/DESIGN_R721_持续发现漏洞机制.md';

// ===== 可复用的判据（能被合成样本复算 ⇒ 不是藏在流程里的恒真）=====
const REQUIRED = ['id', 'source', 'severity', 'title', 'evidence', 'verified_by', 'status', 'verified'];
// 🔴 R730：状态词表白名单。
//   事故：R729b(04e950e) 把 R3-9 的 status 从 deferred 写成 open —— 而下面所有完整性规则
//     只对 'fixed' / 'deferred' 生效 ⇒ 'open' 既不受「修了没证据」约束、也不受「待办没主人」
//     约束，**从所有检查里静默漏过**；只有 check_r714_decisions 的 STATUS_RULE 撞红才暴露。
//   语义上 R3-9 仍是 P1 待办（有 priority + next_action，等真机验证）⇒ 词表不该有第三种值。
//   ⇒ 加白名单：状态写成词表外的值本身就是缺陷，先判红再谈别的。
const STATUS_VOCAB = ['fixed', 'deferred'];
function validateLedger(d) {
  const p = [];
  if (!d || !Array.isArray(d.findings)) return ['台账不可解析'];
  d.findings.forEach((f, i) => {
    const tag = f && f.id ? f.id : '#' + i;
    REQUIRED.forEach((k) => {
      if (!f || f[k] === undefined || f[k] === null || f[k] === '') p.push('证据缺失:' + tag + ':' + k);
    });
    if (f && f.status !== undefined && f.status !== null && STATUS_VOCAB.indexOf(f.status) < 0) {
      p.push('状态词表外:' + tag + ':' + f.status);
    }
    if (f && f.status === 'fixed') {
      if (!f.fix_evidence) p.push('修了没证据:' + tag);
      if (!f.challenge) p.push('挑毛病结论缺失:' + tag);
    }
    if (f && f.status === 'deferred' && (!f.priority || !f.next_action)) p.push('下一步缺失:' + tag);
  });
  return p;
}
const has = (arr, kw) => arr.some((x) => x.indexOf(kw) >= 0);

console.log('\n===== L. 审计发现台账（防发现悄悄消失）=====');
let data = null;
try { data = JSON.parse(fs.readFileSync(path.join(ROOT, LEDGER_REL), 'utf8')); } catch (e) { /* 下面判红 */ }
ok('L-① 台账在场且可解析，条目数 ≥17', !!data && Array.isArray(data.findings) && data.findings.length >= 17,
  data && data.findings ? String(data.findings.length) : '读不到');
const issues = validateLedger(data);
ok('L-② 每条发现都有 id/source/证据/来源/状态，且状态在词表 {fixed,deferred} 内（零字段缺失 + 零状态漂移）', issues.length === 0, issues.slice(0, 3).join(' | '));

const F = (data && data.findings) || [];
const sources = [...new Set(F.map((f) => f.source))];
ok('L-③ 三个独立切面都在台账里（交叉审不是一个人审的）',
  ['R1-gate-blindspot', 'R2-ux', 'R3-security'].every((s) => sources.indexOf(s) >= 0), sources.join(','));
ok('L-④ meta 如实登记交叉审规模（3 reviewer + 1 唱反调 + 6 条准备修，条目数与 findings 长度一致）',
  data && data.cross_review && data.cross_review.reviewers === 3 && data.cross_review.adversarial === 1
  && data.cross_review.prepared_to_fix === 6 && data.cross_review.total === F.length,
  JSON.stringify(data && data.cross_review));

const fixed = F.filter((f) => f.status === 'fixed');
const deferred = F.filter((f) => f.status === 'deferred');
ok('L-⑤ fixed 条目 ≥3 且每条都有修法证据与挑毛病结论',
  fixed.length >= 3 && fixed.every((f) => f.fix_evidence && f.challenge), 'fixed=' + fixed.length);
// R723：下界从 10 降到 5 —— 随着修复推进 deferred 会自然减少，硬 10 会逼人「留着不修」。
//   真正的防线是「总数 ≥17（L-①）+ 条目只改状态不删」，5 条只用来抓「台账被掏空」。
// 🔴 R724k：5 → 3；R724l：3 → 1。**这是最后一次调这个数**。
//   两次下调都是同一个原因：修得快 ⇒ deferred 变少 ⇒ 下界判红，而台账总数与 fixed 证据
//   一条没少。反复调数字本身就说明判据设计错了 —— 把「修复进度」和「台账完整性」绑在一起，
//   等于每修一条就要回来改一次门禁，还会诱使人为了喂绿去**留着不修 / 编造待办**。
//   拆清楚职责：
//     · 条目不许被删        → L-①（总数 ≥17，append-only）
//     · 不许假装修了        → L-⑤（fixed 必须带 fix_evidence + challenge）
//     · 待办不许没主人      → 本条后半（每条带 priority + next_action）
//     · 台账不许被清空      → 本条前半（deferred ≥1；真变 0 就该重新开盲区扫描，判红是对的）
//   ⇒ 下界只剩「非零」这一个语义，不再随进度漂移。
ok('L-⑥ deferred 条目每条都有优先级与下一步（不许挂着没主人 / 台账不许被清空）',
  deferred.length >= 1 && deferred.every((f) => f.priority && f.next_action), 'deferred=' + deferred.length);
ok('L-⑦ 准备修的 6 条都记录了唱反调结论（确认偏误不被抹掉）',
  F.filter((f) => f.challenge).length >= 6, '有 challenge=' + F.filter((f) => f.challenge).length);

// ===== L-⑧：台账说 fixed，产品源码必须真的改了（防「假装修了」）=====
console.log('\n===== L′. fixed 状态与产品源码核对 =====');
const g9 = fs.readFileSync(path.join(ROOT, 'tools/check_m3_storage_isolation.js'), 'utf8');
const t1 = fs.readFileSync(path.join(ROOT, 'miniprogram/i18n/terms.js'), 'utf8');
const t2 = fs.readFileSync(path.join(ROOT, 'specs/dev-specs/i18n/terms.js'), 'utf8');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
ok('L-⑧ R1-2 真改：B-③ 不再被误标「反恒真」，且补了好样本反向腿',
  g9.indexOf('B-③ 反恒真') < 0 && /好样本/.test(g9), 'B-③ 名称与反向腿');
const mSec = t1.match(/secAfterNote:\s*'([^']*)'/);
const sec = mSec ? mSec[1] : '';
ok('L-⑨ R2-4 真改：来源小字不再笼统说「数来自三处」，且仍点名真实数据源、避开禁用字',
  !!sec && sec.indexOf('数来自三处') < 0 && /销量表|收款日报|成本卡|进货价|原料/.test(sec)
  && sec.indexOf('销量表导入') < 0 && sec.indexOf('销量导入') < 0, sec.slice(0, 40));
const mEmp = t1.match(/reviewEmpty:\s*'([^']*)'/);
const emp = mEmp ? mEmp[1] : '';
ok('L-⑩ R2-2 真改：空态不再写「页面上方」，且仍点名本页「导入销量表」',
  !!emp && emp.indexOf('页面上方') < 0 && emp.indexOf('导入销量表') >= 0, emp.slice(0, 40));
ok('L-⑪ terms 双副本逐字节一致（改一份等于白改）', md5(t1) === md5(t2));

// ===== L-⑫：盲区必须对应待办（把「别留隐患」变成机器判据）=====
console.log('\n===== L″. 盲区与反恒真 =====');
// 🔴 2026-11-13 判据重写（旧判据是**假信号**，已废；留档防后人再踩）：
//   旧：桩型工具数 / 全部 check_*.js < 30% ⇒ 台账里必须有一条 P0/P1「补桩」待办。
//   为什么废：那个分子只数「源码里出现 global.Page 或 loadPage( 这个**字面量**」的工具。
//     实测 tools/check_month_picker.js 头部明写「实跑真函数体：把 handler 抠出来、用伪造
//     Page 上下文调用，判行为不判字面」——它已经在真跑页面行为，只因没写这个字面量就不计入；
//     tools/check_revenue_manual.js 同理（「既判结构，也真跑一遍」）。
//     ⇒ 这个比例测的是**写法**不是**覆盖**，19.9% 是假信号。拿它当进度条会诱导
//       「为凑正则给静态守卫硬塞 global.Page」——正是本机制要防的「为喂绿改码」。
//   新：口径换成 tools/scan_zero_stub_pages.js 的 zeroStubCount（唯一口径，直接 require，
//     绝不在这里写第三份页面扫描逻辑 —— R1-3 的教训：口径多一份，名单就不可复现）。
//     语义：零桩页 = 0 才算没欠账；一旦 >0，台账必须挂一条 P0/P1 补桩待办。
const scan = require('./scan_zero_stub_pages.js');
const zeroN = scan.zeroStubCount;
function judgeStubDebt(zeroCount, findings) {
  if (zeroCount === 0) return true; // 零桩清零 ⇒ 无欠账，不逼人挂票
  return findings.some((f) => f.status === 'deferred' && /^P[01]$/.test(f.priority)
    && /桩/.test(String(f.title || '') + String(f.next_action || '')));
}
ok('L-⑫ 零桩页必须为 0（口径=scan_zero_stub_pages.js），>0 时须挂 P0/P1「补桩」待办',
  judgeStubDebt(zeroN, F),
  '实测零桩 ' + zeroN + ' 个' + (zeroN ? '：' + scan.zeroStubPages.join('、') : '')
  + '（Page ' + scan.totalPages + ' / check_* ' + scan.totalTools + '）');
// 反恒真：零桩现为 0，本条平时必然绿 ⇒ 必须用合成样本证明它**能红**，否则就是橡皮章。
ok('L-⑫′ 反恒真：零桩>0 无票⇒红 / 有 P1 票⇒绿 / 只有 P2 票⇒红 / 零桩=0⇒绿',
  judgeStubDebt(2, []) === false
  && judgeStubDebt(2, [{ status: 'deferred', priority: 'P1', title: '补桩' }]) === true
  && judgeStubDebt(2, [{ status: 'deferred', priority: 'P2', title: '补桩' }]) === false
  && judgeStubDebt(2, [{ status: 'fixed', priority: 'P1', title: '补桩' }]) === false
  && judgeStubDebt(0, []) === true);
ok('L-⑬ 方案文档在场且写明六条腿 / 节奏 / 挑毛病战果',
  fs.existsSync(path.join(ROOT, DESIGN_REL))
  && /六条腿|分层取证|唱反调|节奏/.test(fs.readFileSync(path.join(ROOT, DESIGN_REL), 'utf8')));

const good = validateLedger(data);
const badEvidence = validateLedger(Object.assign({}, data, {
  findings: F.map((f, i) => i === 0 ? Object.assign({}, f, { evidence: '' }) : f),
}));
const badNext = validateLedger(Object.assign({}, data, {
  findings: F.map((f, i) => i === 0 ? Object.assign({}, f, { status: 'deferred', priority: '', next_action: '' }) : f),
}));
const badFix = validateLedger(Object.assign({}, data, {
  findings: F.map((f, i) => i === 0 ? Object.assign({}, f, { status: 'fixed', fix_evidence: '', challenge: '' }) : f),
}));
// R730：词表白名单的反恒真腿 —— 合成一条 status=open（真实事故里出现过的漂移值），必须被抓
const badStatus = validateLedger(Object.assign({}, data, {
  findings: F.map((f, i) => i === 0 ? Object.assign({}, f, { status: 'open' }) : f),
}));
ok('L-⑭ 反恒真：好样本零问题，坏样本四条都给相反答案（含状态词表外）',
  good.length === 0 && has(badEvidence, '证据缺失') && has(badNext, '下一步缺失') && has(badFix, '修了没证据')
  && has(badStatus, '状态词表外'),
  'good=' + good.length + ' badEvidence=' + badEvidence.length + ' badNext=' + badNext.length
  + ' badFix=' + badFix.length + ' badStatus=' + badStatus.length);

console.log('\n============================================================');
console.log('===== 审计发现台账守卫结果：' + pass + ' 通过 / ' + problems.length + ' 失败 =====');
if (problems.length) {
  problems.forEach((p) => console.log('   ❌ ' + p));
  process.exit(1);
}
process.exit(0);
