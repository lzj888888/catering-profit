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
  detectPlatformInRows, detectPlatformInMatrix,   // R250：平台自动判定逐行试签名（京东订单级两级表头）
  PLATFORM_AMBIGUOUS,   // R253：多平台同时命中哨兵 —— 🔴 必须 import，truthy 陷阱见 :73 附近
  DISH_SHAPES, detectDishMatrix, parseDishSales, parseDishSalesC, parseDishSalesD, dishRefId, saleDocId,
  BILL_IMPORT_ENABLED,   // R259：账单导入开关（只作用账单，形态 A/B/C 不受影响）
  detectDupImport,       // R271：跨平台重复导入检测（纯函数，零 IO ⇒ 守卫/探针可直测）
  diagnoseColumns,       // R286：认不出表形态时「缺哪几列」诊断（走 ok 通道，见 :111 附近说明）
} = require('./service');
const { validateInput } = require('./validate');
const { parse: parseDSI1, groupByPlatformDate: parseDSI1Groups } = require('./dsi1');   // R584：DSI-1 标准格式解析与分组
// R616：老板自制《营收日报表》（日期×班次×渠道）的解析器。
//   🔴 就近放在本函数目录 —— 不进 cloudfunctions/common（那份会被 sync_common 分发到
//   全部 56 个云函数，每个多一个 cx_*.js，而只有本函数用得到）；也不进小程序包（utils/ 会打包）。
//   ⚠️ 注释里**绝对不要**写出「斜杠+星号」连在一起的写法（含 `common/` 后面紧跟星号的 markdown 粗体），
//   否则会被 `stripComments` 当成块注释开头、把中间大段代码吞掉 —— 本轮真踩过，
//   表现是幂等/pubic-surface/账单解析三个守卫同时红，且报的位置数字全都对不上。
const RevenueDaily = require('./revenueDailyParse');
// R619：营收日报表的落库/读取（只碰 revenue_batch 这一张新表，M1 一行不动）
const RevenueStore = require('./revenueStore');

// ===== R271：跨平台重复导入检测（查库版）=====
// 为什么要单独一层：detectDupImport 是**零 IO 纯函数**（可直测），IO 全隔离在本函数内。
// ⚠️ 走 `da.listAll`（与读侧 getDishReview 同一入口），不自己拼 where —— 分页/软删/上限口径同源。
// 🔴 只在**已选平台**时调用：未选平台（预览首帧）无法判断"跟谁重复"，返回 null（不是"没重复"）。
async function detectDupFromDb(shopId, platform, groups) {
  const da = common.dataAdapter.makeAdapter(db);
  // 🔴 只查**本次涉及的日期**：全店全量 listAll 在行数多时可达数秒，而本检测每批都要跑一次。
  //   日期集合来自表内 biz_date（不是今天），跨月导入也不会漏。
  const dates = [];
  (groups || []).forEach((g) => { if (g.bizDate && dates.indexOf(g.bizDate) < 0) dates.push(g.bizDate); });
  const where = { shop_id: shopId };
  if (dates.length) where.biz_date = db.command.in(dates);
  const res = await da.listAll('external_sales_daily', where);
  const existing = (res && res.data) || [];
  const incoming = [];
  (groups || []).forEach((g) => {
    (g.rows || []).forEach((r) => {
      incoming.push({ biz_date: g.bizDate, dish_key: r.dishKey, qty: r.qty, amountFen: r.amountFen });
    });
  });
  return detectDupImport(existing, incoming, platform);
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

  // ===== 1b. R619 读库分支：进页面直接看上次导的，不用重传 =====
  // 🔴 必须放在「校验 fileID / 下载文件」**之前** —— 读库没有文件，走后面的流程会因为缺 fileID 直接失败。
  if (event && event.action === 'revenue_get') {
    const month = String(event.month || '').trim();
    // month 可留空 ⇒ 取该店最近一次导入的（页面一进来就得有东西看，不能让老板先选月）
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return fail(ERROR_CODES.INVALID_PARAM, 'month 格式应为 YYYY-MM（或留空取最近一次）');
    }
    const got = await RevenueStore.getActive({ db, userId, shopId, month });
    if (!got) return ok({ revenue_stored: null, month });
    // 与上传分支**同一形状**：前端 buildView 不用改两套
    const rd = got.result || {};
    return ok({
      revenue_stored: {
        batch_id: got.batch_id,
        month: got.month,
        file_name: got.file_name,
        created_at: got.created_at,
        caliber_version: got.caliber_version,
        coverage: got.coverage,
        revenueM1: rd.revenueM1,
        cashInflow: rd.cashInflow,
        bridge: rd.bridge,
        channelYuan: rd.channelYuan,
        days: rd.days,
        shiftCount: rd.shiftCount,
        unclassified: rd.unclassified,
      },
      from_store: true,
    });
  }

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

  // ===== 5. 分流：营收日报表（R616）→ 堂食菜品表（批次 G）→ 外卖账单（批次 F）=====
  // 🔴 R616 营收日报表放在**最前**：它的签名极独特（表头同一行同时含「日期」「班次」「现金」），
  //   且不含任何菜品列、结算列 ⇒ 与菜品表/账单表的识别条件互斥，不会误判。
  //   识别到就**只解析、不落库**：本表的用途是「看清各渠道与两套口径」，
  //   要落进 M1 月度账得先定 incomeItems 结构（独立一轮），本轮不碰契约。
  const revOut = (() => {
    const names = Object.keys(matrix.sheets || {});
    for (const nm of names) {
      const rowsOf = (matrix.sheets[nm] || {}).rows || [];
      if (!RevenueDaily.detectRevenueDaily(rowsOf).hit) continue;
      const parsed = RevenueDaily.parseRevenueDaily(rowsOf);
      if (parsed.ok && !parsed.isEmpty) return parsed;
    }
    return null;
  })();
  if (revOut) {
    // 🔴 回传前一刀切：shifts 明细不回传（24 班次 × 17 列没必要全给前端），
    //   只给「日级汇总 + 两套口径 + 差额桥 + 渠道」。老板要看的是结论，不是原始表。
    const payload = {
      shape: 'revenue_daily',
        // A 现金流入（老板对现金账口径，**不是营收**）
        cashInflow: {
          formula: revOut.cashInflow.formula,
          totalYuan: revOut.cashInflow.totalYuan,
          totalFen: revOut.cashInflow.totalFen,
          declaredYuan: revOut.cashInflow.declaredYuan,
          declaredFen: revOut.cashInflow.declaredFen,
          pass: revOut.cashInflow.pass,
          checkedShifts: revOut.cashInflow.checkedShifts,
          mismatches: (revOut.cashInflow.mismatches || []).slice(0, 5),
          purpose: revOut.cashInflow.purpose,
          note: revOut.cashInflow.note,
        },
        // B 经营营收（M1 权责制，**这才是营收**）
        revenueM1: {
          formula: revOut.revenueM1.formula,
          basis: revOut.revenueM1.basis,
          dineInYuan: revOut.revenueM1.dineInYuan,
          dineInFen: revOut.revenueM1.dineInFen,
          takeawayYuan: revOut.revenueM1.takeawayYuan,
          takeawayFen: revOut.revenueM1.takeawayFen,
          totalYuan: revOut.revenueM1.totalYuan,
          totalFen: revOut.revenueM1.totalFen,
          pendingOtherYuan: revOut.revenueM1.pendingOtherYuan,
          pendingOtherFen: revOut.revenueM1.pendingOtherFen,
          note: revOut.revenueM1.note,
        },
        // C 差额桥（老板会问「跟我记的为什么不一样」，这就是答案）
        bridge: revOut.bridge,
        channelYuan: revOut.channelYuan,
        // 日级汇总：只给「哪天、营收多少、几个班次」
        days: (revOut.days || []).map((d) => ({
          date: d.date,
          revenueM1Yuan: d.revenueM1Yuan,
          cashInflowYuan: d.revenueComputedYuan,
          shifts: (d.shifts || []).length,
        })),
        shiftCount: (revOut.shifts || []).length,
        unparsedLedger: (revOut.unparsedLedger || []).slice(0, 10),
        summaryOnlyRows: (revOut.summaryOnlyRows || []).slice(0, 10),
        client_request_id: clientRequestId || '',
    };

    // ===== R619 落库：commit=true 才存（默认 false ⇒ 与 R616 只读行为完全一致，向后兼容）=====
    // 🔴 为什么要 confirm 两道：（豆包批评）"唯一约束不等于幂等"，同月换文件必须让老板看见
    //   差异再决定，不能静默覆盖。同文件重复导则直接幂等，不弹任何东西。
    const src = (event && event.input) || event || {};
    if (src.commit === true) {
      const crypto = require('crypto');
      const fileMd5 = crypto.createHash('md5').update(buffer).digest('hex');
      const c = await RevenueStore.commit({
        db,
        userId,
        shopId,
        fileMd5,
        fileName: src.file_name || '',
        fileSize: buffer.length,
        result: revOut,
        confirm: src.confirm === true,
      });
      if (!c.ok) {
        return fail(ERROR_CODES.INVALID_PARAM,
          '这张表里没有可识别的日期，算不出属于哪个月，暂时存不了。');
      }
      if (c.mode === 'need_confirm') {
        // 同月已有数据、但这次是不同的文件 ⇒ 先给差异，等老板点确认
        return ok({
          revenue_daily: payload,
          need_confirm: true,
          diff: c.diff,
          old_batch_id: c.old_batch_id,
          old_file_name: c.old_file_name,
          old_created_at: c.old_created_at,
          hint: '这个月已经有数据了，换成这份会让总额变化，确认后才覆盖（旧版本保留可查）。',
        });
      }
      return ok({
        revenue_daily: payload,
        stored: {
          mode: c.mode,               // created / replaced / duplicate
          batch_id: c.batch_id,
          diff: c.diff,
        },
      });
    }

    return ok({ revenue_daily: payload });
  }

  // ===== 5b. 分流：堂食菜品销售表（批次 G）优先，识别不出再走外卖账单（批次 F）=====
  const dishDetect = detectDishMatrix(matrix);
  if (dishDetect.shape) {
    // 🔴 R584：DSI-1 标准格式走**独立 handler** —— 它一份文件可能含多个渠道/平台
    //   （堂食 + 美团 + 淘宝闪购），而其余形态一份文件只有一个 platform。
    //   复用 C 分支会丢掉渠道列信息、且落库 _id 会互相覆盖。
    if (dishDetect.shape === DISH_SHAPES.S) {
      return handleDSI1Import({ shopId, userId, clientRequestId, dishDetect, matrix, confirm: v.confirm });
    }
    // 🔴 R585：S2 认得但不收。**必须给具体理由** —— 只说「未识别」老板会以为文件坏了，
    //   而实际上他手里的表是对的，只是选错了类型（要交商品明细，不是月汇总）。
    if (dishDetect.shape === DISH_SHAPES.S2) {
      return fail(ERROR_CODES.INVALID_PARAM,
        '这张是「月渠道汇总」表，用来记月度账的，不能算单品毛利。'
        + '要算每道菜的毛利，请交「商品明细」表（列名：日期、渠道、平台、商品名称、销量、销售额）。');
    }
    return handleDishImport({ shopId, userId, clientRequestId, dishDetect, matrix, confirm: v.confirm, platform: v.platform });
  }

  // ===== 6. 外卖账单（批次 F 原路径）=====
  let platform = v.platform;
  if (!platform) {
    // 🔴 R250：**不能**写 `detectPlatform(rows[guessHeader(rows)])` —— 京东《对账单下载》（订单级）
    //   是两级表头：R1 = 合并的组表头（"商家基础信息"/"订单基础信息"，导出逐格写满 82 格），
    //   R2 才是真列名。两者「非空文本格数」都是 82 ⇒ 打平 ⇒ guessHeader 取到 R1
    //   ⇒ detectPlatform(R1) = null ⇒ **一张 117 行数据的表被判「无法识别账单平台」**（误杀真数据）。
    //   实测（真 SheetJS）：guessHeader ⇒ 第 0 行判不出；第 1 行本可识别为 jd_order。
    //   ⇒ 平台判定直接**逐候选行试签名**（前 5 行内谁先命中谁赢），不再依赖"哪一行最像表头"。
    //   `detectPlatformInMatrix` = 该口径的唯一入口（可 require ⇒ 守卫能真调它判行为）。
    const hit = detectPlatformInMatrix(matrix);
    if (hit) platform = hit.platform;
  }
  // 🔴 R253：多平台「同时命中」⇒ 拒绝代选，改为**指名请用户手选**。
  //   为什么单列一支而不是并进下面那句「无法识别账单平台」：两者**用户下一步动作完全不同** ——
  //   认不出 = 表不对（换文件）；多平台命中 = 表对但归属有歧义（选一下即可）。
  //   并成一句会让用户拿着正确的表反复换文件。且 `'AMBIGUOUS'` 是 truthy，
  //   若不显式拦截，下面 `pickSheet(sheets, 'AMBIGUOUS')` 找不到 sheet ⇒ 落到"认不出"分支（错误归因）。
  if (platform === PLATFORM_AMBIGUOUS) {
    return fail(ERROR_CODES.INVALID_PARAM, '这张表同时符合多个平台的账单特征（例如同时含「结算金额」与「商家应收款」），无法自动判定是哪个平台。请在导入时手动选择平台后再试。');
  }
  // 🔴 R245：判定「表在不在」改为按签名找 sheet（京东表名不固定：com.jd.o2o… / sku对账单下载）
  // 🔴 R286：认不出 ⇒ **走 ok 通道回诊断**，不再 fail。
  //   为什么：这段原来是 `fail(INVALID_PARAM, '无法识别账单平台（请确认是…）')`，
  //   而 `utils/api.js:47` 会把 `r.msg` **整条覆盖**成 `msgOf(code)` 的通用文案（原始 msg 只落 console.warn）
  //   ⇒ 老板看到的只是「参数有误」，不知道**该补哪一列**，只能反复换文件（R283 实测的痛点）。
  //   ⇒ 人话改走 ok 的 data（与 R271 重复导入警告同一条通道），文案由前端按 i18n/terms.js 拼。
  //   ⚠️ 仍保留 fail-closed 语义：**不落库、不给预览、不产生任何数据**，只是把「为什么」说清楚。
  //   ⚠️ 上面 143 行那句「fail 的 msg 会透传到前端」是**错的**（实测已证伪），勿再照它写。
  if (!platform || !pickSheet(matrix.sheets, platform)) {
    return ok({
      diagnosis: diagnoseColumns(matrix),
      client_request_id: clientRequestId || '',
    });
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

  // 🔴 R259：账单导入**暂停展示**（李老师 2026-10-10）。
  //   为什么拦在**这里**（confirm 之后、写库之前），而不是函数入口：
  //     · 预览（confirm=false）**照常放行** —— 它不写库，留着便于日后复看解析与门禁结果；
  //     · 只拦「确认落库」这一步，**精确等于**「不产生账单数据」，不牵连形态 A/B/C。
  //   ⚠️ 前端已把「确认导入」按钮藏起（`utils/featureFlags.js`）⇒ 本行是**防御性兜底**
  //      （防旧版本客户端 / 越权直调）。两端取值必须一致，由 `check_bill_import_gate` 守。
  //   ⚠️ 用 FORBIDDEN 而非新造码：本仓错误码表与 i18n 互锁（core/09），为一条暂停开关扩表
  //      性价比低；且 `fail(code, msg)` 的 msg 会透传到前端（`api.toastError` 取 `e.msg` 优先），
  //      用户看到的是下面这句人话、不是"无权限"。恢复时若需正式语义，再补专用码。
  if (!BILL_IMPORT_ENABLED) {
    return fail(ERROR_CODES.FORBIDDEN, '订单/结算类账单导入已暂停展示，正在打磨中；堂食《菜品销售统计》与美团/京东/淘宝闪购/其他外卖的《商品销量》仍可正常导入。');
  }

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
        // 🔴 R574 / #109：粒度三字段必写。账单是**逐日**的 ⇒ daily，两端都等于该日。
        //   一律显式写入（哪怕恒为 daily），理由：读侧据"字段缺不缺"区分
        //   「明确是逐日」与「历史数据不知道」，缺字段会让旧行被迫按 unknown 处理。
        granularity: 'daily',
        period_from: r.bizDate,
        period_to: r.bizDate,
        source: 'excel',
        created_at: now,
        // 🔴 R249：`.set()` = 整文档替换 ⇒ 不写 is_deleted 的文档**没有该字段**，
        //   而读侧 da.list/listAll 强制 `is_deleted:false`（严格等值）⇒ 写入成功但读不出来（假绿）。
        is_deleted: false,
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
/**
 * 🔴 R587：清掉某 (shop, platform, bizDate) 组里"**本次没再写**"的旧行（软删）。
 *
 * 为什么需要（R586 实测）：
 *   `_id = SALE_<店>_<平台>_<日期>_<seq>`，重导只覆盖 seq **重合**的部分。
 *   本次行数少于上次（改表删了菜 / 换了数据来源）时，尾部旧行会留下 ——
 *   而读侧（getDishReview）按 shop_id 读全量、**不按来源过滤** ⇒ 残留行被算进毛利榜，
 *   金额虚高且不报错。实测 5 行重导成 3 行：残留 2 条。
 *
 * 为什么用「集合差」而不是解析 `_id` 取 seq：
 *   ① 解析是另一份单源（common/salesBillId.js），扩展它要连带同步各云函数的 cx_ 副本；
 *   ② 与 `_id` 形态解耦 —— 将来 `_id` 里加来源标记也不会让这段失效。
 *
 * 为什么由调用方在「写完之后」调：新数据先落地，最坏情况只是"多了几条旧行"，
 *   而不是"该有的没有"（后者老板完全无从发现）。
 *
 * ⚠️ 语义代价（有意的）：同一天同一渠道**分两次导不同部分**时，第二次会覆盖掉第一次的。
 *   我们的表本来就是"一整天的完整导出"，分次导属误用；数据正确性优先于容忍误用。
 *
 * @returns {{pruned:number, failed:number}} pruned=清掉的行数；failed=清理失败的行数
 */
async function pruneStaleGroup(db, shopId, platform, bizDate, writtenIds, now) {
  let stale = [];
  try {
    const oldRes = await db.collection('external_sales_daily')
      .where({ shop_id: shopId, platform: platform, biz_date: bizDate, is_deleted: false })
      .field({ _id: true })
      .limit(500)          // 一天一个平台不会超 500 行；超了会漏清尾部，属已知边界
      .get();
    const done = writtenIds || new Set();
    stale = ((oldRes && oldRes.data) || [])
      .filter((d) => d && d._id && !done.has(d._id));
  } catch (e) {
    // 取不到旧数据就不清理：新数据仍会正确覆盖，不该因"读旧数据失败"阻断导入
    return { pruned: 0, failed: 0 };
  }
  let pruned = 0, failed = 0;
  for (const row of stale) {
    try {
      await db.collection('external_sales_daily').doc(row._id).update({
        data: { is_deleted: true, updated_at: now },
      });
      pruned++;
    } catch (e) {
      failed++;
    }
  }
  return { pruned: pruned, failed: failed };
}

async function handleDishImport({ shopId, userId, clientRequestId, dishDetect, matrix, confirm, platform }) {
  // 形态 B：套餐明细表 —— 不入库（组分已并入菜品表，禁止两表相加）
  if (dishDetect.shape === DISH_SHAPES.B) {
    return fail(ERROR_CODES.INVALID_PARAM, '这是套餐销售明细表，套餐组分已并入菜品销售表，本表仅作交叉校验、不单独导入。');
  }
  // 形态 C：外卖商品销量 —— v1.7 C-2~C-7 本批实现真导入（platform 由调用方显式传入）
  if (dishDetect.shape === DISH_SHAPES.C || dishDetect.shape === DISH_SHAPES.D) {
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
        // R574 / #109：预览就把"这是几天"告诉前端（不落库也要能看见）。
        periodFrom: parsed.periodFrom,
        periodTo: parsed.periodTo,
        granularity: parsed.granularity,
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
  const writtenIds = new Set();   // R587：本次写了哪些 _id（用于清掉多余的旧行）
  for (let seq = 0; seq < parsed.rows.length; seq++) {
    const r = parsed.rows[seq];
    const _id = saleDocId(shopId, 'pos', parsed.bizDate, seq);
    writtenIds.add(_id);
    await db.collection('external_sales_daily').doc(_id).set({
      data: {
        shop_id: shopId,
        biz_date: parsed.bizDate,
        external_ref_id: dishRefId('pos', parsed.bizDate, r.dishKey),
        dish_key: r.dishKey,
        qty: r.qty,
        amount: r.amountFen,          // 实际收入（元→分，整数）
        platform: 'pos',
        // 🔴 R574 / #109：堂食《菜品销售统计》是**区间汇总表**（表头「营业日期：【A 至 B】」），
        //   一行代表整段而不是某一天。三个字段把这件事记下来 —— 只靠 biz_date（= 区间末日）
        //   会让下游把它当"那一天"的量，实测该日收入会 = 真实日均的 7 倍且零报错。
        //   兜底：端点缺失时退回 bizDate（此时 granularity 已是 unknown，不会谎称 interval）。
        granularity: parsed.granularity || 'unknown',
        period_from: parsed.periodFrom || parsed.bizDate,
        period_to: parsed.periodTo || parsed.bizDate,
        source: 'excel',
        created_at: now,
        // 🔴 R249：见上方外卖账单同款注释 —— 缺 is_deleted ⇒ 写入成功、读侧（强制 is_deleted:false）读不出。
        is_deleted: false,
      },
    });
    written++;
  }

  // 🔴 R587：清掉这一天里"本次没再写"的旧行（改表删了菜 / 换了来源时会留下）
  const prA = await pruneStaleGroup(db, shopId, 'pos', parsed.bizDate, writtenIds, now);

  // 摘要写 shop_switch.m3_review_last（批次时间 / 来源 / 行数 / 未匹配数 / 非整数 qty 数）
  const summary = {
    batch_at: now,
    source: 'excel',
    platform: 'pos',
    biz_date: parsed.bizDate,
    // R574 / #109：摘要里记粒度 —— 老板下次看"上次导入"时能知道那批是"一段"还是"一天"。
    granularity: parsed.granularity,
    period_from: parsed.periodFrom || parsed.bizDate,
    period_to: parsed.periodTo || parsed.bizDate,
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
    // R574 / #109：回执里如实报粒度，前端据此提示"这批是 7 天汇总，不是一天"。
    period_from: parsed.periodFrom || parsed.bizDate,
    period_to: parsed.periodTo || parsed.bizDate,
    granularity: parsed.granularity,
    written,
    pruned: prA.pruned,          // R587：清掉的旧残留行数
    pruneFailed: prA.failed,     // R587：清理失败行数（>0 ⇒ 可能残留旧行）
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
  // R432（队列 #43）：形态 D（京东外卖订单导出）与 C 的输出结构完全一致
  //   ⇒ 只在这一处分叉解析，门禁/预览/落库/重复检测全部复用，避免两套逻辑漂移。
  const parsed = dishDetect.shape === DISH_SHAPES.D
    ? parseDishSalesD(sheetRows, { platform })
    : parseDishSalesC(sheetRows, { platform });

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
      shape: parsed.shape,
      // 预览期门禁：剔掉 platform 项（平台的阻断留给 confirm；见上方注释）
      grade: platform ? grade : gradeNonPlatform,
      platform_missing: !platform,
      // 🔴 R271：跨平台重复检测结果（前端据此**在点确认之前**就警告，见 utils/api.js 的 msg 覆盖说明）。
      //   未选平台 ⇒ null（不是"没重复"）；前端只在 platform 有值后才读它。
      dup: (platform ? await detectDupFromDb(shopId, platform, parsed.groups) : null),
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

  // 🔴 R271：跨平台重复导入 ⇒ **硬阻断落库**（防同一份表用两个平台各导一次 ⇒ 销量翻倍）。
  //   前端已在预览期据此禁用「确认导入」并引导改回原平台；本行是**防御性兜底**
  //   （旧版本客户端 / 越权直调）。⚠️ 不提供 force 参数：留后门等于让"随手选平台"继续发生。
  //   正解永远是"改用原平台重导"（同平台同 _id ⇒ 覆盖，不会翻倍）。
  if (confirm) {
    const dup = await detectDupFromDb(shopId, platform, parsed.groups);
    if (dup && dup.dup) {
      return fail(ERROR_CODES.FORBIDDEN,
        '这批数据已经用另一个平台导过一次了（' + dup.hit + ' 行销量与金额完全一致）。'
        + '再导一次会变成两份、销量翻倍。请改用原平台重新导入（会覆盖原来的那一份）。');
    }
  }

  // 🔒 幂等（重放形态）：命中即返回首次结果、不重复写入。
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  const now = nowUtc();
  let written = 0;
  let prunedC = 0, pruneFailC = 0;
  for (const g of parsed.groups) {
    const writtenIds = new Set();   // R587：本组写了哪些 _id
    for (let seq = 0; seq < g.rows.length; seq++) {
      const r = g.rows[seq];
      const _id = saleDocId(shopId, platform, g.bizDate, seq);
      writtenIds.add(_id);
      await db.collection('external_sales_daily').doc(_id).set({
        data: {
          shop_id: shopId,
          biz_date: g.bizDate,
          external_ref_id: dishRefId(platform, g.bizDate, r.dishKey),
          dish_key: r.dishKey,
          qty: r.qty,
          amount: r.amountFen,          // 销售额(元) → 分整数（🔴 非订单交易额）
          platform,
          // 🔴 R574 / #109：外卖商品销量表是**逐日**的（每个 g.bizDate 一组）⇒ daily，两端同该日。
          granularity: 'daily',
          period_from: g.bizDate,
          period_to: g.bizDate,
          source: 'excel',
          created_at: now,
          // 🔴 R249：缺 is_deleted ⇒ 落库 354 行却「单品毛利复盘·外卖」全程空态的根因（读侧强制 is_deleted:false）。
          is_deleted: false,
        },
      });
      written++;
    }
    // 🔴 R587：本组写完后清掉多余的旧行（与形态 A / DSI-1 同一套语义）
    const pr = await pruneStaleGroup(db, shopId, platform, g.bizDate, writtenIds, now);
    prunedC += pr.pruned;
    pruneFailC += pr.failed;
  }

  const out = {
    shop_id: shopId,
    platform,
    shape: parsed.shape,
    written,
    pruned: prunedC,          // R587：清掉的旧残留行数
    pruneFailed: pruneFailC,  // R587：清理失败行数（>0 ⇒ 可能残留旧行）
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

// ===== R584：DSI-1 标准格式导入 =====
// 契约：specs/core/店算标准导入格式_v1.md；解析器：dsi1.js（纯函数，已由第 225 套件守住）
//
// 🔴 为什么它必须独立、不能复用 C 分支：
//   一份 DSI-1 可以同时含堂食 + 美团 + 淘宝闪购（老板一个月的数据就一张表），
//   而 C 分支的入参只有一个 `platform` ⇒ 落库时全部写成同一个平台、_id 也会互相覆盖
//   （同 bizDate 同 seq ⇒ 后写的把先写的冲掉，且**不报错**）。
//
// 🔴 为什么不再套 checkGradeA：
//   那道闸是为「平台原始导出表」设计的（列名不固定、单位不统一、可能有合计行）。
//   DSI-1 是**已经标准化过的表**，dsi1.parse 已逐列校验（日期/渠道/数字/名称），
//   再套一层只会把「格式问题」报成「数据问题」，反而更难懂。
//   ⇒ 门禁口径改为：解析不过 ⇒ 直接把 dsi1 的**人话错误**回给用户（带行号）。

async function handleDSI1Import({ shopId, userId, clientRequestId, dishDetect, matrix, confirm }) {
  const sheetRows = matrix.sheets[dishDetect.sheet].rows;
  const parsed = parseDSI1(sheetRows);
  if (!parsed.ok) {
    // 人话 + 行号原样透出（老板能照着改表，而不是只看到「格式错误」）
    return fail(ERROR_CODES.INVALID_PARAM, parsed.error);
  }

  // 按 (platform, bizDate) 分组 —— 抽成纯函数以便单测（第 225 套件 D 组）
  const groups = parseDSI1Groups(parsed.rows);

  const summary = parsed.summary;

  if (!confirm) {
    return ok({
      shop_id: shopId,
      shape: DISH_SHAPES.S,
      platform: '',                       // DSI-1 一份表可含多平台 ⇒ 顶层不填单值，明细见 by_channel
      preview: {
        rowCount: summary.rowCount,
        dayFrom: summary.dayFrom,
        dayTo: summary.dayTo,
        dayCount: summary.dayCount,
        // 🔴 R589：最老一天距今几个月 —— 前端据此提示"这批数据是不是太旧了"
        //   （抓 AI 猜错年份这类**范围检查抓不住**的错：2024/2025 都是合法年份）
        maxMonthsAgo: summary.maxMonthsAgo,
        dishCount: summary.dishCount,
        totalQty: summary.totalQty,
        totalAmountFen: summary.totalAmountFen,
        byChannel: summary.byChannel,
        nonInt: summary.nonInt,
        refunds: summary.refunds,
        // 🔴 契约 §S1-③：S1 不含打包费 ⇒ 汇总金额天然小于 S2 营业额。前端要如实说明，别让老板以为漏了。
        noteNoPackFee: summary.noteNoPackFee,
      },
    });
  }

  // 幂等（重放形态）：命中即返回首次结果
  const prior = await common.idempotency.findPriorResult(db, shopId, clientRequestId);
  if (prior) return ok(prior);

  const now = nowUtc();
  let written = 0;
  let pruned = 0;          // 本次被清理掉的"旧残留行"
  let pruneFailed = 0;     // 清理失败的组数（新数据仍正确，只是可能残留）
  for (const g of groups) {
    const writtenIds = new Set();   // R587：本组写了哪些 _id
    for (let seq = 0; seq < g.rows.length; seq++) {
      const r = g.rows[seq];
      // _id 确定性 ⇒ 同一份表重导是**覆盖**而不是翻倍（与 A/C/D 同一套 saleDocId）
      const _id = saleDocId(shopId, g.platform, g.bizDate, seq);
      writtenIds.add(_id);
      await db.collection('external_sales_daily').doc(_id).set({
        data: {
          shop_id: shopId,
          biz_date: g.bizDate,
          external_ref_id: dishRefId(g.platform, g.bizDate, r.dishKey),
          dish_key: r.dishKey,
          qty: r.qty,
          amount: r.amountFen,
          platform: g.platform,
          granularity: 'daily',
          period_from: g.bizDate,
          period_to: g.bizDate,
          // 🔴 来源标记：与普通 excel 导入区分开（R581 提的"来源维度"，这里先落第一笔）
          source: 'dsi1',
          created_at: now,
          is_deleted: false,
        },
      });
      written++;
    }

    // 🔴 R587：清掉本组里"这次没再写"的旧行（菜变少 / 换了来源时会出现）。
    //   与形态 A / C/D 共用同一个 pruneStaleGroup —— **同一套语义只许有一份实现**
    //   （R586 曾把这段内联在这里，A/C/D 各自再写一遍就会分叉，正是本轮反复踩的坑）。
    const pr = await pruneStaleGroup(db, shopId, g.platform, g.bizDate, writtenIds, now);
    pruned += pr.pruned;
    pruneFailed += pr.failed;
  }

  const out = {
    shop_id: shopId,
    shape: DISH_SHAPES.S,
    written,
    pruned,          // R586：被清掉的旧残留行数（重导时菜变少会出现）
    pruneFailed,     // R586：清理失败组数；>0 表示"可能有旧行残留"，前端应如实提示
    groups: groups.map((g) => ({ platform: g.platform, bizDate: g.bizDate, count: g.rows.length })),
    byChannel: summary.byChannel,
    totals: { qty: summary.totalQty, amountFen: summary.totalAmountFen },
    nonInt: summary.nonInt,
    refunds: summary.refunds,
    client_request_id: clientRequestId || '',
  };

  if (clientRequestId) {
    try {
      await common.audit.writeAudit(db, {
        action: 'IMPORT_DSI1', operator_type: 'user', operator_id: userId, shop_id: shopId,
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
