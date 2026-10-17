// tools/check_carry_over.js —— 【R308】「沿用上月」（只带费用侧）守卫
// 运行：node tools/check_carry_over.js      （EXIT 0 = 全绿）
//
// 背景（李老师「让餐饮老板用着简单省心」）：M1 是**手填**的，十几项费用月月重复填 ⇒
//   第二个月就懒得填 ⇒ **月度趋势死**（这是"不省心"的头号原因）。
//   餐饮费用结构月度稳定（房租/人工/水电/固定支出），收入才月月变
//   ⇒ 一键带入上月**费用侧**，省掉 ~80% 填写量。
//
// 🔴 三条红线（本仓头号危害 = 静默错账）：
//   ① **只带费用，绝不带收入** —— 预填收入会诱导老板"忘了改" ⇒ 本月收入变成上月的数，利润全错；
//   ② **不许静默覆盖** —— 本月费用侧已有任何数字，必须先确认（抹掉老板已填的数是不可逆损失）；
//   ③ **归档只读必须拦住** —— 归档月不许改（与既有归档锁同一条纪律）。
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { problems.push(name + (extra ? '（' + extra + '）' : '')); }
}
function rd(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } }
// 等长剥注释：判"某标识符是否被赋值"时必须剥，否则注释里提到它会把判据喂成恒真（R298Y 同族）
function stripJsComments(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const pageSrc = rd('pages/month/input.js');
const wxml = rd('pages/month/input.wxml');
const body = (() => {
  const s = stripJsComments(pageSrc);
  const i = s.indexOf('async onCarryExpense(');
  return i < 0 ? '' : s.slice(i, s.indexOf('\n  },', i));
})();
ok('⓪ 自失效护栏：页面/模板非空、方法体已定位（防读空文件或锚点漂移 ⇒ 恒真）',
  pageSrc.length > 20000 && wxml.length > 5000 && body.length > 400 && body.length < 4000,
  '方法体 ' + body.length + ' 字符');

// ① 只带费用侧
ok('①-a 🔴 方法体里**只**写 `expenseGroups`，**不得**写 `incomeGroups`'
  + ' —— 预填收入 = 诱导忘改 = 本月收入变成上月的数（静默错账）',
  /expenseGroups/.test(body) && !/incomeGroups/.test(body));
ok('①-b 复用**同一装配口**（`rebuildFromItems(TERMS.ledger.expense…`），不另造一套行模型',
  /rebuildFromItems\(TERMS\.ledger\.expense/.test(body));

// ② 不许静默覆盖
ok('②-a 🔴 本月费用已有数字 ⇒ 必须先弹确认（`dirty` + `showModal`），不得直接覆盖',
  /dirty/.test(body) && /showModal/.test(body) && /if \(dirty\)/.test(body));
ok('②-b 「有金额」判据一致：`amountYuan` 去空白后非空（填 0 也算填过 ⇒ 防"填了 0 被当空覆盖"）',
  /String\(\(r && r\.amountYuan\) \|\| ''\)\.trim\(\) !== ''/.test(body));

// ③ 归档只读
ok('③-a 🔴 归档只读必须先拦（`if (this.data.readOnly)` 早于任何写 data）',
  /if \(this\.data\.readOnly\)/.test(body)
  && body.indexOf('this.data.readOnly') < body.indexOf('this.setData'));

// ④ 入口与空数据
ok('④-a 模板里有入口按钮且绑定了该方法（不是死代码）',
  /bindtap="onCarryExpense"/.test(wxml) && /carryBtn/.test(wxml));
ok('④-b 上月没有账 ⇒ 明确提示（不静默无反应）', /carryEmpty/.test(body));

// ⑤ 反恒真
ok('⑤-a 反恒真：把「同时带收入」的样本喂给 ①-a 的判据 ⇒ 必须判不通过',
  /incomeGroups/.test('const g = rebuildFromItems(...); this.setData({ incomeGroups: g });'));
ok('⑤-b 反恒真：把「无 dirty 直接 setData」的样本喂给 ②-a 的判据 ⇒ 必须判不通过',
  !(/dirty/.test('this.setData({ expenseGroups: g });') && /showModal/.test('this.setData({ expenseGroups: g });')));

const total = pass + problems.length;
if (problems.length) {
  console.log('❌ 沿用上月校验失败 ' + problems.length + ' 处：');
  problems.forEach((x) => console.log('   ' + x));
  console.log('❌ 沿用上月校验：' + pass + ' 通过 / ' + problems.length + ' 失败');
  process.exit(1);
}
console.log('✅ 沿用上月校验通过（只带费用 · 不静默覆盖 · 归档拦截 · 复用同一装配口）');
console.log('✅ 沿用上月校验：' + total + ' 通过 / 0 失败');
