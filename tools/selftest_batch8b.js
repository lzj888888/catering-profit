// tools/selftest_batch8b.js —— 批次 8 功能补齐（A1~F1）静态自测
// 运行： node tools/selftest_batch8b.js
// 覆盖：A1 费用四大类结构 / A2 二级细项（前端+后端契约）/ B1 年月 picker / C1 mine 三 cell /
//       D1 result 下钻 / E1 引导文案 / F1 术语统一与幽灵词条清理。
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const terms = read("miniprogram/i18n/terms.js");
const termsSpec = read("specs/dev-specs/i18n/terms.js");

console.log('===== A1 · 费用四大类（运营/人工/营销/其他）+ 营销含佣金分列 =====');
check('费用四大类含运营(operation)', /category: 'operation', label: '运营'/.test(terms));
check('费用四大类含人工(labor)', /category: 'labor', label: '人工'/.test(terms));
check('费用四大类含营销(marketing)', /category: 'marketing', label: '营销'/.test(terms));
check('费用四大类含其他(other)', /category: 'other', label: '其他'/.test(terms));
// 定位 expense 数组里的营销块：从 "label: '营销'" 到 "label: '其他'"（收入里的 other 是 '其他业务收入'，不会误命中）
const mktBlock = terms.slice(terms.indexOf("label: '营销'"), terms.indexOf("label: '其他'"));
check('营销细项含外卖平台佣金', mktBlock.includes('外卖平台佣金'));
check('营销细项含团购平台佣金（分列不合并）', mktBlock.includes('团购平台佣金'));
check('营销佣金分列（两独立词条）', mktBlock.includes("'外卖平台佣金'") && mktBlock.includes("'团购平台佣金'"));
check('旧费用分类(房租租金/人员工资/水电物业)已移除', !terms.includes("label: '房租租金'") && !terms.includes("label: '人员工资'"));

console.log('');
console.log('===== A2 · 二级细项（前端 UI + 后端契约）=====');
const inputJs = read("pages/month/input.js");
const inputWxml = read("pages/month/input.wxml");
check('input.js 有 incomeGroups/expenseGroups 组模型', /incomeGroups: \[\],/.test(inputJs) && /expenseGroups: \[\],/.test(inputJs));
check('input.js 有 rows/showRows 细项行模型', /const rows = \[\{ subItem: '', amountYuan: '' \}\]/.test(inputJs) && /showRows: expanded \? rows : rows\.slice\(0, 1\)/.test(inputJs));
check('input.js 有 buildItems（提交 sub_items，前端不汇总）', /buildItems\(groups\)/.test(inputJs) && /sub_items:/.test(inputJs));
check('input.wxml 有 sub_item 输入与 addRow/delRow', /onSubItem/.test(inputWxml) && /addRow/.test(inputWxml) && /delRow/.test(inputWxml));
check('input.wxml 用 group-head 展开/收起', /group-head/.test(inputWxml) && /onToggleGroup/.test(inputWxml));
const slv = read("cloudfunctions/saveLedger/validate.js");
check('saveLedger validate 接受 sub_items', /sub_items !== undefined/.test(slv) && /subItems.push/.test(slv));
check('validate 云函数汇总大类金额（不采信前端大类值）', /amountFen: sum, subItems/.test(slv));
check('validate 限制 sub_item ≤20 字', /SUB_ITEM_MAX_LEN = 20/.test(slv));
const sli = read("cloudfunctions/saveLedger/index.js");
check('saveLedger 落库转 snake_case（amount_fen/sub_items）', /income_items: incomeItemsSnake/.test(sli) && /sub_items: \(it\.subItems/.test(sli));
const gli = read("cloudfunctions/getLedger/index.js");
check('getLedger 兼容旧格式并返回 snake_case', /normalizeToCamel/.test(gli) && /toSnake\(incomeItems\)/.test(gli));

console.log('');
console.log('===== B1 · 摊销年月 picker（替代手输）=====');
const amWxml = read("pages/month/amortize.wxml");
check('开始月用 picker mode=date fields=month', /<picker mode="date" fields="month" value="\{\{formStartMonth\}\}"/.test(amWxml));
check('终止月用 picker mode=date fields=month', /<picker mode="date" fields="month" value="\{\{formTerminateMonth\}\}"/.test(amWxml));
check('amortize.js 有 onMonthPick 处理', /onMonthPick\(e\)/.test(read("pages/month/amortize.js")));

console.log('');
console.log('===== C1 · mine 页 版本/客服/免责声明 =====');
const mineWxml = read("pages/mine/index.wxml");
const mineJs = read("pages/mine/index.js");
check('mine 页有版本号 cell（关于）', /t\.about/.test(mineWxml) && /t\.appVersion/.test(mineWxml));
check('mine 页有意见反馈 cell（AD-16 客服入口）', /t\.feedback/.test(mineWxml) && /onFeedback/.test(mineJs));
check('mine 页有免责声明 cell + 弹窗', /t\.disclaimerLabel/.test(mineWxml) && /onDisclaimer/.test(mineJs));
check('disclaimer 词条被引用（不再是幽灵）', terms.includes("disclaimer: '本工具计算结果仅供参考") && /TERMS\.auditSafe\.disclaimer/.test(mineJs));

console.log('');
console.log('===== D1 · result 下钻明细 =====');
const resWxml = read("pages/month/result.wxml");
const resJs = read("pages/month/result.js");
check('result 营业收入行可点下钻', /data-kind="income" bindtap="toggleDrill"/.test(resWxml));
check('result 费用合计行可点下钻', /data-kind="expense" bindtap="toggleDrill"/.test(resWxml));
check('result 有展开明细面板（大类→细项）', /drill-body/.test(resWxml) && /drill-sub/.test(resWxml));
check('result.js 有 buildDetail/toggleDrill（前端仅格式化展示）', /buildDetail/.test(resJs) && /toggleDrill/.test(resJs));

console.log('');
console.log('===== E1 · 录入页引导文案 =====');
check('input 收入引导 incomeHint 渲染', /t\.incomeHint/.test(read("pages/month/input.wxml")) && /incomeHint: '收入按当月实际到账金额填写/.test(terms));
check('input 费用引导 expenseHint 渲染', /t\.expenseHint/.test(read("pages/month/input.wxml")) && /expenseHint: '费用只填本月实际支出/.test(terms));

console.log('');
console.log('===== F1 · 术语统一 + 幽灵清理 =====');
check('总费用→费用合计（两页统一）', !terms.includes("totalExpense: '总费用'") && terms.includes("totalExpense: '费用合计'"));
const ghostKeys = ['netMargin:', 'breakeven:', 'paybackPrefix:', 'calcReverse:', 'syncPrice2:', 'addAsset:', 'inputs:', 'outputs:', 'exportScopeM1:', 'privacyNeed:', 'unlockAll:', 'intro:', 'conclude:', 'grossMarginRate:'];
for (const k of ghostKeys) {
  if (terms.includes(k)) { failN++; console.log(`❌ 幽灵词条未删除: ${k}`); }
}
pass += ghostKeys.length - ghostKeys.filter((k) => terms.includes(k)).length;
console.log(`   幽灵词条 14 条已清: ${ghostKeys.every((k) => !terms.includes(k)) ? '✅' : '❌'}`);

console.log('');
console.log('===== 门禁预检 =====');
check('K11 双副本逐字一致', terms === termsSpec);
check('建库单源同步（种子在双源）', read("cloudfunctions/initDb/collections.js").includes('SEED_INCOME_ITEMS') && read("specs/dev-specs/prototype/init_db.js").includes('SEED_EXPENSE_ITEMS'));

console.log(`\n==== 批次 8b 功能补齐自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
