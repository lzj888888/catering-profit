// tools/selftest_r85.js —— R85 · 月度录入页「外卖段」取数与录入（规范 §A.11）自测
// 运行： node tools/selftest_r85.js
// 覆盖验收锚点 A1~A15：模式默认推断 / 快速4×1 / 分项4×3 / 互斥快照 / 粘贴提取 / 合计确认 /
//      手写路径 / 自动带出 / 配平四态 / 不阻断 / 平台名单源 / 双副本一致。
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const takeaway = require("../utils/takeaway.js");
const {
  pickTakeawayMode, restoreDetail, subtotalOf, extractPaste,
  subsidyTotal, reconcile, RECONCILE_THRESHOLD,
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
check('A15 后端零改动：cloudfunctions 未触碰', (() => {
  const { execFileSync } = require('child_process');
  const out = execFileSync('git', ['status', '--porcelain', 'cloudfunctions/'], { encoding: 'utf8', input: '', stdio: ['pipe', 'pipe', 'pipe'] });
  return out.trim() === '';
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

console.log(`\n==== R85 外卖段自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
