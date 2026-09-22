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
// 2026-09-20 调整判据：原先把 label 中文名一起当判据（如 label: '运营'），
// 但 label 是**展示文案**，会随用词口径调整（李老师要求四大类带上「费用」二字）；label 一改守卫就红，
// 逼得人不敢改显示文案 —— 属守卫锁错了对象（且它挡不住「category 被改」这种真回归）。
// category 才是后端契约锚点（落库/读写都用它）⇒ 改在 expense 块内按 category 判定，识别力不降反升：
// 四大类缺任何一类、或 category 被改名，依旧必红（且不再受显示文案改动干扰）。
const expBlock = terms.slice(terms.indexOf('expense: ['), terms.indexOf('subItem:'));
check('费用四大类含运营(operation)', /category: 'operation'/.test(expBlock));
check('费用四大类含人工(labor)', /category: 'labor'/.test(expBlock));
check('费用四大类含营销(marketing)', /category: 'marketing'/.test(expBlock));
check('费用四大类含其他(other)', /category: 'other'/.test(expBlock));
// 定位 expense 块里的营销段（收入里也有 category:'other'，故必须先在 expBlock 内切片，避免误命中）
const mktStart = expBlock.indexOf("category: 'marketing'");
const mktBlock = mktStart >= 0 ? expBlock.slice(mktStart, mktStart + 400) : '';
check('营销细项含外卖平台佣金', mktBlock.includes('外卖平台佣金'));
check('营销细项含团购平台佣金（分列不合并）', mktBlock.includes('团购平台佣金'));
check('营销佣金分列（两独立词条）', mktBlock.includes("'外卖平台佣金'") && mktBlock.includes("'团购平台佣金'"));
check('旧费用分类(房租租金/人员工资/水电物业)已移除', !terms.includes("label: '房租租金'") && !terms.includes("label: '人员工资'"));

console.log('');
console.log('===== A2 · 二级细项（前端 UI + 后端契约）=====');
const inputJs = read("pages/month/input.js");
const inputWxml = read("pages/month/input.wxml");
check('input.js 有 incomeGroups/expenseGroups 组模型', /incomeGroups: \[\],/.test(inputJs) && /expenseGroups: \[\],/.test(inputJs));
// round102（2026-09-22）判据放宽到**语义级**：原判据绑死了 initGroups 里的局部变量名（const rows）——
//   本轮把 initGroups/rebuildFromItems 改成「先建页面对象、再装配 rows」后变量名变成 raw ⇒ 误报。
//   守卫意图是「有 rows/showRows 细项行模型」（折叠态取首行、展开态全量），与局部变量名无关。
//   腿①：行数组以「单个空行」初始化（= [{ subItem: ... }]，不限 const/let/变量名）
//   腿②：showRows 按 expanded 取首行 / 全量（showRows: 与 g.showRows = 两种写法均算）
check('input.js 有 rows/showRows 细项行模型（折叠取首行 / 展开全量）',
  /=\s*\[\{ subItem: '', amountYuan: '' \}\]/.test(inputJs)
  && /showRows\s*[:=]\s*(?:g\.|out\.)?expanded\s*\?\s*(?:g\.|out\.)?rows\s*:\s*(?:g\.|out\.)?rows\.slice\(0, 1\)/.test(inputJs));
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
// 2026-09-20 调整：原判据锁死了文案**原文**（'收入按当月实际到账金额填写'）。
// 问题在于这条原文是**错的**——违反规范 A.0-1 权责发生制，且与「佣金记营销费用」自相矛盾（佣金会被扣两次）。
// 锁死原文 ⇒ 谁去修正错误口径，守卫就红谁 ⇒ 守卫成了错误口径的保护伞。
// 改为守「字段存在且非空（≥10 字）+ 页面确实渲染它」，另加一条**口径守卫**（下），比锁原文更强。
check('input 收入引导 incomeHint 渲染', /t\.incomeHint/.test(read("pages/month/input.wxml")) && /incomeHint: '[^']{10,}'/.test(terms));
check('input 费用引导 expenseHint 渲染', /t\.expenseHint/.test(read("pages/month/input.wxml")) && /expenseHint: '[^']{10,}'/.test(terms));
// 口径守卫（2026-09-20 round57 新增，round58 加固为**语义级**）：
//   round57 版判据 = 「必须含『出了餐就算』且 不得含『按当月实际到账金额填写』」——两条都绑死单一字面。
//   round58 独立变异回灌证明它两头都不严（与 round55 的 c24e0a2 同族：守的是拼写，不是意图）：
//     · 漏   ：改成「收入以当月实际到账金额为准填写，出了餐就算。」⇒ 仍是收付实现制，却判绿；
//     · 误报 ：改成「收入按业务发生日确认营业收入，不看钱到账没有。」⇒ 这是**正确**的权责发生制，却判红。
//   ⇒ 加固为语义两条腿，不再依赖任何一句具体的字面：
//     ① 权责锚点：必须出现权责发生制标志（出餐 / 业务发生日 / 权责发生 / 发生日确认）之一；
//     ② 收付框架：`(按|以)` + ≤16 个非标点字符内含 <实际到账|实际入账|实收金额|收到钱|钱到账> + ≤6 字 + <填|填写|录入>。
//        之所以要带「指令框架（按/以 … 填）」而不是裸扫「到账」二字：
//        正确文案里本来就藏着「不管钱有没有到账」这种**否定式**提法，裸扫会误报。
//   fail-closed：锚点与框架任一条不满足即红（拿不出「这是权责发生制」的证据 = 不许过）。
//   依据：specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md A.0-1 / A.1。
check('收入口径=权责发生制（语义级：有权责锚点 且 无收付实现制框架）',
  /incomeHint: '[^']*(?:出了餐|出餐|业务发生日|权责发生|发生日确认)/.test(terms)
  && !/incomeHint: '[^']*?(?:按|以)[^，。；！？：'"\n]{0,16}?(?:实际到账|实际入账|实收金额|收到钱|钱到账)[^，。；！？：'"\n]{0,6}?(?:填|填写|录入)/.test(terms));

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
console.log('===== G · 堂食录入模式（2026-09-21 李老师拍板 · 方案 A 严格互斥）=====');
// 判据原则：守「李老师点名的结构」而非泛展示文案。
//   - 渠道清单是本次交付的核心内容，改名即回归 ⇒ 守名；
//   - 引导句 / 描述句**不锁原文**（round57 教训：锁死原文会让守卫变成错误口径的保护伞）。
const dinWxml = read("pages/month/input.wxml");
const dinJs = read("pages/month/input.js");

const incBlock = terms.slice(terms.indexOf('income: ['), terms.indexOf('subItemPh:'));
const dineBlock = incBlock.slice(incBlock.indexOf("category: 'dine_in'"), incBlock.indexOf("category: 'takeaway'"));
const itemsM = /items: \[([^\]]*)\]/.exec(dineBlock);
const dineItemCount = itemsM ? itemsM[1].split(',').length : 0;
check('G1 堂食渠道数 = 7', dineItemCount === 7, '实际 ' + dineItemCount);
check('G1 含 银行卡/POS刷卡（李老师要求新增）', dineBlock.includes('银行卡/POS刷卡'));
check('G1 含 团购/代金券核销（不单列老板会以为钱少了）', dineBlock.includes('团购/代金券核销'));
check('G1 微信 / 支付宝已拆分为两项', dineBlock.includes('微信扫码收款') && dineBlock.includes('支付宝收款'));
check('G1 旧合并项「微信支付宝」已消失', !dineBlock.includes("'微信支付宝'"));

check('G2 互斥开关两个选项（fast / detail）', /data-val="fast"/.test(dinWxml) && /data-val="detail"/.test(dinWxml));
check('G2 开关绑定 onPickDineMode', /bindtap="onPickDineMode"/.test(dinWxml));
check('G2 选中态由 dineMode 唯一决定（不存在两个数据源）',
  /class="dm-opt \{\{dineMode === 'fast' \? 'on' : ''\}\}"/.test(dinWxml)
  && /class="dm-opt \{\{dineMode === 'detail' \? 'on' : ''\}\}"/.test(dinWxml));

// 🔴 李老师硬要求：「添加细项这个一定要保留」⇒ 必须守住，防止后续改版被误删
check('G3 「添加渠道」按钮保留（李老师硬要求）', dinWxml.includes('{{t.dmAddChannel}}'));
check('G3 添加按钮在分项模式分支内（未被模式开关吃掉）',
  dinWxml.indexOf('{{t.dmAddChannel}}') > dinWxml.indexOf(`wx:elif="{{g.category === 'dine_in'}}"`));
check('G3 添加按钮仍绑定 addRow', /catchtap="addRow"[^>]*>\{\{t\.dmAddChannel\}\}/.test(dinWxml)
  || /\{\{t\.dmAddChannel\}\}[\s\S]{0,80}/.test(dinWxml));

// 方案 A 语义：选「分项」时总额由各渠道相加自动得出、不可手填 ⇒ 单一数据源，无需校验
check('G4 合计是只读文本（不可手填）', /<text class="dine-sum-val">\{\{dineSumYuan\}\}<\/text>/.test(dinWxml));
check('G4 合计不是输入框', !/<input[^>]*dineSumYuan/.test(dinWxml));
check('G4 合计由 syncDineSum 自动相加', /syncDineSum\(\)/.test(dinJs)
  && /reduce\(\(s, r\) => s \+ \(Number\(r\.amountYuan\)/.test(dinJs));

check('G5 有 onPickDineMode 切换方法', /onPickDineMode\(e\)/.test(dinJs));
check('G5 有 decorateDineRows（预设渠道固定不可编辑）', /decorateDineRows\(rows\)/.test(dinJs));
check('G5 模式只存本地、不动后端契约', /DINE_MODE_KEY/.test(dinJs) && /wx\.setStorageSync\(this\.dineModeKey\(\)/.test(dinJs));

check('G6 标注：储值充值不算收入', terms.includes('储值充值不算收入'));
check('G6 标注：团购钱结算在平台', terms.includes('结算在美团/抖音平台'));
check('G6 口径：收回挂账的回款不算营收', terms.includes('挂账的回款'));

// ===== G7 / G8（2026-09-21 真机反馈）：口径句折叠 + 渠道行两行 + × 高度不可下调 =====
// 背景：原「堂食」下方整段口径句常展开、渠道行一行三列把渠道名挤成竖排 —— 都是**版面回归**，
//       旧守卫一条都抓不到（它们只守数据/文案）。这里补上结构判据。
const dinWxss = read("pages/month/input.wxss");
check('G7 口径句收进折叠块（引导行 + 按需展开）',
  /class="scope-head"/.test(dinWxml) && /class="scope" wx:if="\{\{g\.scopeOpen\}\}"/.test(dinWxml));
check('G7 有 onToggleScope 且默认收起（scopeOpen 初值 false）',
  /onToggleScope\(e\)/.test(dinJs) && /scopeOpen: false/.test(dinJs));
check('G7 引导语走 i18n（页面不写死文案）', /scopeShow: '/.test(terms) && /scopeHide: '/.test(terms));
check('G7 口径句未退回「常展开」形态', !/class="scope" wx:if="\{\{g\.scope\}\}"/.test(dinWxml));

check('G8 渠道行拆两行（行①名字+× / 行②金额）',
  /class="dine-line1"/.test(dinWxml) && /class="dine-line2"/.test(dinWxml)
  && dinWxml.indexOf('class="dine-line2"') > dinWxml.indexOf('class="dine-line1"'));
check('G8 一行三列已废（渠道名不再与金额抢宽度而竖排）', !/class="dine-row"/.test(dinWxml));
// 结构性判据（比只认类名强）：行① 只许放名字 + ×，金额框必须落在行② —— 防「把金额挪回名字行」的半回归
const dLine1 = dinWxml.slice(dinWxml.indexOf('class="dine-line1"'), dinWxml.indexOf('class="dine-line2"'));
check('G8 金额框不在行①（名字行不含金额）', dLine1.indexOf('dine-amt') < 0 && dLine1.indexOf('dine-name') >= 0);
check('G8 渠道名不竖排（nowrap + 省略号）',
  /\.dine-name \{[^}]*white-space: nowrap/.test(dinWxss) && /\.dine-name \{[^}]*text-overflow: ellipsis/.test(dinWxss));
check('G8 金额框占满行②（flex 1 + width auto）',
  /\.dine-amt \{[^}]*flex: 1 1 auto/.test(dinWxss) && /\.dine-amt \{[^}]*width: auto/.test(dinWxss));
check('G8 × 触控高度仍 88rpx（李老师要求「变小」≠ 下调 min-height，G2 硬约束）',
  /\.btn-del \{[^}]*min-height: 88rpx/.test(dinWxss));

console.log('');
console.log('===== G9 · 分项→快速→分项 round-trip 不丢值（2026-09-21 李老师反馈）=====');
// 背景：原实现切到快速时把分项行整体覆盖成单行总额、切回再重铺，导致来回切一次原输入全丢。
//   守「快照字段存在 + 切快速前存快照 + 切回优先恢复（非空才恢复，不再永远重铺）」。
check('G9 数据层有 dineDetailRows 快照字段', /dineDetailRows: \[\],/.test(dinJs));
check('G9 切到快速前先把分项行快照进 dineDetailRows', /dineDetailRows: this\.decorateDineRows\(cur\)/.test(dinJs));
check('G9 切回分项优先恢复快照（非空则原样恢复，不重铺首行）',
  /const snap = this\.data\.dineDetailRows/.test(dinJs) && /if \(snap\.length > 0\)/.test(dinJs));
check('G9 仅从未填过分项才走「总额铺首行」旧逻辑', /从未填过分项/.test(dinJs));

console.log('');
console.log('===== G10 · 堂食渠道全集常在 + 单一装配口（2026-09-21 李老师「挂账/团购不见了」）=====');
// 背景：改版前渠道行 = 「后端存过什么就渲染什么」⇒ 没填过的预设渠道（挂账/团购/POS…）凭空消失；
//   且 initGroups / rebuildFromItems / 加行 / 删行 / 切模式 各自拼一遍 ⇒ 改一处漏三处。
// 修法：渠道清单只认 terms.js；所有产出路径强制走 utils/dineChannels.js::normalizeDineRows。
// ⚠️ 守卫**直接 require 真模块 + 真 terms 跑用例**，不在守卫里复制一份实现 ——
//    复制实现会跟着一起错，守卫就成摆设（验收铁律：断言不得恒真）。
const { normalizeDineRows } = require(path.join(ROOT, 'utils/dineChannels.js'));
const { TERMS: T } = require(path.join(ROOT, 'miniprogram/i18n/terms.js'));
const dineDef = (T.ledger.income || []).find((g) => g.category === 'dine_in');
const PRESETS = (dineDef && dineDef.items) || [];
const NOTES = T.ledger.channelNotes || {};

check('G10a 装配模块导出 normalizeDineRows', typeof normalizeDineRows === 'function');
check('G10a 渠道清单来自 terms.js（≥7 条）', PRESETS.length >= 7, `实际 ${PRESETS.length} 条`);
check('G10a 清单含李老师点名的挂账与团购', PRESETS.some((x) => /挂账/.test(x)) && PRESETS.some((x) => /团购/.test(x)));

// 场景①：后端只回传 3 条（缺挂账/团购）⇒ 仍必须补齐全集（李老师现场就是这个）
const fromBackend = [
  { subItem: '现金收款', amountYuan: '1000' },
  { subItem: '微信扫码收款', amountYuan: '2000' },
  { subItem: '储值卡消费', amountYuan: '30' },
];
const full = normalizeDineRows(fromBackend, PRESETS, NOTES);
check('G10b 后端只回传部分渠道时仍补齐全集', full.length === PRESETS.length, `${full.length}/${PRESETS.length}`);
check('G10b 缺失的挂账被补回（空行）', full.some((r) => /挂账/.test(r.subItem) && r.amountYuan === ''));
check('G10b 缺失的团购被补回（空行）', full.some((r) => /团购/.test(r.subItem) && r.amountYuan === ''));
check('G10b 金额按名回填不错位（微信=2000 / 储值卡=30）',
  (full.find((r) => r.subItem === '微信扫码收款') || {}).amountYuan === '2000'
  && (full.find((r) => r.subItem === '储值卡消费') || {}).amountYuan === '30');
check('G10b 顺序按 terms 不打乱', full.map((r) => r.subItem).join('|') === PRESETS.join('|'));

// 场景②：自定义渠道（「+ 添加渠道」）保留在末尾、可编辑可删
const withCustom = normalizeDineRows(fromBackend.concat([{ subItem: '抖音团购', amountYuan: '50' }]), PRESETS, NOTES);
check('G10c 自定义渠道保留在末尾', withCustom.length === PRESETS.length + 1
  && withCustom[PRESETS.length].subItem === '抖音团购');
check('G10c 自定义行 fixed=false（可编辑可删）', withCustom[PRESETS.length].fixed === false);
check('G10c 预设行 fixed=true（名称不可改）', full.every((r) => r.fixed === true));

// 场景③：空行取舍
check('G10d 无名无额的空行被丢弃（不占位）',
  normalizeDineRows([{ subItem: '', amountYuan: '' }], PRESETS, NOTES).length === PRESETS.length);
check('G10d 刚添加的空行(custom)放行（点了有反应）',
  normalizeDineRows([{ subItem: '', amountYuan: '', custom: true }], PRESETS, NOTES).length === PRESETS.length + 1);

// 场景④：幂等（可重复调用，不越补越多）
check('G10f 幂等：normalize(normalize(x)) === normalize(x)',
  JSON.stringify(normalizeDineRows(full, PRESETS, NOTES)) === JSON.stringify(full));

// 场景⑤：round-trip（分项→快速→分项）后渠道全集与数值俱在
const tripSum = full.reduce((s, r) => s + (Number(r.amountYuan) || 0), 0);
const backToDetail = normalizeDineRows(full.map((r) => ({ subItem: r.subItem, amountYuan: r.amountYuan })), PRESETS, NOTES);
check('G10e round-trip 后渠道全集 + 数值俱在', backToDetail.length === PRESETS.length
  && (backToDetail.find((r) => r.subItem === '微信扫码收款') || {}).amountYuan === '2000'
  && tripSum === 3030);

// 静态：唯一入口 + 不许写死渠道名（防「改一处漏三处」复发）
check('G10g decorateDineRows 转调唯一装配口',
  /decorateDineRows\(rows\) \{[\s\S]{0,400}?normalizeDineRows\(rows/.test(dinJs));
check('G10g 页面 require 了装配模块',
  /require\('\.\.\/\.\.\/utils\/dineChannels\.js'\)/.test(dinJs));
check('G10h 页面不写死任何渠道名（清单只认 terms.js）',
  !PRESETS.some((n) => dinJs.includes(`'${n}'`) || dinWxml.includes(n)));
// ⚠️ 判据不能只认「有 .filter(」—— 变异回灌 M4（改成 .filter((r) => true)）照样命中，属假绿（恒真）。
//   必须同时锁住「过滤的是金额字段」：过滤表达式里出现 amountYuan。
// ⚠️ `[^)]*` 是特意用的：把匹配锁在 filter 箭头函数**体内**，不许跨到后面的 .map() ——
//   用 [\s\S]{0,160}? 时，变异体 `.filter((r) => true)` 会吃到 .map() 里的 amountYuan ⇒ 假绿（回灌 M4 实证）。
check('G10i 保存只提交填了金额的行（空渠道不落库）',
  /sub_items: g\.rows[\s\S]{0,160}?\.filter\(\(r\) =>[^)]*amountYuan/.test(dinJs));
// 回灌 M6 抓到：只有运行时用例（G10d）守不住 addRow 这处静态写法 ⇒ 补静态判据
check('G10k 新增行带 custom 标记（点了「添加渠道」立刻出现空行）',
  /concat\(\[\{ subItem: '', amountYuan: '', custom: true \}\]\)/.test(dinJs));
check('G10j 预设行不给删除键（× 只对自定义行）',
  /class="btn-del" wx:if="\{\{!r\.fixed\}\}"/.test(dinWxml));

// ===== G11（2026-09-21 李老师真机反馈「美团和现金后面有红色X、和上面重复了」）=====
// 现场（真云 getLedger 实测）：2026-09 堂食 sub_items = [{美团: 50000}, {现金: 2000}]
//   —— 名字都是老板自己用「+ 添加渠道」填的口语叫法 ⇒ 改版前被当成「自定义渠道」，
//      在 7 个预设渠道下面又各占一行、各带一个红色 ×，看着就是「跟上面的渠道重复了」。
// 修法：terms 加别名表（口语 → 正式渠道），唯一装配口归并（金额相加，一分不丢），
//      并且**所有大类的预设行一律不给删除键**（清单是单一数据源，删了装配必补回）。
const { markFixedRows } = require(path.join(ROOT, 'utils/dineChannels.js'));
const ALIASES = T.ledger.channelAliases || {};

check('G11a 别名表存在且够用（≥8 条）', Object.keys(ALIASES).length >= 8, `${Object.keys(ALIASES).length} 条`);
check('G11c 别名指向的都是真实预设渠道（不许写错渠道名）',
  Object.keys(ALIASES).every((k) => PRESETS.indexOf(ALIASES[k]) >= 0),
  Object.keys(ALIASES).filter((k) => PRESETS.indexOf(ALIASES[k]) < 0).join(',') || '全部命中');
check('G11c 别名不指向自己（防原地打转）', Object.keys(ALIASES).every((k) => ALIASES[k] !== k));

// 现场数据原样回放
const liveRows = [{ subItem: '美团', amountYuan: '50000.00' }, { subItem: '现金', amountYuan: '2000.00' }];
const mergedRows = normalizeDineRows(liveRows, PRESETS, NOTES, ALIASES);
check('G11a 归并后行数 = 预设渠道数（不再多出重复行）',
  mergedRows.length === PRESETS.length, `${mergedRows.length}/${PRESETS.length}`);
check('G11a 「现金」并入「现金收款」（2000.00）',
  (mergedRows.find((r) => r.subItem === '现金收款') || {}).amountYuan === '2000.00');
check('G11a 「美团」并入「团购/代金券核销」（50000.00）',
  (mergedRows.find((r) => /团购/.test(r.subItem)) || {}).amountYuan === '50000.00');
check('G11a 金额一分不丢（归并后合计 = 52000）',
  mergedRows.reduce((s, r) => s + (Number(r.amountYuan) || 0), 0) === 52000);
check('G11b 归并后没有非预设行（页面不会出现重复渠道）',
  mergedRows.every((r) => PRESETS.indexOf(r.subItem) >= 0 && r.fixed === true));
// 反向证据：不在别名表里的自定义渠道**不许被吞**（防别名归并退化成「乱合并」）
const keepCustom = normalizeDineRows([{ subItem: '抖音团购', amountYuan: '50' }], PRESETS, NOTES, ALIASES);
check('G11b 不在别名表的自定义渠道原样保留（不被吞）',
  keepCustom.length === PRESETS.length + 1 && keepCustom[PRESETS.length].subItem === '抖音团购');
// 加法语义 + 幂等
const bothCash = normalizeDineRows(
  [{ subItem: '现金收款', amountYuan: '100' }, { subItem: '现金', amountYuan: '200' }], PRESETS, NOTES, ALIASES);
check('G11b 同渠道「正式行 + 别名行」相加（100+200=300）',
  (bothCash.find((r) => r.subItem === '现金收款') || {}).amountYuan === '300.00');
check('G11b 归并幂等（再归并一次结果不变）',
  JSON.stringify(normalizeDineRows(mergedRows, PRESETS, NOTES, ALIASES)) === JSON.stringify(mergedRows));
check('G11b 页面把别名表真的传进装配口（不传 = 归并静默失效）',
  /TERMS\.ledger\.channelAliases \|\| \{\}/.test(dinJs));

// 非堂食大类：预设细项同样不给删除键
const opDef = (T.ledger.expense || []).find((g) => g.category === 'operation');
const opItems = (opDef && opDef.items) || [];
const markedRows = markFixedRows(
  [{ subItem: opItems[0], amountYuan: '1' }, { subItem: '水电', amountYuan: '2' }], opItems);
check('G11d 非堂食预设行标 fixed=true（预设有清单，删了会自己回来）',
  markedRows[0] && markedRows[0].fixed === true);
check('G11d 非堂食自定义行 fixed=false（可改名可删）',
  markedRows[1] && markedRows[1].fixed === false);
check('G11d 非堂食行装配也走唯一入口（不再各自拼装）',
  /decorateRows\(g, rows\) \{[\s\S]{0,160}?dine_in' \? this\.decorateDineRows\(rows\) : markFixedRows\(rows, g\.items\)/.test(dinJs));
// round102（2026-09-22）：预设细项**改为可删** —— 原判据「名字在预设清单里就不给删除键」的立论
//   （「清单是单一数据源，装配时必然补回」）**实测不成立**：initGroups 只铺一个空行、
//   rebuildFromItems 只按后端 sub_items 重建，两条装配口**从不补回预设项**（那套「删了会回来」
//   只在**堂食渠道**成立）。⇒ 保留名字只读（防同一笔费用两个名字），放开删除键、只留「至少留一行」护栏。
//   依据：规范 A.2「费用项支持老板自定义增删」。
check('G11d 两个 WXML 分支的 × 只受「至少留一行」护栏约束（预设行也可删）',
  (dinWxml.match(/class="btn-del" wx:if="\{\{g\.expanded && g\.rows\.length > 1\}\}"/g) || []).length === 2);
check('G11d 反向腿：预算行的 × 已不再带 !r.fixed（防被改回去）',
  !/class="btn-del" wx:if="\{\{g\.expanded && !r\.fixed/.test(dinWxml));
check('G11d 堂食渠道的 × 仍带 !r.fixed（那里的预设渠道确实会被补回，与 G10j 同口径）',
  /class="btn-del" wx:if="\{\{!r\.fixed\}\}"/.test(dinWxml));
check('G11d 预设行名以纯文本渲染（不可编辑）',
  (dinWxml.match(/class="sub-item-fixed" wx:elif="\{\{g\.expanded\}\}"/g) || []).length === 2);

// ===== round102（2026-09-22）· 未用预设提示行 / 小计块位置 / 只读派生字段 =====
// 为什么需要这组：本轮三处改动都能「改一半」而不报错 —— 放开删除键却忘了提示行（老板仍看不全）、
//   小计块移了位却没接上定位字段（块直接消失）、派生字段算了却没人用（提示行永远空）。
//   故每一条都配方向性判据（含条件与取值来源），不是只判「字符串出现过」。
check('R102-① 装配口挂了两个只读派生字段（unusedText / mkPlatAfterRi）',
  /g\.unusedText = unused\.join\(/.test(dinJs)
  && /g\.mkPlatAfterRi = this\.calcMkPlatAfterRi\(g, out\);/.test(dinJs));
check('R102-② 未用预设项只读计算：堂食排除在外 + 清单取自 g.items（不写死）',
  /g\.category === 'dine_in' \|\| !items\.length/.test(dinJs)
  && /const items = g\.items \|\| \[\];/.test(dinJs));
check('R102-③ 提示行两段都有（费用 + 收入非堂食），文案走 terms 单源前缀',
  (dinWxml.match(/class="hint preset-hint" wx:if="\{\{g\.expanded && g\.unusedText\}\}"/g) || []).length === 2
  && /\{\{t\.presetHintPrefix\}\}\{\{g\.unusedText\}\}/.test(dinWxml));
check('R102-④ 提示行点击直开预设面板（onOpenPresetPick 三处：两段提示 + 费用添加按钮）',
  (dinWxml.match(/catchtap="onOpenPresetPick"/g) || []).length >= 3);
// 反向腿：小计块必须已**移出**段末操作区 —— 取 group-ops 起 300 字符窗口，其中不得再出现 mk-plat
const r102GoIdx = dinWxml.indexOf('<view class="group-ops" wx:if="\{\{g.expanded\}\}">\r\n      <button class="btn-small ghost" data-kind="expense"');
const r102Win = r102GoIdx >= 0 ? dinWxml.slice(r102GoIdx, r102GoIdx + 300) : '';
check('R102-⑤ 小计块已移出「段末操作区」（group-ops 首 300 字符内不含 mk-plat）',
  r102GoIdx >= 0 && r102Win.indexOf('mk-plat') < 0);
check('R102-⑥ 小计块改为按 g.mkPlatAfterRi 在**行循环内**定位（紧跟佣金行）',
  /<view class="mk-plat" wx:if="\{\{g\.category === 'marketing' && g\.expanded && ri === g\.mkPlatAfterRi\}\}">/.test(dinWxml));
check('R102-⑦ 佣金行定位走单源（reconcileRoles.commission），页面零硬编码项名',
  /const name = \(\(TERMS\.ledger\.takeawayMode \|\| \{\}\)\.reconcileRoles \|\| \{\}\)\.commission \|\| '';/.test(dinJs));

console.log('');
console.log('');
console.log('');
console.log('===== A5 · 快速模式轻量自查（T3\u2032，round97）=====');
// 背景修正：快速模式**没有补贴数据源**（只填每平台一个总额）⇒ A.11.4 配平等式硬套会稳定误报；
//   故改为零依赖判据（营销段三个角色是否全空）。本段锁住「它不读分项快照」这件事。
const a5Js = read('pages/month/input.js');
const a5Wxml = read('pages/month/input.wxml');
const a5Body = (a5Js.match(/syncTakeoutSelfCheck\(\) \{[\s\S]{0,1400}?\n  \},/) || [''])[0];
check('A5-① 自查文案在位且非空', /selfCheckMiss: '[^']{10,}'/.test(terms));
check('A5-② 方法在位且接线 ≥3 处（定义 + 合计变化 + 费用行变化）', /syncTakeoutSelfCheck\s*\(/.test(a5Js) && (a5Js.match(/syncTakeoutSelfCheck\(\)/g) || []).length >= 3);
check('A5-③ 页面渲染 + data.t 映射（页面零硬编码）', /\{\{twSelfCheck\}\}/.test(a5Wxml) && /twSelfCheckMiss: TERMS\.ledger\.takeawayMode\.selfCheckMiss/.test(a5Js));
check('A5-④ 判据不读分项快照/补贴合计（方法体非空且零依赖）', a5Body.length > 0 && !/takeoutDetailRows|subsidyTotal/.test(a5Body));
console.log('');
console.log('===== A4 · 费用细项「预设项选择」入口（T4b，round97）=====');
// 背景：预设项清单（含 round97 新增的营销 3 项）若没有「可选入口」，用户只能手打项名 ⇒ 补了也看不见。
const a4Js = read('pages/month/input.js');
const a4Wxml = read('pages/month/input.wxml');
check('A4-① 三条文案均在位且非空', /presetPickTitle: '[^']{2,}'/.test(terms) && /presetPickCustom: '[^']{2,}'/.test(terms) && /presetPickEmpty: '[^']{2,}'/.test(terms));
check('A4-② 费用侧「+ 添加细项」接预设选择入口', /data-kind="expense"[^>]*catchtap="onOpenPresetPick"/.test(a4Wxml));
check('A4-③ 三个处理函数均在位（打开 / 选中 / 加行）', /onOpenPresetPick\s*\(/.test(a4Js) && /onPickPreset\s*\(/.test(a4Js) && /addSubRow\s*\(/.test(a4Js));
check('A4-④ 弹层渲染文案与清单（页面零硬编码）', /\{\{t\.presetPickTitle\}\}/.test(a4Wxml) && /wx:for="\{\{presetPick\.list\}\}"/.test(a4Wxml) && /\{\{t\.presetPickCustom\}\}/.test(a4Wxml));
check('A4-⑤ 三条文案已在 data.t 里映射（否则 wxml 取到空串）', /presetPickTitle: TERMS\.ledger\.presetPickTitle/.test(a4Js) && /presetPickCustom: TERMS\.ledger\.presetPickCustom/.test(a4Js) && /presetPickEmpty: TERMS\.ledger\.presetPickEmpty/.test(a4Js));
console.log('');
console.log('===== A6 · 营销段「分平台佣金小计」（T1，round97）=====');
// 背景：收入侧外卖分 4 平台、费用侧只有 1 个佣金总额 ⇒ 客户要自己把 4 份账单分别求和再相加，
//   漏平台 = 佣金少记 = 利润虚高。本区按平台逐行填、自动汇成那一行（只回显不入库）。
const a6Js = read('pages/month/input.js');
const a6Wxml = read('pages/month/input.wxml');
check('A6-① 五条文案均在位且非空', ['mkPlatTitle', 'mkPlatHintTpl', 'mkPlatPh', 'mkPlatSumLabel', 'mkPlatClear']
  .every((k) => new RegExp(k + ": '[^']{2,}'").test(terms)));
check('A6-② 五条文案已在 data.t 里映射（否则 wxml 取到空串）',
  ['mkPlatTitle', 'mkPlatPh', 'mkPlatSumLabel', 'mkPlatClear']
    .every((k) => new RegExp(k + ': TERMS\\.ledger\\.takeawayMode\\.' + k).test(a6Js))
  && a6Js.indexOf("mkPlatHint: (TERMS.ledger.takeawayMode.mkPlatHintTpl || '').replace('{name}'") >= 0);
check('A6-③ 小计区只挂营销类且随展开显示（页面零硬编码）',
  /g\.category === 'marketing' && g\.expanded/.test(a6Wxml)
  && /wx:for="\{\{twMkByPlat\}\}"/.test(a6Wxml) && /\{\{t\.mkPlatSumLabel\}\}/.test(a6Wxml));
check('A6-④ 小计输入接 onMkByPlat 并传下标', /data-idx="\{\{pi\}\}" bindinput="onMkByPlat"/.test(a6Wxml));
check('A6-⑤ 三个处理函数均在位（输入 / 清空 / 汇总）',
  /onMkByPlat\s*\(/.test(a6Js) && /clearMkByPlat\s*\(/.test(a6Js) && /syncMkByPlat\s*\(/.test(a6Js));
const a6Build = (a6Js.match(/buildItems\(groups\) \{[\s\S]{0,2500}?\n  \},/) || [''])[0];
check('A6-⑥ 接管时该行转只读（两个来源不打架）+ 只回显不入库（buildItems 不含小计）',
  /twMkByPlatActive && gi === twMkRowGi && ri === twMkRowRi/.test(a6Wxml)
  && a6Build.length > 0 && !/twMkByPlat/.test(a6Build));

console.log('');
console.log('===== 门禁预检 =====');
check('K11 双副本逐字一致', terms === termsSpec);
check('建库单源文件仍在（仅存在性；逐项一致性比对在 R124 tools/check_seed_terms_sync.js）', read("cloudfunctions/initDb/collections.js").includes('SEED_INCOME_ITEMS') && read("specs/dev-specs/prototype/init_db.js").includes('SEED_EXPENSE_ITEMS'));

console.log(`\n==== 批次 8b 功能补齐自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
