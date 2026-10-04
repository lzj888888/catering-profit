'use strict';
// M1 费用表单现状盘点（只读 · 不派生子进程 · 机器可核验）
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';

const readRel = (r) => fs.readFileSync(path.join(ROOT, r), 'utf8');

// ---- 1) 解析云端种子 ----
const cf = readRel('cloudfunctions/initDb/collections.js');
function parseSeed(src) {
  const start = src.indexOf('const SEED_EXPENSE_ITEMS = [');
  const end = src.indexOf('\n];', start);
  const block = src.slice(start, end < 0 ? start + 6000 : end);
  const re = /\{\s*item_key:\s*'([^']+)',\s*item_name:\s*'([^']+)',\s*category:\s*'([^']+)',\s*sort_order:\s*(\d+)/g;
  const out = []; let m;
  while ((m = re.exec(block))) out.push({ key: m[1], name: m[2], category: m[3], sort: Number(m[4]) });
  return out;
}
const seed = parseSeed(cf);
const byCat = {};
seed.forEach((x) => { (byCat[x.category] = byCat[x.category] || []).push(x.name); });

console.log('===== 1) 云端种子 SEED_EXPENSE_ITEMS =====');
console.log('总项数 =', seed.length);
Object.keys(byCat).forEach((c) => console.log(' ', c, '(' + byCat[c].length + '):', byCat[c].join('、')));

// ---- 2) 前端 terms ----
const TERMS = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS;
const front = TERMS.ledger.expense;
console.log('\n===== 2) 前端 terms.ledger.expense =====');
front.forEach((g) => console.log(' ', g.category, '(' + g.items.length + '):', g.items.join('、')));

// 逐类逐项比对（与 check_expense_item_seed E3 同法）
console.log('\n===== 3) 前端 ≡ 种子（逐类、项名、保序）=====');
let drift = 0;
['operation', 'labor', 'marketing', 'other'].forEach((c) => {
  const s = seed.filter((x) => x.category === c).sort((a, b) => a.sort - b.sort).map((x) => x.name);
  const f = front.find((g) => g.category === c);
  if (!f) { console.log('  ❌', c, '前端缺该类'); drift++; return; }
  if (s.length !== f.items.length) { console.log('  ❌', c, '数量', s.length, 'vs', f.items.length); drift++; }
  s.forEach((n, i) => { if (f.items[i] !== n) { console.log('  ❌', c, '[' + (i + 1) + '] 前端', f.items[i], 'vs 种子', n); drift++; } });
});
console.log(drift === 0 ? '  ✅ 4 类逐项一致（无漂移）' : '  ❌ 漂移 ' + drift + ' 处');

// ---- 4) 预置名单 ⊆ 单源？（改名即静默失效）----
const allNames = seed.map((x) => x.name);
const fixed = TERMS.ledger.recurringFixed || [];
const variable = TERMS.ledger.recurringVariable || [];
console.log('\n===== 4) 常规科目预置名单 vs 单源（本项无守卫 · 设计缺口）=====');
console.log('recurringFixed   =', JSON.stringify(fixed));
console.log('recurringVariable=', JSON.stringify(variable));
const badRec = fixed.concat(variable).filter((n) => allNames.indexOf(n) < 0);
console.log(badRec.length === 0
  ? '  ✅ 全部命中单源（' + (fixed.length + variable.length) + ' 项）'
  : '  ❌ 未命中单源（将静默不铺行）：' + badRec.join('、'));

// ---- 5) 行内注键 ⊆ 单源？----
const notes = TERMS.ledger.expenseItemNotes || {};
console.log('\n===== 5) expenseItemNotes 键 vs 单源（本项无守卫 · 设计缺口）=====');
const nk = Object.keys(notes);
console.log('已配行内注 ' + nk.length + ' 项：', nk.join('、'));
const badNote = nk.filter((n) => allNames.indexOf(n) < 0);
console.log(badNote.length === 0 ? '  ✅ 键全部命中单源' : '  ❌ 未命中单源（文案永不显示）：' + badNote.join('、'));
const noteCats = {};
nk.forEach((n) => { const it = seed.find((x) => x.name === n); if (it) noteCats[it.category] = (noteCats[it.category] || 0) + 1; });
console.log('  按类分布：', JSON.stringify(noteCats));

// ---- 6) 首月铺行实况 ----
console.log('\n===== 6) 首月 ensureRecurring() 实际铺行 =====');
let totalRows = 0;
front.forEach((g) => {
  const pick = (g.items || []).filter((n) => fixed.indexOf(n) >= 0 || variable.indexOf(n) >= 0);
  if (pick.length) { totalRows += pick.length; console.log('  ' + g.category + ' 铺', pick.length, '行：', pick.join('、')); }
});
console.log('  合计铺行 =', totalRows);

// ---- 7) 运营类可见文案覆盖度 ----
console.log('\n===== 7) 运营类 7 项「可见说明」覆盖度 =====');
const opItems = byCat.operation || [];
opItems.forEach((n) => {
  const hasNote = !!notes[n];
  const inRecur = fixed.indexOf(n) >= 0 || variable.indexOf(n) >= 0;
  console.log('  ' + n.padEnd(6, '　') + ' 行内注=' + (hasNote ? '有' : '无') + '  首月预置=' + (inRecur ? '是' : '否'));
});
console.log('\n  运营类口径（scope，折叠块内）：');
console.log('   ', front.find((g) => g.category === 'operation').scope);
