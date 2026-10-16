// tools/check_export_roundtrip.js ——【R298·B3】导出件「真能读回 + 内容保真」守卫
// 运行： node tools/check_export_roundtrip.js      （EXIT 0 = 全绿）
//
// 背景（PLAN_R297_下一轮审计与修复计划.md 第二梯队 B3，原文）：
//   「导出 ↔ 导入**往返等值** —— 现有约束只保证『导出的是真 xlsx』，**能否读回从未验证**；
//     少行不报错 ⇒ 给会计就是错账」。
//
// 侦察结论（R298，本轮改判）：4 个导出出口（M1 月度报表 / M3 菜品成本卡 / M2 方案对比 /
//   M2 场景矩阵）与 2 个导入入口（外卖账单 / 堂食菜品销售统计）**零交集**
//   ⇒ 「往返等值」的前提不成立，判据改判为「**导出件可回读性与内容保真**」。
//
// 缺口属实（已取证，不是推测）：
//   · tools/check_export_delivery.js 只判**源码形态**（bookType / base64 / 依赖声明 / 文案三处），
//     该套件里 `xlsx | base64 | read(` **零命中** ⇒ 从没有任何测试真的解码过 base64；
//   · cloudfunctions/exportData/selftest.js 里 `xlsx | base64` 同样零命中。
//   ⇒ 导出件「行数对不对、金额是不是数字（会计能不能 SUM）、值有没有变」这一整面，**环上零判据**。
//   同族病：判据只覆盖「写法」不覆盖「产出物」，与 B2「观测覆盖率由命名习惯决定」同型。
//
// 🔴 为什么不设 stub：自写自读（自己造 base64 再自己解析）**恒真**，正是 PLAN 要防的东西。
//   ⇒ 依赖必须来自**真 xlsx 库**，三级解析，全不可得即**响亮红**（fail-closed）：
//     ① 仓内 require 解析（node_modules/xlsx、cloudfunctions/exportData/node_modules/xlsx）
//     ② 受管工作区（env B3_XLSX_WS 可覆盖）
//     ③ env B3_XLSX_PATH（显式绝对路径）
//   本条为**有意**的环境依赖（本机无仓内 xlsx）：门禁换机跑红时，按上面任一路径补依赖即可，
//   警报信息里会打印尝试过的全部候选，不做静默降级。
//
// 判据组（S 扫描面与依赖 / A 真写真读回 / B 单元格类型 / C 内容保真 / D 多 scope /
//          E 边界行为 / F 判据分辨力 / W 已知缺口登记）：
//   S1 三扫描面存在且非空           S2 关键锚点在场（aoa_to_sheet / bookType / base64）
//   S3 xlsx 依赖解析成功（打印层级+版本）   S4 实测版本 ≡ package.json 声明
//   S5 adminExport 明确不在 xlsx 面（它出 csv/json，防复审误判漏项）
//   A1 纯函数可加载（wx-server-sdk 空桩）   A2 真产出 base64 且是 PK zip 魔数
//   A3 工作表名与顺序逐字守恒       A4 逐表行数守恒
//   A5 逐表表头逐格守恒             A6 逐表数据格逐格守恒
//   A7 sheet_to_json 行数 ≡ 源 aoa 长度     A8 真落盘且文件头是 PK
//   B1 利润表金额列为数字型         B2 利润表说明列为文本型（正负互证）
//   B3 明细表金额列数字型           B4 摊销来源数值列数字型
//   B5 口径说明全文本表无数字格     B6 毛利率行是数字型
//   C1 营业收入分↔元往返等值        C2 利润表金额逐点回算分 ≡ 源分
//   C3 明细表逐点回算               C4 摊销来源逐点回算
//   C5 yuan 往返：回算分(yuan(f)) === f     C6 导出金额都是「分」的整数倍（无无限小数）
//   D1 SHEET_NAME 四键齐且对号       D2 单表形态（m3_cards）真读回
//   D3 单表七列：数字列数字型       D4 m2 形态混合表真读回
//   D5 单表与多表同为 PK            D6 四 scope 表名口径登记
//   E1 只有表头（空 rows）⇒ 读回 1 行不抛错
//   E2a SheetJS 底层：空工作簿 ⇒ 抛 Workbook is empty（升级即红逼复核）
//   E2b W1 正向：空 sheets ⇒ xlsxSheetsBase64 返回空串（异常不外泄）
//   E3a SheetJS 底层：重名 ⇒ 抛 already exists（升级即红逼复核）
//   E3b W2 正向：三种重名制造法都去重成功（2 表名互异）
//   E4 超 31 字符真截断             E5 负数 / 大数 / 0.01 边界往返
//   E6 空串表头读回空串（不是 undefined）
//   F1 diffRows 对「少一行」判红     F2 diffRows 对「改一格」判红
//   F3 checkMoneyTypes 对字符串金额判红、对数字判绿
//   F4 reconcileMoney 对「差 1 分」判红
//   F5 diffSheetNames 对改名 / 换序判红
//   F6 resolveXlsx 对全不存在候选返回 null（fail-closed 自证）
//   F7 断言数下界（防退化）
//   W1 正向：xlsxSheetsBase64 已有 try/catch 异常兜底（R298·B3 修复）
//   W2 正向：xlsxSheetsBase64 已接重名去重 uniqueSheetName（R298·B3 修复）
//   W3 正向：buildMonthlySheets 不污染全局（sheets 已显式声明，非隐式全局）
(function () {
  'use strict';
  const fs = require('fs');
  const path = require('path');

  const ROOT = path.resolve(__dirname, '..');
  const P = {
    fn: path.join(ROOT, 'cloudfunctions', 'exportData', 'index.js'),
    pkg: path.join(ROOT, 'cloudfunctions', 'exportData', 'package.json'),
    util: path.join(ROOT, 'utils', 'exportFile.js'),
    admin: path.join(ROOT, 'cloudfunctions', 'adminExport', 'index.js'),
  };
  const OUT_DIR = path.join(ROOT, '_probe_tmp', 'b3_export');

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }
  function read(p) { return fs.readFileSync(p, 'utf8'); }
  // 剥注释：注释里写着老写法（正是被禁的反例），不剥会自伤
  function stripComments(s) { return String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1'); }

  // ============ 依赖解析（三级 · fail-closed）============
  // 纯函数：喂候选数组，逐个 try，全失败返回 null（F6 用它自证）
  function resolveXlsx(cands) {
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c || !c.path) continue;
      try {
        const mod = require(c.path);
        const entry = require.resolve(c.path);
        if (mod && mod.utils && mod.utils.book_new) return { mod: mod, from: c.label, path: c.path, entry: entry };
      } catch (e) { /* 下一个候选 */ }
    }
    return null;
  }
  const WS = process.env.B3_XLSX_WS || 'C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules';
  const CANDS = [
    { label: '①仓内(根)', path: path.join(ROOT, 'node_modules', 'xlsx') },
    { label: '①仓内(exportData)', path: path.join(ROOT, 'cloudfunctions', 'exportData', 'node_modules', 'xlsx') },
    { label: '②受管工作区', path: path.join(WS, 'xlsx') },
  ];
  if (process.env.B3_XLSX_PATH) CANDS.push({ label: '③env B3_XLSX_PATH', path: process.env.B3_XLSX_PATH });

  // ============ 对账纯函数（可喂假数据 · 供 F 组自证）============
  const r2 = (v) => Math.round(Number(v) * 100) / 100;          // 仅用于比对展示值
  const fenOf = (yuanVal) => Math.round(Number((Number(yuanVal) * 100).toFixed(10)));  // 元 → 分（十进制安全式）
  function diffSheetNames(expect, actual) {
    const out = [];
    const n = Math.max(expect.length, actual.length);
    for (let i = 0; i < n; i++) {
      if (expect[i] !== actual[i]) out.push('#' + i + ' 期望『' + expect[i] + '』实得『' + actual[i] + '』');
    }
    return out;
  }
  function diffRows(expectRows, actualRows) {
    const out = [];
    if (expectRows.length !== actualRows.length) out.push('行数 期望 ' + expectRows.length + ' 实得 ' + actualRows.length);
    const n = Math.min(expectRows.length, actualRows.length);
    for (let i = 0; i < n; i++) {
      const e = expectRows[i] || [], a = actualRows[i] || [];
      const w = Math.max(e.length, a.length);
      for (let j = 0; j < w; j++) {
        const ev = e[j] === undefined ? '' : e[j];
        const av = a[j] === undefined ? '' : a[j];
        const same = (typeof ev === 'number' || typeof av === 'number') ? (ev === av) : (String(ev) === String(av));
        if (!same) out.push('R' + (i + 1) + 'C' + (j + 1) + ' 期望 ' + JSON.stringify(ev) + ' 实得 ' + JSON.stringify(av));
      }
    }
    return out;
  }
  function checkMoneyTypes(rows, colIdxes, startRow) {
    const out = [];
    for (let i = (startRow || 1); i < rows.length; i++) {
      colIdxes.forEach((j) => {
        const v = (rows[i] || [])[j];
        if (v === '' || v === undefined || v === null) return;   // 空允许（空行）
        if (typeof v !== 'number') out.push('R' + (i + 1) + 'C' + (j + 1) + ' 非数字：' + JSON.stringify(v));
      });
    }
    return out;
  }
  function reconcileMoney(expectFen, actualFen) {
    const out = [];
    const n = Math.max(expectFen.length, actualFen.length);
    for (let i = 0; i < n; i++) {
      if (expectFen[i] !== actualFen[i]) out.push('#' + i + ' 期望分 ' + expectFen[i] + ' 实得分 ' + actualFen[i]);
    }
    return out;
  }

  const X = resolveXlsx(CANDS);
  const fnSrc = read(P.fn);
  const fnCode = stripComments(fnSrc);
  const utilCode = stripComments(read(P.util));

  // ================= S 扫描面与依赖来源 =================
  console.log('\n===== S · 扫描面与依赖来源（防"扫空/静默降级"）=====');
  const faces = [
    ['cloudfunctions/exportData/index.js', P.fn, 2000],
    ['utils/exportFile.js', P.util, 500],
  ].map((f) => {
    try { return { label: f[0], ok: fs.statSync(f[1]).size > f[2] }; } catch (e) { return { label: f[0], ok: false }; }
  });
  let pkgOk = false;
  try { JSON.parse(read(P.pkg)); pkgOk = true; } catch (e) { pkgOk = false; }
  faces.push({ label: 'cloudfunctions/exportData/package.json', ok: pkgOk });
  check('S1 三个扫描面存在且非空',
    faces.every((f) => f.ok), faces.map((f) => f.label.split('/').pop() + (f.ok ? '(在)' : '(缺)')).join(' / '));
  const anchors = [
    ['aoa_to_sheet', fnCode.indexOf('aoa_to_sheet') >= 0],
    ["bookType:'xlsx'", /bookType:\s*'xlsx'/.test(fnCode)],
    ["type:'base64'", /type:\s*'base64'/.test(fnCode)],
    ['deliver', utilCode.indexOf('function deliver') >= 0],
  ];
  check('S2 四个关键锚点在场（证明根路径没写错、判据真跑了）',
    anchors.every((a) => a[1]), anchors.map((a) => a[0] + (a[1] ? '(在)' : '(缺)')).join(' / '));
  check('S3 xlsx 依赖解析成功（三级 fail-closed，绝不静默降级）',
    !!X, X ? X.from + ' · 版本 ' + X.mod.version : '全部候选失败：' + CANDS.map((c) => c.label + '=' + c.path).join(' | '));
  let declared = '';
  try { declared = (JSON.parse(read(P.pkg)).dependencies || {}).xlsx || ''; } catch (e) { declared = ''; }
  const declMM = (declared.replace(/[^0-9.]/g, '').split('.').slice(0, 2).join('.')) || '';
  check('S4 实测版本与 package.json 声明相容（云端部署用的就是它）',
    !!X && !!declMM && String(X.mod.version).indexOf(declMM) === 0,
    '声明 ' + (declared || '未声明') + ' vs 实测 ' + (X ? X.mod.version : 'n/a'));
  let adminCode = '';
  try { adminCode = stripComments(read(P.admin)); } catch (e) { adminCode = ''; }
  check('S5 adminExport（管理端）明确不在 xlsx 面：它出 csv/json，故不纳入读回判据',
    /'csv'/.test(adminCode) && !/bookType/.test(adminCode), '出参 csv/json + Blob 下载（网页端）');

  // 前置：依赖不可得 ⇒ 后续真跑判据无法执行。fail-closed 打印后直接退出（不假绿）
  if (!X) {
    console.log('\n===== 依赖不可得：真跑判据无法执行 ⇒ fail-closed 判红 =====');
    console.log('   补救：任选其一 —— ① 仓内装 xlsx（npm i xlsx 到 cloudfunctions/exportData）');
    console.log('   ② 设 B3_XLSX_WS 指向含 xlsx 的 node_modules 目录');
    console.log('   ③ 设 B3_XLSX_PATH 指向 xlsx 包目录（含 package.json 的目录）');
    console.log('\n===== R298 B3 导出件可回读守卫结果：' + pass + ' 通过 / ' + (failN + 1) + ' 失败 =====');
    console.log('   ❌ 依赖解析（xlsx 三级全失败）');
    process.exit(1);
  }
  const XLSX = X.mod;
  // 🔴 把真库路由给**被测代码**：exportData 内部是 `require('xlsx')`（相对解析），本机仓内没装
  //   ⇒ `loadXlsx()` 返回 null ⇒ `xlsxSheetsBase64` 返回空串（它自己的 fail-soft 设计）。
  //   这里在模块解析层补上这条环境缝（只拦 'xlsx'，且**先试原解析、失败才回退**）——
  //   喂进去的仍是**同一个真 xlsx 库**，不是 stub，语义不变。
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request) {
    if (request === 'xlsx') {
      try { return origResolve.apply(this, arguments); } catch (e) { return X.entry; }
    }
    return origResolve.apply(this, arguments);
  };

  // ================= 真跑载入 exportData 纯函数 =================
  const origLoad = Module._load;
  Module._load = function (req) {
    if (req === 'wx-server-sdk') return { init() {}, DYNAMIC_CURRENT_ENV: 'x', database: () => ({}), getWXContext: () => ({}) };
    return origLoad.apply(this, arguments);
  };
  let E = null;
  try { E = require(P.fn); } catch (e) { E = null; }
  Module._load = origLoad;

  // 复刻 exportData::xlsxSheetsBase64 的构造（同一形态：数字留数字，其余 String）
  function aoaOf(sheets) {
    return (sheets || []).map((s) => [s.header].concat((s.rows || []).map((r) => r.map((v) => (typeof v === 'number' ? v : String(v == null ? '' : v))))));
  }
  function readBack(b64) {
    const wb = XLSX.read(b64, { type: 'base64' });
    const out = {};
    wb.SheetNames.forEach((n) => {
      const ws = wb.Sheets[n];
      out[n] = {
        rows: XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true }),
        ref: ws['!ref'],
        cell: (addr) => ws[addr],
      };
    });
    return { SheetNames: wb.SheetNames.slice(), sheets: out };
  }

  // 与 check_export_delivery::E 组同构的样例（口径锁 9160 同族，但这里只验读回，不验口径）
  const SAMPLE = {
    shopName: '探针店', month: '2026-09', stamp: Date.UTC(2026, 8, 1),
    row: {
      income_items: [
        { name: '堂食', amount_fen: 4000000, sub_items: [{ sub_item: '午餐', amount_fen: 2500000 }, { sub_item: '晚餐', amount_fen: 1500000 }] },
      ],
      expense_items: [{ name: '房租', amount_fen: 1200000, sub_items: [] }],
      direct_consume_fen: 2200000, real_consume_fen: 2500000, amortize_fen: 333333, lump_sum_fen: 0,
      income_total_fen: 4000000, expense_total_fen: 1200000, gross_profit_fen: 1500000, gross_margin_pct: 37.5,
      operation_ref_profit_fen: 600000, total_factor_real_profit_fen: -33333, profit_diff_fen: 633333,
      switch_used: { inventorySwitchOn: true, amortizeSwitchOn: true },
    },
    assets: [
      { asset_id: 'a1', name: '装修', value_fen: 12000000, start_month: '2026-01', total_months: 36, mode: 'amort' },
      { asset_id: 'a2', name: '小工具', value_fen: 80000, start_month: '2026-09', total_months: 1, mode: 'lump' },
    ],
  };
  check('A1 纯函数可加载：buildMonthlySheets / xlsxSheetsBase64 / xlsxBase64 / yuan（wx-server-sdk 以空桩注入）',
    !!E && typeof E.buildMonthlySheets === 'function' && typeof E.xlsxSheetsBase64 === 'function'
    && typeof E.xlsxBase64 === 'function' && typeof E.yuan === 'function');

  let SHEETS = null, B64 = null, RB = null;
  try {
    SHEETS = E.buildMonthlySheets(SAMPLE);
    B64 = E.xlsxSheetsBase64(SHEETS);
    RB = readBack(B64);
  } catch (e) {
    console.log('   ⚠️ 真跑异常：' + e.message);
  }
  const ran = !!SHEETS && !!B64 && !!RB;

  // ================= A 真写 → 真读回（结构守恒）=================
  console.log('\n===== A · 真写 → 真读回（结构守恒；自写自读恒真 ⇒ 详见 C/E 与 openpyxl 交叉验证）=====');
  check('A2 真产出非空 base64，且是 PK zip 魔数（不是被静默回退成 CSV 文本）',
    ran && B64.length > 1000 && Buffer.from(B64, 'base64').slice(0, 4).toString('hex') === '504b0304',
    ran ? '长度 ' + B64.length + ' · 头 ' + Buffer.from(B64, 'base64').slice(0, 4).toString('hex') : '未产出');
  const expNames = ran ? SHEETS.map((s) => s.name) : [];
  const nameDiff = ran ? diffSheetNames(expNames, RB.SheetNames) : ['未产出'];
  check('A3 工作表名与顺序逐字守恒（4 张：利润表 / 收入费用明细 / 摊销来源 / 口径说明）',
    ran && nameDiff.length === 0 && RB.SheetNames.length === 4,
    ran ? (nameDiff.join('; ') || RB.SheetNames.join(' / ')) : '未产出');
  const aoaAll = ran ? aoaOf(SHEETS) : [];
  const rowCountDiff = [];
  if (ran) {
    SHEETS.forEach((s, i) => {
      const exp = aoaAll[i].length;
      const got = (RB.sheets[s.name] || {}).rows || [];
      if (exp !== got.length) rowCountDiff.push(s.name + ' 期望 ' + exp + ' 实得 ' + got.length);
    });
  }
  check('A4 逐表行数守恒（含空行 —— 少行不报错正是给会计的错账）',
    ran && rowCountDiff.length === 0, rowCountDiff.join('; ') || (ran ? SHEETS.map((s, i) => s.name + '=' + aoaAll[i].length).join(' ') : '未产出'));
  const headDiff = [];
  if (ran) {
    SHEETS.forEach((s) => {
      const got = ((RB.sheets[s.name] || {}).rows || [])[0] || [];
      const d = diffRows([s.header], [got]);
      if (d.length) headDiff.push(s.name + ': ' + d.join(','));
    });
  }
  check('A5 逐表表头逐格守恒', ran && headDiff.length === 0, ran ? (headDiff.join(' | ') || '4 张表头一致') : '未产出');
  const cellDiff = [];
  if (ran) {
    SHEETS.forEach((s, i) => {
      const got = ((RB.sheets[s.name] || {}).rows || []);
      const d = diffRows(aoaAll[i], got);
      if (d.length) cellDiff.push(s.name + ': ' + d.slice(0, 3).join(',') + (d.length > 3 ? ' (+' + (d.length - 3) + ')' : ''));
    });
  }
  check('A6 逐表数据格逐格守恒（数与字符串分别按类型比）', ran && cellDiff.length === 0, ran ? (cellDiff.join(' | ') || '全格一致') : '未产出');
  const jsonLenDiff = [];
  if (ran) {
    SHEETS.forEach((s, i) => {
      const ws = XLSX.read(B64, { type: 'base64' }).Sheets[s.name];
      const len = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true }).length;
      if (len !== aoaAll[i].length) jsonLenDiff.push(s.name + ' 期望 ' + aoaAll[i].length + ' 实得 ' + len);
    });
  }
  check('A7 sheet_to_json 行数 ≡ 源 aoa 长度（blankrows:true 下空行也必须保留）',
    ran && jsonLenDiff.length === 0, ran ? (jsonLenDiff.join('; ') || '4 张表行数一致') : '未产出');
  let diskOk = false, diskPath = '';
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    diskPath = path.join(OUT_DIR, '月度报表.xlsx');
    fs.writeFileSync(diskPath, Buffer.from(B64, 'base64'));
    const head = fs.readFileSync(diskPath).slice(0, 4).toString('hex');
    diskOk = head === '504b0304' && fs.statSync(diskPath).size > 1000;
  } catch (e) { diskOk = false; }
  check('A8 真落盘（_probe_tmp，已 gitignore）且文件头是 PK（可交 Excel/WPS 直接打开验证）',
    diskOk, diskPath || '落盘失败');

  // ================= B 单元格类型（会计能不能 SUM）=================
  console.log('\n===== B · 单元格类型（金额必须是数字型，否则会计 SUM 得 0）=====');
  const rowsOf = (name) => (ran ? ((RB.sheets[name] || {}).rows || []) : []);
  const pRows = rowsOf('利润表');
  const b1 = ran ? checkMoneyTypes(pRows, [1], 1) : ['未产出'];
  check('B1 利润表「金额(元)」列非表头行全为数字型', ran && b1.length === 0, b1.slice(0, 4).join('; ') || '全数字');
  const b2 = [];
  if (ran) {
    for (let i = 1; i < pRows.length; i++) {
      const v = (pRows[i] || [])[2];
      if (v === '' || v === undefined) continue;
      if (typeof v !== 'string') b2.push('R' + (i + 1) + ' 说明列非文本：' + JSON.stringify(v));
    }
  }
  check('B2 利润表「说明」列为文本型（正负互证：判据能分辨数字/文本）', ran && b2.length === 0, ran ? (b2.join('; ') || '全文本') : '未产出');
  const dRows = rowsOf('收入费用明细');
  const b3 = ran ? checkMoneyTypes(dRows, [3], 1) : ['未产出'];
  check('B3 明细表「金额(元)」列为数字型', ran && b3.length === 0, b3.slice(0, 4).join('; ') || '全数字');
  const aRows = rowsOf('摊销来源');
  const b4 = ran ? checkMoneyTypes(aRows, [2, 6], 1) : ['未产出'];
  check('B4 摊销来源「原值(元) / 月均参考(元)」列为数字型', ran && b4.length === 0, b4.slice(0, 4).join('; ') || '全数字');
  const nRows = rowsOf('口径说明');
  // ⚠️ 语义反着来：口径说明表期望**零数字格**（它是「每个数怎么来的」的文字说明）
  //   ⇒ 必须找「是数字」的格，不能用 checkMoneyTypes（那个找「非数字」格）
  const b5 = [];
  if (ran) {
    for (let i = 0; i < nRows.length; i++) {
      [0, 1].forEach((j) => {
        const v = (nRows[i] || [])[j];
        if (typeof v === 'number') b5.push('R' + (i + 1) + 'C' + (j + 1) + ' 数字格：' + v);
      });
    }
  }
  check('B5 口径说明是纯文本表：无数字格（若它冒出数字型 ⇒ 类型判据可能过宽）',
    ran && b5.length === 0, ran ? (b5.slice(0, 4).join('; ') || '零数字格') : '未产出');
  const gmRow = ran ? pRows.find((r) => String(r[0]).indexOf('毛利率') >= 0) : null;
  check('B6 毛利率行是数字型且保留小数（37.5 不得被截成整数或文本）',
    !!gmRow && typeof gmRow[1] === 'number' && gmRow[1] === 37.5, gmRow ? JSON.stringify(gmRow.slice(0, 2)) : '未找到');

  // ================= C 内容保真（分 → 元 → 分 往返等值）=================
  console.log('\n===== C · 内容保真（分 ↔ 元往返逐点等值；用十进制安全式回算）=====');
  const rowOf = (rows, key) => (rows.find((x) => String(x[0]).indexOf(key) >= 0) || []);
  const incRow = ran ? rowOf(pRows, '营业收入') : [];
  check('C1 营业收入：4000000 分 → 40000 元 → 回算分 ≡ 4000000',
    incRow.length > 0 && fenOf(incRow[1]) === 4000000, JSON.stringify(incRow.slice(0, 2)));
  // 利润表金额行（第 2 列）逐点回算。⚠️ 剔除「毛利率(%)」行 —— 它是百分数不是金额，
  //   由 B6 单独验（混进金额序列会让期望值语义含糊）
  const EXP_PROFIT_FEN = [4000000, 1200000, 2200000, 0, 600000, 300000, 333333, -33333, 1500000, 633333];
  const gotProfitFen = ran ? pRows.slice(1)
    .filter((r) => String(r[0]).indexOf('毛利率') < 0)
    .map((r) => r[1]).filter((v) => typeof v === 'number').map((v) => fenOf(v)) : [];
  const c2 = ran ? reconcileMoney(EXP_PROFIT_FEN, gotProfitFen) : ['未产出'];
  check('C2 利润表金额行逐点回算分 ≡ 源分（收入/费用/消耗/一次性/参考利润/差异/摊销/真实利润/毛利/差额）',
    ran && c2.length === 0, c2.join('; ') || gotProfitFen.join(','));
  const gotDetailFen = ran ? dRows.slice(1).map((r) => r[3]).filter((v) => typeof v === 'number').map((v) => fenOf(v)) : [];
  const c3 = ran ? reconcileMoney([4000000, 2500000, 1500000, 4000000, 1200000, 1200000], gotDetailFen) : ['未产出'];
  check('C3 明细表金额逐点回算（大类 + 细项 + 合计）', ran && c3.length === 0, c3.join('; ') || gotDetailFen.join(','));
  // 摊销来源第 7 列（月均参考）：装修 12000000/36 → 333333 分；小工具 80000/1 → 80000 分；两条合计行
  const gotAssetFen = ran ? aRows.slice(1).map((r) => r[6]).filter((v) => typeof v === 'number').map((v) => fenOf(v)) : [];
  const c4 = ran ? reconcileMoney([333333, 80000, 333333, 0], gotAssetFen) : ['未产出'];
  check('C4 摊销来源「月均参考 / 本月摊销合计 / 一次性投入」逐点回算', ran && c4.length === 0, c4.join('; ') || gotAssetFen.join(','));
  const fenList = [0, 1, 99, 100, 12345, 333333, 4000000, 100000000];
  const c5 = ran ? reconcileMoney(fenList, fenList.map((f) => fenOf(E.yuan(f)))) : ['未产出'];
  check('C5 yuan() 往返：回算分(yuan(分)) === 原分（8 个边界值）', ran && c5.length === 0, c5.join('; ') || fenList.join(','));
  const c6 = [];
  if (ran) {
    [['利润表', 1], ['收入费用明细', 3], ['摊销来源', 2], ['摊销来源', 6]].forEach((t) => {
      const rows = rowsOf(t[0]);
      for (let i = 1; i < rows.length; i++) {
        const v = (rows[i] || [])[t[1]];
        if (typeof v !== 'number') continue;
        if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) c6.push(t[0] + ' R' + (i + 1) + ' = ' + v + '（非分的整数倍）');
      }
    });
  }
  check('C6 导出金额都是「分」的整数倍（不得出现 3333.333333 这类无限小数）', ran && c6.length === 0, ran ? (c6.slice(0, 4).join('; ') || '全部 ≤2 位小数') : '未产出');

  // ================= D 多 scope 覆盖（不只 m1_report）=================
  console.log('\n===== D · 多 scope 覆盖（单表形态 + 表名口径）=====');
  const nameMap = {};
  const nameBLK = /const SHEET_NAME = \{([^}]*)\}/.exec(fnCode);
  if (nameBLK) {
    nameBLK[1].split(',').forEach((kv) => {
      const m = /(\w+)\s*:\s*'([^']+)'/.exec(kv);
      if (m) nameMap[m[1]] = m[2];
    });
  }
  const nameKeys = Object.keys(nameMap).sort();
  check('D1 SHEET_NAME 四键齐且对号（m1_report / m3_cards / m2_compare / m2_matrix）',
    nameKeys.length === 4 && nameMap.m3_cards === '菜品成本卡' && nameMap.m2_compare === '方案对比' && nameMap.m2_matrix === '场景矩阵',
    JSON.stringify(nameMap));
  // m3_cards 单表形态（表头与列序照 exportData 的真实实现）
  const M3_HEADER = ['card_code', '菜品名称', '版本', '单份成本(元)', '建议售价(元)', '毛利率%', '核算模式'];
  const M3_AOA = [M3_HEADER,
    ['P001', '耙牛肉', 2, 24.5, 68, 63.97, 'A'],
    ['P002', '小面', 1, 3.2, 12, 73.33, 'B'],
  ];
  let m3B64 = '', m3RB = null;
  try {
    m3B64 = E.xlsxBase64(M3_HEADER, M3_AOA.slice(1), nameMap.m3_cards || '菜品成本卡');
    m3RB = readBack(m3B64);
  } catch (e) { m3RB = null; }
  const m3ws = (m3RB && m3RB.sheets[nameMap.m3_cards]) || null;
  const m3NameDiff = m3RB ? diffSheetNames([nameMap.m3_cards], m3RB.SheetNames) : ['未产出'];
  check('D2 单表形态（m3_cards）真写读回：工作表名守恒 + 行数守恒',
    !!m3ws && m3NameDiff.length === 0 && m3ws.rows.length === M3_AOA.length,
    m3ws ? '名 ' + m3RB.SheetNames[0] + ' 行 ' + m3ws.rows.length : ('未产出 · ' + m3NameDiff.join('; ')));
  const m3Rows = m3ws ? m3ws.rows : [];
  const d3 = m3ws ? checkMoneyTypes(m3Rows, [3, 4, 5], 1) : ['未产出'];
  check('D3 单表七列：成本 / 售价 / 毛利率三列均为数字型', !!m3ws && d3.length === 0, m3ws ? (d3.slice(0, 4).join('; ') || '全数字') : '未产出');
  // m2 形态：前端已算好的 table（数字 + 文本混合）
  const M2_AOA = [['维度', '保本营业额(元)', '毛利率%'],
    ['保守', 18444.44, 55], ['中性', 25000, 55], ['乐观', 32000, 55]];
  let m2RB = null, m2B64 = '';
  try {
    m2B64 = E.xlsxBase64(M2_AOA[0], M2_AOA.slice(1), nameMap.m2_matrix || '场景矩阵');
    m2RB = readBack(m2B64);
  } catch (e) { m2RB = null; }
  const m2ws = (m2RB && m2RB.sheets[nameMap.m2_matrix]) || null;
  const m2Cell = m2ws ? diffRows(M2_AOA, m2ws.rows) : ['未产出'];
  check('D4 m2 形态（前端已算 table：数字 + 文本混合）真读回逐格守恒',
    !!m2ws && m2Cell.length === 0, m2ws ? (m2Cell.slice(0, 4).join('; ') || '全格一致') : '未产出');
  check('D5 单表与多表产物同为 PK zip（两条序列化路径出口一致）',
    !!m3B64 && !!m2B64 && Buffer.from(m3B64, 'base64').slice(0, 4).toString('hex') === '504b0304'
    && Buffer.from(m2B64, 'base64').slice(0, 4).toString('hex') === '504b0304');
  check('D6 四 scope 的表名口径已登记（m1_report 走多表，不用 SHEET_NAME；其余三 scope 走单表）',
    /scope === 'm1_report'/.test(fnCode) && /SHEET_NAME\[scope\]/.test(fnCode));

  // ================= E 边界行为（真读回才能抓到）=================
  console.log('\n===== E · 边界行为（SheetJS 真实行为已登记；升级即红逼复核）=====');
  let hOnly = null;
  try { hOnly = readBack(E.xlsxBase64(['a', 'b'], [], '只有表头')); } catch (e) { hOnly = null; }
  const hws = (hOnly && hOnly.sheets['只有表头']) || null;
  check('E1 只有表头（rows 空）⇒ 读回 1 行且不抛错（会计拿到空表也要能打开）',
    !!hws && hws.rows.length === 1, hws ? JSON.stringify(hws.rows) : '抛错/未产出');
  // E2a 底层登记：**直接**测真库（不经被测函数）——SheetJS 对空工作簿会抛，升级改行为即转红
  let e2raw = '';
  try { XLSX.write(XLSX.utils.book_new(), { type: 'base64', bookType: 'xlsx' }); } catch (e) { e2raw = e.message; }
  check('E2a SheetJS 底层：空工作簿 ⇒ 抛「Workbook is empty」（升级改行为即转红逼复核）',
    e2raw === 'Workbook is empty', e2raw || '未抛错（SheetJS 行为已变！）');
  // E2b 正向（R298·B3-W1 已修）：被测函数把该异常兜成空串 ⇒ main 的 if(!content) 转人话 fail
  let e2ret = 'UNSET', e2threw = '';
  try { e2ret = E.xlsxSheetsBase64([]); } catch (e) { e2threw = e.message; }
  check('E2b W1 正向：空 sheets ⇒ xlsxSheetsBase64 返回空串（不抛；异常不外泄给调用者）',
    e2ret === '' && !e2threw, e2threw ? ('仍抛：' + e2threw) : ('返回 ' + JSON.stringify(e2ret)));
  // E3a 底层登记：**直接**测真库——SheetJS 对重名会抛（升级改行为即转红）
  let e3raw = '';
  try {
    const wbDup = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbDup, XLSX.utils.aoa_to_sheet([['a']]), '同名');
    XLSX.utils.book_append_sheet(wbDup, XLSX.utils.aoa_to_sheet([['b']]), '同名');
  } catch (e) { e3raw = e.message; }
  check('E3a SheetJS 底层：重名 ⇒ 抛「already exists」（升级改行为即转红逼复核）',
    /already exists/.test(e3raw), e3raw || '未抛错（SheetJS 行为已变！）');
  // E3b 正向（R298·B3-W2 已修）：三种制造法都去重成功（2 表 · 名互异 · 不抛）
  const long1 = '第一部分口径说明附录甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥甲乙丙丁戊己庚辛壬癸';
  const dupCases = [
    ['同名', [{ name: '同名', header: ['a'], rows: [[1]] }, { name: '同名', header: ['a'], rows: [[2]] }]],
    ['截断后同名', [{ name: long1 + 'A', header: ['a'], rows: [[1]] }, { name: long1 + 'B', header: ['a'], rows: [[2]] }]],
    ['双双缺名', [{ header: ['a'], rows: [[1]] }, { header: ['a'], rows: [[2]] }]],
  ];
  const dupBad = [];
  dupCases.forEach(([label, sets]) => {
    try {
      const names = readBack(E.xlsxSheetsBase64(sets)).SheetNames;
      if (!(names.length === 2 && new Set(names).size === 2)) dupBad.push(label + '→' + names.join('/'));
    } catch (e) { dupBad.push(label + '→ERR:' + e.message); }
  });
  check('E3b W2 正向：三种重名制造法都去重成功（同名 / 截断后同名 / 双双缺名 ⇒ 2 表名互异）',
    dupBad.length === 0, dupBad.join(' | ') || '全通过');
  const LONG = long1 + 'A';
  let e4name = '';
  try {
    const rb = readBack(E.xlsxSheetsBase64([{ name: LONG, header: ['a'], rows: [[1]] }]));
    e4name = (rb.SheetNames && rb.SheetNames[0]) || '';
  } catch (e) { e4name = 'ERR:' + e.message; }
  check('E4 工作表名超 31 字符被真截断（Excel 硬限；截断后长度 31）',
    e4name === LONG.slice(0, 31) && e4name.length === 31, '源 ' + LONG.length + ' → 读回 ' + e4name.length);
  const EDGE = [-12345.67, 1000000.01, 0, 0.01];
  let e5 = ['未产出'];
  try {
    const ews = readBack(E.xlsxBase64(['金额(元)'], EDGE.map((v) => [v]), '边界')).sheets['边界'];
    const got = ews ? ews.rows.slice(1).map((r) => r[0]) : [];
    e5 = reconcileMoney(EDGE.map((v) => fenOf(v)), got.map((v) => (typeof v === 'number' ? fenOf(v) : NaN)));
  } catch (e) { e5 = ['ERR:' + e.message]; }
  check('E5 负数（亏损月）/ 百万元级 / 0.01 边界金额往返等值', e5.length === 0, e5.slice(0, 3).join('; ') || '全等值');
  let e6v = 'NO_SHEET';
  try {
    const nws = readBack(E.xlsxBase64(['项目', '', '毛利率%'], [['收入', 1, 37.5]], '空表头')).sheets['空表头'];
    e6v = (nws && nws.rows[0]) ? nws.rows[0][1] : 'NO_ROW';
  } catch (e) { e6v = 'ERR:' + e.message; }
  check('E6 空串表头读回空串（不是 undefined ⇒ 列不错位）', e6v === '', JSON.stringify(e6v));

  // ================= F 判据分辨力（纯函数变异自证）=================
  console.log('\n===== F · 判据分辨力（喂假数据，证明判据不是恒绿）=====');
  const f1 = diffRows([['a', 1], ['b', 2]], [['a', 1]]);
  check('F1 diffRows 对「少一行」判红', f1.length > 0, f1.join('; ').slice(0, 60));
  const f2 = diffRows([['a', 1], ['b', 2]], [['a', 1], ['b', 3]]);
  check('F2 diffRows 对「改一格」判红（分毫不差）', f2.length === 1 && /R2C2/.test(f2[0]), f2.join('; '));
  const f3a = checkMoneyTypes([['t', 'v'], ['x', 1]], [1], 1);
  const f3b = checkMoneyTypes([['t', 'v'], ['x', '1']], [1], 1);
  check('F3 checkMoneyTypes：数字判绿 / 字符串金额判红（会计 SUM 得 0 的那种）',
    f3a.length === 0 && f3b.length === 1, '绿=' + f3a.length + ' 红=' + f3b.length);
  const f4 = reconcileMoney([100, 200], [100, 201]);
  check('F4 reconcileMoney 对「差 1 分」判红（老板对差 1 分最敏感）', f4.length === 1 && /#1/.test(f4[0]), f4.join('; '));
  const f5a = diffSheetNames(['甲', '乙'], ['乙', '甲']);
  const f5b = diffSheetNames(['甲', '乙'], ['甲', '丙']);
  check('F5 diffSheetNames 对「换序」与「改名」都判红', f5a.length === 2 && f5b.length === 1,
    '换序 ' + f5a.length + ' 处 / 改名 ' + f5b.length + ' 处');
  const f6 = resolveXlsx([{ label: '假A', path: path.join(ROOT, '__no_such_pkg_A__') }, { label: '假B', path: path.join(ROOT, '__no_such_pkg_B__') }]);
  check('F6 resolveXlsx 对「全不存在候选」返回 null（fail-closed 自证：不会拿假模块蒙混）', f6 === null);
  check('F7 判据非退化：本守卫断言数 ≥ 40（防「删判据 ⇒ 恒绿」）', pass + failN >= 40, '累计 ' + (pass + failN) + ' 条');

  // ================= W 缺口闭合复核（R298·B3 登记的两条缺口 + 隐式全局，本批已修）=================
  console.log('\n===== W · 缺口闭合复核（R298·B3 登记 ⇒ 本批修复后转正向断言）=====');
  const fnBody = /function xlsxSheetsBase64\(sheets\)\s*\{[\s\S]*?\n\}/.exec(fnCode);
  const bodyTxt = fnBody ? fnBody[0] : '';
  check('W1 正向：xlsxSheetsBase64 已有异常兜底（try/catch ⇒ 返回空串 + console.error 留痕）',
    !!bodyTxt && /try\s*\{/.test(bodyTxt) && /catch\s*\(/.test(bodyTxt) && /return\s+''/.test(bodyTxt),
    bodyTxt ? (/try\s*\{/.test(bodyTxt) ? '含 try/catch 兜底' : '❌ 函数体无 try/catch（缺口仍在）') : '未定位到函数体');
  check('W2 正向：xlsxSheetsBase64 已接重名去重入口（uniqueSheetName）',
    !!bodyTxt && /uniqueSheetName\s*\(/.test(bodyTxt),
    bodyTxt ? (/uniqueSheetName\s*\(/.test(bodyTxt) ? '已接去重' : '❌ 未接去重（缺口仍在）') : '未定位到函数体');
  // R298·B3 第 3 项（隐式全局）：原 `sheets = [...]` 未声明 ⇒ 已补 const。
  //   判据取**行为面**（真调一次看是否污染 global），不是形态面 —— 与「分支到不到」同族纪律。
  delete global.sheets;
  let w3threw = '';
  try { E.buildMonthlySheets(); } catch (e) { w3threw = e.message; }
  check('W3 正向：buildMonthlySheets 不污染全局（sheets 已显式声明，非隐式全局）',
    !('sheets' in global) && !w3threw,
    w3threw ? ('抛：' + w3threw) : (('sheets' in global) ? '❌ global.sheets 被写入（仍是隐式全局）' : '未污染全局'));

  console.log('\n===== R298 B3 导出件可回读守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach((b) => console.log('   ❌ ' + b));
  process.exit(failN === 0 ? 0 : 1);
})();
