'use strict';
// round217 · E7 解析器的「形态容忍度」探针 —— 直接 eval 守卫里的真源码，不重写一份（防"测的不是发货的那份"）。
// 目的：证明判据不是只认一种排版（守卫反向伤害第二型：形态窄 ⇒ 合法写法被误判红）。
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const GUARD = path.join(ROOT, 'tools/check_expense_item_seed.js');

const src = fs.readFileSync(GUARD, 'utf8');
const a = src.indexOf('function parseStrList');
const b = src.indexOf('// 运营类行内注覆盖下界');
if (a < 0 || b < 0 || b <= a) { console.log('FAIL 取不到解析器源码片段'); process.exit(1); }
const code = src.slice(a, b);
// 在函数体作用域里跑真源码，再把三个入口导出来
const api = new Function(code + '\n return { parseStrList, parseNoteKeys, missingFrom };')();

let bad = 0;
const ck = (n, ok, extra) => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (extra ? ' | ' + extra : '')); if (!ok) bad += 1; };

// ---- 1) 单行数组（terms.js 现状形态）----
const single = "    recurringFixed: ['房租', '物业费', '宽带网费', '工资绩效'],";
const r1 = api.parseStrList(single, 'recurringFixed');
ck('单行数组可解析且 4 项', !!r1 && r1.length === 4, JSON.stringify(r1));

// ---- 2) 多行数组（等价改写的另一种合法排版）----
const multi = [
  '    recurringFixed: [',
  "      '房租',",
  "      '物业费',",
  "      '宽带网费',",
  "      '工资绩效',",
  '    ],',
].join('\n');
const r2 = api.parseStrList(multi, 'recurringFixed');
ck('多行数组同样可解析（形态容忍）', !!r2 && r2.length === 4 && r2[0] === '房租', JSON.stringify(r2));

// ---- 3) 行内注键解析：块内注释行不得被当成键 ----
const notesBlock = [
  '    expenseItemNotes: {',
  '      // 这是一行注释，里面写了 // 和中文，不能被当键',
  "      '房租': '一次付了几个月的…',",
  "      // 🔴 R161-9：注释里带「引号」与冒号： 也不会被当键",
  "      '水费': '按本月账单填…',",
  '    },',
  '    // 后面还有别的键',
].join('\n');
const k3 = api.parseNoteKeys(notesBlock);
ck('行内注键解析：注释行不被当键', !!k3 && JSON.stringify(k3) === JSON.stringify(['房租', '水费']), JSON.stringify(k3));

// ---- 4) 判据分辨力（影子样本）----
const uni = ['房租', '水费', '电费'];
ck('missingFrom：假项名报 1 条', api.missingFrom(['不存在X'], uni).length === 1);
ck('missingFrom：真项名报 0 条', api.missingFrom(['房租'], uni).length === 0);
ck('missingFrom：混合名单只报缺的那条', JSON.stringify(api.missingFrom(['房租', '不存在Y'], uni)) === JSON.stringify(['不存在Y']));

// ---- 5) 空数组 / 取不到字段 ⇒ 必须返回 null（fail-closed，不能"空也算过"）----
ck('空数组返回 null（防"空数组恒通过"）', api.parseStrList("x: [],", 'x') === null);
ck('字段不存在返回 null', api.parseStrList(single, 'noSuchField') === null);

console.log('\n===== E7 解析器形态容忍度：' + (bad === 0 ? '全部通过' : bad + ' 项失败') + ' =====');
process.exit(bad === 0 ? 0 : 1);
