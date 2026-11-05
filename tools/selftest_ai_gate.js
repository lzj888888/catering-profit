// tools/selftest_ai_gate.js —— AI「出站」k-匿名门槛单测（队列 #28）
//
// ⚠️ 本文件**不写 shebang**：门禁 R68（`check_selftest_shape`）按「顶层块尾必须是 `;` 或 `}`」
//   切分顶层块，`#!...` 行会被当成无法定界的块首 ⇒ 整个文件形状结论 fail-closed 判红。

// 守什么：`cloudfunctions/common/aiGate.js::canSendToModel` 的三关
//   ① 授权态（消费读侧 `getAiConsent` 的判定，不许自己再判一遍四态）
//   ② 用途必须显式授权过（未知用途不许默认放行）
//   ③ 样本量（行 ≥ 5 且 供应商 ≥ 3，设计稿 §5）
//
// 🔴 为什么这条要单独成套件而不是"看一眼代码"：
//   这是**隐私门槛**，它的失效形态是"静默放行"—— 代码在、函数被调用、不报错，
//   只是那批数据发出去了。没有行为断言就永远发现不了（同族：文案写了但零调用 R396/R417）。
//
// 🔴 判据里刻意保留两条"鉴别力"断言（不是恒真的存在性检查）：
//   · 同样 5 行 3 供应商，但用途没授权 ⇒ 必须拒（证明不是只看样本量就放行）
//   · consent 传原始 doc（没有 state）⇒ 必须拒（证明没有偷偷实现第二份四态判定）
//
// 运行：node tools/selftest_ai_gate.js   （由 verify_all.js 的 [ai-gate] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'cloudfunctions', 'common', 'aiGate.js');
const { canSendToModel, judgeSample, SAMPLE_MIN, PURPOSES, REASONS } = require(SRC);

let pass = 0;
const fails = [];
const oks = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; oks.push(name); return; }
  fails.push(name + (detail ? '  →  ' + detail : ''));
}

// 合法基线：读侧已判定为 active、授了 diagnose、样本 5 行 3 供应商
function baseInput() {
  return {
    consent: { state: 'active', policy_stale: false, need_regrant: false, effective_scope: ['diagnose'] },
    sample: { lineCount: 5, supplierCount: 3 },
    purpose: 'diagnose',
  };
}
const run = (mut) => {
  const input = baseInput();
  if (mut) mut(input);
  return canSendToModel(input);
};

// ---------- A 口径常量（钉住设计稿，不许实现里悄悄放宽）----------
check('A1 行数门槛 = 5（设计稿 §5）', SAMPLE_MIN.lineCount === 5, `实测 ${SAMPLE_MIN.lineCount}`);
check('A2 供应商门槛 = 3（设计稿 §5）', SAMPLE_MIN.supplierCount === 3, `实测 ${SAMPLE_MIN.supplierCount}`);
check('A3 用途恰三项且顺序 = diagnose/pricing/expand',
  Array.isArray(PURPOSES) && PURPOSES.join(',') === 'diagnose,pricing,expand', `实测 ${JSON.stringify(PURPOSES)}`);

// ---------- B 允许路径 ----------
check('B1 三关全过 ⇒ allow', (() => { const r = run(); return r.allow === true && r.reason === REASONS.OK; })(), JSON.stringify(run()));
check('B2 恰好踩线（5 行 / 3 家）⇒ allow（门槛是 ≥ 不是 >）', run().allow === true);
check('B3 大样本 ⇒ allow', run((i) => { i.sample = { lineCount: 120, supplierCount: 40 }; }).allow === true);
check('B4 allow 时 fallback 为空串（有答案就不降级）', run().fallback === '');
check('B5 三个用途逐个可放行', ['diagnose', 'pricing', 'expand'].every((p) => run((i) => {
  i.purpose = p; i.consent.effective_scope = [p];
}).allow === true));

// ---------- C 样本门槛 ----------
const r4 = run((i) => { i.sample = { lineCount: 4, supplierCount: 3 }; });
check('C1 4 行（差 1 行）⇒ 拒 + below_line_floor', r4.allow === false && r4.reason === REASONS.BELOW_LINE_FLOOR, JSON.stringify(r4));
const rs2 = run((i) => { i.sample = { lineCount: 9, supplierCount: 2 }; });
check('C2 2 家供应商（差 1 家）⇒ 拒 + below_supplier_floor', rs2.allow === false && rs2.reason === REASONS.BELOW_SUPPLIER_FLOOR, JSON.stringify(rs2));
const r00 = run((i) => { i.sample = { lineCount: 0, supplierCount: 0 }; });
check('C3 双零 ⇒ 先报行数（给出可执行的第一步）', r00.reason === REASONS.BELOW_LINE_FLOOR, JSON.stringify(r00));
check('C4 拒时带 need 口径（页面说得出"还差几行"）',
  r4.need && r4.need.lineCount === 5 && r4.need.supplierCount === 3, JSON.stringify(r4.need));
check('C5 拒时带 got 实际值', r4.got && r4.got.lineCount === 4 && r4.got.supplierCount === 3, JSON.stringify(r4.got));

// ---------- D 非法样本（fail-closed，不做 Number() 静默归一）----------
const bad = [
  ['D1 字符串 "5"/"3"', { lineCount: '5', supplierCount: '3' }],
  ['D2 NaN', { lineCount: NaN, supplierCount: 3 }],
  ['D3 负数', { lineCount: -1, supplierCount: 3 }],
  ['D4 小数 2.5', { lineCount: 2.5, supplierCount: 3 }],
  ['D5 null', null],
  ['D6 缺字段', { lineCount: 5 }],
  ['D7 布尔 true', { lineCount: true, supplierCount: 3 }],
];
bad.forEach(([name, sample]) => {
  const r = run((i) => { i.sample = sample; });
  check(name + ' ⇒ sample_shape_invalid', r.allow === false && r.reason === REASONS.SAMPLE_INVALID, JSON.stringify(r));
});

// ---------- E 授权态 ----------
['none', 'revoked', 'expired'].forEach((st) => {
  const r = run((i) => { i.consent.state = st; });
  check(`E1-${st} ⇒ 拒 + consent_not_active（并带回 state）`,
    r.allow === false && r.reason === REASONS.CONSENT_NOT_ACTIVE && r.state === st, JSON.stringify(r));
});
const rawDoc = run((i) => { i.consent = { revoked_at: 0, expire_at: 0, scope: ['diagnose'] }; });
check('E2 传原始 doc（无 state）⇒ consent_unjudged（不在这里补四态判定）',
  rawDoc.allow === false && rawDoc.reason === REASONS.CONSENT_UNJUDGED, JSON.stringify(rawDoc));
check('E3 consent 缺失 ⇒ consent_unjudged',
  run((i) => { i.consent = null; }).reason === REASONS.CONSENT_UNJUDGED);
check('E4 policy_stale ⇒ 拒（条款升级必须重新同意）',
  run((i) => { i.consent.policy_stale = true; }).reason === REASONS.POLICY_STALE);
check('E5 need_regrant ⇒ 拒（与 stale 同一条路）',
  run((i) => { i.consent.need_regrant = true; }).reason === REASONS.POLICY_STALE);

// ---------- F 用途 ----------
const notGranted = run((i) => { i.purpose = 'pricing'; });   // 只授了 diagnose
check('F1 只授 diagnose 却要 pricing ⇒ purpose_not_granted',
  notGranted.allow === false && notGranted.reason === REASONS.PURPOSE_NOT_GRANTED, JSON.stringify(notGranted));
check('F2 🔴 鉴别力：样本 5/3 全足但用途未授权 ⇒ 仍拒（不是只看样本量放行）',
  notGranted.allow === false && notGranted.reason === REASONS.PURPOSE_NOT_GRANTED);
check('F3 未知用途 ⇒ purpose_invalid（不许默认放行新能力）',
  run((i) => { i.purpose = 'forecast'; }).reason === REASONS.PURPOSE_INVALID);
check('F4 空用途 ⇒ purpose_invalid', run((i) => { i.purpose = ''; }).reason === REASONS.PURPOSE_INVALID);
check('F5 effective_scope 非数组 ⇒ purpose_not_granted（脏数据当未授权）',
  run((i) => { i.consent.effective_scope = null; }).reason === REASONS.PURPOSE_NOT_GRANTED);
check('F6 effective_scope 空数组 ⇒ purpose_not_granted',
  run((i) => { i.consent.effective_scope = []; }).reason === REASONS.PURPOSE_NOT_GRANTED);

// ---------- G fallback 语义（拒必须有降级路，否则上游会自己编）----------
check('G1 所有拒的分支都给 fallback=L0', [
  run((i) => { i.consent.state = 'revoked'; }),
  run((i) => { i.consent.policy_stale = true; }),
  run((i) => { i.purpose = 'expand'; }),
  run((i) => { i.sample = { lineCount: 1, supplierCount: 1 }; }),
  run((i) => { i.sample = { lineCount: 'x', supplierCount: 1 }; }),
].every((r) => r.allow === false && r.fallback === 'L0'));

// ---------- H 纯函数承诺 ----------
const before = JSON.stringify(baseInput());
const inputForPurity = baseInput();
canSendToModel(inputForPurity);
check('H1 不修改入参', JSON.stringify(inputForPurity) === before, JSON.stringify(inputForPurity));
check('H2 确定性：同入参两次同结果', JSON.stringify(run()) === JSON.stringify(run()));
const src = fs.readFileSync(SRC, 'utf8');
check('H3 单源零 require（纯函数承诺：不接 db / 不读时钟 / 不读环境）',
  src.indexOf('require(') === -1, '源码里出现了 require(');
check('H4 judgeSample 可单独调用（供解释文案用）',
  judgeSample({ lineCount: 5, supplierCount: 3 }).ok === true
  && judgeSample({ lineCount: 1, supplierCount: 3 }).ok === false);

// ---------- I 派生副本（云端 require('./common') 走的是它，不是单源）----------
const COPY = path.join(ROOT, 'cloudfunctions', 'getAiConsent', 'cx_aiGate.js');
check('I1 派生副本 cx_aiGate.js 存在（sync_common 已同步）', fs.existsSync(COPY), COPY);
if (fs.existsSync(COPY)) {
  const copy = require(COPY);
  const sameOn = (input) => JSON.stringify(copy.canSendToModel(input)) === JSON.stringify(canSendToModel(input));
  check('I2 副本与单源行为一致（允许路）', sameOn(baseInput()));
  check('I3 副本与单源行为一致（拒绝路）', sameOn({ consent: { state: 'revoked' }, sample: { lineCount: 5, supplierCount: 3 }, purpose: 'diagnose' }));
  check('I4 副本常量与单源一致',
    copy.SAMPLE_MIN.lineCount === SAMPLE_MIN.lineCount && copy.SAMPLE_MIN.supplierCount === SAMPLE_MIN.supplierCount);
}

// ---------- 输出 ----------
// 🔴 收尾形态是门禁 R66/R69 的要求（verify_all::auditAssertions）：段标题下必须有断言，
//   唯一豁免是**末段**且标题含「N 通过 / M 失败」。⇒ 汇总行必须**最后打印**且带这两个数，
//   失败明细打在它**前面**（否则末行是 ❌，R69「未走完收尾」判红）。
const total = pass + fails.length;
// 逐条 ✅：门禁 R66 的兜底判据是「整个套件 ✅ == 0 ⇒ 判红」（防"一条断言都没跑"），
//   只打失败明细 + 汇总行会让一个**全绿**的套件被判红（本轮实测踩到）。惯例即"断言一律以 ✅ 标记"。
oks.forEach((n) => console.log('✅ ' + n));
if (fails.length) fails.forEach((f) => console.log('❌ ' + f));
console.log(`\n===== AI 出站 k-匿名门槛自测（队列 #28）：${pass} 通过 / ${fails.length} 失败（共 ${total}）=====`);
process.exit(fails.length === 0 ? 0 : 1);
