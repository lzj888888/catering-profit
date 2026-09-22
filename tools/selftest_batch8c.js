// tools/selftest_batch8c.js —— 批次 8c · 用户两大诉求静态/契约自测
// 运行： node tools/selftest_batch8c.js
//
// 覆盖：
//   H1 · 二次摊销 = 同一资产多次采购（新增采购也单独摊）
//        · saveAsset 写入侧：group_id / batch_seq 校验与落库（缺省、非法值、自指组键）
//        · 读取侧透传：getAmortSchedule 把分组字段带给前端
//        · 前端：摊销页按组展示（共 N 笔 / 合计原值 / 展开看每笔）+「追加采购」按钮与保存路径
//        · 🔒 算法零改动护栏：三份摊销引擎副本内**不得**出现分组字段（多笔 = 多行资产，
//          现有「逐行独立尾差倒挤」规则天然满足，改引擎属越界）
//   H2 · 填表引导：每一类「包括 / 不包括」+ 顶部「填写口径」折叠块（防重填漏填）
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failN++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const terms = read('miniprogram/i18n/terms.js');
const termsSpec = read('specs/dev-specs/i18n/terms.js');

// ==========================================================================
console.log('===== H1 · 摊销资产多次采购（saveAsset 写入侧）=====');
const { validateInput } = require(ROOT + '/cloudfunctions/saveAsset/validate.js');
const { ERROR_CODES } = require(ROOT + '/cloudfunctions/saveAsset/common');
const S = { name: '装修', value_fen: 8000000, start_month: '2026-07', total_months: 24 };
const V = (asset) => validateInput({ shop_id: 's1', asset });

check('普通新增（无分组字段）放行', V(S).error === null);
check('缺省 group_id → 空串（独立资产）', V(S).asset.group_id === '');
check('缺省 batch_seq → 1', V(S).asset.batch_seq === 1);
const app = V({ ...S, group_id: 'amort_1', batch_seq: 2 });
check('追加采购（group_id + batch_seq=2）放行', app.error === null);
check('group_id 原样回传', app.asset.group_id === 'amort_1');
check('batch_seq 原样回传（第 2 笔）', app.asset.batch_seq === 2);
check('batch_seq=0 → 拒（笔次从 1 起）', V({ ...S, batch_seq: 0 }).error === ERROR_CODES.INVALID_PARAM);
check('batch_seq 字符串 "2" → 拒（JSON number 契约）', V({ ...S, batch_seq: '2' }).error === ERROR_CODES.INVALID_PARAM);
check('batch_seq 小数 1.5 → 拒（笔次必须整数）', V({ ...S, batch_seq: 1.5 }).error === ERROR_CODES.INVALID_PARAM);
check('group_id 等于自身 asset_id → 拒（自指组键）', V({ ...S, asset_id: 'a1', group_id: 'a1' }).error === ERROR_CODES.INVALID_PARAM);
check('追加采购仍守旧契约：金额必须是整数分', V({ ...S, group_id: 'amort_1', batch_seq: 2, value_fen: '100' }).error === ERROR_CODES.INVALID_PARAM);

const saveIdx = read('cloudfunctions/saveAsset/index.js');
check('新增分支落库带 group_id / batch_seq', /group_id: a\.group_id, batch_seq: a\.batch_seq,/.test(saveIdx));
check('编辑分支仅在 group_id 有值时覆盖（不把多笔拆散）', /if \(a\.group_id\) \{ patch\.group_id/.test(saveIdx));
check('落库字段名仍是 value_fen（防字段漂移回归）', saveIdx.includes('value_fen: a.value_fen'));

console.log('');
console.log('===== H1 · 读取侧透传（getAmortSchedule）=====');
const gas = read('cloudfunctions/getAmortSchedule/index.js');
check('读台账时归一分组字段（老数据 → "" / 1）', /group_id: a\.group_id \|\| '', batch_seq: a\.batch_seq \|\| 1/.test(gas));
check('返回 assets 带 group_id', /group_id: a\.group_id, batch_seq: a\.batch_seq,/.test(gas));

console.log('');
console.log('===== H1 · 🔒 摊销算法零改动护栏 =====');
for (const f of ['cloudfunctions/calcAmortize/service.js', 'cloudfunctions/getAmortSchedule/service.js', 'cloudfunctions/saveLedger/service.js']) {
  const src = read(f);
  check(`${f} 不含分组字段（引擎不动）`, !/group_id/.test(src) && !/batches/.test(src));
}
check('末月尾差倒挤仍在（calcAmortize）', /total_value - base \* \(N - 1\)/.test(read('cloudfunctions/calcAmortize/service.js')));

console.log('');
console.log('===== H1 · 前端（摊销页分组 + 追加采购）=====');
const amortJs = read('pages/month/amortize.js');
const amortWxml = read('pages/month/amortize.wxml');
check('amortize.js 有 buildGroups（按 group_id || asset_id 分组）', /buildGroups\(rows\)/.test(amortJs) && /r\.group_id \|\| r\.asset_id/.test(amortJs));
check('amortize.js 有 onToggleGroup（展开看每一笔）', /onToggleGroup\(e\)/.test(amortJs));
check('amortize.js 有 onAppend（追加采购）', /onAppend\(e\)/.test(amortJs) && /appendGroup: group\.key/.test(amortJs));
check('追加采购写入 group_id + 组内序号', /asset\.group_id = this\.data\.appendGroup/.test(amortJs) && /asset\.batch_seq = this\.data\.appendSeq/.test(amortJs));
check('编辑某一笔保留其组归属', /asset\.group_id = this\.data\.editing\.group_id/.test(amortJs));
check('提前报废保留组归属（只终止该笔）', /payload\.group_id = a\.group_id/.test(amortJs));
check('摊销页不再直接用 assets 渲染（改走 groups）', /wx:for="\{\{groups\}\}"/.test(amortWxml) && !/wx:for="\{\{assets\}\}"/.test(amortWxml));
check('卡片显示「共 N 笔采购」', /batchTotalPrefix/.test(amortWxml) && /batchTotalSuffix/.test(amortWxml));
check('卡片显示「合计原值」', /t\.groupValueLabel/.test(amortWxml));
check('每笔显示「第 N 笔」', /batchPrefix/.test(amortWxml) && /batchSuffix/.test(amortWxml));
check('每笔各自有 编辑 / 提前报废', /catchtap="onEdit" data-asset="\{\{b\}\}"/.test(amortWxml) && /catchtap="onTerminate" data-asset="\{\{b\}\}"/.test(amortWxml));
check('有「追加采购」按钮（data-group 定位组）', /onAppend" data-group="\{\{g\.key\}\}"/.test(amortWxml));
check('表单标题区分 新增 / 追加采购 / 编辑', /appendGroup \? t\.appendTitle : t\.add/.test(amortWxml));
check('追加采购时提示「不要另建同名资产」', /t\.appendHint/.test(amortWxml));
check('摊销页 wxss 有分组样式', /\.batch-title/.test(read('pages/month/amortize.wxss')) && /\.batch-head/.test(read('pages/month/amortize.wxss')));

// ==========================================================================
console.log('');
console.log('===== H2 · 填表引导：每类「包括 / 不包括」+ 填写口径 =====');
const inputJs = read('pages/month/input.js');
const inputWxml = read('pages/month/input.wxml');
check('terms 有 incomeScope（收入三类口径）', /incomeScope: \{/.test(terms) && /dine_in: '包括店内扫码点单/.test(terms));
check('堂食口径含「不包括会员充值预收」', /不包括会员充值预收/.test(terms));
// T5（2026-09-22 李老师拍板）：收入一律按实际成交金额（折后）记，折扣不单列（判据见 ModuleA A.1 配套段）。
//   语义级：只守**正向锚点**（`折后` / `实际成交` / `成交金额` 之一）—— 同义换词不误报，不锁整句。
//   ⚠️ 为什么**不设**「无原价框架」反向腿（第一版设了，当场被自己判红，禁再犯）：
//      口径句为提醒老板**特意**写了「**不按**菜单原价填」这句**否定式**，反向正则 `按…原价…填` 会命中它
//      ⇒ 把**正确文案**判成违规。与本仓 batch8b 记载的「『不看钱到账没有』被误判成收付实现制」**同族**。
//      又：本场景正向锚点（折后）与错误状态（原价）**互斥**，单腿已足以抓到回退 ⇒ 反向腿收益 < 误报风险。
//   fail-closed：正向锚点不满足即红（拿不出「这是折后口径」的证据 = 不许过）。
{
  const dineScope = (terms.match(/dine_in: '([^']*)'/) || [])[1] || '';
  const hasAfter = /折后|实际成交|成交金额/.test(dineScope);
  check('堂食口径=折后成交（语义级：口径句须含折后锚点）', hasAfter,
    `实取 ${dineScope.length} 字 / 折后锚点=${hasAfter}`);
}

// T5 决策留痕：口径已写进规范正文 ⇒ 段落被删即红（规格是决策载体，不是可选项）。
const specA = read('specs/dev-specs/core/开发规范v1.0_ModuleA_收入费用核算.md');
check('ModuleA 收入口径铁律段在位（T5 决策留痕）',
  /收入金额口径铁律/.test(specA) && /实际成交金额（折后）/.test(specA));
check('外卖口径指向「费用 · 营销」（不重复扣）', /平台佣金与配送费不要在这里扣/.test(terms));
check('terms 有 expenseScope（费用四类口径）', /expenseScope: \{/.test(terms) && /operation: '包括房租/.test(terms));
check('运营口径含「不包括设备与装修（走摊销资产）」', /不包括设备与装修购置/.test(terms));
check('其他口径含「加盟费金额大走摊销资产」', /加盟费\/品牌使用费金额大请走「摊销资产」/.test(terms));
check('其他口径含「不包括食材采购」', /不包括食材采购与还本付息/.test(terms));
check('terms 有 fillGuideTitle', /fillGuideTitle: '填写口径/.test(terms));
const guideCount = (terms.match(/^      '[①②③④⑤]/gm) || []).length;
check('填写口径 5 条（防重填漏填）', guideCount === 5, `实际 ${guideCount} 条`);
check('口径含「同一笔钱只填一次」', /同一笔钱只填一次/.test(terms));
check('口径含「食材采购不计入费用」', /食材采购不计入费用/.test(terms));
check('input.js 折叠块状态 + 开关', /fillGuideOpen: false/.test(inputJs) && /onToggleFillGuide\(\)/.test(inputJs));
check('input.js initGroups 给每类挂 scope', /scope: \(scopeMap \|\| \{\}\)\[g\.category\] \|\| ''/.test(inputJs));
check('input.js 从后端重建时也挂 scope', /rebuildFromItems\(TERMS\.ledger\.income, d\.income_items, TERMS\.ledger\.incomeScope\)/.test(inputJs));
check('input.wxml 渲染顶部口径折叠块', /fill-guide-head/.test(inputWxml) && /t\.fillGuideTitle/.test(inputWxml));
// 2026-09-21：口径句从「常展开」改为「折叠块」（李老师真机反馈：太占地方）
//   判据**升级**而非放宽：仍要求 {{g.scope}} 被渲染，另要求折叠机制存在 + 老形态已消失。
check('input.wxml 每类口径句收进折叠块（引导行 + 按需展开）',
  /class="scope-head"/.test(inputWxml) && /bindtap="onToggleScope"/.test(inputWxml)
  && /<view class="scope" wx:if="\{\{g\.scopeOpen\}\}">\{\{g\.scope\}\}<\/view>/.test(inputWxml));
check('input.wxml 口径句未退回「常展开」形态', !/class="scope" wx:if="\{\{g\.scope\}\}"/.test(inputWxml));
check('input.wxss 有折叠块/口径样式', /\.fill-guide-head/.test(read('pages/month/input.wxss'))
  // round70 加固：原判据 `/\.scope-head/` 是**裸子串**，`.scope-head-x {` 也能命中 ⇒ 样式类被改名成
  //  带后缀的兄弟类时判绿（漏）。加边界 `[\s,{]`（类名后须紧跟空白/逗号/左花括号＝真选择器声明）。
  && /\.scope-head[\s,{]/.test(read('pages/month/input.wxss')) && /\.scope \{/.test(read('pages/month/input.wxss')));
check('口径文案无硬编码（全部走 t.*）', !/[\u4e00-\u9fff]/.test(inputWxml.replace(/<!--[\s\S]*?-->/g, '')));

console.log('');
console.log('===== 门禁预检 =====');
check('K11 双副本逐字一致', terms === termsSpec);
check('H1/H2 新词条双副本均有（batchTotalPrefix / appendPurchase / fillGuideTitle）', termsSpec.includes('batchTotalPrefix') && termsSpec.includes('appendPurchase') && termsSpec.includes('fillGuideTitle'));
check('计算下沉：页面不直连数据库（只经 api.call）', !/cloud\.database\(/.test(amortJs) && !/cloud\.database\(/.test(inputJs) && /api\.call\('saveAsset'/.test(amortJs));

console.log(`\n==== 批次 8c 自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
