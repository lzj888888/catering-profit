// cloudfunctions/importSalesBill/index.js —— 批次 F 阶段① 账单导入（Controller · 写 external_sales_daily）
//
// 流程：鉴权 → 校验 → cloud.downloadFile 取文件 → xlsx 转矩阵 → billParse → 甲级门禁 gradeGate
//       → confirm=false 返回预览（不落库）→ confirm=true 甲级通过才落库 → 返回写入条数。
// 🔴 落库口径照 PLAN §四-bis：_id = 'BILL_<shop_id>_<platform>_<biz_date>'（确定性 ⇒ 幂等），
//    .doc(_id).set() 覆盖写；external_ref_id = 'BILL:<platform>:<biz_date>'；dish_key 空串。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const { bufferToMatrix, detectPlatform, guessHeader, parseBillMatrix, checkGradeA, SALES_SCHEMA } = require('./service');
const { validateInput } = require('./validate');

exports.main = async (event) => {
  const ctx = cloud.getWXContext();

  // ===== 1. 鉴权中间件（批次 0）=====
  const auth = await resolveAuth(ctx, db);
  if (auth.error) return fail(auth.error);
  const userId = auth.user.id;

  const shopId = event && event.shop_id;
  const owner = await assertShopOwner(db, shopId, userId);
  if (owner.error) return fail(owner.error, owner.msg);

  // ===== 2. 校验 =====
  const v = validateInput(event);
  if (v.error) return fail(v.error, v.msg);
  const clientRequestId = v.input.client_request_id;

  // ===== 3. 下载文件 =====
  let buffer;
  try {
    const res = await cloud.downloadFile({ fileID: v.fileID });
    buffer = res.fileContent;
  } catch (e) {
    return fail(ERROR_CODES.INVALID_PARAM, '文件下载失败：' + (e && (e.errMsg || e.message)));
  }
  if (!buffer) return fail(ERROR_CODES.INVALID_PARAM, '文件内容为空');

  // ===== 4. xlsx → 矩阵 =====
  const matrix = bufferToMatrix(buffer);

  // ===== 5. 确定平台（传了用之；否则按表头自动检测）=====
  const sheetNameByPlatform = { taobao: '外卖账单明细', meituan: '订单明细' };
  let platform = v.platform;
  if (!platform) {
    for (const name of Object.keys(matrix.sheets)) {
      const s = matrix.sheets[name];
      const hdr = (s.rows[guessHeader(s.rows)] || []).map((x) => String(x).trim());
      const p = detectPlatform(hdr);
      if (p) { platform = p; break; }
    }
  }
  if (!platform || !matrix.sheets[sheetNameByPlatform[platform]]) {
    return fail(ERROR_CODES.INVALID_PARAM, '无法识别账单平台（请确认是淘宝闪购或美团外卖账单）');
  }

  // ===== 6. 解析 =====
  const parsed = parseBillMatrix(matrix, { platform });

  // ===== 7. 甲级门禁（fail-closed）=====
  const grade = checkGradeA({ platform, shopId, header: parsed.header, rows: parsed.rows, totals: parsed.totals }, SALES_SCHEMA);

  // ===== 8. 预览（confirm 缺省/false，不落库）=====
  if (!v.confirm) {
    return ok({
      shop_id: shopId,
      platform,
      grade,
      preview: {
        headerRow: parsed.headerRow,
        rows: parsed.rows,
        totals: parsed.totals,
        months: parsed.months,
        excluded: parsed.excluded,
      },
      client_request_id: clientRequestId || '',
    });
  }

  // ===== 9. 落库（confirm === true，甲级通过才落库）=====
  if (!grade.pass) {
    return fail(ERROR_CODES.INVALID_PARAM, '甲级门禁未通过，已阻断落库');
  }

  // 🔒 R181l 幂等（重放形态）：命中即返回首次结果、不重复写入。
  //    本函数落库用确定性 _id（同店同平台同账单日 ⇒ 覆盖同一文档），语义上已幂等；
  //    此处按项目红线「写操作带 client_request_id 幂等」补**显式**预检 + 审计登记（形态对齐 syncCostCard）。
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  const now = nowUtc();
  let written = 0;
  for (const r of parsed.rows) {
    const _id = 'BILL_' + shopId + '_' + platform + '_' + r.bizDate;
    await db.collection('external_sales_daily').doc(_id).set({
      data: {
        shop_id: shopId,
        biz_date: r.bizDate,
        external_ref_id: 'BILL:' + platform + ':' + r.bizDate,
        dish_key: '',
        qty: r.qty,
        amount: r.amountFen,          // 整数分
        platform,
        source: 'excel',
        created_at: now,
      },
    });
    written++;
  }

  const out = {
    shop_id: shopId,
    platform,
    written,
    totals: parsed.totals,
    client_request_id: clientRequestId || '',
  };

  // 幂等登记（键与上面查重键**同源**，一律走单源 shopKey）
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'IMPORT_SALES_BILL',
        operator_type: 'user',
        operator_id: userId,
        shop_id: shopId,
        after_data: out,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }

  return ok(out);
};
