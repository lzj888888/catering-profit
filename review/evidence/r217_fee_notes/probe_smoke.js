'use strict';
// round217 冒烟：真跑 pages/month/input.js 的 Page 对象（stub wx / Page / getApp），
// 验证三件事 —— ①行内注在六条装配路径上都挂上；②缺项软提示的判据正确；③改名后旧注会被摘掉。
const path = require('path');
const ROOT = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';

const storage = {};
global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  showModal: () => {},
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  setNavigationBarTitle: () => {},
  navigateTo: () => {},
  navigateBack: () => {},
  showNavigationBarLoading: () => {},
  hideNavigationBarLoading: () => {},
};
global.getApp = () => ({ globalData: { shop_id: 'SHOP_TEST' } });
let CFG = null;
global.Page = (c) => { CFG = c; };
global.Component = () => {};

require(path.join(ROOT, 'pages/month/input.js'));

function mkPage() {
  const p = Object.assign({}, CFG);
  p.data = JSON.parse(JSON.stringify(CFG.data));
  p.setData = function (o) { Object.assign(p.data, o); };
  return p;
}

let bad = 0;
const ck = (name, cond, extra) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' | ' + extra : ''));
  if (!cond) bad += 1;
};

// ---- 1) initGroups：费用组 notesOn=true，收入组 notesOn=false ----
const p = mkPage();
p.initGroups();
const expG = p.data.expenseGroups;
const incG = p.data.incomeGroups;
ck('费用组全部 notesOn=true', expG.every((g) => g.notesOn === true), expG.map((g) => g.category + ':' + g.notesOn).join(','));
ck('收入组全部 notesOn=false', incG.every((g) => g.notesOn === false), incG.map((g) => g.category + ':' + g.notesOn).join(','));

// ---- 2) ensureRecurring：首月铺行后，运营行的行内注必须已在行上 ----
p.ensureRecurring();
const op = p.data.expenseGroups.find((g) => g.category === 'operation');
const opRows = (op.rows || []).map((r) => r.subItem);
const opNames = ['房租', '物业费', '水费', '电费', '燃气费', '垃圾清运费', '宽带网费'];
const seeded = opNames.filter((n) => opRows.indexOf(n) >= 0);
ck('运营组首月铺到常规科目行', seeded.length >= 3, '铺到=' + seeded.join('、'));
const notedRows = (op.rows || []).filter((r) => opNames.indexOf((r.subItem || '').trim()) >= 0);
const withNote = notedRows.filter((r) => !!r.note);
ck('铺出来的运营行都带上了行内注', withNote.length === notedRows.length && notedRows.length > 0,
  withNote.length + '/' + notedRows.length);

// 营销组：原 R85 的标注必须仍在（拿已知营销项名造一行验证，不依赖 initGroups 的空行）
const probeMk = p.attachRowNote({ subItem: '外卖平台佣金' });
ck('营销组行内注未被破坏（原 R85 行为回归）', !!probeMk.note, String(probeMk.note).slice(0, 20));
const probePromo = p.attachRowNote({ subItem: '外卖推广费' });
ck('营销「推广费」仍带 promo 高亮', probePromo.promo === true, 'promo=' + probePromo.promo);

// ---- 3) 缺项判据 ----
const miss0 = p.missingRecurringNames();
ck('全空时 缺项 = [房租,水费,电费]', JSON.stringify(miss0) === JSON.stringify(['房租', '水费', '电费']), JSON.stringify(miss0));

// 填上房租 ⇒ 只剩两项
p.updateRow('expense', p.data.expenseGroups.findIndex((g) => g.category === 'operation'), opRows.indexOf('房租'), { amountYuan: '8000' });
const miss1 = p.missingRecurringNames();
ck('填了房租 ⇒ 缺项只剩水费/电费', JSON.stringify(miss1) === JSON.stringify(['水费', '电费']), JSON.stringify(miss1));

// 填 0 也算填过（_hasVal 语义）
p.updateRow('expense', p.data.expenseGroups.findIndex((g) => g.category === 'operation'), opRows.indexOf('水费'), { amountYuan: '0' });
const miss2 = p.missingRecurringNames();
ck('水费填 0 也算填过 ⇒ 只剩电费', JSON.stringify(miss2) === JSON.stringify(['电费']), JSON.stringify(miss2));

// ---- 4) 改细项名 ⇒ 旧注必须被摘掉 ----
const gi = p.data.expenseGroups.findIndex((g) => g.category === 'operation');
const ridx = (p.data.expenseGroups[gi].rows || []).findIndex((r) => r.subItem === '房租');
const before = p.data.expenseGroups[gi].rows[ridx].note;
p.updateRow('expense', gi, ridx, { subItem: '房租（自建物业）' });
const after = p.data.expenseGroups[gi].rows[ridx];
ck('改名前该行有注', !!before, '前注=' + String(before).slice(0, 12));
ck('改名后旧注被摘掉（note/promo 均无）', after.note === undefined && after.promo === undefined,
  'note=' + String(after.note) + ' promo=' + String(after.promo));

// 再改回「电费」⇒ 应重新挂上电费的注
p.updateRow('expense', gi, ridx, { subItem: '电费' });
ck('改回已知项名 ⇒ 重新挂上注', !!p.data.expenseGroups[gi].rows[ridx].note);

// ---- 5) onSave 软提示：不阻断 + 每账套每月只问一次 ----
let modals = [];
global.wx.showModal = (o) => { modals.push(o); };
const p2 = mkPage();
p2.initGroups();
p2.ensureRecurring();
modals = [];
p2.onSave();
const warnModal = modals.find((m) => m.title === require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.missingWarnTitle);
ck('缺项时保存弹了软提示', !!warnModal, warnModal ? warnModal.content : '(无弹窗)');
ck('提示按钮文案 ≤4 字符', !!warnModal && warnModal.confirmText.length <= 4 && warnModal.cancelText.length <= 4,
  warnModal ? warnModal.confirmText + '/' + warnModal.cancelText : '');
// 走「仍保存」分支
modals = [];
if (warnModal && warnModal.success) warnModal.success({ confirm: false });
ck('「仍保存」后已标记本月提示过', p2.missingWarned() === true);
// 再点一次保存 ⇒ 不再弹缺项提示
modals = [];
p2.onSave();
const warnAgain = modals.filter((m) => m.title === require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.missingWarnTitle);
ck('同月再保存不再重复提示', warnAgain.length === 0, '弹了 ' + warnAgain.length + ' 次');

// 「去填」分支 ⇒ 不保存但展开运营组（先清掉本地"本月已提示"标记，否则会被上一次同月提示挡掉）
Object.keys(storage).forEach((k) => { delete storage[k]; });
const p3 = mkPage();
p3.initGroups();
p3.ensureRecurring();
p3.data.expenseGroups.forEach((g) => { g.expanded = false; });
modals = [];
p3.onSave();
const w3 = modals.find((m) => m.title === require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.missingWarnTitle);
if (w3 && w3.success) w3.success({ confirm: true });
const opAfter = p3.data.expenseGroups.find((g) => g.category === 'operation');
ck('「去填」⇒ 运营组被展开', opAfter.expanded === true);

console.log('\n===== round217 冒烟结果：' + (bad === 0 ? '全部通过' : bad + ' 项失败') + ' =====');
process.exit(bad === 0 ? 0 : 1);
