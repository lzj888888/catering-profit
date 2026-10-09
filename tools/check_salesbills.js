// tools/check_salesbills.js —— R252 · 已导入账单「查看 + 清除」守卫
// 运行：node tools/check_salesbills.js   （由 verify_all.js 的 [sales-bills] 套件调用）
//
// ===== 为什么需要它（失效是**静默**的）=====
// `getSalesBills`（读侧列账单）与 `clearSalesBills`（写侧软删）**都要反向解析 `_id`**。
// 若两侧各写一份解析、或解析写错（例如用 `lastIndexOf('_')` 取平台名）：
//   列表里显示的平台 ≠ 清除时匹配的平台
//   ⇒ 出现「**列表里看得见、点清除却删不掉**」或「删错平台」
//   ⇒ 而且**没有任何报错**（只是 hits=[]，返回 cleared_rows:0，看着像"本来就没有"）。
// 本仓同族前例：R232 C-9（dish_key 归一两侧分叉 ⇒ 全菜匹配不上且不报错）。
// ⇒ 形态解析上提到单源 `cloudfunctions/common/salesBillId.js`，两侧一律引用；本守卫把这条钉死。
//
// ===== 🔴 实测过的两个真 bug（本守卫必须能抓住，它的存在理由就是这两条）=====
//   BUG-A：`lastIndexOf('_')` 取平台 ⇒ `jd_order` 被切成 `order`（平台名含下划线）。
//   BUG-B：目标匹配表用 `t.kind + '|' + ...` 而 `kind` 缺省为 `''`
//          ⇒ 构出的键是 `|taobao|2026-10-08`，与实行的 `bill|taobao|...` 永不相等
//          ⇒ 「不限形态」的清除**全部命中 0 行**（看着像已经清过了）。
//
// ===== 输出纪律 =====
// 段标题用 `===== … =====`（与既有套件一致；R66 的 SECTION_HEAD 认这个形式），
// 且**每段至少 1 条断言**（非末段零断言 ⇒ 判红）。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SID_REL = 'cloudfunctions/common/salesBillId.js';
const GET_IDX = 'cloudfunctions/getSalesBills/index.js';
const GET_SVC = 'cloudfunctions/getSalesBills/service.js';
const CLR_IDX = 'cloudfunctions/clearSalesBills/index.js';
const CLR_SVC = 'cloudfunctions/clearSalesBills/service.js';

let pass = 0, failN = 0;
const sec = (t) => console.log('\n===== ' + t + ' =====');
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, ''); }
  catch (e) { return ''; }
}
// 剥注释（块 + 行）—— 防「注释里的字面量把判据喂成恒绿」（R232 C-9 血的教训）
function stripComments(src) {
  let s = String(src || '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return s;
}

// =====================================================================
sec('① 单源存在且被两侧引用（判行为：函数引用恒等）');
// =====================================================================
const sidRaw = read(SID_REL);
const sid = stripComments(sidRaw);
check('1-① 单源 salesBillId.js 存在且够长', sid.trim().length > 500, `${sid.trim().length} 字符（剥注释后）`);
check('1-② 单源导出 parseSalesBillId', /module\.exports\s*=\s*\{[^}]*parseSalesBillId/.test(sid), '在 module.exports 内');

const idxCommon = stripComments(read('cloudfunctions/common/index.js'));
check('1-③ common/index.js 聚合入口导出 parseSalesBillId',
  /parseSalesBillId\s*:\s*require\(['"]\.\/salesBillId['"]\)/.test(idxCommon), '符号已挂（否则云端 TypeError）');

const getSvc = stripComments(read(GET_SVC));
const clrSvc = stripComments(read(CLR_SVC));
check('1-④ 读侧引用单源（不再自带解析）',
  /require\(['"]\.\/cx_salesBillId['"]\)/.test(getSvc) && !/lastIndexOf\(['"]_['"]\)/.test(getSvc),
  'getSalesBills/service.js 走 cx_salesBillId');
check('1-⑤ 写侧引用单源（不再自带解析）',
  /require\(['"]\.\/cx_salesBillId['"]\)/.test(clrSvc) && !/lastIndexOf\(['"]_['"]\)/.test(clrSvc),
  'clearSalesBills/service.js 走 cx_salesBillId');

// =====================================================================
sec('② 形态解析行为（真调单源 · 含 BUG-A 回归）');
// =====================================================================
let SID = null;
try { SID = require(path.join(ROOT, SID_REL)); } catch (e) { SID = null; }
check('2-① 单源可 require（fail-closed）', !!(SID && typeof SID.parseSalesBillId === 'function'), '可加载');

const P = (id) => (SID ? SID.parseSalesBillId(id) : { kind: '?', platform: '?', bizDate: '?' });
check('2-② 账单级 taobao 解析正确',
  JSON.stringify(P('BILL_shop_mu6j87v1itrs_taobao_2026-10-08')) === '{"kind":"bill","platform":"taobao","bizDate":"2026-10-08"}',
  JSON.stringify(P('BILL_shop_mu6j87v1itrs_taobao_2026-10-08')));
// 🔴 BUG-A 回归：平台名含下划线（jd_order / jd_sku），rightmost-'_' 取法会切成 'order'
check('2-③ 🔴 BUG-A 回归：jd_order 不得被切成 order',
  P('BILL_shop_mu6j87v1itrs_jd_order_2026-10-08').platform === 'jd_order',
  `实得 '${P('BILL_shop_mu6j87v1itrs_jd_order_2026-10-08').platform}'`);
check('2-④ jd_sku 同族解析正确',
  P('BILL_shop_mu6j87v1itrs_jd_sku_2026-10-08').platform === 'jd_sku',
  `实得 '${P('BILL_shop_mu6j87v1itrs_jd_sku_2026-10-08').platform}'`);
check('2-⑤ 菜品级 taobao 解析正确（seq 归位）',
  JSON.stringify(P('SALE_shop_mu6j87v1itrs_taobao_2026-10-08_0')) === '{"kind":"dish","platform":"taobao","bizDate":"2026-10-08"}',
  JSON.stringify(P('SALE_shop_mu6j87v1itrs_taobao_2026-10-08_0')));
check('2-⑥ 菜品级 jd_order 解析正确（多段平台 + seq）',
  JSON.stringify(P('SALE_shop_mu6j87v1itrs_jd_order_2026-10-08_12')) === '{"kind":"dish","platform":"jd_order","bizDate":"2026-10-08"}',
  JSON.stringify(P('SALE_shop_mu6j87v1itrs_jd_order_2026-10-08_12')));
check('2-⑦ 认不出的 id ⇒ unknown（不误判形态）',
  P('GARBAGE_x').kind === 'unknown' && P('BILL_x').kind === 'unknown',
  'GARBAGE_x / BILL_x');
check('2-⑧ 平台枚举与写入侧同源（含 jd_order / jd_sku）',
  Array.isArray(SID && SID.KNOWN_PLATFORMS) && SID.KNOWN_PLATFORMS.indexOf('jd_order') >= 0
  && SID.KNOWN_PLATFORMS.indexOf('jd_sku') >= 0, (SID && SID.KNOWN_PLATFORMS || []).join(','));

// =====================================================================
sec('③ 聚合行为（真调 service · 形态分开、金额求和）');
// =====================================================================
let GET = null, CLR = null;
try { GET = require(path.join(ROOT, GET_SVC)); } catch (e) { GET = null; }
try { CLR = require(path.join(ROOT, CLR_SVC)); } catch (e) { CLR = null; }
check('3-① 两侧 service 可 require（fail-closed）',
  !!(GET && typeof GET.buildBillList === 'function' && CLR && typeof CLR.matchTargets === 'function'),
  'buildBillList / matchTargets');

const ROWS = [
  { _id: 'BILL_shop_mu6j87v1itrs_taobao_2026-10-08', qty: 118, amount: 182308, is_deleted: false },
  { _id: 'BILL_shop_mu6j87v1itrs_jd_order_2026-10-08', qty: 0, amount: 0, is_deleted: false },
  { _id: 'SALE_shop_mu6j87v1itrs_taobao_2026-10-08_0', qty: 2, amount: 1520, is_deleted: false },
  { _id: 'SALE_shop_mu6j87v1itrs_taobao_2026-10-08_1', qty: 43, amount: 0, is_deleted: false },
  { _id: 'SALE_shop_mu6j87v1itrs_pos_2026-10-07_0', qty: 5, amount: 5000, is_deleted: true, delete_at: '2026-10-09T08:00:00Z' },
];
const B = GET ? GET.buildBillList(ROWS, {}) : { list: [], summary: {}, unknownCount: -1 };
check('3-② 账单级与菜品级**分开**成条（不混成一条）',
  B.list.length === 3 && B.list.filter((x) => x.kind === 'bill').length === 2
  && B.list.filter((x) => x.kind === 'dish').length === 1, `list=${B.list.length}`);
check('3-③ 菜品级按 (platform,biz_date) 聚合：2 行 → 1 条，qty 求和 = 45',
  (() => { const d = B.list.filter((x) => x.kind === 'dish')[0]; return d && d.row_count === 2 && d.qty === 45; })(),
  JSON.stringify(B.list.filter((x) => x.kind === 'dish')[0] || null));
check('3-④ 金额以「分」为单位求和（1520）',
  (() => { const d = B.list.filter((x) => x.kind === 'dish')[0]; return d && d.amount_fen === 1520; })(), 'amount_fen=1520');
check('3-⑤ 默认不含软删行（清楚的行不出现在列表）',
  B.list.every((x) => x.platform !== 'pos') && B.summary.cleared_bills === 0, 'pos 行被滤掉');
check('3-⑥ includeCleared 时含软删（追溯能力）',
  (GET ? GET.buildBillList(ROWS, { includeCleared: true }).summary.cleared_bills : -1) === 1, 'cleared_bills=1');
// 🔴 判据错订正（R252 我自己踩的第三处）：默认视图把软删的 10-07 pos 行滤掉了 ⇒
//   那个列表里**根本没有** 10-07 ⇒ 拿它验排序永远红。排序要用 **includeCleared** 的全量视图验。
const BA = GET ? GET.buildBillList(ROWS, { includeCleared: true }) : { list: [] };
check('3-⑦ 排序：新日期在前，同日期按平台（用全量视图验）',
  BA.list.length === 4 && BA.list[0].biz_date === '2026-10-08' && BA.list[3].biz_date === '2026-10-07'
  && BA.list[0].platform === 'jd_order' && BA.list[1].platform === 'taobao',
  BA.list.map((x) => x.biz_date + '/' + x.platform + '/' + x.kind).join(' , '));

// =====================================================================
sec('④ 清除匹配行为（真调 service · 含 BUG-B 回归）');
// =====================================================================
const LIVE = ROWS.filter((r) => !r.is_deleted);
const H = (targets, opts) => (CLR ? CLR.matchTargets(LIVE, targets, opts || {}).hits.map((h) => h._id) : []);
// 🔴 BUG-B 回归：kind 缺省（''）⇒ 两种形态都该命中
check('4-① 🔴 BUG-B 回归：kind 缺省 ⇒ 账单级 + 菜品级**都**命中（3 行）',
  H([{ platform: 'taobao', biz_date: '2026-10-08', kind: '' }]).length === 3,
  `${H([{ platform: 'taobao', biz_date: '2026-10-08', kind: '' }]).length} 行`);
check('4-② kind=bill ⇒ 仅账单级（1 行）',
  H([{ platform: 'taobao', biz_date: '2026-10-08', kind: 'bill' }]).length === 1, '1 行');
check('4-③ kind=dish ⇒ 仅菜品级（2 行）',
  H([{ platform: 'taobao', biz_date: '2026-10-08', kind: 'dish' }]).length === 2, '2 行');
check('4-④ 平台名含下划线也能命中（jd_order）',
  H([{ platform: 'jd_order', biz_date: '2026-10-08', kind: '' }]).length === 1,
  JSON.stringify(H([{ platform: 'jd_order', biz_date: '2026-10-08', kind: '' }])));
check('4-⑤ all=true ⇒ 全部命中（4 行未删）', H([], { all: true }).length === 4, '4 行');
check('4-⑥ 无命中 ⇒ 空数组（不误删、不报错）',
  H([{ platform: 'meituan', biz_date: '2026-10-08', kind: '' }]).length === 0, '0 行');
check('4-⑦ 软删行不参与匹配（调用方已滤；此处再验语义）',
  (CLR ? CLR.matchTargets(ROWS, [{ platform: 'pos', biz_date: '2026-10-07', kind: '' }], {}).hits.length : -1) === 1,
  '（ROWS 含 pos 软删行 ⇒ 直传应命中 1，证明滤除责任在调用方）');

// =====================================================================
sec('⑤ index.js 源码形状（顺序铁律 · 只读性 · 台账面）');
// =====================================================================
const gi = stripComments(read(GET_IDX));
const ci = stripComments(read(CLR_IDX));
check('5-① getSalesBills 是**只读**（无 insert / softDelete / .add( / .update( / .remove(）',
  gi.length > 0 && !/\.insert\(|softDelete\(|collection\([^)]*\)\.add\(|\.update\(|\.remove\(/.test(gi), '零写入调用');
check('5-② clearSalesBills **软删**（is_deleted:true + delete_at + delete_by 三件套齐）',
  /is_deleted\s*:\s*true/.test(ci) && /delete_at/.test(ci) && /delete_by/.test(ci), '软删三件套');
check('5-③ clearSalesBills **绝不物理删除**（无 .remove(）', !/\.remove\(/.test(ci), '无物理删除');
check('5-④ 幂等预检在**任何业务写之前**（findPriorResult 位置 < 第一次 .update(）',
  (() => {
    const a = ci.indexOf('findPriorResult'); const b = ci.indexOf('.update(');
    return a >= 0 && b >= 0 && a < b;
  })(), 'findPriorResult 早于 update');
check('5-⑤ 幂等 + 审计齐备（契约行标「+幂等」⇒ 代码必须有这两个）',
  /findPriorResult/.test(ci) && /writeAudit/.test(ci), 'findPriorResult + writeAudit');
check('5-⑥ 显式上限护栏存在（MAX_CLEAR_ROWS）',
  /MAX_CLEAR_ROWS\s*=\s*\d+/.test(ci) && /hits\.length\s*>\s*MAX_CLEAR_ROWS/.test(ci), '上限 + 判据');
// 🔴 R252 变异回灌抓出的漏网（A6）：上面那条只判「有赋值」⇒ 把 5000 改成 999999999 照样绿
//   —— 而上限的意义正是「**别太大**」（云函数有时限，无上限的循环会超时且半途而废）。
//   ⇒ 补一条**上界判据**：上限必须 ≤ 10000（与「单次清除」的物理含义相称）。
(() => {
  const m = /MAX_CLEAR_ROWS\s*=\s*(\d+)/.exec(ci);
  const v = m ? Number(m[1]) : NaN;
  check('5-⑥-b 上限必须是**有效的上界**（≤ 10000，不是摆设）',
    Number.isFinite(v) && v > 0 && v <= 10000, `MAX_CLEAR_ROWS = ${m ? m[1] : '(缺)'}`);
})();
check('5-⑦ 鉴权与归属校验齐备（resolveAuth + assertShopOwner）',
  /resolveAuth\(/.test(gi) && /assertShopOwner\(/.test(gi) && /resolveAuth\(/.test(ci) && /assertShopOwner\(/.test(ci),
  '两函数均 A 类');
check('5-⑧ 两函数均**不碰**成本卡 / M1 / 台账（复盘页只读红线）',
  !/shop_cost_card|shop_ledger|monthly_profit/.test(gi) && !/shop_cost_card|shop_ledger|monthly_profit/.test(ci),
  '零跨集合写');

// =====================================================================
sec('⑥ 校验层形状（validate.js 独立 · R56 立约）');
// =====================================================================
const gv = stripComments(read('cloudfunctions/getSalesBills/validate.js'));
const cv = stripComments(read('cloudfunctions/clearSalesBills/validate.js'));
check('6-① 两函数各带独立 validate.js（入参面不裸奔）',
  gv.length > 300 && cv.length > 300, `get=${gv.length} / clear=${cv.length}`);
check('6-② clear 校验有「targets 与 all 二选一」判据（不许都空）',
  /!all\s*&&\s*rawTargets\.length\s*===\s*0/.test(cv), '空目标 fail-closed');
check('6-③ clear 校验有「all 需 confirm_all 二次确认」判据',
  /all\s*&&\s*!confirmAll/.test(cv), '全清二次确认');
check('6-④ clear 校验逐项验 platform + biz_date 格式',
  /targets\[/.test(cv) && /DATE_RE\.test/.test(cv), '逐项校验');

// =====================================================================
sec('⑦ 自检：判据非退化（合成样本必须能判红）');
// =====================================================================
check('7-① 自检：空列表的 buildBillList 必须给出 0 条（非恒真有值）',
  (GET ? GET.buildBillList([], {}).list.length : -1) === 0, '空 ⇒ 0 条');
check('7-② 自检：unknown 形态必须被计入 unknownCount 而非静默吞掉',
  (GET ? GET.buildBillList([{ _id: 'XXX_1', qty: 1, amount: 1 }], {}).unknownCount : -1) === 1, 'unknownCount=1');
check('7-③ 自检：匹配「认不出形态的行」必须 0 命中（不误删）',
  (CLR ? CLR.matchTargets([{ _id: 'XXX_1' }], [{ platform: 'taobao', biz_date: '2026-10-08', kind: '' }], { all: true }).hits.length : -1) === 0,
  '全清也不碰认不出的 id');

console.log(`\n===== 已导入账单守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
