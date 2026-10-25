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
console.log('===== H1 · 🔒 摊销算法零改动护栏（形态面）=====');
// 🔴 R453：本仓摊销金额有**三份各自手写的实现**，每一份都在注释里自称"同源/同款/同口径"：
//   ① 利润表侧 `calcAmortize/service.js`（另含残值 calcResidualFen）
//   ② 摊销页展示 `getAmortSchedule/service.js`（首行「与 calcAmortize/service.js 同源」）
//   ③ 账本快照 `saveLedger/service.js`（首注「与 calcAmortize/service.js 保持同源同口径」）
//   ⇒ 任一份漂移 = 「页面显示 ≠ 账本 ≠ 利润表」而门禁照绿（摊销是 M1 利润表的核心减项）。
//   ⚠️ R453 之前的实况：尾差倒挤句**只守了 ①一份**（②③ 各自手写的同一句无人守）⇒ 下面逐份补上。
const AMORT_ENGINES = [
  { tag: '①利润表侧', rel: 'cloudfunctions/calcAmortize/service.js', fn: 'amountForMonthFen' },
  { tag: '②摊销页展示', rel: 'cloudfunctions/getAmortSchedule/service.js', fn: 'amountForMonth' },
  { tag: '③账本快照', rel: 'cloudfunctions/saveLedger/service.js', fn: 'amountForMonth' },
];
for (const f of ['cloudfunctions/calcAmortize/service.js', 'cloudfunctions/getAmortSchedule/service.js', 'cloudfunctions/saveLedger/service.js']) {
  const src = read(f);
  check(`${f} 不含分组字段（引擎不动）`, !/group_id/.test(src) && !/batches/.test(src));
}
check('末月尾差倒挤仍在（calcAmortize）', /total_value - base \* \(N - 1\)/.test(read('cloudfunctions/calcAmortize/service.js')));
// R453 补面（只增不减）：②③ 的同一句也必须在场 —— 此前没人问过它们
for (const e of AMORT_ENGINES) {
  check(`尾差倒挤句仍在 · ${e.tag}（${e.rel}）`, /total_value - base \* \(N - 1\)/.test(read(e.rel)));
}

console.log('');
console.log('===== H1b · 🔒 三份摊销引擎「数值等价」对拍（R453 新增）=====');
// 为什么还要加：上面是**形态面**（判文本）。两份形态相同的实现仍可能数值不等 ——
//   例如有人把 ②③ 的尾差句**同时**改成 `return base`，形态判据照样全绿。
//   ⇒ 这里补**行为面**：真 require 三份引擎，对同一批资产 × 同一批月份**逐点对拍分整数**。
//   形态 + 行为互补，与 R255「写侧键 ≡ 读侧键」同手法；判据不绑函数名以外的字面量。
const ENGINES = {};
for (const e of AMORT_ENGINES) {
  try { ENGINES[e.tag] = require(path.join(ROOT, e.rel)); } catch (err) { ENGINES[e.tag] = null; }
}
check('三份引擎均可被 Node 加载（loadable 是对拍的前提；读不到即判红，不静默跳过）',
  AMORT_ENGINES.every((e) => ENGINES[e.tag] && typeof ENGINES[e.tag][e.fn] === 'function'));

const EQ_CASES = [
  { name: '整除 12 月', value: 120000, months: 12, start: '2026-01', term: '' },
  { name: '不整除 3 月', value: 1000000, months: 3, start: '2026-01', term: '' },
  { name: '不整除 7 月', value: 10000000, months: 7, start: '2025-11', term: '' },
  { name: '单月 N=1', value: 88888, months: 1, start: '2026-03', term: '' },
  { name: '提前终止', value: 1200000, months: 12, start: '2026-01', term: '2026-05' },
  { name: '终止月晚于自然到期', value: 600000, months: 6, start: '2026-01', term: '2026-12' },
  { name: '跨年 13 月', value: 999999, months: 13, start: '2025-11', term: '' },
  { name: '1 分 3 月（尾差极端）', value: 1, months: 3, start: '2026-01', term: '' },
  { name: 'S3 装修 12 万/36 月', value: 12000000, months: 36, start: '2026-01', term: '' },
];
const EQ_MONTHS = ['2025-01', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
  '2026-05', '2026-06', '2026-07', '2026-12', '2027-01', '2027-06', '2027-12', '2028-11', '2028-12', '2029-01'];
const eqAsset = (c, i) => ({
  asset_id: 'e' + i, name: c.name, total_value: c.value,
  start_month: c.start, total_months: c.months, terminate_month: c.term,
});
const eqMonthsOf = (start, n) => {
  const [y0, m0] = start.split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) { const idx = y0 * 12 + (m0 - 1) + i; out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`); }
  return out;
};

let eqMism = 0, eqFirst = '';
for (let i = 0; i < EQ_CASES.length; i++) {
  const a = eqAsset(EQ_CASES[i], i);
  for (const m of EQ_MONTHS) {
    const v = AMORT_ENGINES.map((e) => ENGINES[e.tag][e.fn](a, m));
    if (!(v[0] === v[1] && v[1] === v[2])) {
      eqMism++;
      if (!eqFirst) eqFirst = `${EQ_CASES[i].name}@${m}: ①${v[0]}/②${v[1]}/③${v[2]}`;
    }
  }
}
check(`三份引擎全矩阵逐点对拍一致（${EQ_CASES.length} 资产 × ${EQ_MONTHS.length} 月 × 3 份）`,
  eqMism === 0, eqMism === 0 ? `${EQ_CASES.length * EQ_MONTHS.length} 点全等` : eqMism + ' 处不等，首处 ' + eqFirst);

// S3 双侧锚点（与 saveLedger/selftest.js 的 3,333.33 / 末月 3,333.45 同值 ⇒ 口径跨包更硬）
const decorE = { asset_id: 'dec', name: '装修', total_value: 12000000, start_month: '2026-01', total_months: 36, terminate_month: '' };
const vDec12 = AMORT_ENGINES.map((e) => ENGINES[e.tag][e.fn](decorE, '2026-12'));
const vDecLast = AMORT_ENGINES.map((e) => ENGINES[e.tag][e.fn](decorE, '2028-12'));
check('S3 锚点：装修 2026-12 = 333,333 分（三份一致）', vDec12.every((x) => x === 333333), vDec12.join('/'));
check('S3 锚点：装修末月 2028-12 尾差倒挤 = 333,345 分（三份一致）', vDecLast.every((x) => x === 333345), vDecLast.join('/'));

// 影子样本（反恒真）：把 ② 的尾差倒挤改成 base ⇒ 对拍**必须**判不等。
//   用 vm + 空桩加载（不落盘、不污染生产目录），与探针同一手法。
const vm = require('vm');
const TAIL_SENT = 'if (end === naturalEnd) return asset.total_value - base * (N - 1);';
const pageSrcE = read('cloudfunctions/getAmortSchedule/service.js');
check('影子样本前提：② 源码含尾差句（否则样本无效，下面会 fail-closed 地判红）',
  pageSrcE.indexOf(TAIL_SENT) >= 0);
function loadTamperedEngine(src) {
  const sandbox = { module: { exports: {} }, exports: {}, console };
  sandbox.require = (id) => {
    if (id === './common') return { ERROR_CODES: {} };
    throw new Error('unexpected require: ' + id);
  };
  vm.runInNewContext(src, sandbox, { filename: 'tampered_engine.js' });
  return sandbox.module.exports;
}
const TAMP = loadTamperedEngine(pageSrcE.replace(TAIL_SENT, 'if (end === naturalEnd) return base;'));
// ⚠️ 参照物取 **② 的真品**（不是 ①）：影子样本的职责只是"证明篡改能被检出"，
//   若拿 ① 当基准、而 ① 自己也被人为篡改（变异回灌场景），影子样本会**假红**
//   —— 那会把"对照组被污染"误读成"判据失效"。用真品 ② 作基准 ⇒ 与其他引擎状态无关。
let shMism = 0, shTail = 0;
for (let i = 0; i < EQ_CASES.length; i++) {
  const c = EQ_CASES[i];
  if (c.term) continue;                       // 只对"自然到期"样本：尾差路径专属
  const a = eqAsset(c, i);
  const tailMonth = eqMonthsOf(c.start, c.months).slice(-1)[0];
  for (const m of EQ_MONTHS) {
    if (TAMP.amountForMonth(a, m) !== ENGINES['②摊销页展示'].amountForMonth(a, m)) {
      shMism++;
      if (m === tailMonth) shTail++;
    }
  }
}
check('影子样本：篡改 ② 的尾差句 ⇒ 对拍判不等（⇒ 判据有鉴别力，非恒真）', shMism > 0, shMism + ' 处不等');
check('影子样本：不等点全部落在自然到期末月（⇒ 定位准确，不误报区间外）',
  shMism > 0 && shMism === shTail, `末月 ${shTail} / 不等 ${shMism}`);
const aTermE = eqAsset(EQ_CASES[4], 4);
let shTermChanged = 0;
for (const m of EQ_MONTHS) {
  if (TAMP.amountForMonth(aTermE, m) !== ENGINES['②摊销页展示'].amountForMonth(aTermE, m)) shTermChanged++;
}
check('影子样本：提前终止样本零变化（⇒ 篡改只打到自然到期尾差路径）', shTermChanged === 0, shTermChanged + ' 处');

console.log('');
console.log('===== H1 · 前端（摊销页分组 + 追加采购）=====');
const amortJs = read('subpkg/biz/month/amortize.js');
const amortWxml = read('subpkg/biz/month/amortize.wxml');
// round107：表单（新增 / 再投一笔 / 编辑 / 删除）已搬去独立页 ⇒ 相关判据的宿主随之切换。
const aeJs = read('subpkg/biz/month/assetEdit.js');
const aeWxml = read('subpkg/biz/month/assetEdit.wxml');
check('amortize.js 有 buildGroups（按 group_id || asset_id 分组）', /buildGroups\(rows\)/.test(amortJs) && /r\.group_id \|\| r\.asset_id/.test(amortJs));
check('amortize.js 有 onToggleGroup（展开看每一笔）', /onToggleGroup\(e\)/.test(amortJs));
check('amortize.js 有 onAppend（「再投一笔」跳编辑页并带组键）',
  /onAppend\(e\)/.test(amortJs) && /assetEdit\?kind=amort/.test(amortJs) && /'&group=' \+ key|&group=' \+ key/.test(amortJs));
check('「再投一笔」写入 group_id + 组内序号（round107：随表单搬到 assetEdit）',
  /asset\.group_id = this\.data\.groupKey/.test(aeJs) && /asset\.batch_seq = this\.data\.batchSeq/.test(aeJs));
// round107：编辑分支只送 asset_id，**不送 group_id** ⇒ 组键由后端 patch 原样保留，前端无从写坏。
//   故判据反转为「不得出现编辑期回写组键」（旧写法 `asset.group_id = this.data.editing.group_id` 会红）。
check('编辑某一笔时**不回写**组归属（只送 asset_id，组键由后端保留 ⇒ 前端写不坏）',
  /asset\.asset_id = this\.data\.assetId/.test(aeJs) && !/asset\.group_id = this\.data\.edit/.test(aeJs + amortJs));
check('提前报废保留组归属（只终止该笔）', /payload\.group_id = a\.group_id/.test(amortJs));
check('摊销页不再直接用 assets 渲染（改走 groups）', /wx:for="\{\{groups\}\}"/.test(amortWxml) && !/wx:for="\{\{assets\}\}"/.test(amortWxml));
check('卡片显示「共 N 笔采购」', /batchTotalPrefix/.test(amortWxml) && /batchTotalSuffix/.test(amortWxml));
check('卡片显示「合计原值」', /t\.groupValueLabel/.test(amortWxml));
check('每笔显示「第 N 笔」', /batchPrefix/.test(amortWxml) && /batchSuffix/.test(amortWxml));
check('每笔各自有 编辑 / 提前报废（round107 handler 改名 onEdit → onEditAsset）',
  /catchtap="onEditAsset" data-asset="\{\{b\}\}"/.test(amortWxml) && /catchtap="onTerminate" data-asset="\{\{b\}\}"/.test(amortWxml));
check('有「追加采购」按钮（data-group 定位组）', /onAppend" data-group="\{\{g\.key\}\}"/.test(amortWxml));
check('表单标题区分 一次算清 / 分期摊销 / 再投一笔（round107：三态在 assetEdit）',
  /mode === 'append' \? t\.appendTitle : t\.amortTitle/.test(aeWxml) && /kind === 'lump' \? t\.lumpTitle/.test(aeWxml));
check('「再投一笔」时渲染提示（t.appendHint 真出现；不绑具体文案，改词不误报）',
  /t\.appendHint/.test(aeWxml));
check('摊销页 wxss 有分组样式', /\.batch-title/.test(read('subpkg/biz/month/amortize.wxss')) && /\.batch-head/.test(read('subpkg/biz/month/amortize.wxss')));

// ==========================================================================
console.log('');
console.log('===== H2 · 填表引导：每类「包括 / 不包括」+ 填写口径 =====');
const inputJs = read('subpkg/biz/month/input.js');
const inputWxml = read('subpkg/biz/month/input.wxml');
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
// ⚠️ R500：原判据钉的是**字面量**「平台佣金与配送费不要在这里扣」⇒ R497/R500 改文案（语义完全不变）就假红。
//   本仓 R297 第二轮教训：判据要判**语义**、别钉字面量。改为真读 TERMS 判三要素：
//   ① 提到「营销费用」② 明说佣金/配送「不要在这里扣/加减」③ 点名佣金或配送费。
const takeawayScopeT = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger.incomeScope.takeaway || '';
check('外卖口径指向「费用 · 营销」（不重复扣）',
  /营销费用/.test(takeawayScopeT) && /(不要在这里扣|不要在这里加减)/.test(takeawayScopeT) && /(佣金|配送费)/.test(takeawayScopeT));
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
// round102（2026-09-22）判据放宽到**语义级**：原判据绑死了 map 回调参数名（g）—— 本轮把
//   initGroups/rebuildFromItems 改成「先建页面对象、再装配 rows」后回调参数改名 d ⇒ 误报。
//   守卫意图是「initGroups 给每类挂 scope（取自 scopeMap、按 category 取）」，与参数名无关。
check('input.js initGroups 给每类挂 scope', /scope: \(scopeMap \|\| \{\}\)\[(?:g|d)\.category\] \|\| ''/.test(inputJs));
check('input.js 从后端重建时也挂 scope', /rebuildFromItems\(TERMS\.ledger\.income, d\.income_items, TERMS\.ledger\.incomeScope\)/.test(inputJs));
check('input.wxml 渲染顶部口径折叠块', /fill-guide-head/.test(inputWxml) && /t\.fillGuideTitle/.test(inputWxml));
// 2026-09-21：口径句从「常展开」改为「折叠块」（李老师真机反馈：太占地方）
//   判据**升级**而非放宽：仍要求 {{g.scope}} 被渲染，另要求折叠机制存在 + 老形态已消失。
check('input.wxml 每类口径句收进折叠块（引导行 + 按需展开）',
  /class="scope-head"/.test(inputWxml) && /bindtap="onToggleScope"/.test(inputWxml)
  && /<view class="scope" wx:if="\{\{g\.scopeOpen\}\}">\{\{g\.scope\}\}<\/view>/.test(inputWxml));
check('input.wxml 口径句未退回「常展开」形态', !/class="scope" wx:if="\{\{g\.scope\}\}"/.test(inputWxml));
check('input.wxss 有折叠块/口径样式', /\.fill-guide-head/.test(read('subpkg/biz/month/input.wxss'))
  // round70 加固：原判据 `/\.scope-head/` 是**裸子串**，`.scope-head-x {` 也能命中 ⇒ 样式类被改名成
  //  带后缀的兄弟类时判绿（漏）。加边界 `[\s,{]`（类名后须紧跟空白/逗号/左花括号＝真选择器声明）。
  && /\.scope-head[\s,{]/.test(read('subpkg/biz/month/input.wxss')) && /\.scope \{/.test(read('subpkg/biz/month/input.wxss')));
check('口径文案无硬编码（全部走 t.*）', !/[\u4e00-\u9fff]/.test(inputWxml.replace(/<!--[\s\S]*?-->/g, '')));

console.log('');
console.log('===== 门禁预检 =====');
check('K11 双副本逐字一致', terms === termsSpec);
check('H1/H2 新词条双副本均有（batchTotalPrefix / appendPurchase / fillGuideTitle）', termsSpec.includes('batchTotalPrefix') && termsSpec.includes('appendPurchase') && termsSpec.includes('fillGuideTitle'));
check('计算下沉：页面不直连数据库（只经 api.call）', !/cloud\.database\(/.test(amortJs) && !/cloud\.database\(/.test(inputJs) && /api\.call\('saveAsset'/.test(amortJs));

console.log(`\n==== 批次 8c 自测：${pass} 通过 / ${failN} 失败 ====`);
process.exit(failN === 0 ? 0 : 1);
