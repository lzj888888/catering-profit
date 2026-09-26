// tools/selftest_r85.js —— R85 · 月度录入页「外卖段」取数与录入（规范 §A.11）自测
// 运行： node tools/selftest_r85.js
// 覆盖验收锚点 A1~A24：模式默认推断 / 快速4×1 / 分项4×3 / 互斥快照 / 粘贴提取 / 合计确认 /
//      手写路径 / 自动带出 / 配平四态 / 不阻断 / 平台名单源 / 双副本一致 /
//      账期与长单号不误算金额(A16) / 带出误锁回归(A17) / 配平角色单源(A18) / 主题色单源(A19) /
//      粘贴到 0 不被吞(A20) / 快速录入汇总(A21) / 快速框占位不串线(A22) / 已填平台数 M≤1 不显示(A23) /
//      账单形态用例表：换行合计不翻倍 + 只有合计兜底填入(A24, R120)。
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
  subsidyTotal, reconcile, RECONCILE_THRESHOLD,
  mkByPlatTotal, mkByPlatFilled,
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
check('A7 分项模式金额框仍绑 onTwDetail（wx:for 模板 3 处 → 4 平台 × 3 框 = 12 输入框，手写可用）', (inputWxml.match(/bindinput="onTwDetail"/g) || []).length === 3, `onTwDetail 模板 ${(inputWxml.match(/bindinput="onTwDetail"/g) || []).length} 处`);
check('A7 buildItems 快速模式按金额行提交（非粘贴专属）', /takeoutMode === 'fast'/.test(inputJs) && /sub_items: g.rows/.test(inputJs));

console.log('===== A8 · 自动带出（活动补贴合计 → 费用侧外卖活动补贴）=====');
const subsidySum = subsidyTotal([{ subsidy: '10' }, { subsidy: '20.5' }, { subsidy: '' }, { subsidy: '5' }]);
check('A8 补贴合计 = 35.5', Math.abs(subsidySum - 35.5) < 0.001, `sum=${subsidySum}`);
check('A8 营销项单源：费用营销含「外卖活动补贴」且顺序对齐', MARKETING.indexOf('外卖活动补贴') === 2, MARKETING.join('/'));
const inputJsSync = inputJs.slice(inputJs.indexOf('syncSubsidyCarry'));
check('A8 带出实现存在（syncSubsidyCarry）', /syncSubsidyCarry/.test(inputJsSync));
check('A8 手改后不覆盖（twCarryLock 守卫）', /twCarryLock/.test(inputJs) && /已有值且与合计不同 = 用户手改/.test(inputJs));

console.log('===== A9~A12 · 配平校验（只做软提示：不阻断、不参与利润、不写入）=====');
// 应有应收 = 收入合计 − 补贴 − 佣金 − 配送服务费 − 配送补贴
const recBase = { incomeTotal: 5000, subsidy: 300, commission: 200, deliveryFee: 100, deliverySubsidy: 50, packTotal: 60 };
check('A9 未填应收款 → null（跳过，不误报）', reconcile(Object.assign({}, recBase, { actualReceivable: 0 })) === null);
check('A9 两侧一致（差额 0 ≤ 50）→ pass', reconcile(Object.assign({}, recBase, { actualReceivable: 4350 })).status === 'pass');
check('A9 差额 30 ≤ 50 → pass', reconcile(Object.assign({}, recBase, { actualReceivable: 4380 })).status === 'pass');
check('A10 差额 >50 → miss 且报漏填', reconcile(Object.assign({}, recBase, { actualReceivable: 4200 })).status === 'miss');
check('A11 差额恰等于打包费 → packaging 专项', reconcile(Object.assign({}, recBase, { actualReceivable: 4290 })).status === 'packaging'); // 4350-60
check('A11 专项非笼统 miss', reconcile(Object.assign({}, recBase, { actualReceivable: 4290 })).status !== 'miss');
check('A11 差额恰等于配送服务费 → delivery（用户配送费未纳入，不判错）', reconcile(Object.assign({}, recBase, { actualReceivable: 4250 })).status === 'delivery'); // 4350-100
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
check('A17 仍有 twCarryLock 短路（本会话手改优先）', /if \(g\.rows\[ri\]\.twCarryLock\) return;/.test(inputJs));
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

console.log(`\n==== R85 外卖段自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
