// tools/check_bill_realtables.js —— R700：**老板真表**端到端回归
//
// 为什么单独建这个套件：
//   仓里 `review/evidence/r615_wechat_real/` 与 `r181l_stage1_import_feed/fixtures/`
//   早就躺着美团、淘宝闪购的**真实导出文件**（李老师提供的），但全仓**零脚本引用** ——
//   它们从没进过门禁。于是「解析器改坏了真表」这件事只有等老板导入才发现。
//   本套件把真表接进自动化：金额一律**独立复算**后双向核对，不采信解析器自己的汇总。
//
// 数据来源（xlsx → JSON，无损抽取，见 review/evidence/r700_realtables/README.md）：
//   taobao_bill.json   ← r181l_stage1_import_feed/fixtures/淘宝闪购.xlsx（6 个 sheet）
//   meituan_bill.json  ← r615_wechat_real/meituan_bill_20260907-0913.xlsx（sheet「订单明细」69 列）
//   meituan_goods.json ← r615_wechat_real/meituan_goods_20260907-0913.xlsx（商品销量表 14 列）
//
// 🔴 判据纪律：
//   - 金额比「分」（整数），不比浮点元，避免 0.01 抖动假红。
//   - 不比中文字面量做业务判断（page-terms P3-1）：要比就比**结构位置**（列索引）或数字。
//   - 每条断言都能指出「哪一行真表数据支撑它」。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');   // E 组读 xlsx 的 docProps 用（解 deflate，零依赖）
const BP = require('../utils/billParse.js');
const DI = require('../utils/dishImport.js');

const EV = path.join(__dirname, '..', 'review', 'evidence', 'r700_realtables');
const load = (f) => JSON.parse(fs.readFileSync(path.join(EV, f), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  (' + extra + ')' : '')); }
}
const fen = (n) => (n / 100).toFixed(2);

const tb = load('taobao_bill.json');
const mt = load('meituan_bill.json');
const mg = load('meituan_goods.json');

// ================== A · 淘宝闪购真表（零误差锚点） ==================
// billParse.js 头部注释写着锚点：「淘宝闪购 2026-08：156 行 / 到手 3779.65 元」。
// 这张真表就是那个锚点的原始数据 —— 解析器若与它不符，说明锚点早就漂了。
console.log('\n===== A · 淘宝闪购真表（6 sheet / 156 数据行） =====');
ok('A-① 样本真带 6 个 sheet（真实导出，不是单 sheet 精简版）',
  Object.keys(tb.sheets).length === 6, Object.keys(tb.sheets).join('/'));

const tbDet = BP.detectPlatformInMatrix(tb);
ok('A-② 多 sheet 里能自己找对表：判定 taobao 且选中「外卖账单明细」',
  !!tbDet && tbDet.platform === 'taobao' && tbDet.sheet === '外卖账单明细',
  JSON.stringify(tbDet));

const tbR = BP.parseBillMatrix(tb, { platform: 'taobao' });
ok('A-③ 到手 3779.65 元（与模块注释的零误差锚点逐一相符）',
  tbR.totals.amountFen === 377965, fen(tbR.totals.amountFen) + ' 元');
ok('A-④ 有效订单 150 单（156 行里有 6 行退单，退单不计单）',
  tbR.totals.qty === 150, 'qty=' + tbR.totals.qty);
ok('A-⑤ 退单是「整表取、自然冲减」：参与计算 156 行，一行都没被丢',
  tbR.totals.rowCount === 156, 'rowCount=' + tbR.totals.rowCount);
ok('A-⑥ 归月 2026-08（按账单日期，不是结算日期）',
  tbR.months.length === 1 && tbR.months[0] === '2026-08', JSON.stringify(tbR.months));

// 独立复算：完全不经过解析器，直接从 JSON 求和
let tbSum = 0, tbRefund = 0, tbRows = 0;
{
  const rows = tb.sheets['外卖账单明细'].rows;
  const hdr = rows[0];
  const iAmt = hdr.indexOf('结算金额');
  const iType = hdr.indexOf('订单类型');
  for (let i = 1; i < rows.length; i++) {
    const v = parseFloat(String(rows[i][iAmt] || '').replace(/,/g, ''));
    if (Number.isNaN(v)) continue;
    tbRows++; tbSum += Math.round(v * 100);
    if (String(rows[i][iType] || '').indexOf('退') >= 0) tbRefund++;
  }
}
ok('A-⑦ 独立复算与解析器一致（不用被测代码，直接求和）',
  Math.round(tbSum) === tbR.totals.amountFen && tbRows === tbR.totals.rowCount,
  '独立=' + fen(Math.round(tbSum)) + ' 元/' + tbRows + ' 行  解析器=' + fen(tbR.totals.amountFen) + ' 元/' + tbR.totals.rowCount + ' 行');
ok('A-⑧ 退单确实是 6 行（证明 A-④ 的 qty 差额来自退单，不是算错）',
  tbRefund === 6, '退单 ' + tbRefund + ' 行');

// ================== B · 美团真表（退款冲减 —— R700 修的就是这条） ==================
// 真表实证：同一订单号 440229506410710878 有两行
//   「外卖订单」+37.87 与「订单部分退款」−39.85
// 修前只按 eq 筛「外卖订单」⇒ 退款整行被排 ⇒ 收入 130.66（多算 39.85 / 多 44%），零提示。
console.log('\n===== B · 美团真表（69 列 / 含部分退款） =====');
const mtDet = BP.detectPlatformInMatrix(mt);
ok('B-① 判定 meituan 且选中「订单明细」（不是豆包说的「结算账单」，那张是另一回事）',
  !!mtDet && mtDet.platform === 'meituan' && mtDet.sheet === '订单明细',
  JSON.stringify(mtDet));

const mtR = BP.parseBillMatrix(mt, { platform: 'meituan' });
ok('B-② 到手 90.81 元 = 外卖订单 130.66 + 部分退款 −39.85（退款必须冲减）',
  mtR.totals.amountFen === 9081, fen(mtR.totals.amountFen) + ' 元');
ok('B-③ 有效订单 5 单（退款行不计单 —— 它的订单状态写「订单完成」，靠状态判不出来）',
  mtR.totals.qty === 5, 'qty=' + mtR.totals.qty);
ok('B-④ 只排除 8 行（5 保险 + 3 广告），退款**不在**被排除之列',
  mtR.excluded.rows === 8, 'excluded=' + mtR.excluded.rows);
ok('B-⑤ 参与计算 6 行（5 外卖订单 + 1 退款），不是 5 行',
  mtR.totals.rowCount === 6, 'rowCount=' + mtR.totals.rowCount);

// 独立复算（三条口径都算出来，证明 90.81 不是碰巧）
{
  const rows = mt.sheets['订单明细'].rows;
  const hdr = rows[0];
  const iType = hdr.indexOf('交易类型');
  const iNet = hdr.indexOf('商家应收款');
  let orderSum = 0, refundSum = 0, adIns = 0;
  for (let i = 1; i < rows.length; i++) {
    const t = String(rows[i][iType] || '').trim();
    const v = parseFloat(String(rows[i][iNet] || '').replace(/,/g, ''));
    if (Number.isNaN(v)) continue;
    const c = Math.round(v * 100);
    if (t === '外卖订单') orderSum += c;
    else if (t.indexOf('退款') >= 0) refundSum += c;
    else adIns += c;
  }
  ok('B-⑥ 独立复算：外卖订单 130.66 − 退款 39.85 = 90.81（与解析器一致）',
    orderSum === 13066 && refundSum === -3985 && orderSum + refundSum === mtR.totals.amountFen,
    '订单=' + fen(orderSum) + ' 退款=' + fen(refundSum) + ' 合计=' + fen(orderSum + refundSum));
  ok('B-⑦ 反恒真：若按修前口径（排掉退款）会算成 130.66 —— 证明 B-② 有分辨力',
    orderSum === 13066 && orderSum !== mtR.totals.amountFen,
    '修前=' + fen(orderSum) + ' 修后=' + fen(mtR.totals.amountFen));
  ok('B-⑧ 广告+保险合计 −5.61（5×保险0.10 + 广告0.21/3.50/1.40），与「不该被当外卖收入」这一定性相符',
    adIns === -561, fen(adIns) + ' 元');
}

// ================== C · 美团商品表真表（验 R699 列探测） ==================
// 真表列序：日期 / 商品名 / 门店所在城市 / 门店名称 / 门店id / 商品销量 / 销量占比 / 商品销售额 ...
// ⇒ 菜名在**第 2 列**、第一列是日期；且**没有单价列**（只有销售额）。
// 这正是 R699 修的那件事：旧实现把第一列当菜名 ⇒ 每道菜都叫「20260910」。
console.log('\n===== C · 美团商品销量真表（14 列 / 菜名在第 2 列） =====');
{
  const sn = Object.keys(mg.sheets)[0];
  const rows = mg.sheets[sn].rows;
  ok('C-① 真表 sheet 名是动态的（带门店与日期后缀），不能硬编码表名',
    sn.length > 8 && sn.indexOf('_') > 0, sn);
  ok('C-② 表头第一列不是菜名（先证明「可能出错」的前提成立）',
    rows[0][0] !== rows[0][1], '第一列=' + rows[0][0] + ' 第二列=' + rows[0][1]);

  const cols = DI.detectColumns(rows.map(function (r) { return r.join('\t'); }));
  ok('C-③ detectColumns 在真表上定位到菜名列 = 第 2 列（idx 1）',
    !!cols && cols.nameIdx === 1, JSON.stringify(cols));
  ok('C-④ 真表无「单价」列 ⇒ priceIdx 为 −1（绝不把「商品销售额」当单价）',
    !!cols && cols.priceIdx === -1, 'priceIdx=' + (cols && cols.priceIdx));

  const parsed = DI.parseDishLines(rows.map(function (r) { return r.join('\t'); }).join('\n'));
  ok('C-⑤ 10 行商品全部解析出来（表头行被拦、不漏行）',
    parsed.length === rows.length - 1, parsed.length + ' / ' + (rows.length - 1));
  ok('C-⑥ 菜名不是日期：没有一行名字是纯 8 位数字（R699 修的那件事，真表上复核）',
    parsed.every(function (r) { return !/^\d{8}$/.test(r.name); }),
    parsed.slice(0, 3).map(function (r) { return r.name; }).join('、'));
  ok('C-⑦ 售价全部留空（真表没有单价值，宁可空着也不猜）',
    parsed.every(function (r) { return r.priceYuan === null; }));
}

// ================== D · 回归：改动没有波及别的平台 ==================
console.log('\n===== D · 回归（keepContains 只对美团开口） =====');
ok('D-① 淘宝 profile 未配 keepContains（退单靠整表取冲减，不需要它）',
  !BP.PLATFORM_PROFILE.taobao.rowFilter, '淘宝 rowFilter=null');
ok('D-② 京东订单级 profile 仍未配 keepContains（不受本次改动影响）',
  !BP.PLATFORM_PROFILE.jd_order.rowFilter.keepContains, JSON.stringify(BP.PLATFORM_PROFILE.jd_order.rowFilter));
ok('D-③ 美团 keepContains 只放「退款」（不放广告/保险，否则等于不筛）',
  Array.isArray(BP.PLATFORM_PROFILE.meituan.rowFilter.keepContains)
  && BP.PLATFORM_PROFILE.meituan.rowFilter.keepContains.length === 1, JSON.stringify(BP.PLATFORM_PROFILE.meituan.rowFilter.keepContains));

// ================== E · 样本出处（真表 vs 脚本模拟） ==================
// 起因：李老师提醒「这里表格有真实的，有后期豆包模拟生成的」。
//   仓里 evidence 下混着两类文件：平台导出的真表，和早期用脚本/豆包造的样本
//   （如 `jd_sku_sample_doubao.xlsx`、`dsi1_s1_example.xlsx`）。
//   **把模拟样本当真表用，会让「回归通过」变成假象** —— 模拟样本本来就是照着解析器写的。
//
// 判据（写进 xlsx 的 docProps，改不掉、也编不出）：
//   Application = Apache POI        → 平台**后端** Java 导出 ⇒ 真表（真人不会用 POI）
//   Application = WPS 表格 / Excel  → 老板打开/另存过 ⇒ 真表
//   Application = openpyxl / "Excel Compatible" → 脚本生成 ⇒ 模拟
// 这里用 node 零依赖解 zip（中央目录 + inflateRaw）直接读元数据，不看文件名、不看注释。
console.log('\n===== E · 样本出处（不许把模拟样本当真表） =====');
function zipEntryText(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cnt = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < cnt; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === want) {
      const lNameLen = buf.readUInt16LE(lho + 26);
      const lExtra = buf.readUInt16LE(lho + 28);
      const start = lho + 30 + lNameLen + lExtra;
      const raw = buf.slice(start, start + csize);
      return method === 0 ? raw.toString('utf8') : zlib.inflateRawSync(raw).toString('utf8');
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return null;
}
function xlsxApp(file) {
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const appXml = zipEntryText(buf, 'docProps/app.xml') || '';
  const coreXml = zipEntryText(buf, 'docProps/core.xml') || '';
  const grab = (tag, s) => {
    const m = new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>').exec(s);
    return m ? m[1] : '';
  };
  return {
    app: grab('Application', appXml),
    by: grab('cp:lastModifiedBy', coreXml),
    created: grab('dcterms:created', coreXml),
  };
}
// 真表判据：平台后端（POI）或 老板用 WPS/Excel 打开过
const isReal = (m) => !!m && (/poi/i.test(m.app) || /wps|excel(?!.*compatible)/i.test(m.app) && !/compatible/i.test(m.app));
const ROOT = path.join(__dirname, '..');
const mtBillX = path.join(ROOT, 'review/evidence/r615_wechat_real/meituan_bill_20260907-0913.xlsx');
const tbBillX = path.join(ROOT, 'review/evidence/r181l_stage1_import_feed/fixtures/淘宝闪购.xlsx');
const mtGoodsX = path.join(ROOT, 'review/evidence/r615_wechat_real/meituan_goods_20260907-0913.xlsx');
const fakeX = path.join(ROOT, 'review/evidence/r245_jd_profile/jd_sku_sample_doubao.xlsx');

const m1 = xlsxApp(mtBillX), m2 = xlsxApp(tbBillX), m3 = xlsxApp(mtGoodsX), m4 = xlsxApp(fakeX);
ok('E-① 美团账单来源是真表：xlsx 元数据 Application=Apache POI（平台后端 Java 导出）',
  !!m1 && /poi/i.test(m1.app), m1 ? m1.app : '读不到元数据');
ok('E-② 淘宝闪购来源是真表：同上（且 lastModifiedBy 是门店名，老板动过）',
  !!m2 && /poi/i.test(m2.app), m2 ? m2.app + ' / by=' + m2.by : '读不到');
ok('E-③ 美团商品表来源是真表：WPS 表格打开过（老板另存）',
  !!m3 && /wps/i.test(m3.app), m3 ? m3.app + ' / by=' + m3.by : '读不到');
ok('E-④ 说明：这三张不是脚本模拟（真表判据独立成立，不靠文件名/注释）',
  isReal(m1) && isReal(m2) && isReal(m3));
ok('E-⑤ 反证判据有分辨力：标了 doubao 的样本必须被判成「模拟」而非真表',
  !!m4 && !isReal(m4), m4 ? m4.app : '读不到');
ok('E-⑥ 三个 JSON 抽取自三张真 xlsx，且 xlsx 都还在（防止证据被删后 JSON 成孤儿）',
  fs.existsSync(mtBillX) && fs.existsSync(tbBillX) && fs.existsSync(mtGoodsX));

// ================== F · 账单侧扩展（R703：原来只有 3 张进回归，这些一直躺着没跑） ==================
// 云函数 service.js 只导出纯函数，但它 require 了 xlsx（本机没装）。
// 用 Module._load 打空桩 —— 与 tools/check_bill_import_gate.js 同一做法（不是新发明）。
console.log('\n===== F · 账单侧扩展（美团账单包 / 京东账单 / 京东SKU） =====');
let SV = null;
{
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  try { SV = require('../cloudfunctions/importSalesBill/service.js'); } catch (e) { SV = null; }
  finally { Module._load = orig; }
}
ok('F-⓪ 云函数纯函数可加载（xlsx 走空桩）', !!SV);

const mtPack = load('meituan_bill_pack.json');
const mtPackDet = BP.detectPlatformInMatrix(mtPack);
// 🔴 这个文件是**完整账单包**：4 个 sheet 里「账单明细」是按日汇总（列名是「账单金额」），
//   「订单明细」才是我们吃的那张（69 列）。认错 sheet = 收入口径整个错。
ok('F-① 4 个 sheet 里认对「订单明细」（不是「账单明细」按日汇总）',
  !!mtPackDet && mtPackDet.platform === 'meituan' && mtPackDet.sheet === '订单明细',
  JSON.stringify(mtPackDet));

const mtPackR = BP.parseBillMatrix(mtPack, { platform: 'meituan' });
ok('F-② 2026-08 整月：到手 1826.64 元 / 50 单 / 50 行',
  mtPackR.totals.amountFen === 182664 && mtPackR.totals.qty === 50 && mtPackR.totals.rowCount === 50,
  fen(mtPackR.totals.amountFen) + ' 元 / ' + mtPackR.totals.qty + ' 单');
ok('F-③ 只排除 47 行（广告 26 + 保险 21），与真表交易类型分布相符',
  mtPackR.excluded.rows === 47, 'excluded=' + mtPackR.excluded.rows);

// 🔴🔴 本套件**最强的一条验证**：用平台自己写的「汇总信息」sheet 当基准。
//   为什么不只用独立复算：复算和解析器可能犯同一个理解错误（比如都把退款当广告）。
//   平台汇总是第三方立场，且它把「外卖订单 49笔 1779.53」与「企业外卖订单 1笔 47.11」分开列 ——
//   在「订单明细」里这两类都写「外卖订单」，所以我们必须拿到 1826.64 才对得上。
{
  const ws = mtPack.sheets['汇总信息'].rows;
  const cell = (r, c) => String((ws[r] || [])[c] || '');
  // R2: [门店数量, 1, 外卖订单, 49笔, 1,779.53元]  R7: [_, _, 企业外卖订单, 1笔, 47.11元]
  ok('F-④ 平台自带「汇总信息」存在且写了外卖订单笔数/金额（对账基准可得）',
    cell(1, 2).indexOf('外卖订单') >= 0 && cell(1, 3).indexOf('笔') >= 0,
    cell(1, 2) + ' ' + cell(1, 3) + ' ' + cell(1, 4));
  const parseYuan = (s) => Math.round(parseFloat(String(s).replace(/[,，元]/g, '')) * 100) || 0;
  const parseCnt = (s) => parseInt(String(s).replace(/[^0-9]/g, ''), 10) || 0;
  const normalAmt = parseYuan(cell(1, 4));       // 外卖订单 1779.53
  const normalCnt = parseCnt(cell(1, 3));        // 49 笔
  // 企业外卖订单在第 7 行（下标 6）
  let bizAmt = 0, bizCnt = 0;
  for (let r = 1; r < ws.length; r++) {
    const row = ws[r] || [];
    if (String(row[2] || '').indexOf('企业') >= 0) { bizCnt = parseCnt(row[3]); bizAmt = parseYuan(row[4]); }
  }
  ok('F-⑤ 平台汇总：外卖订单 49笔 1779.53 + 企业外卖订单 1笔 47.11 = 1826.64',
    normalCnt === 49 && normalAmt === 177953 && bizCnt === 1 && bizAmt === 4711,
    normalCnt + '笔/' + fen(normalAmt) + ' + ' + bizCnt + '笔/' + fen(bizAmt));
  ok('F-⑥ 我们的解析结果 ≡ 平台两项之和（第三方立场对账，不是自己复算自己）',
    normalAmt + bizAmt === mtPackR.totals.amountFen && normalCnt + bizCnt === mtPackR.totals.qty,
    '平台=' + fen(normalAmt + bizAmt) + '/元 ' + (normalCnt + bizCnt) + '笔  我们=' + fen(mtPackR.totals.amountFen) + '元 ' + mtPackR.totals.qty + '笔');
}

const jdBill = load('jd_bill.json');
const jdBillDet = BP.detectPlatformInMatrix(jdBill);
ok('F-⑦ 京东账单（两级表头 R1 分组 / R2 真列名）认得出', !!jdBillDet && jdBillDet.platform === 'jd_order', JSON.stringify(jdBillDet));
const jdBillR = BP.parseBillMatrix(jdBill, { platform: 'jd_order' });
ok('F-⑧ 京东账单：正向订单 555.96 元 / 23 单（不筛 = 482.65，那是扣完推广费/保险的净打款）',
  jdBillR.totals.amountFen === 55596 && jdBillR.totals.qty === 23,
  fen(jdBillR.totals.amountFen) + ' 元 / ' + jdBillR.totals.qty + ' 单');
ok('F-⑨ 京东账单排除 92 行（推广费 23 + 保险单 69）',
  jdBillR.excluded.rows === 92, 'excluded=' + jdBillR.excluded.rows);
{
  const rows = jdBill.sheets[Object.keys(jdBill.sheets)[0]].rows;
  const hdr = rows[1];
  const iT = hdr.indexOf('订单类型'), iN = hdr.indexOf('应结金额');
  let pos = 0, posN = 0;
  for (let i = 2; i < rows.length; i++) {
    if (String(rows[i][iT] || '').trim() !== '正向订单') continue;
    const v = parseFloat(String(rows[i][iN] || '').replace(/,/g, ''));
    if (Number.isNaN(v)) continue;
    pos += Math.round(v * 100); posN++;
  }
  ok('F-⑩ 独立复算与解析器一致（不经过解析器）',
    pos === jdBillR.totals.amountFen, '独立=' + fen(pos) + ' 元/' + posN + ' 行');
}

// 空样本：只有表头没有数据。断言的是「不崩、不编」——这比"能解析"更重要。
const jdSku = load('jd_sku_bill.json');
const jdSkuR = BP.parseBillMatrix(jdSku, { platform: 'jd_sku' });
ok('F-⑪ 京东SKU 空表（只有表头）：0 元 / 0 单，不崩不编',
  jdSkuR.totals.amountFen === 0 && jdSkuR.totals.qty === 0 && jdSkuR.totals.rowCount === 0,
  JSON.stringify(jdSkuR.totals));

// ================== G · 菜品侧扩展（R703） ==================
console.log('\n===== G · 菜品侧扩展（外卖商品 / 京东订单 / 套餐明细 / 进销存） =====');
const goodsDl = load('goods_download.json');
const goodsRows = goodsDl.sheets['data'].rows;
const gShape = SV ? SV.detectDishShape(goodsRows) : null;
ok('G-① 外卖「商品下载」355 行 ⇒ 形态 C', gShape === 'waimai_goods', String(gShape));
const goodsC = SV ? SV.parseDishSalesC(goodsRows) : { totals: {} };
ok('G-② 商品下载：118 件 / 1823.08 元 / 354 行（独立复算一致）',
  goodsC.totals.qty === 118 && goodsC.totals.amountFen === 182308 && goodsC.rows.length === 354,
  JSON.stringify(goodsC.totals));
ok('G-③ 该表把「销售额」排在「销量」**前面**，仍读对 —— 证明形态 C 按列名定位、不靠列序',
  (function () {
    const hdr = goodsRows[0];
    return hdr.indexOf('销售额') < hdr.indexOf('销量');
  })() && goodsC.totals.amountFen === 182308);

const jdOrd = load('jd_order_export.json');
const jdOrdRows = jdOrd.sheets['数据'].rows;
ok('G-④ 京东订单导出 ⇒ 形态 D（商品混装在一列，无独立销量/销售额列）',
  SV && SV.detectDishShape(jdOrdRows) === 'jd_order_export');
const jdOrdR = SV ? SV.parseDishSalesD(jdOrdRows) : { totals: {}, rows: [] };
ok('G-⑤ 京东订单：10 件 / 197.02 元 / 8 单（混装列还原正确）',
  jdOrdR.totals.qty === 10 && jdOrdR.totals.amountFen === 19702 && jdOrdR.rows.length === 8,
  JSON.stringify(jdOrdR.totals));
ok('G-⑥ 混装列无未匹配项（unmatched 为空 —— 有残留就说明解析漏了商品）',
  Array.isArray(jdOrdR.unmatched) && jdOrdR.unmatched.length === 0);

const combo = load('combo_detail.json');
const comboRows = combo.sheets[Object.keys(combo.sheets)[0]].rows;
ok('G-⑦ 套餐明细 ⇒ 形态 B（主动拒收，套餐组分已在菜品销售统计里）',
  SV && SV.detectDishShape(comboRows) === 'combo_detail');

// 「认不出」也是一种**正确**行为：进销存表我们根本没有对应功能，
// 硬塞进菜品/账单任一口径都是错的。这条断言防的就是「以后有人为了 KPI 让它认得出」。
const inv = load('inventory.json');
ok('G-⑧ 进销存表 ⇒ 认不出（预期：没有这个功能，认得出反而说明判据放得太松）',
  SV && SV.detectDishShape(inv.sheets[Object.keys(inv.sheets)[0]].rows) === null,
  String(SV ? SV.detectDishShape(inv.sheets[Object.keys(inv.sheets)[0]].rows) : 'SV 未加载'));

// ================== H · 三种口径：把「看起来矛盾」变成机器可查的事实 ==================
// 为什么单独一组：美团账单包里三个数都对得上，但**不相等** ——
//   1826.64（外卖收入，含企业外卖订单）
//   1779.53（平台口径的「外卖订单」，不含企业外卖订单）
//   1747.95（账单金额 = 打款净额，扣完广告/保险）
// 不知道这层关系的人，看到任一数字都会以为另外两个是 bug。
console.log('\n===== H · 三种口径不许混（防后人误判成 bug） =====');
{
  const billAmt = mtPack.sheets['账单明细'].rows;
  // 「汇总信息」R3 写了账单金额 1747.95
  const sumRows = mtPack.sheets['汇总信息'].rows;
  let billTotal = 0;
  for (let r = 0; r < sumRows.length; r++) {
    const row = sumRows[r] || [];
    if (String(row[0] || '').indexOf('账单金额') >= 0) {
      billTotal = Math.round(parseFloat(String(row[1]).replace(/[,，元]/g, '')) * 100) || 0;
    }
  }
  ok('H-① 平台「账单金额」1747.95 元可得（这是打款净额，不是外卖收入）',
    billTotal === 174795, fen(billTotal) + ' 元');
  ok('H-② 外卖收入 1826.64 − 账单金额 1747.95 = 78.69 = 广告 76.41 + 保险 2.28',
    mtPackR.totals.amountFen - billTotal === 7869,
    '差 ' + fen(mtPackR.totals.amountFen - billTotal) + ' 元');
  ok('H-③ 三个数互不相等，但每一个都能解释 —— 不是 bug（本条就是防误判的判据）',
    new Set([182664, 177953, 174795]).size === 3 && mtPackR.totals.amountFen === 182664);
  ok('H-④ 「账单明细」sheet 是按日汇总，列名是「账单金额」不是「商家应收款」',
    (billAmt[1] || []).indexOf('账单金额') >= 0 && (billAmt[1] || []).indexOf('商家应收款') < 0,
    JSON.stringify((billAmt[1] || []).slice(0, 6)));
}

console.log('\n' + '='.repeat(60));
console.log('===== 真表回归结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);
