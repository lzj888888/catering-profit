// tools/check_ai_pack_advice.js —— 诊断包推荐语守卫（R646 · 会审 R638）
//
// 会审原话：「诊断包末尾加『建议找 WorkBuddy 解读』，带 pack_id + 一键跳转 + 点击埋点。
//   **放最后，不打断主流程。**」
//
// 本守卫盯四件事：
//   ① 包号必须**确定性**（同数据同号）—— 否则老板今天发一份、明天再发号变了，包号反而添乱
//   ② 推荐语必须在**最末尾**（放开头会打断「复制→粘贴」这个主流程）
//   ③ 埋点必须**静默失败**（埋点是观测手段，不能影响复制）
//   ④ 埋点**不许传敏感数据**（只传包号，不传金额/菜名/店名）

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const pack = require(path.join(ROOT, 'utils/diagnosisPack.js'));

function mk(opts) {
  const o = opts || {};
  return pack.buildDiagnosisPack({
    month: o.month || '2026-09',
    hasLedger: true,
    shop: { bizText: o.biz || '火锅', cityText: '一线' },
    ledger: { income_total_fen: o.rev || 100000, gross_profit_fen: o.gp || 40000 },
    breakeven: {}, anomalies: {}, dishes: [], channels: {},
  });
}

console.log('\n===== A 包号（pack_id）=====');
const a = mk(); const b = mk();
ok('A-① 同一份数据两次生成 ⇒ **同一个**包号（确定性）', a.pack_id === b.pack_id, a.pack_id + ' / ' + b.pack_id);
ok('A-② 换了月份或金额 ⇒ 包号必须变（否则包号失去指认意义）',
  mk({ month: '2026-08' }).pack_id !== a.pack_id && mk({ rev: 200000 }).pack_id !== a.pack_id);
ok('A-③ 包号格式可读：D + 月份 + 短哈希', /^D\d{4}-\d{2}-[0-9a-f]{8}$/.test(a.pack_id), a.pack_id);

console.log('\n===== A 推荐语位置 =====');
const txt = pack.packToText(a);
const lines = txt.split('\n').filter((x) => x.trim() !== '');
const tail = lines.slice(-6).join('\n');
ok('A-④ 推荐语在包**末尾**（放开头会打断「复制→粘贴」主流程）',
  /让 AI 直接给你解读结论/.test(tail) && /包号/.test(tail));
ok('A-⑤ 推荐语里带上了真实包号（不是占位符）', txt.indexOf(a.pack_id) >= 0);
ok('A-⑥ 推荐语给了**可直接照做**的问法（不是"快去问AI"这种空话）',
  /请指出最该先改的三件事/.test(txt) && /多少钱/.test(txt));
ok('A-⑦ 明确说了「数字都是你店里真实的数，AI 不会自己编」', /不会自己编/.test(txt));
ok('A-⑧ 推荐语排在第 9 节「可以直接问的问题」**之后**（不打断问题清单）',
  txt.indexOf('可以直接问的问题') < txt.indexOf('让 AI 直接给你解读结论'));

console.log('\n===== A 埋点 =====');
const TRACK = fs.readFileSync(path.join(ROOT, 'utils/track.js'), 'utf8');
const RESULT = fs.readFileSync(path.join(ROOT, 'subpkg/biz/month/result.js'), 'utf8');
ok('A-⑨ 🔴 埋点必须静默失败（try/catch，绝不弹错、绝不阻断复制）',
  /try \{/.test(TRACK) && /catch \(e\) \{/.test(TRACK) && /观测手段，不是业务流程/.test(TRACK));
ok('A-⑩ 埋点只接受枚举/短串 —— 函数体里不得出现金额类字段名',
  !/revenue|cost_fen|price|amount/.test(TRACK));
ok('A-⑪ 复制**成功后**才埋点（失败也埋点会虚高数据）',
  /success: \(\) => \{[\s\S]{0,200}track\('ai_pack_copy'/.test(RESULT));
ok('A-⑫ 埋点只传包号，不传金额/菜名/店名', /track\('ai_pack_copy', \{ pack_id:/.test(RESULT));

console.log('\n===== A 失败不影响主流程 =====');
ok('A-⑬ 复制成功弹窗按模板注入包号（不写死）', /aiPackCopied\.replace\('\{id\}'/.test(RESULT));
ok('A-⑭ 文案走 terms 单源（禁硬编码中文）',
  !!require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.exportBtn.aiPackCopied);

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
