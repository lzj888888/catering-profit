'use strict';
// round217 自检：terms 新键与运营类行内注覆盖率（只读）
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger;
const notes = T.expenseItemNotes;
const op = ['房租', '物业费', '水费', '电费', '燃气费', '垃圾清运费', '宽带网费'];
console.log('expenseItemNotes 键数 =', Object.keys(notes).length);
console.log('运营类行内注覆盖 =', op.filter((n) => !!notes[n]).length, '/ 7');
op.forEach((n) => console.log('  -', n, '=>', notes[n] ? notes[n].slice(0, 24) + '…' : '(无)'));
console.log('missingWarnItems =', JSON.stringify(T.missingWarnItems));
console.log('missingWarnBody  =', T.missingWarnBody(T.missingWarnItems.join('、')));
console.log('按钮文案长度 =', T.missingWarnGo.length, T.missingWarnSave.length, '(须 ≤4)');
console.log('recurringFixed   =', JSON.stringify(T.recurringFixed));
console.log('recurringVariable=', JSON.stringify(T.recurringVariable));
