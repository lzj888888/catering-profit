// cloudfunctions/exportData/index.js —— 批次 7 · 用户端数据导出（Controller 层 · 读）
//
// ⚠️ 导出权限解耦（批次 7 §2.8）：**只读 shop_entitlement.expire_at** 判定（付费档才可导出），
//   **不读 plan_id**；开关/文案由后端控制（免费用户由前端弹付费窗，后端返回 FEATURE_LOCKED 兜底）。
// ⚠️ 异步导出 + 进度（§2.4）：本函数生成内容并返回（v1.0 简版：云函数内同步生成，前端显示
//   「正在导出…」进度提示条 + loading，不阻塞 UI；超大数据量的任务队列排 v1.1 选做）。
//   · scope = 'm1_report'（M1 月度报表）| 'm3_cards'（M3 成本卡批量）
//   · format = 'xlsx'（**默认**，真 Excel 二进制·base64 下发）| 'excel'（=CSV+BOM，旧兼容）| 'json'
//   · 文件名含店铺名 + 月份（对齐 §2.4）
//
// 🔴 R265（2026-10-10 真机反馈修复）：v1.0 默认落 **CSV**，前端 `wx.openDocument({fileType:'csv'})`
//    而微信 fileType 合法值只有 doc/docx/xls/xlsx/ppt/pptx/pdf —— **csv/json 一律打不开**，
//    openDocument 必走 fail；当时的 fail 回调是空的 ⇒ 用户只看到一句「导出完成」，
//    **文件躺在小程序沙箱里永远找不到，也不知道是什么格式**。
//    ⇒ 默认改为真 xlsx：SheetJS 生成 → base64 下发 → 前端落盘后 fileType:'xlsx' 打开（右上角可保存/转发）。
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

// ===================== XLSX 纯函数（R265·可单测）=====================
// 惰性 require：万一云端漏装依赖，也只让「导出」这一条路失败并明确报错，
//   不会因顶层 require 崩掉整个云函数（连 CSV/JSON 一起陪葬）。
function loadXlsx() {
  try { return require('xlsx'); } catch (e) { return null; }
}
// R266：多工作表（月度报表 = 利润表 / 收入费用明细 / 摊销来源 / 口径说明 四张）。
//   起因（李老师真机反馈）：导出能出 Excel 了，但「月度报表」里**没有摊销**，
//   两个利润数字并列却看不出差在哪、每个数怎么来的 ⇒ 拿到表也对不上账。
function xlsxSheetsBase64(sheets) {
  const XLSX = loadXlsx();
  if (!XLSX) return '';
  const wb = XLSX.utils.book_new();
  (sheets || []).forEach((s) => {
    const aoa = [s.header].concat((s.rows || []).map((r) => r.map((v) => (typeof v === 'number' ? v : String(v == null ? '' : v)))));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, String(s.name || 'Sheet1').slice(0, 31));
  });
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
function xlsxBase64(header, rows, sheetName) {
  return xlsxSheetsBase64([{ name: sheetName, header: header, rows: rows }]);
}
// 工作表名（≤31 字符，Excel 硬限）
const SHEET_NAME = { m1_report: '月度报表', m3_cards: '菜品成本卡', m2_compare: '方案对比' };

// R266：分 → 元（**仅导出展示用**；库内与引擎一律「分」整数）
function yuan(fen) { return Math.round(Number(fen) || 0) / 100; }

// R266：月度报表四张表的**纯构造**（零 IO ⇒ 探针可直测「表上加减是否对得上账」）。
//   main 只负责读库并调用它；所有算式与文案都在这一处，避免「表里写的」与「引擎算的」分叉。
function buildMonthlySheets(c) {
  const row = (c && c.row) || {};
  const assets = (c && c.assets) || [];
  const shopName = (c && c.shopName) || '';
  const month = (c && c.month) || '';
  const stamp = (c && c.stamp) || 0;
    const income = row.income_items || [];
    const expense = row.expense_items || [];
    const sw = row.switch_used || {};
    const invOn = !!sw.inventorySwitchOn;
    const amOn = !!sw.amortizeSwitchOn;
    const nz = (x) => (Number(x) || 0);
    const sumFen = (arr) => (arr || []).reduce((s, it) => s + nz(it && it.amount_fen), 0);
    // 汇总一律优先取**引擎已落库的值**（服务端权威）；老数据缺字段才回退明细累加（口径与引擎一致）
    const incTotal = row.income_total_fen != null ? nz(row.income_total_fen) : sumFen(income);
    const expTotal = row.expense_total_fen != null ? nz(row.expense_total_fen) : sumFen(expense);
    const direct = nz(row.direct_consume_fen);
    const real = row.real_consume_fen != null ? nz(row.real_consume_fen) : direct;
    const amort = nz(row.amortize_fen);
    const lump = nz(row.lump_sum_fen);
    const opRef = nz(row.operation_ref_profit_fen);
    const realP = nz(row.total_factor_real_profit_fen);
    const gross = row.gross_profit_fen != null ? nz(row.gross_profit_fen) : incTotal - real;
    const gmPct = row.gross_margin_pct != null ? nz(row.gross_margin_pct)
      : (incTotal === 0 ? 0 : Math.round(((gross / incTotal) * 100 + Number.EPSILON) * 100) / 100);
    const gapFen = real - direct;
    const diffFen = row.profit_diff_fen != null ? nz(row.profit_diff_fen) : gapFen + amort;

    // —— 表1：利润表（从上往下加减，能对上账）——
    const profitRows = [
      ['营业收入', yuan(incTotal), '收入明细逐项累加（见「收入费用明细」）'],
      ['减：费用合计', yuan(expTotal), '费用明细逐项累加（见「收入费用明细」）'],
      ['减：食材消耗（本月填写）', yuan(direct), '本月填写的食材总消耗'],
      ['减：一次性投入（本月）', yuan(lump), '资产台账里「一次算清」且计入本月的投入（见「摊销来源」）'],
      ['＝ 经营参考利润', yuan(opRef), '= 收入 − 费用 − 本月填写消耗 − 一次性投入（不含摊销·现金流视角）'],
      ['', '', ''],
      ['〔全要素调整〕', '', '把「这个月没掏钱、但确实花掉了的成本」加进来'],
      ['　消耗差异（真实 − 填写）', yuan(gapFen), invOn ? '库存开关开：真实消耗 = 期初 + 采购 − 期末' : '库存开关关：两者相等，无差异'],
      ['　减：当月摊销', yuan(amort), amOn ? '资产台账按分摊月数逐笔计算（见「摊销来源」）' : '摊销开关关闭 ⇒ 本月不计入'],
      ['＝ 全要素真实利润', yuan(realP), '= 经营参考利润 − 消耗差异 − 当月摊销'],
      ['', '', ''],
      ['〔补充指标〕', '', ''],
      ['毛利（收入 − 真实消耗）', yuan(gross), '食材成本 = 真实消耗'],
      ['毛利率(%)', gmPct, '毛利 ÷ 营业收入'],
      ['两口径差额', yuan(diffFen), '= 消耗差异 + 当月摊销（经营参考 − 全要素真实）'],
    ];

    // —— 表2：收入/费用明细（大类 → 细项，与利润表合计对得上）——
    const detailRows = [];
    const pushDetail = (kind, items) => {
      (items || []).forEach((it) => {
        detailRows.push([kind, it.name || '', '大类', yuan(nz(it.amount_fen)), '本月录入']);
        (it.sub_items || []).forEach((s) => {
          detailRows.push([kind, s.sub_item || '', '细项', yuan(nz(s.amount_fen)), '本月录入']);
        });
      });
      detailRows.push([kind, kind + '合计', '合计', yuan(kind === '收入' ? incTotal : expTotal), '与利润表对应行一致']);
    };
    pushDetail('收入', income);
    pushDetail('费用', expense);

    // —— 表3：摊销来源（摊销这笔钱是从哪几笔资产来的）——
    //   ⚠️ 只列台账**登记信息** + 服务端权威合计，本函数**不重算摊销公式**
    //   （摊销引擎有三个同源副本：calcAmortize / getAmortSchedule / saveLedger；
    //     这里再写一份 = 第四个真相源，末月尾差一旦分叉就是静默错账）。
    const assetRows = assets.map((a) => {
      const valFen = a.value_fen != null ? nz(a.value_fen) : nz(a.total_value);
      const months = nz(a.total_months);
      const perYuan = months > 0 ? yuan(Math.round(valFen / months)) : 0;
      return [
        a.mode === 'lump' ? '一次算清' : '分期摊销',
        a.name || '', yuan(valFen), a.start_month || '', months || '', a.terminate_month || '', perYuan,
      ];
    });
    assetRows.push(['合计', '本月摊销合计（服务端计算）', '', '', '', '', yuan(amort)]);
    assetRows.push(['合计', '本月一次性投入（本月计入）', '', '', '', '', yuan(lump)]);

    // —— 表4：口径说明（每个数怎么来的 + 两个开关状态）——
    const nowTxt = new Date(stamp).toISOString().replace('T', ' ').slice(0, 19);
    const noteRows = [
      ['店铺', shopName || ''],
      ['月份', month],
      ['生成时间', nowTxt],
      ['金额单位', '元（库内与引擎一律以「分」整数计算，本表展示保留 2 位小数）'],
      ['库存开关', invOn ? '开' : '关'],
      ['摊销开关', amOn ? '开' : '关'],
      ['经营参考利润', '= 营业收入 − 费用合计 − 本月填写食材消耗 − 一次性投入（不含摊销，现金流视角）'],
      ['全要素真实利润', '= 营业收入 − 费用合计 − 真实食材消耗 − 当月摊销 − 一次性投入'],
      ['真实食材消耗', invOn ? '库存开关开 ⇒ 期初库存 + 本月采购 − 期末库存' : '库存开关关 ⇒ 等于本月填写值'],
      ['当月摊销', '由资产台账逐笔按分摊月数计算（末月尾差倒挤）；摊销开关关闭时为 0'],
      ['一次性投入', '资产台账中处置方式 = 「一次算清」，且计入月份 = 本月的投入'],
      ['月均参考', '= 资产原值 ÷ 分摊月数，仅供估算；逐笔实际金额以「本月摊销合计」为准'],
      ['待结算', '本表不列：待结算是现金流指标，不进入毛利与利润'],
    ];

    sheets = [
      { name: '利润表', header: ['项目', '金额(元)', '说明（这个数怎么来的）'], rows: profitRows },
      { name: '收入费用明细', header: ['类别', '项目', '层级', '金额(元)', '来源'], rows: detailRows },
      { name: '摊销来源', header: ['处置方式', '名称', '原值(元)', '起始月', '分摊月数', '提前终止月', '月均参考(元)'], rows: assetRows },
      { name: '口径说明', header: ['项目', '内容'], rows: noteRows },
    ];
  return sheets;
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
  // R265：不传 format 时默认 **xlsx**（真 Excel），'excel' 保留为 CSV 旧兼容通道。
  const format = v.format === 'json' ? 'json' : (v.format === 'excel' ? 'excel' : 'xlsx');
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
  let header, body, fileBase;
  let sheets = null;            // R266：多工作表（仅 m1_report；其余 scope 走单表）
  if (scope === 'm1_report') {
    const r = await da.list('shop_monthly_account', { shop_id: shopId, month });
    const row = r && r.data && r.data[0] || {};
    const aRes = await da.list('shop_amortize', { shop_id: shopId });
    sheets = buildMonthlySheets({
      shopName: shopName, month: month, stamp: stamp,
      row: row, assets: (aRes && aRes.data) || [],
    });
    // json/csv 兼容通道只出第一张表（利润表）
    header = sheets[0].header;
    body = sheets[0].rows;
    fileBase = `${shopName || '店铺'}_${month}_月度报表`;
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
    fileBase = `${shopName || '店铺'}_方案对比`;
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
    // R266：金额改「元」（老板看「分」没有意义；库内仍以分存储）
    header = ['card_code', '菜品名称', '版本', '单份成本(元)', '建议售价(元)', '毛利率%', '核算模式'];
    body = Array.from(latest.values()).map((c) => [
      c.card_code || '', c.name || '', c.version || 1,
      yuan(c.total_cost != null ? c.total_cost : 0),
      yuan(c.price_list != null ? c.price_list : 0),
      c.gross_margin_pct != null ? c.gross_margin_pct : 0,
      c.calc_mode === 2 ? 'B' : 'A',
    ]);
    fileBase = `${shopName || '店铺'}_成本卡_${month || '全部'}`;
  }

  // ===== 4. 序列化（R265：默认 xlsx；json/csv 为兼容通道）=====
  let content;
  let encoding = 'utf8';
  if (format === 'json') {
    content = body.map((b) => {
      // JSON 键必须唯一（表头可有重复列标签；fromEntries 会覆盖）—— dup 时追加下标
      const o = {};
      header.forEach((k, i) => { let key = String(k); if (o[key]) key = key + '_' + i; o[key] = b[i]; });
      return o;
    });
  } else if (format === 'xlsx') {
    content = sheets
      ? xlsxSheetsBase64(sheets)
      : xlsxBase64(header, body, SHEET_NAME[scope] || 'Sheet1');
    // 🔴 依赖缺失必须**响亮失败**：静默回退成 CSV 会让用户又回到「导出完成但打不开」的原点。
    if (!content) return fail(ERROR_CODES.SYSTEM_ERROR, '导出服务未安装 xlsx 依赖，暂时无法生成 Excel');
    encoding = 'base64';
  } else {
    content = csvFromRows(header, body);
  }
  const ext = format === 'json' ? 'json' : (format === 'xlsx' ? 'xlsx' : 'csv');
  const filename = `${fileBase}.${ext}`;

  return ok({
    shop_id: shopId,
    scope,
    format,
    filename,
    encoding,              // R265 新增：前端据此决定「base64 二进制」还是「utf8 文本」落盘
    // 进度提示字段：简版直接生成完毕
    progress: 100,
    status: 'ready',
    content,
    count: body.length,
    generated_at: stamp,
    client_request_id: v.client_request_id || '',
  });
};

// 导出供 selftest
exports.csvEscape = csvEscape;
exports.csvFromRows = csvFromRows;
exports.xlsxBase64 = xlsxBase64;
exports.xlsxSheetsBase64 = xlsxSheetsBase64;
exports.yuan = yuan;
exports.buildMonthlySheets = buildMonthlySheets;