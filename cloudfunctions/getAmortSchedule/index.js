// cloudfunctions/getAmortSchedule/index.js —— 批次 4 · M1 摊销台账 + 当月摊销（Controller 层 · 读）
//
// 鉴权 → 校验 → DataAdapter 读该店活跃摊销资产（软删自动排除）→ 内嵌 calcAmortize 引擎算当月摊销。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { amortizeForMonth, amountForMonth, resolveArchiveSwitches, monthIndex, fmtMonthIdx } = require('./service');
const { validateInput } = require('./validate');

// round106（F5b）：留存数据 —— 「已摊多少期 / 还剩余多少未摊 / 哪个月摊完」。
//   纪律：剩余额**必须由引擎累加**（逐月调 amountForMonth），前端只格式化，绝不重算摊销公式。
//   区间口径与引擎一致：起 = start_month；止 = min(自然到期月, terminate_month)。
function progressOf(asset, month) {
  const start = monthIndex(asset.start_month);
  const naturalEnd = start + asset.total_months - 1;
  let end = naturalEnd;
  if (asset.terminate_month) { const t = monthIndex(asset.terminate_month); if (t < naturalEnd) end = t; }
  const mi = monthIndex(month);
  const paidMonths = mi < start ? 0 : (Math.min(mi, end) - start + 1);
  let paidFen = 0;
  for (let k = start; k <= Math.min(mi, end); k++) paidFen += amountForMonth(asset, fmtMonthIdx(k));
  return {
    paid_months: paidMonths,
    total_periods: asset.total_months,
    paid_fen: paidFen,
    remaining_fen: asset.total_value - paidFen,
    end_month: fmtMonthIdx(end),
  };
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);

  const da = makeAdapter(db);
  // round107：本页/编辑页要知道**这个月有没有归档** —— 一次性投入挂在月份上，归档后不该再改。
  //   与 saveAsset 的 archiveLocked / saveLedger 的归档守卫是同一把锁（这里只做前置提示，不替代服务端拦截）。
  const accRes = await da.list('shop_monthly_account', { shop_id: shopId, month: v.month });
  const acc = (accRes && accRes.data && accRes.data[0]) || null;
  const isArchive = !!(acc && acc.is_archive);

  // round108（真机缺陷修复）：把**服务端权威**的摊销开关随本页数据一起返回。
  //   起因（李老师真机）：开关「关不上，会自动调整为打开状态」。
  //   真因 = 摊销页原来从 `app.globalData.switches`（**前端缓存**）读开关，而那个缓存只在 getShopContext
  //     时写一次 —— 保存开关后**没有任何人刷新它** ⇒ 页面保存后重拉时读回**旧值**（true）⇒ 开关自己弹回打开。
  //   修法与 getLedger 一致：**页面只认云函数出参**（渲染本页的那次调用就是唯一真相源），不认前端缓存。
  //   注：开关本身的口径没变 —— 关掉 ⇒ 摊销不进真实利润（引擎 `effectiveAmortizeFen` 已按此实现）。
  //
  // 🔴 R735（多轮审计挖出的连带缺陷）：**归档月必须用落库快照，不能用实时开关**。
  //   与 getLedger 同一纪律（R257）：归档月的展示值每次读都现算，参与计算的参数必须一起冻结。
  //   病灶：本页原先直接读实时 shop_switch ⇒ 归档后关掉开关，摊销页说「本月未扣」，
  //     而结果页/月报列表经 getLedger 走快照、说「扣了」 ⇒ **同一月份两个页面互相打脸**。
  //   ⚠️ 本轮把页首大数字改成跟开关走（关闭 ⇒ ¥0.00），若不修这里，矛盾会被放大成显性错误。
  const swRes = await da.list('shop_switch', { shop_id: shopId });
  const swRows = (swRes && swRes.data) || [];
  // ⚠️ 这里刻意用**两处显式字面**而不是一个通用 `swGet(key)`：
  //   `getShopContext/selftest.js` 的 R298X-J3e 要求「直连 switch_key === 开关名字面 的命中 ≥2」，
  //   它守的是「静态扫描面没退化」这个前提（扫描面空了，后面的键覆盖检查会恒绿）。
  //   换成通用函数后字面消失 ⇒ 命中数掉到 1 ⇒ 前提断言判红（实测踩过，不是产品缺陷）。
  //   ⚠️ 本注释不要在反引号里写出「switch_key 后面跟一个带引号的示例键名」——
  //     J3c 的正则会把注释里的示例当成真字面，判「未登记键」（本轮踩过一次）。
  //   显式写法同时也更直白：看到 switch_key 就知道读的是哪把开关。
  const liveInventoryOn = !!((swRows.find((r) => r.switch_key === 'inventory_switch') || {}).enabled);
  const liveAmortizeOn = !!((swRows.find((r) => r.switch_key === 'amortize_switch') || {}).enabled);
  const sw = resolveArchiveSwitches({
    isArchive,
    switchUsed: acc && acc.switch_used,
    liveInventorySwitchOn: liveInventoryOn,
    liveAmortizeSwitchOn: liveAmortizeOn,
  });
  const amortizeSwitchOn = sw.amortizeSwitchOn;

  const res = await da.list('shop_amortize', { shop_id: shopId });
  const rows = ((res && res.data) || []).map((a) => ({
    asset_id: a.asset_id || a.id, name: a.name || '',
    total_value: a.value_fen != null ? a.value_fen : a.total_value,
    start_month: a.start_month, total_months: a.total_months,
    terminate_month: a.terminate_month || '',
    // H1（批次 8c）：多次采购分组字段透传（老数据无此字段 → '' / 1，前端按独立资产处理）
    group_id: a.group_id || '', batch_seq: a.batch_seq || 1,
    asset_kind: a.asset_kind || '',   // R653：老数据没有该字段 ⇒ 空串（前端显示「未分类」）
    // round107：处置方式。缺字段的老数据一律按 'amort'（老行为不变）
    mode: a.mode === 'lump' ? 'lump' : 'amort',
  }));
  // round107：两类投入**拆开返回**。
  //   摊销引擎只吃 mode='amort' 的行 —— 一次性投入不进摊销公式（虽然 total_months=1 时数值恰好相同，
  //   但口径归属就错了：它不是「1 个月摊完」，而是「当月一次性费用」，在利润表里进的是另一个减项）。
  const assets = rows.filter((a) => a.mode !== 'lump');
  // 本月一次算清清单：只列「计入月份 == 本月」的行（别月的一次性投入与本月无关）
  const lumps = rows.filter((a) => a.mode === 'lump' && a.start_month === v.month);
  const sched = amortizeForMonth(assets, v.month);

  return ok({
    shop_id: shopId, month: v.month,
    assets: assets.map((a) => Object.assign({
      asset_id: a.asset_id, name: a.name, value_fen: a.total_value,
      start_month: a.start_month, total_months: a.total_months, terminate_month: a.terminate_month,
      group_id: a.group_id, batch_seq: a.batch_seq,
    }, progressOf(a, v.month))),
    // round107：本月一次性投入清单（金额取台账原值，前端只做 fenToYuan 格式化，绝不重算）
    lumps: lumps.map((a) => ({
      item_id: a.asset_id, name: a.name, amount_fen: a.total_value, month: a.start_month,
    })),
    lump_total_fen: lumps.reduce((s, a) => s + (a.total_value || 0), 0),
    // round107：该月归档态（前端据此把一次性投入与台账操作置只读；服务端另有硬拦截）
    is_archive: isArchive,
    // round108：摊销开关（服务端权威）—— 前端**必须**用这个值渲染开关，不得读 globalData 缓存
    // 🔴 R735：归档月这里返回的是**落库快照值**（source='snapshot'），与 getLedger 同口径。
    //   switch_source 一并返回，便于排查「这个月的开关到底按哪份算的」。
    amortize_switch_on: amortizeSwitchOn,
    switch_source: sw.source,
    total_amount_fen: sched.total_amount_fen,
    details: sched.details,
    client_request_id: v.input.client_request_id || '',
  });
};