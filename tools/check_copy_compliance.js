#!/usr/bin/env node
// tools/check_copy_compliance.js —— A14/A15/A21 文案合规 + 退款规则守卫（2026-11-05）
//
// 为什么需要这一层（本仓第 N 例「写进文档 ≠ 有机器看护」）：
//   规范 `review/收费与权益_总设计师规范_20261105.md` §6（退款）、§12.7（合规话术）、A15（术语统一）
//   三条都是**纯文案要求**：写错了不会让任何数字出错，只会让小程序被判"伪专业/诱导交易"或让退款纠纷无据可依
//   ⇒ 数字类判据（引擎 selftest、金额对账）**一个都抓不到**。只能直接扫**外显文案源**。
//
// 🔴 本守卫的扫描方式（关键）：**require terms.js 后遍历对象里的字符串值**，
//   不在源码文本上正则。原因：
//     · 文本正则会把**注释**里出现的说明文字也当命中（本仓 round115 裸扫误杀过十几次）；
//     · 也会漏掉 `key: 'a' + 'b'` 这类拼接。遍历值 = 用户真正能看到的东西，注释天然不计。
//   ⚠️ 代价：函数型文案（如 `(days) => \`...\``）**扫不到**。所以另有一条 A-④ 明确
//      "函数型跳过"并把数量打出来（诚实标注盲区，不假装全覆盖）。
//
// 判据（A/B/C/D 四段，fail-closed）：
//   A 扫描器自证：能取到足量字符串 / 正样本必中 / 负样本不误杀 / 函数型盲区可见
//   B 禁词零命中：算命类 / 绝对化承诺 / 「食材成本率」/ 诊断术语变体
//   C 必备文案就位：三术语 / 兜底声明 / 退款说明 / 墙内置退款提示 / 双副本一致
//   D 退款规则行为：我方责任优先 / 已使用不退 / 窗口边界 / fail-closed / iOS 不承诺
//
// 运行：node tools/check_copy_compliance.js   （由 verify_all.js 的 [copy-compliance] 套件调用）

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

// ===== 字符串遍历器（A 段会先自证它有效）=====
function collectStrings(node, prefix, out) {
  const acc = out || [];
  const p = prefix || '';
  if (node == null) return acc;
  const tp = typeof node;
  if (tp === 'string') { acc.push({ path: p, text: node }); return acc; }
  if (tp === 'function') { acc.push({ path: p, text: '', fn: true }); return acc; }
  if (tp === 'object') {
    Object.keys(node).forEach((k) => collectStrings(node[k], p + '.' + k, acc));
  }
  return acc;
}

const M = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const TERMS = M.TERMS;
const ALL = collectStrings(TERMS, 'TERMS');
const STR = ALL.filter((x) => !x.fn);
const FNS = ALL.filter((x) => x.fn);

/** 在**全表字符串值**里找禁词（不含注释、不含函数型文案） */
function hits(words, scope) {
  const src = scope || STR;
  const out = [];
  src.forEach((s) => {
    words.forEach((w) => {
      if (s.text.indexOf(w) >= 0) out.push(`${s.path} → 「${w}」`);
    });
  });
  return out;
}

// ============ A 扫描器自证（防"扫空恒绿"）============
sec('A 扫描器自证：遍历器有效 · 正负样本互证 · 盲区可见');
ok('A-① 从 terms.js 取到足量字符串值（≥1500 条，少于此说明结构与遍历器脱节）',
  STR.length >= 1500, `实取 ${STR.length} 条字符串 + ${FNS.length} 条函数型`);

// ⚠️ 合成样本必须**真的含禁词**（第一版写成「算个命」，不含「算命」⇒ 正样本永远扫不到，
//    那条断言就退化成恒假，而它恰恰是"证明扫描器有效"的唯一证据 —— 守卫生来就要抓这种自欺）
const POS = collectStrings({ a: { b: '这个月给你算命看看运势' } }, 'POS').filter((x) => !x.fn);
const NEG = collectStrings({ a: { b: '本月经营体检结论' } }, 'NEG').filter((x) => !x.fn);
const scanOf = (arr, words) => arr.filter((s) => words.some((w) => s.text.indexOf(w) >= 0)).length;
ok('A-② 正样本必中：含「算命」的合成对象能被扫出（扫描器不是恒假）',
  scanOf(POS, ['算命']) === 1, `命中 ${scanOf(POS, ['算命'])} 条`);
ok('A-③ 负样本不误杀：正常的「经营体检」不被算作禁词',
  scanOf(NEG, ['算命', '风水', '运势']) === 0, `误杀 ${scanOf(NEG, ['算命', '风水', '运势'])} 条`);
// A-④ 盲区诚实标注：函数型文案（如 (n)=>`...${n}...`）扫不到 ⇒ 数出来，别假装全覆盖。
ok('A-④ 函数型文案盲区可见（本守卫只扫字面量，函数型需人工复核；此处只要求数量可观测）',
  FNS.length >= 0, `函数型文案 ${FNS.length} 条（未纳入禁词扫描，属已知盲区）`);

// ============ B 禁词零命中 ============
sec('B 禁词零命中：算命类 / 绝对化 / 食材成本率 / 诊断术语变体');
const FORTUNE = ['算命', '测算运势', '化解', '转运', '旺财', '风水', '看相', '八字', '改运', '开光', '求财'];
const ABSOLUTE = ['一定能救活', '保证不亏', '包赚', '必赚', '稳赚', '百分百', '绝对不会亏'];
const FOOD_RATE = ['食材成本率'];
// 诊断术语的"同义变体"（正名是 深度诊断 / 免费简诊 / 放弃）——这些写法会让人以为是另一个产品/另一档权益
const DIAG_VARIANTS = ['深度体检', '全面诊断', '深度分析', '大师诊断', '免费体检', '简易诊断', '浅诊', '快速诊断'];

{
  const h = hits(FORTUNE);
  ok('B-① 算命类词零命中（会被判"伪专业 + 诱导交易"）', h.length === 0, h.slice(0, 3).join('；') || `${FORTUNE.length} 个词全过`);
}
{
  const h = hits(ABSOLUTE);
  ok('B-② 绝对化承诺零命中（数字能算，命算不了）', h.length === 0, h.slice(0, 3).join('；') || `${ABSOLUTE.length} 个词全过`);
}
{
  const h = hits(FOOD_RATE);
  ok('B-③ 「食材成本率」零命中（round111 铁律：只说毛利率）', h.length === 0, h.slice(0, 3).join('；') || '零命中');
}
{
  const h = hits(DIAG_VARIANTS);
  ok('B-④ 诊断术语变体零命中（只许 深度诊断 / 免费简诊 / 放弃）', h.length === 0, h.slice(0, 3).join('；') || `${DIAG_VARIANTS.length} 个变体全过`);
}
{
  // giveUp 专属：作用域限定在 TERMS.diag —— 「跳过」在别处是正常词（"第一行是表头会自动跳过"），
  //   全局禁会误杀；但在**诊断语境**里说"跳过"就是骗人（老板会以为以后还能补）。
  const diagScope = collectStrings(TERMS.diag, 'TERMS.diag').filter((x) => !x.fn);
  const bad = ['跳过', '算了', '不要了', '下次再说'].filter((w) => diagScope.some((s) => s.text.indexOf(w) >= 0));
  ok('B-⑤ 诊断语境里不得用「跳过/算了/不要了」（用户会以为还能补，实际是这一轮不判）',
    bad.length === 0, bad.length ? '命中：' + bad.join('、') : '诊断语境用词干净');
}

// ============ C 必备文案就位 ============
sec('C 必备文案就位：术语 / 兜底 / 退款说明 / 墙内置提示 / 双副本一致');
{
  const d = TERMS.diag || {};
  ok('C-① 三个规范术语就位且值正确',
    d.deepName === '深度诊断' && d.freeName === '免费简诊' && d.giveUp === '放弃',
    `deep=${d.deepName} / free=${d.freeName} / giveUp=${d.giveUp}`);
}
{
  const d = TERMS.diag || {};
  const dis = String(d.disclaimer || '');
  ok('C-② 合规兜底声明存在且含「仅供参考」（规范 §12.7 硬要求）',
    dis.indexOf('仅供参考') >= 0, dis || '缺失');
}
{
  const wxml = READ('subpkg/biz/month/result.wxml');
  // 结论页必须**真的渲染**兜底，不能只躺在 terms 里（"配置了就以为生效"是本仓高频坑）
  ok('C-③ M1 结论页真的渲染兜底声明（t.disclaimer 出现在 wxml）',
    wxml.indexOf('t.disclaimer') >= 0, wxml.indexOf('t.disclaimer') >= 0 ? '已渲染' : 'terms 有、页面没渲染');
}
{
  const r = TERMS.pay && TERMS.pay.refundNotice ? String(TERMS.pay.refundNotice) : '';
  const need = ['7 天', '未使用', '不退'];
  const miss = need.filter((w) => r.indexOf(w) < 0);
  ok('C-④ 退款说明三要素齐（窗口 / 使用条件 / 不退情形）',
    !!r && miss.length === 0, r ? (miss.length ? '缺：' + miss.join('、') : '三要素齐') : 'TERMS.pay.refundNotice 缺失');
}
{
  const pay = READ('utils/paywall.js');
  // 判据不是"文件里出现过这个词"，而是**拼进了 modal 的 content**（出现过却没用 = 老坑 R298Y 同族）
  const used = pay.indexOf("def.content + '\\n\\n' + TERMS.pay.refundNotice") >= 0
    || pay.indexOf('TERMS.pay.refundNotice') >= 0;
  const passedAsContent = /wx\.showModal\(\{[\s\S]{0,400}?content,\s*\n/.test(pay);
  ok('C-⑤ 付费弹窗把退款说明拼进 content（购买前明示，不是事后补一句）',
    used && passedAsContent, `引用=${used} / 传入 content=${passedAsContent}`);
}
{
  const a = READ('miniprogram/i18n/terms.js');
  const b = READ('specs/dev-specs/i18n/terms.js');
  ok('C-⑥ terms 双副本逐字节一致（运行时用 miniprogram 那份，改了另一份=白改）',
    a === b, a === b ? `${a.length} 字节完全一致` : `长度 ${a.length} vs ${b.length}，已漂移`);
}

// ============ D 退款规则行为（A14）============
sec('D 退款规则行为：我方责任优先 / 已使用不退 / 窗口边界 / fail-closed / iOS');
const RP = require(path.join(ROOT, 'cloudfunctions/common/refundPolicy.js'));
const DAY = 24 * 3600 * 1000;
const NOW = 1762300000000;   // 2026-11-05 附近（固定值，纯函数可测）

{
  // 🔴 最容易写反的顺序：先判"有没有用"会把"被扣了两次钱"的用户挡在门外
  const v = RP.judgeRefund({ paidAtMs: NOW - 30 * DAY, nowMs: NOW, exported: true, duplicatePay: true });
  ok('D-① 我方责任优先于使用状态：已导出 + 重复扣款 ⇒ 仍全额退',
    v.refundable === true && v.code === RP.CODES.OUR_FAULT, `code=${v.code} refundable=${v.refundable}`);
}
{
  const v = RP.judgeRefund({ paidAtMs: NOW - 1 * DAY, nowMs: NOW, exported: true, diagIssued: true });
  ok('D-② 已使用核心权益 ⇒ 不退，且给出收回动作清单（含收回诊断报告）',
    v.refundable === false && v.code === RP.CODES.USED && v.revoke.indexOf('revoke_diag_report') >= 0,
    `code=${v.code} revoke=[${v.revoke.join(',')}]`);
}
{
  const v = RP.judgeRefund({ paidAtMs: NOW - 3 * DAY, nowMs: NOW });
  ok('D-③ 未使用 + 窗口内（第 3 天）⇒ 全额退', v.refundable === true && v.code === RP.CODES.UNUSED_IN_WINDOW,
    `code=${v.code} days=${v.daysSincePaid}`);
}
{
  const v7 = RP.judgeRefund({ paidAtMs: NOW - 7 * DAY, nowMs: NOW });
  const v8 = RP.judgeRefund({ paidAtMs: NOW - 8 * DAY, nowMs: NOW });
  ok('D-④ 窗口边界：第 7 天可退 / 第 8 天不退（边界明确，不留"看客服心情"）',
    v7.refundable === true && v8.refundable === false && v8.code === RP.CODES.OUT_OF_WINDOW,
    `第7天=${v7.code} / 第8天=${v8.code}`);
}
{
  const v1 = RP.judgeRefund({ nowMs: NOW });
  const v2 = RP.judgeRefund({ paidAtMs: NaN, nowMs: NOW });
  const v3 = RP.judgeRefund({ paidAtMs: NOW - DAY });          // 缺 nowMs（不读系统时钟）
  ok('D-⑤ fail-closed：缺支付时间 / NaN / 缺 nowMs ⇒ 一律 need_manual 且不判可退',
    [v1, v2, v3].every((v) => v.refundable === false && v.code === RP.CODES.NEED_MANUAL),
    [v1, v2, v3].map((v) => v.code).join('/'));
}
{
  const v = RP.judgeRefund({ paidAtMs: NOW + 2 * DAY, nowMs: NOW });
  ok('D-⑥ 支付时间在未来（时钟异常）⇒ 转人工，不按"刚买"放行',
    v.refundable === false && v.code === RP.CODES.NEED_MANUAL, `code=${v.code}`);
}
{
  const v = RP.judgeRefund({ paidAtMs: NOW - 1 * DAY, nowMs: NOW, iosIap: true });
  ok('D-⑦ iOS IAP ⇒ 我方不承诺可退、转人工（苹果单方处理，承诺了也做不到）',
    v.refundable === false && v.code === RP.CODES.IOS_IAP && v.needManual === true, `code=${v.code}`);
}
{
  // 反向：正常路径**不得**恒为 need_manual（证明上面的 fail-closed 不是"全都转人工"的恒真）
  const v = RP.judgeRefund({ paidAtMs: NOW - 2 * DAY, nowMs: NOW });
  ok('D-⑧ 反向：数据齐全时不转人工（fail-closed 不是"什么都推给人"）',
    v.needManual === false && v.code !== RP.CODES.NEED_MANUAL, `code=${v.code} needManual=${v.needManual}`);
}
{
  // 收权清单：没出报告就不该出现 revoke_diag_report（乱收权 = 用户已经在看的报告消失）
  const v = RP.judgeRefund({ paidAtMs: NOW - 2 * DAY, nowMs: NOW, exported: true });
  ok('D-⑨ 收权清单按实际交付项生成：只导出过 ⇒ 不得出现 revoke_diag_report',
    v.refundable === false && v.revoke.indexOf('revoke_diag_report') < 0 && v.revoke.indexOf('revoke_diag_credit') >= 0,
    `revoke=[${v.revoke.join(',')}]`);
}

// ============ 汇总 ============
console.log(`\n===== 文案合规与退款规则守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
