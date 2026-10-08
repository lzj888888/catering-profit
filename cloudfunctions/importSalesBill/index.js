// cloudfunctions/importSalesBill/index.js —— 批次 F 阶段① 账单导入 + 批次 G 堂食菜品销量导入（Controller · 写 external_sales_daily）
//
// 流程：鉴权 → 校验 → cloud.downloadFile 取文件 → xlsx 转矩阵 → 分流（堂食菜品表 / 外卖账单）
//       → 解析 → 甲级门禁 gradeGate → confirm=false 返回预览（不落库）→ confirm=true 甲级通过才落库。
// 🔴 堂食菜品表（批次 G §2.2）落库口径：
//    _id = 'SALE_<shop_id>_<platform>_<biz_date>_<seq>'（确定性 ⇒ 幂等，同表重导覆盖同文档）；
//    external_ref_id = 'DISH:<platform>:<biz_date>:<dish_key>'（🔴 必含 dish_key 段，见 §5.1 ——
//      否则唯一索引 (shop_id, biz_date, external_ref_id) 会让同平台同天所有菜共用同一三元组 ⇒ 只落得下 1 条）；
//    amount = 菜品收入(元) 转分整数（实际收入口径，不用毛销售额）；qty = Math.round 整数；platform='pos'。
// 🔴 外卖账单（批次 F）口径不变：_id='BILL_...'、external_ref_id='BILL:...'、dish_key=''。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const common = require('./common');                 // 扁平派生副本（sync_common 生成）
const { resolveAuth, assertShopOwner } = common;
const { ERROR_CODES, ok, fail } = common;
const { nowUtc } = common.utilTime;
const {
  bufferToMatrix, detectPlatform, guessHeader, parseBillMatrix, checkGradeA, SALES_SCHEMA,
  pickSheet,   // R245：🔴 京东表名不固定 ⇒ 判定 sheet 是否存在必须按签名找，不能硬编码表名
  DISH_SHAPES, detectDishMatrix, parseDishSales, parseDishSalesC, dishRefId, saleDocId,
} = require('./service');
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

  // ===== 5. 分流：堂食菜品销售表（批次 G）优先，识别不出再走外卖账单（批次 F）=====
  const dishDetect = detectDishMatrix(matrix);
  if (dishDetect.shape) {
    return handleDishImport({ shopId, userId, clientRequestId, dishDetect, matrix, confirm: v.confirm, platform: v.platform });
  }

  // ===== 6. 外卖账单（批次 F 原路径）=====
  let platform = v.platform;
  if (!platform) {
    for (const name of Object.keys(matrix.sheets)) {
      const s = matrix.sheets[name];
      const hdr = (s.rows[guessHeader(s.rows)] || []).map((x) => String(x).trim());
      const p = detectPlatform(hdr);
      if (p) { platform = p; break; }
    }
  }
  // 🔴 R245：判定「表在不在」改为按签名找 sheet（京东表名不固定：com.jd.o2o… / sku对账单下载）
  if (!platform || !pickSheet(matrix.sheets, platform)) {
    return fail(ERROR_CODES.INVALID_PARAM, '无法识别账单平台（请确认是淘宝闪购、美团外卖、京东秒送账单，或堂食《菜品销售统计》）');
  }

  const parsed = parseBillMatrix(matrix, { platform });
  const grade = checkGradeA({ platform, shopId, header: parsed.header, rows: parsed.rows, totals: parsed.totals }, SALES_SCHEMA);

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

  if (!grade.pass) return fail(ERROR_CODES.INVALID_PARAM, '甲级门禁未通过，已阻断落库');

  // 🔒 R181l 幂等（重放形态）：命中即返回首次结果、不重复写入。
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

  const out = { shop_id: shopId, platform, written, totals: parsed.totals, client_request_id: clientRequestId || '' };
  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'IMPORT_SALES_BILL', operator_type: 'user', operator_id: userId, shop_id: shopId,
        after_data: out,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }
  return ok(out);
};

/**
 * 堂食《菜品销售统计》（形态 A）导入：解析 → 甲级门禁 → 落库 → 摘要写 shop_switch.m3_review_last。
 * 🔴 形态 B（套餐明细）不入库（套餐组分已并入菜品表，§6 重复计算禁令）；形态 C 预留（待样例）。
 */
async function handleDishImport({ shopId, userId, clientRequestId, dishDetect, matrix, confirm, platform }) {
  // 形态 B：套餐明细表 —— 不入库（组分已并入菜品表，禁止两表相加）
  if (dishDetect.shape === DISH_SHAPES.B) {
    return fail(ERROR_CODES.INVALID_PARAM, '这是套餐销售明细表，套餐组分已并入菜品销售表，本表仅作交叉校验、不单独导入。');
  }
  // 形态 C：外卖商品销量 —— v1.7 C-2~C-7 本批实现真导入（platform 由调用方显式传入）
  if (dishDetect.shape === DISH_SHAPES.C) {
    return handleFormCImport({ shopId, userId, clientRequestId, dishDetect, matrix, confirm, platform });
  }
  // 仅形态 A 走主路径
  const sheetRows = matrix.sheets[dishDetect.sheet].rows;
  const parsed = parseDishSales(sheetRows);

  // 甲级门禁（fail-closed）：biz_date 格式 / qty 整数 / amount 整数 / platform 枚举
  const gradeRows = parsed.rows.map((r) => ({ bizDate: parsed.bizDate, qty: r.qty, amountFen: r.amountFen }));
  const grade = checkGradeA({ platform: 'pos', shopId, header: [], rows: gradeRows, totals: parsed.totals }, SALES_SCHEMA);

  // 预览（不落库）
  if (!confirm) {
    return ok({
      shop_id: shopId,
      platform: 'pos',
      shape: DISH_SHAPES.A,
      grade,
      preview: {
        bizDate: parsed.bizDate,
        rows: parsed.rows,
        totals: parsed.totals,
        nonInt: parsed.nonInt,
        unmatched: parsed.unmatched,
      },
      client_request_id: clientRequestId || '',
    });
  }

  if (!grade.pass) return fail(ERROR_CODES.INVALID_PARAM, '甲级门禁未通过，已阻断落库');
  if (!parsed.bizDate) return fail(ERROR_CODES.INVALID_PARAM, '无法识别营业日期（表头参数行缺失日期区间）');

  // 🔒 幂等（重放形态）：命中即返回首次结果、不重复写入。
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  const now = nowUtc();
  let written = 0;
  for (let seq = 0; seq < parsed.rows.length; seq++) {
    const r = parsed.rows[seq];
    const _id = saleDocId(shopId, 'pos', parsed.bizDate, seq);
    await db.collection('external_sales_daily').doc(_id).set({
      data: {
        shop_id: shopId,
        biz_date: parsed.bizDate,
        external_ref_id: dishRefId('pos', parsed.bizDate, r.dishKey),
        dish_key: r.dishKey,
        qty: r.qty,
        amount: r.amountFen,          // 实际收入（元→分，整数）
        platform: 'pos',
        source: 'excel',
        created_at: now,
      },
    });
    written++;
  }

  // 摘要写 shop_switch.m3_review_last（批次时间 / 来源 / 行数 / 未匹配数 / 非整数 qty 数）
  const summary = {
    batch_at: now,
    source: 'excel',
    platform: 'pos',
    biz_date: parsed.bizDate,
    row_count: parsed.rows.length,
    unmatched_count: parsed.unmatched.length,
    nonint_qty_count: parsed.nonInt.length,
  };
  try {
    await upsertSwitch(db, shopId, 'm3_review_last', JSON.stringify(summary), now);
  } catch (e) { /* 摘要写失败不阻断主流程 */ }

  const out = {
    shop_id: shopId,
    platform: 'pos',
    shape: DISH_SHAPES.A,
    biz_date: parsed.bizDate,
    written,
    totals: parsed.totals,
    nonInt: parsed.nonInt,
    unmatched: parsed.unmatched,
    client_request_id: clientRequestId || '',
  };

  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'IMPORT_DISH_SALES', operator_type: 'user', operator_id: userId, shop_id: shopId,
        after_data: out,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }
  return ok(out);
}

/**
 * 形态 C（外卖「商品销量」）导入：解析 → 甲级门禁 → 落库（一表多天 ⇒ 多组，v1.7 C-7）。
 * 🔴 platform 必须由调用方显式传入（不许按文件名猜）；落库时缺值 ⇒ fail('请选择外卖平台')，不许 fallback 'other'。
 */
async function handleFormCImport({ shopId, userId, clientRequestId, dishDetect, matrix, confirm, platform }) {
  const sheetRows = matrix.sheets[dishDetect.sheet].rows;
  const parsed = parseDishSalesC(sheetRows, { platform });

  // 甲级门禁（fail-closed）：逐组展开成行喂 checkGradeA；platform 由 opts 传入（R181m）
  const gradeRows = [];
  for (const g of parsed.groups) {
    for (const r of g.rows) gradeRows.push({ bizDate: g.bizDate, qty: r.qty, amountFen: r.amountFen });
  }
  const grade = checkGradeA({ platform: platform || '', shopId, header: [], rows: gradeRows, totals: parsed.totals }, SALES_SCHEMA);

  // 预览（不落库）：zeroAmountQty 必须可见（用户要先知道「这份表里有 N 份是 0 元的」）
  //
  // 🔴 预览**不因缺 platform 而阻断**（R232j 修订）：形态 C 的平台机器判不出，必须由用户在
  //   预览之后选（页面上 picker 就长在预览卡里）⇒ 首次预览时 platform 必然为空。
  //   若此处按 `grade.pass` 决定界面上是否给「确认导入」按钮，就会形成**死锁**：
  //     没按钮 → 用户选不了平台 → 平台永远空 → 门禁永远不过 → 按钮永远不出现。
  //   ⇒ 预览回一个 `platform_missing: true` 的**提示位**（界面照常渲染 picker + 合计），
  //     **真正阻断只发生在本函数 confirm=true 分支**（下方 `if (!platform) return fail`）。
  //   门禁里的非-platform 项（日期/金额/qty/门店）与 platform 无关，照常在预览里如实上报。
  const gradeNonPlatform = {
    pass: grade.failures.every((f) => f.code === 'SCHEMA_PLATFORM'),
    level: grade.level,
    failures: grade.failures.filter((f) => f.code !== 'SCHEMA_PLATFORM'),
  };
  if (!confirm) {
    return ok({
      shop_id: shopId,
      platform: platform || '',
      shape: DISH_SHAPES.C,
      // 预览期门禁：剔掉 platform 项（平台的阻断留给 confirm；见上方注释）
      grade: platform ? grade : gradeNonPlatform,
      platform_missing: !platform,
      preview: {
        groups: parsed.groups,
        totals: parsed.totals,
        nonInt: parsed.nonInt,
        zeroAmountQty: parsed.zeroAmountQty,
        unmatched: parsed.unmatched,
      },
      client_request_id: clientRequestId || '',
    });
  }

  // 🔴 落库：platform 必填，缺值 fail（不许 fallback 'other' 静默入库）
  if (!platform) return fail(ERROR_CODES.INVALID_PARAM, '请选择外卖平台');
  if (!grade.pass) return fail(ERROR_CODES.INVALID_PARAM, '甲级门禁未通过，已阻断落库');

  // 🔒 幂等（重放形态）：命中即返回首次结果、不重复写入。
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  const now = nowUtc();
  let written = 0;
  for (const g of parsed.groups) {
    for (let seq = 0; seq < g.rows.length; seq++) {
      const r = g.rows[seq];
      const _id = saleDocId(shopId, platform, g.bizDate, seq);
      await db.collection('external_sales_daily').doc(_id).set({
        data: {
          shop_id: shopId,
          biz_date: g.bizDate,
          external_ref_id: dishRefId(platform, g.bizDate, r.dishKey),
          dish_key: r.dishKey,
          qty: r.qty,
          amount: r.amountFen,          // 销售额(元) → 分整数（🔴 非订单交易额）
          platform,
          source: 'excel',
          created_at: now,
        },
      });
      written++;
    }
  }

  const out = {
    shop_id: shopId,
    platform,
    shape: DISH_SHAPES.C,
    written,
    groups: parsed.groups.map((g) => ({ bizDate: g.bizDate, count: g.rows.length })),
    totals: parsed.totals,
    zeroAmountQty: parsed.zeroAmountQty,
    unmatched: parsed.unmatched,
    client_request_id: clientRequestId || '',
  };

  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'IMPORT_DISH_SALES_C', operator_type: 'user', operator_id: userId, shop_id: shopId,
        after_data: out,
        idempotency_key: common.idempotency.shopKey(shopId, clientRequestId),
      });
    } catch (e) { /* 审计失败不阻断主流程 */ }
  }
  return ok(out);
}

// shop_switch upsert（唯一键 shop_id + switch_key；沿用 saveShopSetting 同款写法，零新建集合）
async function upsertSwitch(db, shopId, key, value, now) {
  const res = await db.collection('shop_switch')
    .where({ shop_id: shopId, switch_key: key, is_deleted: false })
    .limit(1).get();
  const row = (res && res.data && res.data[0]) || null;
  if (row) {
    await db.collection('shop_switch').doc(row._id).update({ data: { value, updated_at: now } });
  } else {
    await db.collection('shop_switch').add({
      data: { shop_id: shopId, switch_key: key, value, created_at: now, updated_at: now, is_deleted: false },
    });
  }
}
