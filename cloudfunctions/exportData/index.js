// cloudfunctions/exportData/index.js —— 批次 7 · 用户端数据导出（Controller 层 · 读）
//
// ⚠️ 导出权限解耦（批次 7 §2.8）：**只读 shop_entitlement.expire_at** 判定（付费档才可导出），
//   **不读 plan_id**；开关/文案由后端控制（免费用户由前端弹付费窗，后端返回 FEATURE_LOCKED 兜底）。
// ⚠️ 异步导出 + 进度（§2.4）：本函数生成内容并返回（v1.0 简版：云函数内同步生成，前端显示
//   「正在导出…」进度提示条 + loading，不阻塞 UI；超大数据量的任务队列排 v1.1 选做）。
//   · scope = 'm1_report'（M1 月度报表）| 'm3_cards'（M3 成本卡批量）
//   · format = 'excel'（CSV+BOM，Excel 可开）| 'json'
//   · 文件名含店铺名 + 月份（对齐 §2.4）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { makeAdapter } = common.dataAdapter;
const { nowUtc } = common.utilTime;
const { hasFeature } = common;                      // 付费判定单源（M3.28 批次 Q3）

// ===================== CSV 纯函数（可单测）=====================
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvFromRows(header, rows) {
  return '\uFEFF' + [header].concat(rows).map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

// JSON 导出用唯一键名（CSV 表头允许重复列标签，JSON 键必须唯一）
function jsonKeys(scope) {
  if (scope === 'm3_cards') return ['card_code', 'dish_name', 'version', 'total_cost_fen', 'price_fen', 'gross_margin_pct', 'calc_mode'];
  return ['income_name', 'income_amount_fen', 'expense_name', 'expense_amount_fen', 'operation_ref_profit_fen', 'total_factor_real_profit_fen'];
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  const v = (event && event.input) || event || {};
  // M2v1.3：对比表导出（Excel 付费，复用 'export' 能力键）。前端已用 calcSandbox 重算好
  //   compare 表（且图片/Excel 两出口共用同一份已算结果），本函数只做事后序列化 + 归属校验。
  const isCompare = v.export_type === 'm2_compare';
  const scope = isCompare ? 'm2_compare' : (v.scope === 'm3_cards' ? 'm3_cards' : 'm1_report');
  const format = v.format === 'json' ? 'json' : 'excel';
  const month = (typeof v.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.month)) ? v.month : '';
  if (!isCompare && scope === 'm1_report' && !month) return fail(ERROR_CODES.INVALID_PARAM, 'm1_report 需提供 month（YYYY-MM）');
  // M2 对比：plan_ids 必须 1~3 个非空字符串
  if (isCompare) {
    const planIds = Array.isArray(v.plan_ids) ? v.plan_ids.filter((s) => typeof s === 'string' && s) : [];
    if (planIds.length === 0 || planIds.length > 3) {
      return fail(ERROR_CODES.INVALID_PARAM, 'm2_compare 需 1~3 个 plan_ids（不泄漏他人方案是否存在）');
    }
  }

  // ===== 2. 导出权限（只读 expire_at）=====
  // M3.28（批次 Q3）：判定下沉到单源 common/entitlement.js —— 理由见该文件头注。
  //   ⚠️ 不许在本函数里写第二遍 `expireAt > nowUtc()`：付费语义一旦分叉，"导出"与"S1 套餐"就会给出两个答案。
  const canExport = await hasFeature(db, userId, 'export');
  if (!canExport) return fail(ERROR_CODES.FEATURE_LOCKED, '导出需开通真实利润');

  const da = makeAdapter(db);
  const shopDoc = await da.get('shop', shopId);
  const shopName = shopDoc ? (shopDoc.name || '') : '';
  const stamp = nowUtc();

  // ===== 3. 取数并生成 =====
  let header, body, filename;
  if (scope === 'm1_report') {
    const r = await da.list('shop_monthly_account', { shop_id: shopId, month });
    const row = r && r.data && r.data[0];
    const income = (row && row.income_items) || [];
    const expense = (row && row.expense_items) || [];
    header = ['收入项', '金额(分)', '费用项', '金额(分)', '经营参考利润(分)', '真实利润(分)'];
    // 展平：收入/费用并列行
    const n = Math.max(income.length, expense.length);
    body = [];
    for (let i = 0; i < n; i++) {
      body.push([
        income[i] ? (income[i].name || '') : '',
        income[i] ? (income[i].amount_fen || 0) : '',
        expense[i] ? (expense[i].name || '') : '',
        expense[i] ? (expense[i].amount_fen || 0) : '',
        row ? (row.operation_ref_profit_fen || 0) : 0,
        row ? (row.total_factor_real_profit_fen || 0) : 0,
      ]);
    }
    filename = `${shopName || '店铺'}_${month}_月度报表.${format === 'json' ? 'json' : 'csv'}`;
  } else if (scope === 'm2_compare') {
    // M2 对比表：前端已用 calcSandbox 重算好 `table`（= 图片/Excel 两出口共用同一份已算结果）。
    // 本函数只做归属校验（不泄漏他人方案）+ 序列化。
    const planIds = v.plan_ids.filter((s) => typeof s === 'string' && s);
    for (const pid of planIds) {
      const r = await da.list('shop_sandbox', { shop_id: shopId, sandbox_id: pid });
      if (!(r && r.data && r.data.length)) {
        return fail(ERROR_CODES.RESOURCE_NOT_FOUND, `方案 ${pid} 不存在或不属于本店`);
      }
    }
    const table = (v.table && Array.isArray(v.table.rows)) ? v.table : { header: [], rows: [] };
    header = Array.isArray(table.header) ? table.header : [];
    body = table.rows || [];
    filename = `${shopName || '店铺'}_方案对比.${format === 'json' ? 'json' : 'csv'}`;
  } else {
    const res = await da.list('shop_cost_card', { shop_id: shopId });
    const cards = ((res && res.data) || []);
    // 按 card_code 取最新版本
    const latest = new Map();
    for (const c of cards) {
      const cc = c.card_code;
      if (!cc) continue;
      const cur = latest.get(cc);
      if (!cur || (c.version || 0) > (cur.version || 0)) latest.set(cc, c);
    }
    header = ['card_code', '菜品名称', '版本', '单份成本(分)', '建议售价(分)', '毛利率%', '核算模式'];
    body = Array.from(latest.values()).map((c) => [
      c.card_code || '', c.name || '', c.version || 1,
      c.total_cost != null ? c.total_cost : 0,
      c.price_list != null ? c.price_list : 0,
      c.gross_margin_pct != null ? c.gross_margin_pct : 0,
      c.calc_mode === 2 ? 'B' : 'A',
    ]);
    filename = `${shopName || '店铺'}_成本卡_${month || '全部'}.${format === 'json' ? 'json' : 'csv'}`;
  }

  const payload = format === 'json'
    ? body.map((b) => {
      if (scope === 'm2_compare') {
        // JSON 键必须唯一（CSV 表头可有重复列标签；JSON fromEntries 会覆盖）—— dup 时追加下标
        const o = {};
        header.forEach((k, i) => { let key = String(k); if (o[key]) key = key + '_' + i; o[key] = b[i]; });
        return o;
      }
      return Object.fromEntries(jsonKeys(scope).map((k, i) => [k, b[i]]));
    })
    : csvFromRows(header, body);

  return ok({
    shop_id: shopId,
    scope,
    format,
    filename,
    // 进度提示字段：简版直接生成完毕
    progress: 100,
    status: 'ready',
    content: payload,
    count: body.length,
    generated_at: stamp,
    client_request_id: v.client_request_id || '',
  });
};

// 导出供 selftest
exports.csvEscape = csvEscape;
exports.csvFromRows = csvFromRows;