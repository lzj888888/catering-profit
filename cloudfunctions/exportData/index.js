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
  const scope = v.scope === 'm3_cards' ? 'm3_cards' : 'm1_report';
  const format = v.format === 'json' ? 'json' : 'excel';
  const month = (typeof v.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.month)) ? v.month : '';
  if (scope === 'm1_report' && !month) return fail(ERROR_CODES.INVALID_PARAM, 'm1_report 需提供 month（YYYY-MM）');

  // ===== 2. 导出权限（只读 expire_at）=====
  const entRes = await db.collection('shop_entitlement').where({ user_id: userId }).limit(1).get();
  const ent = entRes && entRes.data && entRes.data[0];
  const expireAt = ent ? (ent.expire_at || 0) : 0;
  const isPaid = expireAt > nowUtc();
  if (!isPaid) return fail(ERROR_CODES.FEATURE_LOCKED, '导出需开通真实利润');

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
    // JSON 用唯一键名（CSV 表头可有重复列标签；JSON 键必须唯一，防 fromEntries 覆盖）
    ? body.map((b) => Object.fromEntries(jsonKeys(scope).map((k, i) => [k, b[i]])))
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