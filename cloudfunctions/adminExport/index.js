// cloudfunctions/adminExport/index.js —— 批次 6/7 · 数据导出（adminAuth + 角色控权）
//
// ⚠️ 导出权限（批次 6 §2.9）：**仅超管可导出全量数据，运营仅可导出订单明细**（云函数层拦截）。
// ⚠️ 所有导出操作写 audit_log（导出人/时间/数据范围）。
// ⚠️ R49（健壮性）：全量/订单导出均改为**分页累取到耗尽**（service.js 的 fetchAllPages），
//   杜绝 limit(1000/2000) 静默截断；达到安全上限（20000 条）**响亮失败**（HARD_CAP_EXCEEDED）。
// ⚠️ CSV 生成在 Service 侧（service.js 的 csvFromRows），返回 CSV 文本 + 文件名；前端用 Blob 下载。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { writeAudit } = common.audit;
const { parseBearer, requireAuth, requireRole } = require('./adminAuth');
const { csvFromRows, fetchAllPages, makePagedQuery } = require('./service');

exports.main = async (event) => {
  const headers = (event && event.headers) || (event && event.header) || {};
  const token = parseBearer(headers);

  // ===== 1. adminAuth 中间件（R48：会话 + admin_user.status 双重校验）=====
  const sess = await requireAuth(db.collection('admin_login_log'), db.collection('admin_user'), token);
  if (sess.error) return fail(sess.error, '登录已失效');

  const v = (event && event.input) || event || {};
  const scope = v.scope === 'orders' ? 'orders' : (v.scope === 'entitlements' ? 'entitlements' : 'orders');
  const format = v.format === 'json' ? 'json' : 'csv';
  const clientRequestId = v.client_request_id || '';

  // ===== 2. 角色控权：全量（entitlements）仅 super；运营仅订单明细 =====
  if (scope === 'entitlements') {
    const roleErr = requireRole(sess.role, ['super']);
    if (roleErr) return fail(roleErr, '运营账号不可导出全量数据');
  }

  // ===== 3. 时间范围（导出口径：created_at 在 [from, to]）=====
  const from = v.from ? Number(v.from) : 0;
  const to = v.to ? Number(v.to) : nowUtc();
  const cond = { is_deleted: false };
  if (from > 0 || to > 0) {
    const cmd = db.command;
    cond.created_at = cmd.gte(from).and(cmd.lte(to));
  }

  const now = nowUtc();

  // ===== 4. 取数（R49：分页累取到耗尽，安全上限响亮失败）=====
  // ⚠️ R51：空 where({}) 无平台行为保证（全仓零先例），故「全量无过滤」走**不带 where 的路径**
  //   （where == null → makePagedQuery 跳过 .where()），不凑恒真条件、不赌平台对空对象的行为。留痕防后人改回去。

  try {
    if (scope === 'entitlements') {
      // 全量权益明细（仅 super；无过滤 → where=null 不带 where 取全量）
      const rows = await fetchAllPages(makePagedQuery(db.collection('shop_entitlement'))(null));
      const header = ['user_id', 'expire_at', 'source', 'updated_at'];
      const body = rows.map((r) => [r.user_id || '', r.expire_at || 0, r.source || '', r.updated_at || 0]);
      const csv = format === 'csv' ? csvFromRows(header, body) : '';
      const json = format === 'json' ? rows : [];
      await writeAudit(db, {
        action: 'ADMIN_EXPORT',
        operator_type: 'admin',
        operator_id: sess.adminId,
        shop_id: '',
        before_data: null,
        after_data: { scope: 'entitlements', format, from, to, count: rows.length },
        remark: '全量权益导出（分页取尽）',
        idempotency_key: clientRequestId ? `adm_export_${clientRequestId}` : '',
      });
      return ok({ scope, format, filename: 'entitlements_' + now + '.' + format, csv, json, count: rows.length });
    }

    // 订单明细（超管/运营均可；支持时间范围过滤）
    const rows = await fetchAllPages(makePagedQuery(db.collection('shop_payment_flow'))(cond));
    const header = ['order_no', 'user_id', 'amount_fen', 'plan_id', 'plan_name', 'status', 'channel', 'paid_at', 'created_at'];
    const body = rows.map((r) => [r.order_no || '', r.user_id || '', r.amount != null ? r.amount : 0, r.plan_id || '', r.plan_name || '', r.status || '', r.channel || '', r.paid_at || 0, r.created_at || 0]);
    const csv = format === 'csv' ? csvFromRows(header, body) : '';
    const json = format === 'json' ? rows : [];

    await writeAudit(db, {
      action: 'ADMIN_EXPORT',
      operator_type: 'admin',
      operator_id: sess.adminId,
      shop_id: '',
      before_data: null,
      after_data: { scope: 'orders', format, from, to, count: rows.length },
      remark: '订单明细导出（分页取尽）',
      idempotency_key: clientRequestId ? `adm_export_${clientRequestId}` : '',
    });

    return ok({ scope, format, filename: 'orders_' + now + '.' + format, csv, json, count: rows.length });
  } catch (e) {
    if (e && e.code === 'HARD_CAP_EXCEEDED') {
      return fail(e.code, (e && e.message) || '导出数据超过安全上限');
    }
    return fail(ERROR_CODES.SYSTEM_ERROR, (e && e.message) || '导出失败');
  }
};