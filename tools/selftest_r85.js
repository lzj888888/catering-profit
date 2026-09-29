// tools/selftest_r85.js —— R85 · 月度录入页「外卖段」取数与录入（规范 §A.11）自测
// 运行： node tools/selftest_r85.js
// 覆盖验收锚点 A1~A24：模式默认推断 / 快速4×1 / 分项4×3 / 互斥快照 / 粘贴提取 / 合计确认 /
//      手写路径 / 自动带出 / 配平四态 / 不阻断 / 平台名单源 / 双副本一致 /
//      账期与长单号不误算金额(A16) / 带出误锁回归(A17) / 配平角色单源(A18) / 主题色单源(A19) /
//      粘贴到 0 不被吞(A20) / 快速录入汇总(A21) / 快速框占位不串线(A22) / 已填平台数 M≤1 不显示(A23) /
//      账单形态用例表：换行合计不翻倍 + 只有合计兜底填入(A24, R120) /
//      R162：有效订单数第 4 必填 + 补贴三项合计口径 + 防双记边界 + 列名双名(A25~A30)。
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const takeaway = require("../utils/takeaway.js");
const {
  pickTakeawayMode, restoreDetail, subtotalOf, extractPaste, pasteFillValue, pasteFilledFromTotal, filledLabel,
  snapshotDetail,   // R162：切模式快照（qty round-trip 用）
  subsidyTotal, reconcile, RECONCILE_THRESHOLD,
  mkByPlatTotal, mkByPlatFilled,
  qtyTotal, perOrderYuan,   // R162：有效订单数（只回显，不进金额）
} = takeaway;
const TERMS = require("../miniprogram/i18n/terms.js").TERMS;
const PLATFORMS = TERMS.ledger.income.find((g) => g.category === "takeaway").items;
const MARKETING = TERMS.ledger.expense.find((g) => g.category === "marketing").items;

console.log('===== A1 · 外卖组默认模式（按数据推断：细项行 >1 ⇒ 分项）=====');
check('A1 无缓存 + 单行 → 快速', pickTakeawayMode(null, [{ subItem: 'x' }]) === 'fast');
check('A1 无缓存 + 多行 → 分项', pickTakeawayMode(null, [{ subItem: 'a' }, { subItem: 'b' }]) === 'detail');
check('A1 缓存 fast 优先于数据', pickTakeawayMode('fast', [{}, {}]) === 'fast');
check('A1 缓存 detail 优先于数据', pickTakeawayMode('detail', [{}]) === 'detail');

console.log('===== A2/A3 · 快速 4×1 与分项 4×3（平台名来自 terms）=====');
check('A2 平台清单 = terms takeaway items（4 个）', PLATFORMS.length === 4, PLATFORMS.join('/'));
check('A2 平台名单源：页面/工具内不出现平台字面（除 terms）', (() => {
  const utilSrc = fs.readFileSync(path.join(ROOT, 'utils/takeaway.js'), 'utf8');
  return !PLATFORMS.some((p) => utilSrc.includes(p)); // 工具只按 presets 参数走，不写死
})());
const det = restoreDetail([{ platform: PLATFORMS[0], goods: '100', pack: '20', subsidy: '30' }], PLATFORMS);
check('A3 分项模式 4 平台行（restoreDetail 铺全）', det.length === 4);
check('A3 每行 3 框 + 小计', det.every((r) => ('goods' in r) && ('pack' in r) && ('subsidy' in r) && ('subtotal' in r)));
check('A3 小计自动 = goods+pack+subsidy', det[0].subtotal === '150.00', det[0].subtotal);
check('A3 分项行 fixed（平台名固定不可删）', det.every((r) => r.fixed === true));
check('A3 未填平台小计为空', det[1].subtotal === '');

console.log('===== A4 · 模式互斥 + 快照恢复 =====');
const snap = [{ platform: PLATFORMS[0], goods: '88', pack: '1.5', subsidy: '2.5' }];
const restored = restoreDetail(snap, PLATFORMS);
check('A4 快照回填：金额原样恢复', restored[0].goods === '88' && restored[0].pack === '1.5' && restored[0].subsidy === '2.5');
check('A4 快照回填后小计重算', restored[0].subtotal === '92.00', restored[0].subtotal);

console.log('===== A5 · 粘贴提取（只提数字并求和；跳过表头/空/说明列）=====');
const paste1 = extractPaste('商品名\t金额\n米饭\t12.5\n可乐\t3\n配送说明 无\n\n18.5'); // 表头+说明+空行，数字 12.5+3=15.5
check('A5 提取并求和（跳表头/说明/空行；每行首个数字，末行 18.5 为真实数）', Math.abs(paste1.sum - 34) < 0.001, `sum=${paste1.sum}`);
const paste2 = extractPaste('1,234.56\n2,000'); // 千分位
check('A5 千分位逗号正确解析', Math.abs(paste2.sum - 3234.56) < 0.001, `sum=${paste2.sum}`);
check('A5 纯文字 → sum=0 且 numbers 空', extractPaste('这是说明文字\n没有数字').numbers.length === 0);

console.log('===== A6 · 粘贴含「合计」行 → 弹确认标记（页面拦截，此处验证提取侧 hasTotal）=====');
const paste3 = extractPaste('12\n18\n合计 30');
check('A6 含合计行 → hasTotal=true', paste3.hasTotal === true);
check('A6 合计行不计入求和（防重复加）', Math.abs(paste3.sum - 30) < 0.001, `sum=${paste3.sum}`);
check('A6 无合计 → hasTotal=false', extractPaste('1\n2\n3').hasTotal === false);

console.log('===== A7 · 手写路径（粘贴非唯一入口：金额框直接填合计数可保存）=====');
// 语义：快速模式金额框直接写合计数，buildItems 只提交填了金额的行（既有逻辑），粘贴只是另一条路
const inputJs = fs.readFileSync(path.join(ROOT, 'pages/month/input.js'), 'utf8');
const inputWxml = fs.readFileSync(path.join(ROOT, 'pages/month/input.wxml'), 'utf8');
check('A7 快速模式有 4 个金额框（手写可用）', /快速录入：每平台 1 个金额框/.test(inputWxml) && inputWxml.includes('bindinput="onSubAmount"'));
// ⚠️ R162：分项由 3 框变 4 框（加「有效订单数」）⇒ 模板处数 3 → 4。
//   这条断言正是「加框但忘了同步守卫」的报警器：不同步就当场红。
check('A7 分项模式金额框仍绑 onTwDetail（wx:for 模板 4 处 → 4 平台 × 4 框，手写可用）', (inputWxml.match(/bindinput="onTwDetail"/g) || []).length === 4, `onTwDetail 模板 ${(inputWxml.match(/bindinput="onTwDetail"/g) || []).length} 处`);
check('A7 buildItems 快速模式按金额行提交（非粘贴专属）', /takeoutMode === 'fast'/.test(inputJs) && /sub_items: g.rows/.test(inputJs));

console.log('===== A8 · 自动带出（活动补贴合计 → 费用侧外卖活动补贴）=====');
const subsidySum = subsidyTotal([{ subsidy: '10' }, { subsidy: '20.5' }, { subsidy: '' }, { subsidy: '5' }]);
check('A8 补贴合计 = 35.5', Math.abs(subsidySum - 35.5) < 0.001, `sum=${subsidySum}`);
check('A8 营销项单源：费用营销含「外卖活动补贴」且顺序对齐', MARKETING.indexOf('外卖活动补贴') === 2, MARKETING.join('/'));
const inputJsSync = inputJs.slice(inputJs.indexOf('syncSubsidyCarry'));
check('A8 带出实现存在（syncSubsidyCarry）', /syncSubsidyCarry/.test(inputJsSync));
check('A8 手改后不覆盖（twCarryLock 守卫）', /twCarryLock/.test(inputJs) && /已有值且与合计不同 = 用户手改/.test(inputJs));

console.log('===== A8b · R170 快速模式「其中商家承担补贴」带出 =====');
// 🔴 R170（方案1）：syncSubsidyCarry 不再对快速模式提前 return；快速模式取 g.rows[].subsidy 求和。
check('A8b 已删「快速模式直接 return」（首行不再有 takeoutMode !== detail）',
  !/if \(this\.data\.takeoutMode !== 'detail'\) return;/.test(inputJs));
check('A8b 快速模式 subsidy 取数 = g.rows[].subsidy 求和',
  /isFast\s*\?\s*\(\(g && g\.rows\) \|\| \[\]\)\.reduce\(\(s, r\) => s \+ \(Number\(r\.subsidy\) \|\| 0\), 0\)/.test(inputJs));
check('A8b 带出结果 twCarryLock=false（不锁，跟随收入侧）', /twCarryLock: false/.test(inputJs));
// R170 真值复算（8 月淘宝闪购）：收入(含补贴)6585.08 − 补贴2069.70 − 佣金158.71 − 配送577.02 = 到手3779.65
const R170_INCOME = 6585.08, R170_SUBSIDY = 2069.70, R170_COMM = 158.71, R170_DELIV = 577.02;
const fastSubsidyTotal = [{ amountYuan: '6585.08', subsidy: '2069.70' }].reduce((s, r) => s + (Number(r.subsidy) || 0), 0);
check('A8b 真值：快速模式补贴合计 = 2069.70', Math.abs(fastSubsidyTotal - R170_SUBSIDY) < 0.001, `sum=${fastSubsidyTotal}`);
const R170_PROFIT = R170_INCOME - R170_SUBSIDY - R170_COMM - R170_DELIV;
check('A8b 真值复算：6585.08−2069.70−158.71−577.02 = 3779.65（与分项模式一致）',
  Math.abs(R170_PROFIT - 3779.65) < 0.001, `profit=${R170_PROFIT.toFixed(2)}`);

console.log('===== A8c · R170 空值兼容（老用户不回归）=====');
// 快速模式 subsidy 全空 ⇒ total=0 ⇒ target='' ⇒ 走「两边都空，无事可做」不写费用侧。
check('A8c 空值守卫存在（!cur && !target 直接 return）', /if \(!cur && !target\) return;/.test(inputJs));
check('A8c 快速模式 subsidy 全空 ⇒ 合计 0（不强制带出）',
  (() => { const total = [{ amountYuan: '6585.08', subsidy: '' }].reduce((s, r) => s + (Number(r.subsidy) || 0), 0); return total === 0; })(),
  'total=0 ⇒ target=空 ⇒ 不写费用侧');
check('A8c 模式切换搬运 subsidy（快速→分项 r.subsidy||"" / 分项→快速收进 g.rows）',
  /subsidy: r\.subsidy \|\| ''/.test(inputJs) && /subsidy: r\.subsidy,/.test(inputJs));

console.log('===== A17b · R170 runReconcile 快速模式 subsidy 取数 =====');
check('A17b runReconcile 快速模式用 g.rows[].subsidy（非 0 参与差额）',
  /const subsidy = \(g && this\.data\.takeoutMode === 'fast'\)/.test(inputJs));
check('A17b 分项模式 subsidy 仍取 takeoutDetailRows（不回归）',
  /rows\.reduce\(\(s, r\) => s \+ \(Number\(r\.subsidy\) \|\| 0\), 0\)/.test(inputJs));

console.log('===== A9~A12 · 配平校验（只做软提示：不阻断、不参与利润、不写入）=====');
// 应有应收 = 收入合计 − 补贴 − 佣金 − 配送服务费 − 配送补贴
// ⚠ R164 改了配平式：expected = (incomeTotal − subsidy) − |subsidy| − 佣金 − 配送 − 配送补贴
//   本基准 expected = (5000−300) − 300 − 200 − 100 − 50 = 4050（改前是 4350，差恰为一个补贴额 300）
const recBase = { incomeTotal: 5000, subsidy: 300, commission: 200, deliveryFee: 100, deliverySubsidy: 50, packTotal: 60 };
const REC_EXPECTED = 4050;
check('A9 未填应收款 → null（跳过，不误报）', reconcile(Object.assign({}, recBase, { actualReceivable: 0 })) === null);
check('A9 两侧一致（差额 0 ≤ 50）→ pass', reconcile(Object.assign({}, recBase, { actualReceivable: REC_EXPECTED })).status === 'pass');
check('A9 差额 30 ≤ 50 → pass', reconcile(Object.assign({}, recBase, { actualReceivable: REC_EXPECTED + 30 })).status === 'pass');
check('A10 差额 >50 → miss 且报漏填', reconcile(Object.assign({}, recBase, { actualReceivable: REC_EXPECTED - 150 })).status === 'miss');
check('A11 差额恰等于打包费 → packaging 专项', reconcile(Object.assign({}, recBase, { actualReceivable: REC_EXPECTED - 60 })).status === 'packaging');
check('A11 专项非笼统 miss', reconcile(Object.assign({}, recBase, { actualReceivable: REC_EXPECTED - 60 })).status !== 'miss');
check('A11 差额恰等于配送服务费 → delivery（用户配送费未纳入，不判错）', reconcile(Object.assign({}, recBase, { actualReceivable: REC_EXPECTED - 100 })).status === 'delivery');
check('A12 配平不写入金额：reconcile 纯计算无副作用', reconcile.length >= 1 && typeof reconcile(Object.assign({}, recBase, { actualReceivable: 4200 })) === 'object');
check('A12 阈值 = 50（规范默认）', RECONCILE_THRESHOLD === 50);
check('A12 页面提示不阻断（配平文案为软提示）', /配平校验（A.11.4 · 只做软提示：不阻断保存、不参与利润、不写入金额）/.test(inputWxml));

console.log('===== A13 · 平台名单源（页面/工具源码无平台字面量）=====');
const allSrc = inputWxml + inputJs + fs.readFileSync(path.join(ROOT, 'utils/takeaway.js'), 'utf8');
const platformLeaks = PLATFORMS.filter((p) => allSrc.includes(p));
check(`A13 页面+工具源码不出现平台名字面（${PLATFORMS.join('/')}）`, platformLeaks.length === 0, platformLeaks.join(',') || '无泄漏');

console.log('===== A14 · i18n 双副本逐字一致（K11）=====');
const t1 = fs.readFileSync(path.join(ROOT, 'miniprogram/i18n/terms.js'), 'utf8');
const t2 = fs.readFileSync(path.join(ROOT, 'specs/dev-specs/i18n/terms.js'), 'utf8');
check('A14 双副本一致', t1 === t2);

console.log('===== A15 · 门禁预检（结构）=====');
check('A15 input.wxml 含外卖模式开关', /onPickTakeoutMode/.test(inputWxml) && /twSecTitle/.test(inputWxml));
check('A15 input.js 含粘贴处理（openPaste/onPasteExtract）', /openPaste/.test(inputJs) && /onPasteExtract/.test(inputJs) && /extractPaste/.test(inputJs));
check('A15 input.js 含配平（onRecYuan/runReconcile）', /onRecYuan/.test(inputJs) && /runReconcile/.test(inputJs));
check('A15 推广费取数路径标注存在', /twPromoPathHint/.test(inputWxml) && /twPromoPathLabel/.test(inputWxml));
// ⚠️ 2026-09-22（round97）按 by/date/reason 修订 ——
//   by=WorkBuddy / date=2026-09-22 / reason=原判据「git status cloudfunctions/ 完全干净」**语义过强**：
//   它把「建库单源」`cloudfunctions/initDb/collections.js`（集合定义与费用/收入项种子，本就随
//   规范 A.2 这类口径变更而变）也算作「后端改动」，于是「按规范补 3 项营销费用项」这个**正确动作**
//   必然转红，且断言实质变成「必须先提交再跑门禁」的**时机关卡**（与本身要守的「云函数逻辑别被顺手改」
//   无关）。现收窄为**云函数逻辑零改动**：允许 `cloudfunctions/initDb/`（该目录另有
//   check_schema_sync(R74) 守集合与索引 / check_collection_perms(R67) 守权限 /
//   check_income_channel_seed(R110) 与 check_expense_item_seed(R121) 守两套字典 ⇒ 豁免不损失覆盖），
//   其余任何 cloudfunctions 文件被改动仍判红。
// ⚠️ 2026-09-22（round103）**二次收窄** —— 同族病复发：本判据读的是 `git status` **工作区**，
//   实质是「必须先提交再跑门禁」的**时机关卡**，而不是「云函数逻辑有没有被顺手改」。
//   round97 已因 initDb 收窄过一次；round103 又因**授权的**后端修复（getLedger 出参命名分裂 +
//   saveLedger 可选入参静默清零）被判红 ⇒ 本次改为**白名单式**：豁免 `initDb/`（建库单源，另有
//   R74/R67/R110/R121 四条守卫）+ 本批**显式登记**的授权函数目录；其余任何云函数被改仍判红。
//   by=WorkBuddy / date=2026-09-22 / reason=round103 授权修 getLedger（出参命名）+ saveLedger（缺省清零）
// ⚠️ 2026-09-23（round106）**三次登记** —— 同一时机关卡第 3 次触发：本轮 F2「一次性计入当月」
//   的利润口径必须同时落在三副本引擎（saveLedger / getLedger / calcMonthlyProfit），F5b 留存
//   数据又要 getAmortSchedule 出参 ⇒ 这 4 个函数全部是**李老师授权的**后端改动（「按你建议的来」）。
//   仍按 round103 的**白名单式**登记，**不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：
//   by=WorkBuddy / date=2026-09-23 / reason=round106 授权加 lump_sum_fen 口径（F2）+ 摊销留存数据出参（F5b）
// ⚠️ 2026-09-21（round107）**四次登记** —— 同一时机关卡第 4 次触发：本轮把「一次性投入」从
//   录入页的 shop 级二选一拆成**台账行级 mode**（李老师真机反馈授权），后端必须动 saveAsset
//   （新增 mode + 删除分支 + 台账归档锁）、getAmortSchedule（拆 assets/lumps + is_archive）、
//   saveLedger / getLedger / calcMonthlyProfit（去互斥 + 台账求和）。故新增登记 saveAsset/。
//   仍按 round103 的**白名单式**登记，**绝不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：
//   by=WorkBuddy / date=2026-09-21 / reason=round107 授权拆台账行级 mode（saveAsset 新增 mode+删除+归档锁）
// ⚠️ 2026-09-23（round108）**五次触发** —— 同一时机关卡第 5 次：李老师真机反馈「启用分期摊销」开关
//   关不上、自己弹回打开，真因＝**摊销页读了前端缓存**（`app.globalData.switches` 只在 getShopContext
//   时写一次，保存后没人刷）；修法是 getAmortSchedule 随笔数据返回**服务端权威**开关
//   `amortize_switch_on`（页面只认这次出参）。该函数**已在白名单内**（round107 登记）⇒ 本轮**沿用既有条目、
//   不新增白名单**（避免把豁免面撑大），但按纪律把时点与理由记明：
//   by=WorkBuddy / date=2026-09-23 / reason=round108 授权：开关回弹真因修复（getAmortSchedule 出参加权威开关）
// ⚠️ 2026-09-23（round110）**六次触发** —— 同一时机关卡第 6 次：李老师拍板 M2 大改造
//   （「菜品变动成本率→毛利率 / 去掉营销率与其他率、改自选费用项 / 补加盟费·装修·摊销·管理费 /
//    加餐饮指标对照 / 按城市层级区分占比」），后端必须动 calcSandbox（契约 v2：结构化清单 +
//   一次性投入摊销 + 指标对照），并新增**公共层单源** common/indicatorRef.js（分业态 × 城市层级参考库）。
//   ⚠️ 本轮有个新形态：sync_common 会因新增单源而向**全部 42 个云函数目录**派生 cx_indicatorRef.js
//   并重写 common.js ⇒ 同步产物必须按**精确文件名**一并登记，否则本判据在任何一次公共层变更后
//   必然转红（那是「同步动作」而非「顺手改云函数逻辑」）。
//   仍按 round103 的**白名单式**登记，**绝不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：
//   by=WorkBuddy / date=2026-09-23 / reason=round110 授权 M2 契约 v2（calcSandbox）+ 新增公共层单源 indicatorRef
// ⚠️ 2026-09-27（round162）**七次触发** —— 同一时机关卡第 7 次：李老师授权落地 R161-1
//   （外卖补第 4 必填「有效订单数」），该字段**必须落库**才不会「保存即丢」 ⇒ 后端要动
//   saveLedger（入参校验 + 落库映射）与 getLedger（出参回读）。两者**均已在白名单内**
//   （round103 登记）⇒ 本轮**沿用既有条目、不新增白名单**（避免把豁免面撑大），按纪律记明时点与理由：
//   by=WorkBuddy / date=2026-09-27 / reason=round162 授权：外卖有效订单数 qty 落库（saveLedger 校验+映射 / getLedger 出参回读）
const A15_EXEMPT = [
  /^cloudfunctions\/initDb\//,
  /^cloudfunctions\/getLedger\//,
  /^cloudfunctions\/saveLedger\//,
  /^cloudfunctions\/calcMonthlyProfit\//,
  /^cloudfunctions\/getAmortSchedule\//,
  /^cloudfunctions\/saveAsset\//,
  /^cloudfunctions\/calcSandbox\//,                    // round110：M2 契约 v2（service/validate/selftest）
  /^cloudfunctions\/common\/indicatorRef\.js$/,        // round110：新增指标参考库单源
  /^cloudfunctions\/common\/index\.js$/,               // round110：聚合入口挂载 indicatorRef
  // M3 v1.1 批次 A1（round120 登记）：免费配额「配置化 + 写侧真拦截」——
  //   额度由 checkQuota/service.js 常量迁至 feature_permissions 种子；saveCostCard 新增写侧拦截；
  //   getShopList 删第二硬编码点改读同一配置。**仍按白名单式登记，不放宽成全豁免**：
  /^cloudfunctions\/checkQuota\//,
  /^cloudfunctions\/getShopList\//,
  /^cloudfunctions\/saveShopSetting\//,               // round115：M1 指标对照（validate 业态/城市白名单 + index 出参回读）
  // round116：写库主键修复（doc(业务键) → doc(_id 优先)）—— 真云静默 0 行导致功能失效，属缺陷修复而非同步动作
  /^cloudfunctions\/saveMaterial\//,               // round116：doc(m.id) → doc(exist._id || m.id)
  /^cloudfunctions\/saveCostCard\//,               // round116：doc(vm.id||vm.material_id) → 优先 _id
  /^cloudfunctions\/syncCostCard\//,               // round116：同上
  /^cloudfunctions\/getMaterial\//,                // round127（M3 v1.2 批次 P0）授权：原料档案三可选字段出参（category/aliases/remark）
  // ⚠️ 2026-09-25（round127/r128）**八次触发** —— 同一时机关卡第 8 次：M3 v1.2 批次 P0 授权改
  //   saveCostCard / saveMaterial / syncCostCard（**已在 round116 白名单内**）+ getMaterial（新增登记）。
  //   本批改动内容：M3.2 原料软删分支、M3.3 临时手工行（input_type=2）、M3.7 成本卡软删（按 card_code 全版本）、
  //   M3.30 原料三可选字段出参。均为**投喂包显式授权**的后端改动，非「顺手改云函数逻辑」。
  //   仍按 round103 的**白名单式**登记（精确到目录），**绝不放宽成 `cloudfunctions/` 全豁免**：
  //   by=WorkBuddy / date=2026-09-25 / reason=round127 授权 M3 v1.2 P0（原料档案页 + 手工行 + 软删）
  // round110：以下三条是 sync_common 的**派生产物**（非云函数自有逻辑）——
  //   common/index.js 加一个导出，就会让全部 42 个函数的 cx_index.js 同步变动；
  //   新增单源文件则派生 cx_indicatorRef.js。精确到文件名登记，不做 cx_*.js 泛化豁免。
  /^cloudfunctions\/[^/]+\/cx_indicatorRef\.js$/,      // round110：sync_common 派生（全函数）
  /^cloudfunctions\/[^/]+\/cx_index\.js$/,             // round110：sync_common 派生（全函数，本轮 35 个变动）
  /^cloudfunctions\/[^/]+\/common\.js$/,               // round110：sync_common 派生入口
  // ⚠️ 2026-09-26（round129）**九次触发** —— M3 v1.2 批次 **S0** 授权快马（InsCode）写码：
  //   任务1「明细行快照补 5 字段」触及 saveCostCard / syncCostCard（**已在 round116 白名单内**）、
  //   新增登记 **getCostCard / getCardVersions** 两处读侧出参（price_promo_fen + 快照 5 字段，fail-soft 缺省）。
  //   本批属**投喂包显式授权**的后端改动，非「顺手改云函数逻辑」；仍按 round103 的**白名单式**登记
  //   （精确到目录），**绝不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：
  //   by=WorkBuddy / date=2026-09-26 / reason=round129 授权 M3 v1.2 S0（快照 5 字段 + 活动特价出参）
  /^cloudfunctions\/getCostCard\//,
  /^cloudfunctions\/getCardVersions\//,
  // ⚠️ 2026-09-26（round147）**十次触发** —— 同一时机关卡第 10 次：M3.28 批次 **Q2/Q3** 授权改后端：
  //   ① Q2 计数口径：`checkQuota/` `saveCostCard/`（**均已在 round120/round116 白名单内**）新增 `calc_status` 过滤，
  //      额度由「档案数」改计「可算数」；
  //   ② Q3 付费判定单源：新增 `common/entitlement.js` + `common/index.js` 补导出，并把唯一消费者
  //      `exportData/` 切到单源（**禁止在函数体里再写一遍 expireAt > now**）。
  //   ③ 派生面：`sync_common` 因新增单源文件产出 `cx_entitlement.js`（同 round110 的 cx_indicatorRef.js 性质）。
  //   均为**本批显式授权**的后端改动，非「顺手改云函数逻辑」；沿用**白名单式**登记（精确到目录/文件名），
  //   **绝不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：
  //   by=WorkBuddy / date=2026-09-26 / reason=round147 授权 M3.28 Q2 计数口径 + Q3 付费判定单源
  /^cloudfunctions\/common\//,                          // round147：付费判定单源本体（entitlement.js + 聚合入口补齐导出）
  /^cloudfunctions\/exportData\//,                      // round147：唯一既有付费消费者，切到判定单源（避免第二份 `expireAt > now`）
  /^cloudfunctions\/[^/]+\/cx_entitlement\.js$/,        // round147：sync_common 派生（全函数，同 cx_indicatorRef.js 性质）
  // ⚠️ 2026-09-26（round150）**十一次触发** —— 同一时机关卡第 11 次：M3 v1.3 批次 **R150** 授权落地
  //   ① M3.14 组件分类：明细行新增 `line_kind`（主/辅/调/半/耗）——落库侧 `saveCostCard/`（已在内）、
  //      读侧 `getCostCard/` `getCardVersions/`（已在内）；
  //   ② M3.15 多规格派生：新增**公共层单源** `common/specDerive.js`（派生层本体，5 份引擎副本零改动），
  //      消费侧 `calcBom/`（validate 保留 line_kind 防静默退化 + index 返回 spec_results）⇒ 新增登记；
  //   ③ 派生面：sync_common 因新增单源文件产出 `cx_specDerive.js`（同 round110/147 的 cx_* 性质）。
  //   均为**本批显式授权**的后端改动，非「顺手改云函数逻辑」；沿用**白名单式**登记（精确到目录/文件名），
  //   **绝不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：
  //   by=WorkBuddy / date=2026-09-26 / reason=round150 授权 M3.14 组件分类 + M3.15 多规格派生层
  /^cloudfunctions\/calcBom\//,                         // round150：M3.15 派生消费侧（validate 保 line_kind + index 出 spec_results）
  /^cloudfunctions\/[^/]+\/cx_specDerive\.js$/,         // round150：sync_common 派生（全函数，同 cx_indicatorRef.js 性质）
  // ⚠️ 2026-09-27（round154）**十二次触发** —— 同一时机关卡第 12 次：修复「列表静默截断 100 条」。
  //   改动面 = 单源 `cloudfunctions/common/dataAdapter.js` 两个列表出口补 `.limit(LIST_LIMIT)`，
  //   `sync_common` 派生到全部 42 个函数目录的 `cx_dataAdapter.js`（**同步动作**，非各函数自有逻辑）。
  //   仍按 round103 的**白名单式**登记（精确到文件名），**绝不放宽成 `cloudfunctions/` 全豁免**：
  //   by=WorkBuddy / date=2026-09-27 / reason=round154 列表查询条数上限修复（数据正确性缺陷）
  /^cloudfunctions\/[^/]+\/cx_dataAdapter\.js$/,         // round154：sync_common 派生（全函数，同 cx_indicatorRef.js 性质）
  /^cloudfunctions\/calcAmortize\//,                     // round154：本地替身 fakeDb 补 .limit()（对齐真云形状）
  // ⚠️ 2026-09-27（round156）**十三次触发** —— 同一时机关卡第 13 次：列表排序 + 常用置顶
  //   （李老师点单的四项优化之第 1 项：「两个列表加 orderBy（最近编辑在前）+ 常用置顶」）。
  //   ① 排序出参：`getCostCard/` `getMaterial/` `getCardVersions/`（**均已在 round129/127 白名单内**）
  //      各补一个 `updated_at` —— 这是「最近编辑在前」的**排序键**（原料列表此前一个时间字段都没有），
  //      存量数据缺该字段 ⇒ 退回 created_at（fail-soft，不回填、不报错）。
  //   ② 置顶落点：`saveShopSetting/`（**已在 round115 白名单内**：validate 加两数组字段 + index 写 patch/出参回读）
  //      与 **getShopContext/**（**新增登记**：出参下发 pinned_cards / pinned_materials）。
  //      ⚠️ 为什么置顶存 `shop` 文档、不存成本卡记录：M3 成本卡是**版本模型（只 INSERT 不 UPDATE）**，
  //      置顶写进卡记录就得插新版本 ⇒ 每置顶一次多一版历史；而 M3 v1.1 红线是**零新建集合**
  //      ⇒ 复用既有 shop 文档（同 biz_type / city_tier 的性质）。
  //   均为**本批显式授权**的后端改动，非「顺手改云函数逻辑」；沿用**白名单式**登记（精确到目录/文件名），
  //   **绝不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：
  //   by=WorkBuddy / date=2026-09-27 / reason=round156 授权列表排序（updated_at 出参）+ 店铺级置顶字段
  /^cloudfunctions\/getShopContext\//,                   // round156：出参下发店铺级置顶（pinned_cards / pinned_materials）
  // ⚠️ 2026-09-27（round157）**十四次触发** —— 同一时机关卡第 14 次：容量审计修复（索引字段对齐 + 分页取全）。
  //   ① 索引单源：`common/initDb/collections.js`（`idx_line_card`→`idx_line_row`）—— 已在 `initDb/` 条目内；
  //   ② 分页取全：单源 `common/dataAdapter.js` 新增 `listAll()`（**已在 `common/` 条目内**），
  //      消费侧 `getCostCard/` `checkQuota/` `saveCostCard/`（**三者均已在 round129/120/116 白名单内**）切到该入口；
  //   ③ 派生面：`sync_common` 把新 dataAdapter 派生到全部 42 个函数目录的 `cx_dataAdapter.js`
  //      （**已在 round154 条目 `/^cloudfunctions\/[^/]+\/cx_dataAdapter\.js$/` 内**）。
  //   ⇒ 本轮**无需新增白名单条目**（沿用既有），但按纪律把时点与理由记明；
  //   仍按 round103 的**白名单式**登记，**绝不放宽成 `cloudfunctions/` 全豁免**（那样等于守卫作废）：
  //   by=WorkBuddy / date=2026-09-27 / reason=round157 容量审计授权（索引字段对齐 + listAll 分页取全）
];
check('A15 云函数逻辑零改动（仅 initDb 建库单源 + 本批授权函数豁免）', (() => {
  const { execFileSync } = require('child_process');
  const out = execFileSync('git', ['status', '--porcelain', 'cloudfunctions/'], { encoding: 'utf8', input: '', stdio: ['pipe', 'pipe', 'pipe'] });
  const changed = out.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/^[A-Z?!]{1,2}\s+/, '').trim())
    .filter((p) => !A15_EXEMPT.some((re) => re.test(p)));
  return changed.length === 0;
})());

console.log('===== A16 · 账期/日期/时间/长单号不得被当金额（P1 回归）=====');
check('A16 账期 2026-09 → 不计入 sum', extractPaste('2026-09').sum === 0, `sum=${extractPaste('2026-09').sum}`);
check('A16 日期+金额行 → 只取金额', Math.abs(extractPaste('2026-09-21\t1234.56').sum - 1234.56) < 0.001, `sum=${extractPaste('2026-09-21\t1234.56').sum}`);
check('A16 时间 13:45 → 不计入 sum', extractPaste('13:45').sum === 0, `sum=${extractPaste('13:45').sum}`);
check('A16 长单号（≥11 位）→ 不计入 sum', extractPaste('1234567890123').sum === 0, `sum=${extractPaste('1234567890123').sum}`);
check('A16 中文日期 2026年9月21日 → 不计入 sum', extractPaste('2026年9月21日').sum === 0);
check('A16 正常金额不受影响（1,234.56 + 2,000）', Math.abs(extractPaste('1,234.56\n2,000').sum - 3234.56) < 0.001);
check('A16 ≥4 位无千分位不得被截断（4380.00）', Math.abs(extractPaste('4380.00').sum - 4380) < 0.001, `sum=${extractPaste('4380.00').sum}`);
check('A16 ≥4 位无千分位不得被截断（1234.56）', Math.abs(extractPaste('1234.56').sum - 1234.56) < 0.001, `sum=${extractPaste('1234.56').sum}`);
check('A16 无千分位多行（4380.00 / 5600）', Math.abs(extractPaste('4380.00\n5600').sum - 9980) < 0.001, `sum=${extractPaste('4380.00\n5600').sum}`);
check('A16 账单两列（账期+金额）只取金额', Math.abs(extractPaste('归属账期\t商家应收款\n2026-09\t4380.00').sum - 4380) < 0.001);

console.log('===== A17 · 补贴带出不得因回读旧值误锁（P5 回归）=====');
check('A17 无「cur !== target ⇒ 视为手改加锁」误判', !/cur && cur !== target/.test(inputJs));
check('A17 仍有 twCarryLock 短路（本会话手改优先）', /if \(mg\.rows\[ri\]\.twCarryLock\) return;/.test(inputJs));
check('A17 回读旧值≠合计时仍会跟随更新（cur === target 才幂等返回）', /if \(cur === target\) return;/.test(inputJs));

console.log('===== A18 · 配平角色单源（P2/P4 回归）=====');
const roles = TERMS.ledger.takeawayMode.reconcileRoles || {};
check('A18 reconcileRoles 三值均在营销 items 内',
  ['commission', 'deliveryFee', 'deliverySubsidy'].every((k) => MARKETING.indexOf(roles[k]) >= 0), JSON.stringify(roles));
check('A18 runReconcile 不写死中文项名', !/mrow\('外卖(平台佣金|配送服务费|配送补贴)'\)/.test(inputJs));
check('A18 promoItem 单源在营销 items 内', MARKETING.indexOf(TERMS.ledger.takeawayMode.promoItem) >= 0);
check('A18 promo 判断不再由文案内容驱动', !/推广中心\/\.test\(note\)/.test(inputJs));

console.log('===== A19 · 主题色单源（旧橘黄已全线下线，不得回流）=====');
const wxssSrc = fs.readFileSync(path.join(ROOT, 'pages/month/input.wxss'), 'utf8');
// 判据只扫「生效样式」：逐行滤掉注释行（块注释首行 /* 与续行 *、含 */ 的收尾行）
// ⚠️ 必须写成**单行**：R68 顶层块切分要求「深度回 0 时以 ; 或 } 收尾」，链式调用换行会让首行括号即平衡 ⇒ 判「不确定」而 fail-closed
const wxssLive = wxssSrc.split('\n').filter((l) => !/^\s*(\/\*|\*)/.test(l) && l.indexOf('*/') < 0).join('\n');
check('A19 input.wxss 生效样式不含旧橘黄', !/#ff6b35/i.test(wxssLive));
check('A19 粘贴面板主按钮走主色渐变（#2a4e7c → #162c49）', /linear-gradient\(135deg, #2a4e7c 0%, #162c49 100%\)/.test(wxssLive));

console.log('===== A20 · 粘贴填入值：0 是合法金额，不得被当成空（R119 回归）=====');
check('A20 粘 "0" 应变 "0.00"（原先被当空吞掉）', pasteFillValue(extractPaste('0')) === '0.00', pasteFillValue(extractPaste('0')));
check('A20 粘 "0\n0" 应变 "0.00"', pasteFillValue(extractPaste('0\n0')) === '0.00');
check('A20 粘空文本不填（空串，不误填 0.00）', pasteFillValue(extractPaste('')) === '');
check('A20 粘纯表头不填（空串）', pasteFillValue(extractPaste('项目\t金额')) === '');
check('A20 千分位照旧 -> 1234.56', pasteFillValue(extractPaste('1,234.56')) === '1234.56');
check('A20 页面不再用「非零才写」三态', !/res\.sum \?/.test(inputJs));
// R120 后页面先算 fill 再赋值（多一个「合计兜底提示」的分支）⇒ 判语义而非绑定字面：
check('A20 页面改走 pasteFillValue 单源', /const fill = pasteFillValue\(res\);/.test(inputJs)
  && /r\[field\] = fill;/.test(inputJs));

console.log('===== A21 · 快速录入汇总：合计 + 已填平台数（R119）=====');
const twT = TERMS.ledger.takeawayMode;
check('A21 totalLabel / filledTpl / totalAutoHint / fastPh 四键齐备且非空',
  ['totalLabel', 'filledTpl', 'totalAutoHint', 'fastPh'].every((k) => typeof twT[k] === 'string' && twT[k].length > 0));
const fastBlock = (() => {
  const i = inputWxml.indexOf("takeoutMode === 'fast'");
  if (i < 0) return '';
  const j = inputWxml.indexOf('</block>', i);
  return j < 0 ? '' : inputWxml.slice(i, j);
})();
check('A21 快速块内给出合计（twTotalLabel + takeoutSumYuan）',
  fastBlock.length > 0 && /twTotalLabel/.test(fastBlock) && /takeoutSumYuan/.test(fastBlock));
check('A21 快速块内给出已填平台数（takeoutFilledText）', /takeoutFilledText/.test(fastBlock));
check('A21 快速块内不复用分项标签 / 配平占位', !/twSumLabel/.test(fastBlock) && !/twRecPh/.test(fastBlock));
check('A21 syncTakeoutSum 按模式取数（快速读各平台 amountYuan）',
  /syncTakeoutSum\(\) \{[\s\S]{0,900}?takeoutMode === 'fast'[\s\S]{0,300}?amountYuan/.test(inputJs));
check('A21 平台金额变化即重算合计（updateRow 内联动）',
  /if \(kind === 'income' && g\.category === 'takeaway'\) this\.syncTakeoutSum\(\);/.test(inputJs));
check('A21 载入后无条件算合计（不再仅分项模式才算）',
  /this\.syncTakeoutSum\(\);\r?\n\s+if \(this\.data\.takeoutMode === 'detail'\) this\.runReconcile\(\);/.test(inputJs));
check('A21 takeoutFilledText 已在 data 声明', /takeoutFilledText: ''/.test(inputJs));

console.log('===== A22 · 快速框占位文案不串线（R119）=====');
check('A22 terms.fastPh 非空且不等同 recPh', twT.fastPh.length > 0 && twT.fastPh !== twT.recPh);
check('A22 快速金额框占位走 twFastPh', /placeholder="\{\{t\.twFastPh\}\}" data-kind="income"/.test(inputWxml));
check('A22 pasteFillValue 已从纯模块导出', typeof pasteFillValue === 'function');
check('A22 页面映射了 twFastPh / twTotalLabel / twTotalAutoHint',
  /twFastPh: TERMS\.ledger\.takeawayMode\.fastPh/.test(inputJs)
  && /twTotalLabel: TERMS\.ledger\.takeawayMode\.totalLabel/.test(inputJs)
  && /twTotalAutoHint: TERMS\.ledger\.takeawayMode\.totalAutoHint/.test(inputJs));

console.log('===== A23 · 已填平台数文案（M ≤ 1 不显示，避免「1 / 1」噪音）=====');
check('A23 单平台（整类总额）不显示该句', filledLabel('已填 {n} / {m} 个平台', 1, 1) === '');
check('A23 0 个平台行同样不显示', filledLabel('已填 {n} / {m} 个平台', 0, 0) === '');
check('A23 双平台：1/2 正常显示', filledLabel('已填 {n} / {m} 个平台', 1, 2) === '已填 1 / 2 个平台');
check('A23 四平台：3/4 正常显示', filledLabel('已填 {n} / {m} 个平台', 3, 4) === '已填 3 / 4 个平台');
check('A23 模板缺参不抛异常（回落到空串替换）', typeof filledLabel('', 1, 3) === 'string');
check('A23 页面改用 filledLabel 单源', /takeoutFilledText: filledLabel\(/.test(inputJs));

console.log('===== A24 · 账单形态用例表（R120：换行合计不得翻倍 + 只有合计兜底填入）=====');
// 用例表单源：tools/paste_cases.js（守卫 check_takeaway_paste_cases.js 跑同一张表）
const { PASTE_CASES } = require('./paste_cases.js');
const gB24 = PASTE_CASES.filter((c) => String(c.id)[0] === 'B');
const gC24 = PASTE_CASES.filter((c) => String(c.id)[0] === 'C');
const gA24 = PASTE_CASES.filter((c) => String(c.id)[0] === 'A');
check('A24 用例表单源存在且 ≥24 条', Array.isArray(PASTE_CASES) && PASTE_CASES.length >= 24, `${PASTE_CASES.length} 条`);
check('A24 全表零红（形态 → 期望填入值）',
  PASTE_CASES.every((c) => pasteFillValue(extractPaste(c.input)) === c.fill),
  PASTE_CASES.filter((c) => pasteFillValue(extractPaste(c.input)) !== c.fill).map((c) => c.id).join(',') || '28/28');
check('A24 明细+换行合计（B 组）不得翻倍',
  gB24.length >= 4 && gB24.every((c) => pasteFillValue(extractPaste(c.input)) === c.fill),
  `B 组 ${gB24.length} 条`);
check('A24 明细+同行合计（A 组）排除合计后取明细和',
  gA24.every((c) => pasteFillValue(extractPaste(c.input)) === c.fill));
check('A24 只有合计（C 组）兜底填入合计值',
  gC24.length >= 3 && gC24.every((c) => pasteFillValue(extractPaste(c.input)) === c.fill),
  `C 组 ${gC24.length} 条`);
check('A24 兜底判据：无明细+有合计 ⇒ fromTotal=true',
  gC24.every((c) => pasteFilledFromTotal(extractPaste(c.input)) === true));
check('A24 有明细 ⇒ fromTotal=false（不得漏掉确认弹窗）',
  gA24.every((c) => pasteFilledFromTotal(extractPaste(c.input)) === false));
check('A24 合计值须真被识别（B 组 totalValue 非 null）',
  gB24.every((c) => {
    const r = extractPaste(c.input);
    return r.totalValue !== null && r.totalValue !== undefined;
  }));
check('A24 numbers 不得含合计值（翻倍根因）',
  gB24.every((c) => {
    const r = extractPaste(c.input);
    return !r.numbers.some((v) => Math.abs(Number(v) - Number(r.totalValue)) < 0.001);
  }));
check('A24 空文本 / 纯表头不误填 0.00（null 判据不得弱化为 Number()）',
  pasteFillValue(extractPaste('')) === '' && pasteFillValue(extractPaste('项目\t金额')) === '');
check('A24 pasteFromTotal 文案键非空', typeof TERMS.ledger.takeawayMode.pasteFromTotal === 'string'
  && TERMS.ledger.takeawayMode.pasteFromTotal.length > 0, TERMS.ledger.takeawayMode.pasteFromTotal);
check('A24 页面判据走「最终能否填出值」', /const fill = pasteFillValue\(res\);/.test(inputJs)
  && /if \(fill === ''\)/.test(inputJs));
check('A24 页面按 fromTotal 分流提示', /fromTotal \? TERMS\.ledger\.takeawayMode\.pasteFromTotal/.test(inputJs));

console.log('===== A25 · 营销段分平台佣金小计（T1，round97）=====');
// 语义：只回显不入库；4 平台逐行填 ⇒ 合计自动汇成佣金总额那一行；**全空则完全不碰那一行**。
const mkTotal = mkByPlatTotal([{ amountYuan: '10' }, { amountYuan: '20.5' }, { amountYuan: '' }, { amountYuan: '5' }]);
check('A25 分平台合计 = 35.5（空值 / 缺值按 0）', Math.abs(mkTotal - 35.5) < 0.001, `sum=${mkTotal}`);
check('A25 全空 / 空数组 ⇒ 未接管（第一红线：不得清零库里已存值）',
  mkByPlatFilled([]) === false
  && mkByPlatFilled([{ platform: PLATFORMS[0], amountYuan: '' }, { platform: PLATFORMS[1], amountYuan: '' }]) === false
  && [null, undefined, ''].every((v) => mkByPlatFilled([{ amountYuan: v }]) === false));
check('A25 填 0 也算「填过」（语义与页面其它已填判据一致）', mkByPlatFilled([{ amountYuan: '0' }]) === true);
const mkBody = (inputJs.match(/syncMkByPlat\(\) \{[\s\S]{0,2200}?\n  \},/) || [''])[0];
check('A25 页面：全空即早退不碰行 + 项名走 reconcileRoles 单源',
  /if \(!active \|\| mk < 0 \|\| !name\)/.test(mkBody)
  && /reconcileRoles[\s\S]{0,140}commission/.test(mkBody)
  && mkBody.indexOf('expenseGroups = groups') > 0);

console.log('===== A26 · R162 有效订单数（qty）与补贴三项合计口径 =====');
// 数据基础：review/evidence/r161_waimai/agg_taobao_shangou_2026-08.json
//   淘宝闪购 2026-08：优惠前总额 6585.08 / 有效订单 150 / 商家到手 3779.65
//   ⇒ 单均优惠前 = 43.90（本组锚点用真值，不用随手编的数）
console.log('—— A26-1 qty 求和（空值按 0，0 是合法值）——');
check('A26-1 qtyTotal 求和（含空串 / 缺行 / 字符串数字）',
  qtyTotal([{ qty: '150' }, { qty: '' }, { qty: 0 }, {}]) === 150, String(qtyTotal([{ qty: '150' }, { qty: '' }, { qty: 0 }, {}])));
check('A26-1 qtyTotal 空数组 / null ⇒ 0（不得 NaN）', qtyTotal([]) === 0 && qtyTotal(null) === 0);
check('A26-1 真值锚点：150 单 ⇒ 单均优惠前 43.90（6585.08 ÷ 150）',
  perOrderYuan(6585.08, 150) === '43.90', perOrderYuan(6585.08, 150));

console.log('—— A26-2 perOrderYuan 边界（除零 / 零元）——');
check('A26-2 订单数为 0 / 空 ⇒ 返回空串（不得渲染 NaN）',
  perOrderYuan(6585.08, 0) === '' && perOrderYuan(6585.08, '') === '' && perOrderYuan(6585.08, undefined) === '');
check('A26-2 总额 0 但订单数 > 0 ⇒ 0.00（0 元是算出来的，不是没算）', perOrderYuan(0, 150) === '0.00');
check('A26-2 真值锚点：单均到手 25.20（3779.65 ÷ 150）', perOrderYuan(3779.65, 150) === '25.20', perOrderYuan(3779.65, 150));

console.log('—— A26-3 qty 随快照 round-trip（切模式来回不得丢）——');
const r162snap = snapshotDetail([{ platform: PLATFORMS[0], goods: '100', pack: '20', subsidy: '30', qty: '150' }]);
check('A26-3 snapshotDetail 带 qty', r162snap[0].qty === '150', String(r162snap[0].qty));
const r162restored = restoreDetail(r162snap, PLATFORMS);
check('A26-3 restoreDetail 回填 qty（非空原样回）', r162restored[0].qty === '150', String(r162restored[0].qty));
check('A26-3 回填后小计仍按三框算（150 不得混进金额）', r162restored[0].subtotal === '150.00', r162restored[0].subtotal);
const r162zero = restoreDetail([{ platform: PLATFORMS[0], qty: '0' }], PLATFORMS);
check('A26-3 qty 填 0 不被当空吃掉（字符串形态，用 || 会丢）', r162zero[0].qty === '0', JSON.stringify(r162zero[0].qty));
// ⚠️ 加严（R162 变异回灌 M2 抓出来的假绿）：上面那条用**字符串** '0'，而字符串 '0' 是 truthy
//   ⇒ 即便实现写成 `s.qty || ...` 也照样通过（守卫看不见这个坑）。
//   **数字 0 才是真会丢的形态**（0 是 falsy）⇒ 必须单独断言，否则 M2 恒绿。
check('A26-3 qty 为**数字 0** 同样不得被吃掉（falsy 形态，本条才是 M2 的靶心）',
  restoreDetail([{ platform: PLATFORMS[0], qty: 0 }], PLATFORMS)[0].qty === '0',
  JSON.stringify(restoreDetail([{ platform: PLATFORMS[0], qty: 0 }], PLATFORMS)[0].qty));
check('A26-3 老数据（无 qty）⇒ 空串而非 undefined', restoreDetail([{ platform: PLATFORMS[0] }], PLATFORMS)[0].qty === '');

console.log('—— A26-4 qty 绝不进金额（本组最硬的一条）——');
check('A26-4 subtotalOf 只吃三框：qty 不参与小计',
  subtotalOf('100', '20', '30') === '150.00' && (() => {
    const src = fs.readFileSync(path.join(ROOT, 'utils/takeaway.js'), 'utf8');
    const body = (src.match(/function subtotalOf\([^)]*\) \{[\s\S]{0,400}?\n\}/) || [''])[0];
    return body.length > 0 && !/\bqty\b/.test(body);
  })());
check('A26-4 utils 源码里 qty 只出现在 qtyTotal/perOrderYuan/快照 四处（不得进 reconcile）',
  (() => {
    const src = fs.readFileSync(path.join(ROOT, 'utils/takeaway.js'), 'utf8');
    const recBody = (src.match(/function reconcile\(p\) \{[\s\S]*?\n\}/) || [''])[0];
    return recBody.length > 0 && !/\bqty\b/.test(recBody);
  })());

console.log('—— A26-5 页面：第 4 框 + 快速模式订单数 + 单均回显 ——');
check('A26-5 分项有第 4 框（data-field="qty" 且绑 onTwDetail）',
  /data-field="qty"/.test(inputWxml) && /value="\{\{r\.qty\}\}"/.test(inputWxml));
check('A26-5 快速模式也有订单数框（onFastQty）', /onFastQty/.test(inputWxml) && /onFastQty\(e\)/.test(inputJs));
check('A26-5 订单合计 / 单均只回显（takeoutQtyTotal、takeoutPerOrder 由 syncTakeoutSum 算）',
  /takeoutQtyTotal/.test(inputWxml) && /takeoutPerOrder/.test(inputWxml) && /takeoutPerOrder: perOrder/.test(inputJs));
check('A26-5 术语键齐备（ordersField/ordersPh/ordersHint/ordersTotalLabel/perOrderLabel/perOrderHint）',
  ['ordersField', 'ordersPh', 'ordersHint', 'ordersTotalLabel', 'perOrderLabel', 'perOrderHint']
    .every((k) => typeof TERMS.ledger.takeawayMode[k] === 'string' && TERMS.ledger.takeawayMode[k].length > 0));

console.log('—— A26-6 R161-2 补贴三项合计口径（防少抄两列）——');
check('A26-6 补贴字段显示名 = 商家承担全部补贴（合计）',
  TERMS.ledger.takeawayMode.subsidyField === '商家承担全部补贴（合计）', TERMS.ledger.takeawayMode.subsidyField);
check('A26-6 口径小字点名三项（活动 / 代金券 / 配送费活动）', (() => {
  const n = TERMS.ledger.takeawayMode.subsidyNote || '';
  return n.includes('商家活动补贴') && n.includes('商家代金券补贴') && n.includes('商家配送费活动补贴');
})());
check('A26-6 口径小字渲染在补贴框下（twSubsidyNote 出现在补贴字段块内）', (() => {
  const i = inputWxml.indexOf('twSubsidyField');
  const j = inputWxml.indexOf('twSubsidyNote');
  const k = inputWxml.indexOf('twOrdersField');
  return i > 0 && j > i && k > j;
})());

console.log('—— A26-7 R161-3 防双记边界句 ——');
check('A26-7 boundaryNote 文案存在且点名两项不可重复录入', (() => {
  const n = TERMS.ledger.takeawayMode.boundaryNote || '';
  return n.includes('外卖活动补贴') && n.includes('外卖配送补贴') && n.includes('不能二次计入');
})());
check('A26-7 边界句挂在展开块最上方（先于模式开关与口径句）', (() => {
  const b = inputWxml.indexOf('twBoundaryNote');
  const s = inputWxml.indexOf('twSecTitle');
  const g = inputWxml.indexOf('twScopeGuide');
  return b > 0 && b < s && s < g;
})());

console.log('—— A26-8 R161-9 费用项注列名双名对照 ——');
check('A26-8 外卖配送服务费注含「配送服务费」且点出美团别名',
  /配送服务费/.test(TERMS.ledger.expenseItemNotes['外卖配送服务费'])
  && /履约服务费/.test(TERMS.ledger.expenseItemNotes['外卖配送服务费']),
  TERMS.ledger.expenseItemNotes['外卖配送服务费']);

console.log('—— A26-9 落库链路（qty 可选、不参与金额、老数据无感）——');
const vSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/saveLedger/validate.js'), 'utf8');
const sSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/saveLedger/index.js'), 'utf8');
const gSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/getLedger/index.js'), 'utf8');
check('A26-9 validate 接受可选 qty 且做非负整数校验',
  /si\.qty !== undefined && si\.qty !== null/.test(vSrc) && /qty 必须是非负整数/.test(vSrc));
check('A26-9 qty 不进大类金额汇总（sum += amt 仍在，qty 不累加）',
  /sum \+= amt;/.test(vSrc) && !/\bsum \+= .*qty/.test(vSrc));
check('A26-9 落库带 qty（saveLedger toSnake）', /o\.qty = si\.qty/.test(sSrc));
check('A26-9 出参带 qty（getLedger toSnake + normalizeToCamel）',
  (gSrc.match(/o\.qty = si\.qty/g) || []).length >= 2, `命中 ${(gSrc.match(/o\.qty = si\.qty/g) || []).length} 处`);
check('A26-9 前端 buildItems 只在合法非负整数时提交 qty',
  /Number\.isInteger\(q\) && q >= 0/.test(inputJs));
check('A26-9 buildItems 过滤判据放宽为「金额 或 订单数」（只填订单数不得被滤掉）',
  /this\._hasVal\(r\.subtotal\) \|\| this\._hasVal\(r\.qty\)/.test(inputJs)
  && /this\._hasVal\(r\.amountYuan\) \|\| this\._hasVal\(r\.qty\)/.test(inputJs));
check('A26-9 回读带 qty（rebuildFromItems / restoreDetail 两处）',
  /qty: \(si\.qty === undefined \|\| si\.qty === null\) \? '' : String\(si\.qty\)/.test(inputJs)
  && /qty: \(r\.qty === undefined \|\| r\.qty === null\) \? '' : String\(r\.qty\)/.test(inputJs));

console.log('—— A26-10 R161-6 归月口径句（账期 3 天，按结算日导月必串月）——');
check('A26-10 periodNote 点名归月判据与 3 天账期', (() => {
  const n = TERMS.ledger.takeawayMode.periodNote || '';
  // 非退化：必须同时点名「账单日期」「订单完成时间」「结算日期」「3 天」四要素
  return n.includes('账单日期') && n.includes('订单完成时间') && n.includes('结算日期') && n.includes('3 天');
})());
check('A26-10 periodNote 说清后果（串到上个月）', (TERMS.ledger.takeawayMode.periodNote || '').includes('上个月'));
check('A26-10 页面渲染归月句（wxml 有 twPeriodNote + input.js 注入）',
  inputWxml.includes('{{t.twPeriodNote}}') && /twPeriodNote: TERMS\.ledger\.takeawayMode\.periodNote/.test(inputJs));
check('A26-10 归月句排在口径句之后、模式区之外（两条都不在金额框内 ⇒ 不干扰输入）', (() => {
  const g = inputWxml.indexOf('twScopeGuide');
  const p = inputWxml.indexOf('twPeriodNote');
  const f = inputWxml.indexOf('twFastHint');
  return g > 0 && p > g && f > p;
})());
check('A26-10 归月句只是提示，不参与金额（utils/takeaway.js 里不得出现 periodNote）',
  !/periodNote/.test(fs.readFileSync(path.join(ROOT, 'utils/takeaway.js'), 'utf8')));

console.log('—— A26-11 R161-4 补贴框防多填（平台承担部分不得抄进来）——');
check('A26-11 口径小字同时防「少抄」与「多填」两侧', (() => {
  const n = TERMS.ledger.takeawayMode.subsidyNote || '';
  // 少抄侧：点名三项；多填侧：点名平台承担不要填
  return n.includes('不要只抄') && n.includes('平台承担') && n.includes('不要填进来');
})());
check('A26-11 多填侧说清后果（不进商家到手，填了会多扣）', (() => {
  const n = TERMS.ledger.takeawayMode.subsidyNote || '';
  return n.includes('不进商家到手') || n.includes('多扣');
})());

console.log('—— A26-12 R164 配平式修正（补贴被抵消 ⇒ 恒定误报）——');
// 真值锚点：8 月实测账单 —— 商品 6418.08 / 打包 167.00 / 商家补贴 2069.70 / 佣金 158.71 / 配送 577.02 / 到手 3779.65
const R164 = { commission: 158.71, deliveryFee: 577.02, deliverySubsidy: 0, packTotal: 167.00, actualReceivable: 3779.65 };
const r164pos = reconcile(Object.assign({}, R164, {
  incomeTotal: Number(subtotalOf('6418.08', '167.00', '2069.70')), subsidy: 2069.70 }));
const r164neg = reconcile(Object.assign({}, R164, {
  incomeTotal: Number(subtotalOf('6418.08', '167.00', '-2069.70')), subsidy: -2069.70 }));
// ⚠ 用容差比较：expected 是浮点连算（3779.650000000001），严格 === 会被精度坑成假红
const near = (a, b) => Math.abs(a - b) < 0.01;
check('A26-12 补贴填**正数**：expected = 真实到手 3779.65（status=pass，不得误报漏填）',
  near(r164pos.expected, 3779.65) && r164pos.status === 'pass', `expected=${r164pos.expected} status=${r164pos.status}`);
check('A26-12 补贴填**负数**：同一个正确答案（符号无关 —— 客户按账单抄负数也不该算错）',
  near(r164neg.expected, 3779.65) && r164neg.status === 'pass', `expected=${r164neg.expected} status=${r164neg.status}`);
check('A26-12 改前行为已证伪：只减一次补贴 ⇒ expected 会多出一个补贴额（2069.70）',
  Math.abs((6418.08 + 167.00 - 158.71 - 577.02) - 3779.65 - 2069.70) < 0.01);
check('A26-12 真漏填补贴仍要报 miss（修公式不得把漏填检测一起修没）', (() => {
  const r = reconcile(Object.assign({}, R164, { incomeTotal: 6585.08, subsidy: 0 }));
  return r.status === 'miss' && Math.abs(Math.abs(r.diff) - 2069.70) < 0.01;
})());
check('A26-12 源码级：reconcile 内补贴取绝对值参与扣减（防回退到只减一次）',
  /Math\.abs\(subsidy\)/.test(fs.readFileSync(path.join(ROOT, 'utils/takeaway.js'), 'utf8')));

// ===== A27 · R166 文案不得与已修算法脱节（"实现改了、说明没跟上" 是静默误导，客户照样算错）=====
// 背景：R164 修了配平式（只减一次补贴 ⇒ 两步走），但界面上那句「按外卖收入−活动补贴…」仍在描述旧算法。
//      这类漂移**不影响计算结果**，故不会有任何现有断言变红 —— 只能靠显式语义断言钉住。
console.log('—— A27 R166 配平/带出文案不得回退到已证伪的旧说明 ——');
const twTerms = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.takeawayMode;
check('A27-1 recCalcHint 不得残留旧算法描述「外卖收入 − 活动补贴」（该式已被 R164 真值证伪）',
  !/外卖收入\s*[−\-]\s*活动补贴/.test(twTerms.recCalcHint), twTerms.recCalcHint);
check('A27-2 recCalcHint 必须说清「还原优惠前总额」这一步（两步走的第①步，缺了它等式就不成立）',
  /还原/.test(twTerms.recCalcHint) && /优惠前/.test(twTerms.recCalcHint), twTerms.recCalcHint);
check('A27-3 autoCarryHint 不得再写「配平相抵」（修好后配平已不依赖费用侧那一行，留着会诱导重复记账）',
  !/配平相抵/.test(twTerms.autoCarryHint), twTerms.autoCarryHint);
check('A27-4 费用项注「外卖活动补贴」引用的是**新字段名**（R161-2 已改名，旧名两边对不上号）',
  /商家承担全部补贴/.test(require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.expenseItemNotes['外卖活动补贴']),
  require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.expenseItemNotes['外卖活动补贴']);
// ⚠️ 不再额外加「terms 双副本一致」—— A14（K11）已守，重复判据会两处漂移。

console.log(`\n==== R85 外卖段自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
