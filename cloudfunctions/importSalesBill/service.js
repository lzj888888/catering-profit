// cloudfunctions/importSalesBill/service.js —— xlsx → 矩阵 → 解析 → 甲级门禁（纯逻辑，仅本函数）
//
// ⚠️ 云函数独立打包、不能 require 小程序侧 utils/，故本文件**内联**了
//   utils/billParse.js（detectPlatform/guessHeader/parseBillMatrix/toNum）与
//   utils/gradeGate.js（SALES_SCHEMA/checkGradeA）的**同源实现**。
//   自测 tools/selftest_bill_parse.js / selftest_grade_gate.js 直接 require utils/ 那份，
//   本份是云函数侧的等价副本（口径一致，锚点由自测守）。
const XLSX = require('xlsx');

// 🔴 R232 C-9：菜品名归一**必须**走单源 common/dishKey.js（经扁平派生件 ./common 命中）。
//   此前本文件内联过一份 normalizeDishName，读侧 getDishReview 又内联了一份 normName，
//   环上零守卫 ⇒ 任一侧改规则即分叉 ⇒ **全菜匹配不上**且**无报错**（失效静默）。
//   写法与仓内其它云函数完全一致（const { ... } = require('./common')）；
//   common/ 全层零外部依赖（已实测可直接加载），不污染本文件「纯逻辑」的定位。
const common = require('./common');
const { normalizeDishName } = common;

// ===================== 通用：字符串 → 数值（移植 parse_bill.py::to_num）=====================
function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, '').replace(/¥/g, '').replace(/￥/g, '').trim();
  if (s === '' || s === '-' || s === '--') return null;
  let neg = false, t = s;
  if (t.startsWith('(') && t.endsWith(')')) { neg = true; t = t.slice(1, -1); }
  const n = parseFloat(t);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

// ===================== 单元格格式化 =====================

// 🔴 Excel 日期序列号基准 —— **必须**是 Date.UTC，不能用 new Date(1899, 11, 30)。
//   后者会落在 GMT+0805：1899 年中国尚未采用标准时区，tzdata 保留的是 LMT 地方平时
//   （比 +0800 少约 5′43″）⇒ 给整天时间戳注入 5′43″ 偏差 ⇒ 取日历日时**系统性早一天**。
//   SheetJS(xlsx, cellDates:true) 内部正是用它做 setTime(serial*86400000 + basedate)，
//   所以**拿到的 Date 本身已经带偏**，必须在入口把它扳正。
//   实证（review/evidence/r232_tz_datecell/fixcheck_datecell.js）：修前 0/4 正确 → 修后 4/4。
const EXCEL_UTC_BASE = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

function fmtCell(cell) {
  if (cell == null) return '';
  if (cell instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    // 反推序列号并四舍五入 ⇒ 消掉 SheetJS basedate 的历史时区偏移，再按 UTC 取日历日。
    const serial = Math.round((cell.getTime() - EXCEL_UTC_BASE) / MS_PER_DAY);
    const d = new Date(EXCEL_UTC_BASE + serial * MS_PER_DAY);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  return String(cell).trim();
}

/**
 * xlsx Buffer → matrix.json 同构结构 { sheets: { 表名: { rows, max_row, max_col } } }。
 */
function bufferToMatrix(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const rows = (aoa || []).map((row) => (Array.isArray(row) ? row.map(fmtCell) : []));
    sheets[name] = { rows, max_row: rows.length, max_col: rows.length ? rows[0].length : 0 };
  }
  return { sheets };
}

// ===================== billParse 同源（utils/billParse.js）=====================
// 🔴 R245：与 utils/billParse.js **档案驱动**版同步（P1 判据加严 + P2~P6 京东两形态）。
//   改这里之前先改 utils/ 那份并跑 tools/selftest_bill_parse.js（锚点由自测守）。
const C_BILL_DATE  = '账单日期';
const C_TAOBAO_NET = '结算金额';
const C_MEITUAN_NET = '商家应收款';
const C_JD_ORDER_NET = '应结金额';
const C_JD_BIZ_TYPE  = '对账单业务类型';
const C_JD_ACCT      = '账期';
const C_JD_ACCT_TIME = '账期时间';
const C_JD_SKU_ORDER = '到家业务单号';
const JD_ONLY_COLS = [C_JD_ORDER_NET, C_JD_BIZ_TYPE, 'sku名称', '费用类型'];

const PLATFORM_PROFILE = {
  taobao: {
    sheet: '外卖账单明细',
    require: [C_BILL_DATE, C_TAOBAO_NET],
    deny: JD_ONLY_COLS,
    billDate: C_BILL_DATE, net: C_TAOBAO_NET,
    orderType: '订单类型', refund: '退单',
    rowFilter: null,
    qtyRule: 'perRow_exceptRefund',
    excludeLabel: '退单',
  },
  meituan: {
    sheet: '订单明细',
    require: [C_BILL_DATE, C_MEITUAN_NET],
    deny: [],
    billDate: C_BILL_DATE, net: C_MEITUAN_NET,
    bizType: '交易类型', order: '外卖订单',
    rowFilter: { col: '交易类型', eq: '外卖订单' },
    qtyRule: 'perRow',
    excludeLabel: '非外卖订单（广告/保险）',
  },
  jd_order: {
    sheet: null,
    require: [C_JD_ORDER_NET, C_JD_BIZ_TYPE],
    deny: [],
    billDate: C_JD_ACCT, net: C_JD_ORDER_NET,
    dateRule: 'acctRange',
    rowFilter: { col: '订单类型', eq: '正向订单' },
    qtyRule: 'perOrderNo',
    orderKey: '主订单号',
    excludeLabel: '非正向订单（推广费/保险单）',
  },
  jd_sku: {
    sheet: 'sku对账单下载',
    require: [C_TAOBAO_NET, 'sku名称', '费用类型'],
    deny: [C_BILL_DATE],
    billDate: C_JD_ACCT_TIME, net: C_TAOBAO_NET,
    dateRule: 'datetime',
    rowFilter: null,
    qtyRule: 'perOrderNo',
    orderKey: C_JD_SKU_ORDER,
    excludeLabel: '',
  },
};
const PLATFORM_ORDER = ['taobao', 'meituan', 'jd_order', 'jd_sku'];

// 🔴 R253：多平台「同时命中」的哨兵值 —— 与 utils/billParse.js 同步（两份独立副本，改一处必改另一处）。
//   成因：各平台档案的 require 是**独立**判据，谁都不排除谁 ⇒ 一张表同时含
//   淘宝 `结算金额` + 美团 `商家应收款`（第三方导出宽表 / 平台改版加列）时两套签名同时成立。
//   旧实现 `for…return p` 命中第一个就返回 ⇒ 闷头按淘宝跑完并给出"算完了"的结果 —— 不报错才是最大的错。
//   ⚠️ 本哨兵是**字符串**（truthy）⇒ `if (p)` / `if (hit)` 式的判空拦截**都拦不住它**，上层必须显式比较。
const PLATFORM_AMBIGUOUS = 'AMBIGUOUS';

// 🔴 R247：原此处的 `COL` / `SHEET` 两个映射表在 R245 平台档案化后**已零引用**
//   （sheet 名与列名全部收进 `PLATFORM_PROFILE[]`，`detectPlatform` / `pickSheet` 直接读档案）
//   ⇒ 作为残骸删除（全仓 grep 零引用；两处副本 utils/billParse.js 同步删）。

function detectPlatform(header) {
  if (!Array.isArray(header)) return null;
  const cols = header.filter(Boolean).map((s) => String(s).trim());
  const has = (n) => cols.indexOf(n) >= 0;
  const hits = [];
  for (const p of PLATFORM_ORDER) {
    const prof = PLATFORM_PROFILE[p];
    if (!(prof.require || []).every(has)) continue;
    if ((prof.deny || []).some(has)) continue;
    hits.push(p);
  }
  if (hits.length === 0) return null;                    // 认不出 ⇒ fail-closed（现状不变）
  if (hits.length === 1) return hits[0];                 // 唯一命中 ⇒ 现状不变
  return PLATFORM_AMBIGUOUS;                             // 🔴 R253：≥2 命中 ⇒ 拒绝代选
}

// 🔴 R250：平台判定**不能先问「哪一行最像表头」**。
//   京东《对账单下载》（订单级）是**两级表头**：R1 = 合并的组表头（"商家基础信息" × 5 / "订单基础信息" × 77，
//   导出时**逐格写满**，不是只写左上角），R2 = 真列名。两者「非空文本格数」都是 82 ⇒ 打平
//   ⇒ guessHeader 的启发式（文本最多 + 严格大于 + 先到先得）取到 **R1**
//   ⇒ detectPlatform(R1) = null ⇒ 一张 117 行数据的表被判「无法识别账单平台」（fail-closed 误杀真数据）。
//   实测（真 SheetJS 走 bufferToMatrix）：guessHeader ⇒ 第 0 行；但**第 1 行本可识别为 jd_order**。
//   修法：平台判定改为**逐候选行试签名**（前 5 行内谁先命中谁赢），与 pickSheet 的扫描口径一致。
function detectPlatformInRows(rows, limit) {
  const list = rows || [];
  const n = Math.min(list.length, limit == null ? 5 : limit);
  for (let i = 0; i < n; i++) {
    const p = detectPlatform(list[i] || []);
    // 🔴 R253：`'AMBIGUOUS'` 是**真值字符串** ⇒ `if (p)` 拦不住它，会被当平台名往下传。
    //   遇到即**立即冒泡**，不继续试后续行去挑一个"更像"的（那正是本条要消灭的「闷头代选」）。
    if (p === PLATFORM_AMBIGUOUS) return { platform: PLATFORM_AMBIGUOUS, headerRow: i };
    if (p) return { platform: p, headerRow: i };
  }
  return null;
}

// 矩阵级：逐 sheet、每 sheet 逐候选行试签名 —— 云端「自动判定平台」的唯一入口。
// （上提成可 require 的纯函数，守卫才能真调它判**行为**，而不是扫源码字面。）
function detectPlatformInMatrix(matrix) {
  const sheets = (matrix && matrix.sheets) || {};
  for (const name of Object.keys(sheets)) {
    const hit = detectPlatformInRows((sheets[name] || {}).rows);
    // 🔴 R253：哨兵同上，跨 sheet 也不代选。
    if (hit && hit.platform === PLATFORM_AMBIGUOUS) return { platform: PLATFORM_AMBIGUOUS, headerRow: hit.headerRow, sheet: name };
    if (hit) return { platform: hit.platform, headerRow: hit.headerRow, sheet: name };
  }
  return null;
}

function rowCols(row) {
  return (row || []).map((v) => (v == null ? '' : String(v).trim()));
}

function guessHeader(rows, platform) {
  const list = rows || [];
  const prof = platform ? PLATFORM_PROFILE[platform] : null;
  if (prof && prof.require) {
    const lim = Math.min(list.length, 5);
    for (let i = 0; i < lim; i++) {
      const cols = rowCols(list[i]);
      if (prof.require.every((c) => cols.indexOf(c) >= 0)) return i;
    }
  }
  let best = -1, bi = 0;
  const n = Math.min(list.length, 5);
  for (let i = 0; i < n; i++) {
    const row = rows[i] || [];
    let txt = 0;
    for (const v of row) if (v && toNum(v) === null) txt++;
    if (txt > best) { best = txt; bi = i; }
  }
  return bi;
}

function pickSheet(sheets, platform) {
  const prof = PLATFORM_PROFILE[platform];
  if (!prof) return undefined;
  const names = Object.keys(sheets || {});
  if (prof.sheet && names.indexOf(prof.sheet) >= 0) return prof.sheet;
  for (const n of names) {
    const rows = (sheets[n] && sheets[n].rows) || [];
    const hi = guessHeader(rows, platform);
    const cols = rowCols(rows[hi]);
    const has = (c) => cols.indexOf(c) >= 0;
    if ((prof.require || []).every(has) && !(prof.deny || []).some(has)) return n;
  }
  return prof.sheet;
}

function normDate(raw, rule) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || !rule) return s;
  let m;
  if (rule === 'acctRange') {
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : s;
  }
  if (rule === 'compact8') {
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : s;
  }
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : s;
}

function parseBillMatrix(matrix, opts) {
  const platform = (opts && opts.platform) || null;
  const prof = PLATFORM_PROFILE[platform];
  const sheets = (matrix && matrix.sheets) || {};
  if (!prof) {
    return {
      platform, sheet: null, headerRow: -1, header: [], rows: [],
      totals: { amountFen: 0, qty: 0, rowCount: 0 }, months: [],
      excluded: { rows: 0, reason: '未知平台' },
    };
  }

  const sheetKey = pickSheet(sheets, platform);
  const sheet = sheets[sheetKey];
  const allRows = (sheet && sheet.rows) || [];
  const headerRow = guessHeader(allRows, platform);
  const header = rowCols(allRows[headerRow]);

  const colIdx = {};
  header.forEach((h, i) => { if (h) colIdx[h] = i; });
  const at = (row, name) => (name == null ? undefined : row[colIdx[name]]);

  let excludedRows = 0;
  const rf = prof.rowFilter;
  const orders = [];
  const seenOrder = new Set();

  for (let i = headerRow + 1; i < allRows.length; i++) {
    const row = allRows[i] || [];
    if (rf) {
      const v = String(at(row, rf.col) == null ? '' : at(row, rf.col)).trim();
      if (rf.eq != null && v !== rf.eq) { excludedRows++; continue; }
      if (rf.ne != null && v === rf.ne) { excludedRows++; continue; }
    }
    const net = toNum(at(row, prof.net));
    if (net == null) continue;
    const bizDate = normDate(at(row, prof.billDate), prof.dateRule);
    let qty = 0;
    if (prof.qtyRule === 'perRow_exceptRefund') {
      const ot = String(at(row, prof.orderType) == null ? '' : at(row, prof.orderType)).trim();
      qty = (ot === prof.refund) ? 0 : 1;
    } else if (prof.qtyRule === 'perRow') {
      qty = 1;
    } else if (prof.qtyRule === 'perOrderNo') {
      const key = String(at(row, prof.orderKey) == null ? '' : at(row, prof.orderKey)).trim();
      if (key && key !== '-' && seenOrder.has(key)) {
        qty = 0;
      } else {
        if (key && key !== '-') seenOrder.add(key);
        qty = 1;
      }
    }
    orders.push({ bizDate, qty, amountFen: Math.round(net * 100) });
  }

  const byDate = new Map();
  for (const o of orders) {
    const d = byDate.get(o.bizDate) || { bizDate: o.bizDate, qty: 0, amountFen: 0 };
    d.qty += o.qty;
    d.amountFen += o.amountFen;
    byDate.set(o.bizDate, d);
  }
  const rows = Array.from(byDate.values()).sort((a, b) => (a.bizDate < b.bizDate ? -1 : 1));
  const totals = {
    amountFen: rows.reduce((s, r) => s + r.amountFen, 0),
    qty: rows.reduce((s, r) => s + r.qty, 0),
    rowCount: orders.length,
  };
  const months = Array.from(new Set(rows.map((r) => String(r.bizDate).slice(0, 7)))).sort();
  const excludedReason = excludedRows > 0 ? (prof.excludeLabel || '') : '';

  return { platform, sheet: sheetKey, headerRow, header, rows, totals, months,
           excluded: { rows: excludedRows, reason: excludedReason } };
}

// ===================== gradeGate 同源（utils/gradeGate.js）=====================
const SALES_SCHEMA = {
  fields: {
    shop_id: { type: 'string', required: true },
    biz_date: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    external_ref_id: { type: 'string', required: true },
    dish_key: { type: 'string', required: true },
    qty: { type: 'number', required: true, integer: true, min: 0 },
    amount: { type: 'number', required: true, integer: true },
    platform: { type: 'string', required: true, enum: ['taobao', 'meituan', 'jd_order', 'jd_sku', 'eleme', 'pos', 'other'] },
    source: { type: 'string', required: true, enum: ['oauth', 'excel', 'manual'] },
    created_at: { type: 'number', required: true, integer: true },
  },
};

function checkGradeA(input, schema) {
  const s = schema || SALES_SCHEMA;
  const fields = s.fields || {};
  const failures = [];
  const { platform, rows, totals } = input || {};
  const rowList = Array.isArray(rows) ? rows : [];

  if (rowList.length === 0) failures.push({ code: 'CHANNEL_EMPTY', field: 'rows', msg: '未解析到任何数据行' });
  if (!totals || totals.amountFen == null || !Number.isFinite(totals.amountFen)) {
    failures.push({ code: 'CHANNEL_TOTAL_MISSING', field: 'totals.amountFen', msg: '合计金额缺失或非法' });
  }

  const platformEnum = (fields.platform && fields.platform.enum) || [];
  if (!platform || platformEnum.indexOf(platform) < 0) {
    failures.push({ code: 'SCHEMA_PLATFORM', field: 'platform', msg: `平台未知：${platform}` });
  }
  for (let i = 0; i < rowList.length; i++) {
    const r = rowList[i] || {};
    const pat = (fields.biz_date && fields.biz_date.pattern) || /^\d{4}-\d{2}-\d{2}$/;
    if (typeof r.bizDate !== 'string' || !pat.test(r.bizDate)) {
      failures.push({ code: 'SCHEMA_BIZDATE', field: `rows[${i}].bizDate`, msg: `账单日期格式错误：${r.bizDate}` });
    }
    if (typeof r.amountFen !== 'number' || !Number.isInteger(r.amountFen)) {
      failures.push({ code: 'SCHEMA_AMOUNT', field: `rows[${i}].amountFen`, msg: `金额不是整数分：${r.amountFen}` });
    }
    if (typeof r.qty !== 'number' || !Number.isInteger(r.qty) || r.qty < (fields.qty ? fields.qty.min : 0)) {
      failures.push({ code: 'SCHEMA_QTY', field: `rows[${i}].qty`, msg: `订单数非法：${r.qty}` });
    }
  }

  if (input.shopId === undefined || input.shopId === null || input.shopId === '') {
    failures.push({ code: 'REQUIRED_SHOP_ID', field: 'shop_id', msg: '门店 ID 为空' });
  }
  for (let i = 0; i < rowList.length; i++) {
    if (!rowList[i] || rowList[i].bizDate == null || rowList[i].bizDate === '') {
      failures.push({ code: 'REQUIRED_BIZDATE', field: `rows[${i}].bizDate`, msg: '账单日期为空' });
    }
  }
  if (!totals || totals.amountFen == null) {
    failures.push({ code: 'REQUIRED_AMOUNT', field: 'amount', msg: '金额为空' });
  }

  return { pass: failures.length === 0, level: 'A', failures };
}

// ===================== M3.33 单品毛利复盘（批次 G） 表形态解析 =====================
//
// 依据 specs/dev-specs/core/开发规范v1.6_ModuleM3增量_M3.33阶段二解析与清洗定案.md：
//   三种表形态（§3.4 fail-closed，零命中/多命中不许猜）+ 堂食《菜品销售统计》解析（§4）。
// 🔴 引擎四函数（netUnitCostWan / lineNetCostYuan / calcCostCard / wouldCreateCycle）零改动 —— 本段纯上层。

// 表形态（§2.1.1 / §3）
const DISH_SHAPES = {
  A: 'dish_sales',    // 堂食《菜品销售统计》（美团收银 POS）—— 主路径
  B: 'combo_detail',  // 团购《套餐销售明细》—— 仅交叉校验，不入库
  C: 'waimai_goods',  // 外卖「商品销量」—— 预留，待样例
};

// 形态 A 表结构常量（§2.1.2 实测 · 六项必核）
const DISH_A_STRUCT = {
  headerRow1: 3,        // R3 一级表头（1-based）
  headerRow2: 4,        // R4 二级表头（「销售额构成」/「菜品收入构成」各横跨 3 列）
  dataStartRow: 5,      // 数据 R5 起
  totalLabel: '合计',   // 末行首列 = 合计 ⇒ 必须排除（§4.2）
  // 列序（1-based）：名称 / 数量 / 销售额(元) / 收入(元) / 优惠(元)
  colName: 1, colQty: 2, colSales: 4, colIncome: 6, colDiscount: 8,
};

// 名称归一（trim + NFKC，保留规格后缀与括号 —— §4.4/§4.7）
// 🔴 R232 C-9：实现已上提到单源 common/dishKey.js，由顶部 `const { normalizeDishName } = common;` 取用
//    （common 全层零外部依赖，写法与仓内其它云函数一致）⇒ 本文件**不得**再内联第二份。
//    伴侣守卫：tools/check_dish_key_single_source.js。

// 🔴 R245 P7：形态 C **列名别名表**（单源）。正名 → 别名清单（按序取第一个命中的）。
//   真样例有两套列名：R232 那份是正名（`商品名称`/`销量`/`销售额`），
//   李老师 2026-10-08 微信来料的美团「商品」表是别名（`商品名`/`商品销量`/`商品销售额`）⇒ 精确等名判不出。
//   🔴 判定与取列**共用这一张表**：判得出就必须取得出，否则「认得出却取不到列」的静默空表。
//   ⚠️ `门店编号` **无下游**（parseDishSalesC 取了也不进 rows）⇒ **不**给「门店id」加别名 ——
//      加了就是死输入（本仓红线：填了没用比填了算错更坏）；将来按门店分流时再补。
const DISH_C_ALIAS = {
  日期: ['日期'],
  // `菜品名称` 保留为别名：v1.7 旧判据是 `商品名称 || 菜品名称`，归一后等价（且**不影响**形态 A —— A 用原样列名判）
  商品名称: ['商品名称', '商品名', '菜品名称'],
  销量: ['销量', '商品销量'],
  销售额: ['销售额', '商品销售额'],
  门店编号: ['门店编号'],
};

// 别名归一（**仅供形态 C 判定使用**）：`商品名`→`商品名称`、`商品销量`→`销量`、`商品销售额`→`销售额`。
// 🔴 绝不能对形态 A/B 的判据做归一 —— A 的判据就靠 `菜品名称` 原样命中（归一会把 A 也吃掉 ⇒ 判不出 A）。
function canonDishCHeader(hdr) {
  const rev = {};
  for (const k of Object.keys(DISH_C_ALIAS)) {
    for (const a of DISH_C_ALIAS[k]) rev[a] = k;
  }
  return (hdr || []).map((c) => (rev[c] == null ? c : rev[c]));
}

// 按正名找列位（先用正名，再用别名；全不中 ⇒ -1 ⇒ 取数归空，不报错）
function findDishCCol(hdr, canon) {
  for (const a of (DISH_C_ALIAS[canon] || [])) {
    const i = hdr.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

// 单 sheet 形态判定（v1.6 §3.4 fail-closed + **v1.7 C-1/C-2 勘误** + **R245 P7 别名**）。sheetRows：0-based 二维 cells。
// 🔴 v1.7 C-2：表头行**按形态不同** —— A/B 在 R3、**C 在 R1（单行表头）**
//   ⇒ 必须同时扫描 R1 与 R3；只扫 R3 则形态 C 的表头永远扫不到。
// 🔴 v1.7 C-1：v1.6 §3.4 写死 `'商品销量'`，而**真样例的列名是 `销量`**
//   ⇒ 原样启用则形态 C **永远判不出**（硬阻断：明明是外卖表却提示「这张表不认识」）。
//   ⇒ 放宽为 `'商品销量' 或 '销量'`，并要求 `'销售额'`（提高判定精度）。
// 规则：
//   A ← 有 '菜品名称' + '销售数量' 且 R2 含 '销售方式'
//   B ← 有 '套餐' + '单品名称'
//   C ← 有 ('商品名称' 或 '菜品名称') + ('商品销量' 或 '销量') + '销售额' 且 R2 **不含** '销售方式'
//       （最后一项是**冗余防御**：实测两套列名天然不重叠，A 用「销售数量」、C 用「销量」，
//         即使删掉也不会误判 —— 见 v1.7 §4.2 与锚点 C-1i~C-1l。保留以防将来列名趋同。）
function detectDishShape(sheetRows) {
  const rows = sheetRows || [];
  const hdr3 = (rows[2] || []).map((x) => (x == null ? '' : String(x).trim()));  // R3（形态 A/B）
  const hdr1 = (rows[0] || []).map((x) => (x == null ? '' : String(x).trim()));  // R1（形态 C）
  const hdr = hdr3.concat(hdr1);
  const hdrC = canonDishCHeader(hdr);   // 🔴 R245 P7：别名归一**只给形态 C 用**（A/B 仍按原列名判）
  const r2 = (rows[1] || []).map((x) => (x == null ? '' : String(x))).join('');  // R2 参数自述
  const has = (c) => hdr.indexOf(c) >= 0;      // A/B 判据：原样列名
  const hasC = (c) => hdrC.indexOf(c) >= 0;    // C 判据：别名归一后的列名
  if (has('菜品名称') && has('销售数量') && r2.indexOf('销售方式') >= 0) return DISH_SHAPES.A;
  if (has('套餐') && has('单品名称')) return DISH_SHAPES.B;
  if (hasC('商品名称')
    && hasC('销量')
    && hasC('销售额')
    && r2.indexOf('销售方式') < 0) return DISH_SHAPES.C;
  return null;
}

// 从矩阵里找第一个可识别的菜品表（供入口分流用）。返回 { shape, sheet }；识别不出 ⇒ shape null。
function detectDishMatrix(matrix) {
  const sheets = (matrix && matrix.sheets) || {};
  for (const name of Object.keys(sheets)) {
    const shape = detectDishShape((sheets[name] || {}).rows);
    if (shape) return { shape, sheet: name };
  }
  return { shape: null, sheet: '' };
}

// 从 R2 参数行提取营业日期（取「至」= 结束日，确定性 ⇒ 幂等）。返回 YYYY-MM-DD，取不到返回 ''。
function extractBizDate(sheetRows) {
  const r2 = ((sheetRows || [])[1] || []).map((x) => (x == null ? '' : String(x))).join('');
  const dates = r2.match(/\d{4}[/\-]\d{1,2}[/\-]\d{1,2}/g) || [];
  if (!dates.length) return '';
  const last = dates[dates.length - 1];
  const m = last.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/);
  if (!m) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
}

// external_ref_id 编码（§5.1）：必含 dish_key 段 —— 否则唯一索引 (shop_id, biz_date, external_ref_id)
//   会让同平台同天所有菜共用同一三元组 ⇒ 只落得下 1 条。
function dishRefId(platform, bizDate, dishKey) {
  return 'DISH:' + platform + ':' + bizDate + ':' + dishKey;
}

// _id 确定性形态（§2.2）：SALE_<shop>_<platform>_<biz_date>_<seq> ⇒ 同表重导覆盖同一文档（幂等）。
function saleDocId(shopId, platform, bizDate, seq) {
  return 'SALE_' + shopId + '_' + platform + '_' + bizDate + '_' + seq;
}

const round1 = (n) => Math.round(n * 10) / 10;

// 解析形态 A（堂食《菜品销售统计》）。
// 返回 { shape, bizDate, rows, totals, nonInt, unmatched }。
//   · rows：{ name, dishKey, qty(整数), amountFen(收入元→分整数), salesFen, discountFen, rawQty, nonInt }
//   · amountFen 取「菜品收入(元)」列（= 销售额 − 优惠，§5.3 实际收入口径），不用毛销售额
//   · qty = Math.round(原始 qty)（§5.2）；非整数行进 nonInt（解析报告单列，不静默）
//   · 合计行（首列 == 合计）排除（§4.2）
function parseDishSales(sheetRows, opts) {
  const rows = sheetRows || [];
  const c = DISH_A_STRUCT;
  const out = [];
  const nonInt = [];
  const unmatched = [];
  for (let i = c.dataStartRow - 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name0 = (r[0] == null ? '' : String(r[0])).trim();
    if (name0 === c.totalLabel) break;                 // 合计行，排除且停（恰在末行）
    const rawQty = toNum(r[c.colQty - 1]);
    const income = toNum(r[c.colIncome - 1]);
    const sales = toNum(r[c.colSales - 1]);
    const discount = toNum(r[c.colDiscount - 1]);
    if (name0 === '' && rawQty == null && income == null && sales == null) continue; // 全空行跳过
    const qty = rawQty == null ? 0 : Math.round(rawQty);   // §5.2 恒整数
    const isNonInt = rawQty != null && !Number.isInteger(rawQty);
    if (isNonInt) nonInt.push({ name: name0, raw: rawQty, rounded: qty });
    const amountFen = Math.round((income == null ? 0 : income) * 100);       // 收入元→分整数
    const salesFen = Math.round((sales == null ? 0 : sales) * 100);
    const discountFen = Math.round((discount == null ? 0 : discount) * 100);
    const dishKey = normalizeDishName(name0);
    // 菜名 '-' 或空（外卖未建映射 / 空行）⇒ 归未匹配（§1.3-2 / 红线 17），不落为菜名
    if (dishKey === '' || dishKey === '-') { unmatched.push({ name: name0, dishKey, rawQty, qty, amountFen }); continue; }
    out.push({
      name: name0, dishKey, qty, amountFen, salesFen, discountFen,
      rawQty: rawQty == null ? 0 : rawQty, nonInt: isNonInt,
    });
  }
  const totals = {
    qty: round1(out.reduce((s, x) => s + x.rawQty, 0)),
    sales: round1(out.reduce((s, x) => s + x.salesFen / 100, 0)),
    income: round1(out.reduce((s, x) => s + x.amountFen / 100, 0)),
    discount: round1(out.reduce((s, x) => s + x.discountFen / 100, 0)),
    amountFen: out.reduce((s, x) => s + x.amountFen, 0),
    rowCount: out.length,
  };
  return {
    shape: DISH_SHAPES.A,
    bizDate: extractBizDate(rows),
    rows: out,
    totals,
    nonInt,
    unmatched,
  };
}

// ===================== M3.33 形态 C（外卖「商品销量」）解析 —— v1.7 C-2~C-7 =====================

// 日期归一：接受 2026/9/7 / 2026-09-07 / 2026.9.7 等形态，统一成 YYYY-MM-DD（月/日补零）。
// 🔴 R245 P8：再接受**紧凑 8 位** `20260910`（美团「商品」表真格式 —— 此前原样返回 ⇒ 被甲级门禁拦）。
// 取不到可解析形态时原样返回（由甲级门禁 fail-closed 拦，不静默改写）。
function normalizeDate(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\D|$)/);   // 紧凑 8 位（后跟非数字或直接结束 ⇒ 7 位/9 位不认）
  if (!m) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
}

// 形态 C 白名单取列（v1.7 C-4）：只取这几列，其余列一律丢弃且不报错。
// 🔴 R245 P7：列名由别名表派生（判定与取列同一张表 ⇒ 不会出现「认得出却取不到」）。
const DISH_C_COLS = Object.keys(DISH_C_ALIAS);

/**
 * 解析形态 C（外卖「商品销量」）。v1.7 C-2~C-7。
 * @param {Array<Array>} sheetRows 0-based 二维 cells（表头 R1 = sheetRows[0]，数据 R2 起）
 * @param {{platform:string}} opts 🔴 opts.platform 必填（由调用方显式传入，不许按文件名猜，见 v1.7 §10-2）
 * @returns {{shape:string, rows:Array, groups:Array, totals:{qty,amountFen}, nonInt:Array, zeroAmountQty:Array, unmatched:Array}}
 */
function parseDishSalesC(sheetRows, opts) {
  const rows = sheetRows || [];
  const hdr = (rows[0] || []).map((x) => (x == null ? '' : String(x).trim()));   // R1 单行表头（v1.7 C-2）

  // 白名单列位（找不到的列记 -1，取数时按 -1 走 undefined ⇒ 归空，不报错）
  const idx = {};
  for (const c of DISH_C_COLS) idx[c] = findDishCCol(hdr, c);   // R245 P7：正名 → 别名兜底
  const get = (r, col) => (idx[col] >= 0 ? r[idx[col]] : undefined);

  const out = [];
  const nonInt = [];
  const unmatched = [];

  for (let i = 1; i < rows.length; i++) {           // 数据 R2 起（单行表头）
    const r = rows[i] || [];
    const name0 = (get(r, '商品名称') == null ? '' : String(get(r, '商品名称')).trim());
    const rawQty = toNum(get(r, '销量'));           // 🔴 销量列全为文本 ⇒ 必先 toNum（v1.7 C-6 / R232-4）
    const sales = toNum(get(r, '销售额'));          // 🔴 严禁用「订单交易额」（整单口径 ⇒ 重复计钱，R232-1）
    const qty = rawQty == null ? 0 : Math.round(rawQty);
    const isNonInt = rawQty != null && !Number.isInteger(rawQty);
    if (isNonInt) nonInt.push({ name: name0, raw: rawQty, rounded: qty });
    const amountFen = Math.round((sales == null ? 0 : sales) * 100);   // amount_fen = 销售额 × 100（v1.7 C-3）
    const bizDate = normalizeDate(get(r, '日期'));   // 行内「日期」列（v1.7 C-7：形态 C 无参数行）
    const dishKey = normalizeDishName(name0);        // 单源 common/dishKey（R232 C-9）

    // 空 dish_key（空格名/空 key）⇒ 单列 unmatched，不落 rows / 不计入 totals（与形态 A 同口径）
    if (dishKey === '' || dishKey === '-') {
      unmatched.push({ name: name0, dishKey, qty, amountFen, bizDate });
      continue;
    }
    out.push({ bizDate, name: name0, dishKey, qty, amountFen });
  }

  // 🔴 v1.7 C-5：amount=0 且 qty>0 的行**按名称聚合**单列（口味询问类 SKU），不进 unmatched、不剔除。
  //   聚合而非逐行：同名 SKU 多天各一行，逐行会给用户 7 条冗余告警；按名合并为 1 条（qty 累加）更清楚。
  const zeroMap = new Map();
  for (const r of out) {
    if (r.amountFen === 0 && r.qty > 0) {
      const z = zeroMap.get(r.name) || { name: r.name, qty: 0 };
      z.qty += r.qty;
      zeroMap.set(r.name, z);
    }
  }
  const zeroAmountQty = Array.from(zeroMap.values());

  // 按 bizDate 分组（一表多天 ⇒ N 组，v1.7 C-7）。🔴 禁止补零行（无行 = 无销售，v1.7 C-6 / R232-2）。
  const groupMap = new Map();
  for (const r of out) {
    const g = groupMap.get(r.bizDate) || { bizDate: r.bizDate, rows: [] };
    g.rows.push(r);
    groupMap.set(r.bizDate, g);
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => (a.bizDate < b.bizDate ? -1 : 1));

  const totals = {
    qty: out.reduce((s, x) => s + x.qty, 0),
    amountFen: out.reduce((s, x) => s + x.amountFen, 0),
  };

  return { shape: DISH_SHAPES.C, rows: out, groups, totals, nonInt, zeroAmountQty, unmatched };
}

module.exports = {
  bufferToMatrix, detectPlatform, guessHeader, parseBillMatrix, checkGradeA, SALES_SCHEMA, toNum,
  pickSheet, normDate, PLATFORM_PROFILE,   // R245：P4 按签名找 sheet / 日期归一
  detectPlatformInRows, detectPlatformInMatrix,   // R250：两级表头（京东订单级）⇒ 平台判定逐行试签名，不靠 guessHeader 选行
  PLATFORM_AMBIGUOUS,                            // R253：多平台同时命中哨兵（上层必须显式比较，truthy 陷阱）
  fmtCell, EXCEL_UTC_BASE,   // R232 C-11：fmtCell 导出以便守卫直接验证日期口径（此前漏导，0/4 全错无人知）
  DISH_SHAPES, DISH_A_STRUCT, normalizeDishName, detectDishShape, detectDishMatrix,
  DISH_C_ALIAS, canonDishCHeader, findDishCCol,   // R245 P7：形态 C 列名别名单源（守卫用）
  extractBizDate, dishRefId, saleDocId, parseDishSales,
  normalizeDate, parseDishSalesC,   // v1.7 形态 C（外卖商品销量）
};
