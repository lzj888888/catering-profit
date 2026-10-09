// tools/selftest_bill_parse.js —— 批次 F 账单解析自测（零依赖，只用仓库内 fixture）
//
// 锚点（PLAN §四，移植后必须原样复现，否则不算交付）：
//   淘宝闪购 2026-08：156 行 / 到手 3779.65 元
//   美团 2026-08：全 97 行 → 外卖订单筛后 50 行 / 应收 1826.64 元
//
// 运行：node tools/selftest_bill_parse.js

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

const { detectPlatform, guessHeader, parseBillMatrix, detectPlatformInMatrix } = require('../utils/billParse.js');
const ROOT = path.join(__dirname, '..', 'review', 'evidence', 'r181l_stage1_import_feed', 'fixtures');
const tb = JSON.parse(fs.readFileSync(path.join(ROOT, 'taobao_2026-08.matrix.json'), 'utf8'));
const mt = JSON.parse(fs.readFileSync(path.join(ROOT, 'meituan_2026-08.matrix.json'), 'utf8'));

console.log('===== detectPlatform（按列名，不看文件名）=====');
const tbHeader = tb.sheets['外卖账单明细'].rows[0].map((s) => String(s).trim());
const mtHeader = mt.sheets['订单明细'].rows[0].map((s) => String(s).trim());
check('detectPlatform 淘宝表头 → taobao', detectPlatform(tbHeader) === 'taobao', detectPlatform(tbHeader));
check('detectPlatform 美团表头 → meituan', detectPlatform(mtHeader) === 'meituan', detectPlatform(mtHeader));
// 反例：美团文件名叫 09bbd0104….xlsx、淘宝叫「淘宝闪购.xlsx」—— 只看列名不看文件名
check('detectPlatform 空表头 → null', detectPlatform([]) === null, '');
check('detectPlatform 未知表头 → null', detectPlatform(['foo', 'bar']) === null, '');

// 🔴 P1（R245）：判据从「单列特征」改为「签名列全中 + 排除列全不中」
//    京东 SKU 表第 11 列也叫「结算金额」⇒ 旧判据把它误判成 taobao（能算出错数的静默错账）。
console.log('===== P1 平台判据加严（京东串味回归）=====');
const JDR = path.join(__dirname, '..', 'review', 'evidence', 'r245_jd_profile');
const jdSkuH = JSON.parse(fs.readFileSync(path.join(JDR, 'jd_sku_header.json'), 'utf8')).header;
const jdOrdH = JSON.parse(fs.readFileSync(path.join(JDR, 'jd_order_header.json'), 'utf8')).header;
check('京东 SKU 表头 ≠ taobao（deny 排除生效）', detectPlatform(jdSkuH) !== 'taobao', String(detectPlatform(jdSkuH)));
check('京东订单级表头 ≠ taobao', detectPlatform(jdOrdH) !== 'taobao', String(detectPlatform(jdOrdH)));
check('淘宝表头混入「应结金额」⇒ 判 null（deny 硬判据）', detectPlatform(tbHeader.concat(['应结金额'])) === null, String(detectPlatform(tbHeader.concat(['应结金额']))));
check('缺签名列（只有账单日期）⇒ null', detectPlatform(['账单日期']) === null, String(detectPlatform(['账单日期'])));
check('签名列单中一个（只有结算金额）⇒ 不判 taobao', detectPlatform(['结算金额']) !== 'taobao', String(detectPlatform(['结算金额'])));

console.log('===== 淘宝锚点 =====');
const tbR = parseBillMatrix(tb, { platform: 'taobao' });
check('淘宝 行数 156（totals.rowCount）', tbR.totals.rowCount === 156, `got ${tbR.totals.rowCount}`);
check('淘宝 到手 3779.65 元 = 377965 分', tbR.totals.amountFen === 377965, `got ${tbR.totals.amountFen}`);
check('淘宝 有效订单数 150（不含退单 6）', tbR.totals.qty === 150, `got ${tbR.totals.qty}`);
check('淘宝 归月 months 含 2026-08', tbR.months.indexOf('2026-08') >= 0, JSON.stringify(tbR.months));

console.log('===== 美团锚点 =====');
const mtR = parseBillMatrix(mt, { platform: 'meituan' });
check('美团 筛后 50 行（totals.rowCount）', mtR.totals.rowCount === 50, `got ${mtR.totals.rowCount}`);
check('美团 应收 1826.64 元 = 182664 分', mtR.totals.amountFen === 182664, `got ${mtR.totals.amountFen}`);
check('美团 有效订单数 50', mtR.totals.qty === 50, `got ${mtR.totals.qty}`);
check('美团 排除 47 行（全 97 − 筛后 50）', mtR.excluded.rows === 47, `got ${mtR.excluded.rows}`);
check('美团 不筛直接 Σ 会得 1747.95（≠ 收入，已通过筛选避开）', mtR.totals.amountFen !== 174795, `应收=${mtR.totals.amountFen}`);

console.log('===== guessHeader（前 5 行非空文本格最多）=====');
check('guessHeader 淘宝 → 0', guessHeader(tb.sheets['外卖账单明细'].rows) === 0, String(guessHeader(tb.sheets['外卖账单明细'].rows)));
check('guessHeader 美团 → 0', guessHeader(mt.sheets['订单明细'].rows) === 0, String(guessHeader(mt.sheets['订单明细'].rows)));

// 🔴 P2~P6（R245）：京东秒送两形态接入（订单级两级表头 / SKU 级长表）
console.log('===== 京东秒送（P2~P6）=====');
const jdOrderM = JSON.parse(fs.readFileSync(path.join(JDR, 'jd_order_2026-09.matrix.json'), 'utf8'));
const jdSkuM = JSON.parse(fs.readFileSync(path.join(JDR, 'jd_sku_sample.matrix.json'), 'utf8'));
check('detectPlatform 京东订单级表头 → jd_order', detectPlatform(jdOrdH) === 'jd_order', String(detectPlatform(jdOrdH)));
check('detectPlatform 京东 SKU 表头 → jd_sku', detectPlatform(jdSkuH) === 'jd_sku', String(detectPlatform(jdSkuH)));

const jo = parseBillMatrix(jdOrderM, { platform: 'jd_order' });
check('京东订单级 表头行 = 1（两级表头取 R2）', jo.headerRow === 1, `got ${jo.headerRow}`);
check('京东订单级 收入 555.96 元 = 55596 分（仅正向订单）', jo.totals.amountFen === 55596, `got ${jo.totals.amountFen}`);
check('京东订单级 有效订单 23（按主订单号去重）', jo.totals.qty === 23, `got ${jo.totals.qty}`);
check('京东订单级 排除 92 行（115 − 23）', jo.excluded.rows === 92, `got ${jo.excluded.rows}`);
check('京东订单级 不筛会得 482.65（错值，已验证避开）', jo.totals.amountFen !== 48265, `收入=${jo.totals.amountFen}`);
check('京东订单级 bizDate 由「账期」区间归一为 YYYY-MM-DD', jo.rows.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(jo.rows[0].bizDate), JSON.stringify(jo.rows[0]));

const js = parseBillMatrix(jdSkuM, { platform: 'jd_sku' });
check('京东 SKU 表头行 = 0', js.headerRow === 0, `got ${js.headerRow}`);
check('京东 SKU 结算合计 237.00 元 = 23700 分', js.totals.amountFen === 23700, `got ${js.totals.amountFen}`);
check('京东 SKU 订单数 3（13 行按到家业务单号去重）', js.totals.qty === 3, `got ${js.totals.qty}`);
check('京东 SKU 计费行 13（长表一行一费项）', js.totals.rowCount === 13, `got ${js.totals.rowCount}`);
check('京东 SKU bizDate 取「账期时间」', js.rows.length === 1 && js.rows[0].bizDate === '2026-09-01', JSON.stringify(js.rows));

// 🔴 云函数副本同步（防两处漂移）：cloudfunctions/importSalesBill/service.js 内联了同源实现，
//    云函数独立打包不能 require utils/ ⇒ 必须**人工同步**。此处用源码特征做**便宜的防漂移判据**
//    （比 runtime 等价便宜的版本；逐字节等价由 probe_cf_parity.js 单独证）。
console.log('===== 云函数副本同步检查（防两处漂移）=====');
const cfSrc = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'importSalesBill', 'service.js'), 'utf8');
check('云函数副本含 PLATFORM_PROFILE 档案', cfSrc.indexOf('PLATFORM_PROFILE') >= 0, '');
check('云函数副本含 jd_order / jd_sku 两形态', cfSrc.indexOf("'jd_order'") >= 0 && cfSrc.indexOf("'jd_sku'") >= 0, '');
check('云函数副本含 pickSheet（按签名找 sheet，P4）', cfSrc.indexOf('function pickSheet') >= 0, '');
check('云函数副本 detectPlatform 用 require+deny（P1）', cfSrc.indexOf('prof.deny') >= 0, '');

// 🔴 R245：平台枚举在仓内有**三份**手写副本（云端 SALES_SCHEMA / 前端 utils/gradeGate.js / 入参 validate.js）。
//    P1 给云端加了 jd_order/jd_sku 而另两份漏跟 ⇒ check_grade_gate_dual A-② 当场红（抓到了才补）。
//    ⇒ 此处立「三副本逐值同序」判据，防止下次加平台又只改一处。
console.log('===== 平台枚举三副本同步（R245：京东两形态）=====');
const enumOf = (src) => {
  const m = src.match(/platform: \{[^}]*enum: \[([^\]]*)\]/);
  return m ? m[1].replace(/['"\s]/g, '').split(',').filter(Boolean) : null;
};
const ggSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'gradeGate.js'), 'utf8');
const vaSrc = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'importSalesBill', 'validate.js'), 'utf8');
const eCloud = enumOf(cfSrc);
const eFront = enumOf(ggSrc);
check('前端 utils/gradeGate.js 与云端 SALES_SCHEMA 的 platform.enum 逐值同序（含 jd_order/jd_sku）',
  !!eCloud && !!eFront && eCloud.join(',') === eFront.join(',') && eCloud.indexOf('jd_order') >= 0
    && eCloud.indexOf('jd_sku') >= 0,
  'cloud=[' + (eCloud || []).join(',') + '] front=[' + (eFront || []).join(',') + ']');
const platValidate = (vaSrc.match(/PLATFORMS = \[([^\]]*)\]/) || [])[1];
const pv = platValidate ? platValidate.replace(/['"\s]/g, '').split(',').filter(Boolean) : [];
check('入参 validate.js 的 PLATFORMS 含 jd_order/jd_sku 且不含 pos（入口不得把京东平台吞成空）',
  pv.indexOf('jd_order') >= 0 && pv.indexOf('jd_sku') >= 0 && pv.indexOf('pos') < 0,
  'PLATFORMS=[' + pv.join(',') + ']');

// ============================================================================================
// 🔴 R250：平台**自动判定**（前端不传 platform 时走的那条路）必须识破「两级表头」。
//
//   根因：京东《对账单下载》（订单级）R1 是**合并的组表头**（"商家基础信息" × 5 /
//     "订单基础信息" × 77，导出时**逐格写满**），R2 才是真列名；两者的「非空文本格数」都是 82
//     ⇒ guessHeader 的启发式（文本最多 + 严格大于 + 先到先得）取到 **R1**
//     ⇒ 旧写法 `detectPlatform(rows[guessHeader(rows)])` 返 null
//     ⇒ **一张有 117 行数据的表被判「无法识别账单平台」**（真机现象：李老师导京东账单进不去）。
//   ⚠️ 盲区成因：本文件此前只测了 `detectPlatform(正确表头行)`，**从没测过
//     `guessHeader → detectPlatform` 这条生产链**；且原 `guessHeader` 注释已写明"京东订单级 R1 是
//     分组行"，但那要在**传入 platform** 时才生效 —— 自动判定时 platform 还没有，走的正是纯启发式。
//   ✅ 本组判**行为**（真调生产函数），不扫源码字面。
// ============================================================================================
console.log('===== 平台自动判定（R250：两级表头 ⇒ 逐候选行试签名）=====');
const jdOrdRows = ((jdOrderM.sheets || {})[Object.keys(jdOrderM.sheets)[0]] || {}).rows || [];
check('S1 样本确实是"两级表头"：R1（组表头）判不出平台', detectPlatform(jdOrdRows[0]) === null, String(detectPlatform(jdOrdRows[0])));
check('S2 样本确实是"两级表头"：R2 才是真列名（jd_order）', detectPlatform(jdOrdRows[1]) === 'jd_order', String(detectPlatform(jdOrdRows[1])));
check('S3 自失效护栏：扫描面非退化（4 个 fixture 都在场、京东订单级样本 ≥ 10 行）',
  jdOrdRows.length >= 10 && !!tb && !!mt && !!jdSkuM, 'jd_order 行数=' + jdOrdRows.length);

const autoJd = detectPlatformInMatrix(jdOrderM);
check('A1 京东订单级：自动判定 ⇒ jd_order 且表头行 = 1  ← R250 修复点',
  !!autoJd && autoJd.platform === 'jd_order' && autoJd.headerRow === 1, JSON.stringify(autoJd));

// 🔴🔴 R250 关键：**仓内 fixture 复现不出这个坑** —— 它的 R0（组表头）是**稀疏**的
//   （只有 17 个非空格，导出时只写了左上角），而 R1 真列名有 82 格 ⇒ 启发式照样选 R1。
//   但**真文件**的 R1 是**逐格写满**的（实测：82 格全非空，与 R2 打平）⇒ 才触发"先到先得取到组表头"。
//   ⇒ 拿 fixture 当样本时，旧写法（`detectPlatform(rows[guessHeader(rows)])`）**也能过**
//     ⇒ A1 那条**没有分辨力**（实测：把 detectPlatformInRows 退回旧写法，A1 仍绿）。
//   故此处按真文件形态**现造忠实样本**：只需在**判据相关属性**上忠实，
//   即「R0 与 R1 的非空文本格数相等」——这正是让旧写法翻车的那一条。
const jdOrdRealHdr = jdOrdH.slice();
const jdFilled = (() => {
  const w = jdOrdRealHdr.length;
  const group = [];
  for (let i = 0; i < w; i++) group.push(i < 5 ? '商家基础信息' : '订单基础信息');
  return { sheets: { 'com.jd.o2o.settlement.domain.dt': { rows: [group, jdOrdRealHdr] } } };
})();
const nzText = (r) => (r || []).filter((x) => x != null && String(x).trim() !== '').length;
check('S4 忠实样本：R0（组表头逐格写满）与 R1（真列名）非空文本格数**相等** ⇒ 复现出"打平"这一致病条件',
  nzText(jdFilled.sheets['com.jd.o2o.settlement.domain.dt'].rows[0]) === nzText(jdOrdRealHdr)
  && nzText(jdOrdRealHdr) === 82,
  'R0=' + nzText(jdFilled.sheets['com.jd.o2o.settlement.domain.dt'].rows[0]) + ' R1=' + nzText(jdOrdRealHdr));
check('S5 记录盲区成因：仓内 fixture 的 R0 是**稀疏**的（非空格数 < 一半）⇒ 不能拿它当本组样本',
  nzText(jdOrdRows[0]) < nzText(jdOrdRows[1]) / 2,
  'fixture R0=' + nzText(jdOrdRows[0]) + ' vs R1=' + nzText(jdOrdRows[1]));
const autoFilled = detectPlatformInMatrix(jdFilled);
check('A5 忠实样本（两级表头都写满）：自动判定 ⇒ jd_order 且表头行 = 1  ← 真正有分辨力的那条',
  !!autoFilled && autoFilled.platform === 'jd_order' && autoFilled.headerRow === 1, JSON.stringify(autoFilled));
// 只作诊断打印、**不判红**：旧写法在此样本上会翻车 —— 用它自证「样本确有区分力」，
//   但**不**把"旧写法必须失败"写成断言（否则将来有人把 guessHeader 改进成会跳组表头，
//   正确实现反被判红 = 判据反向伤害第二型）。真正的判据只有 A5 这一条行为断言。
console.log('      · 诊断（不判红）：旧写法 detectPlatform(rows[guessHeader(rows)]) 在本样本 ⇒ '
  + JSON.stringify(detectPlatform((jdFilled.sheets['com.jd.o2o.settlement.domain.dt'].rows[guessHeader(jdFilled.sheets['com.jd.o2o.settlement.domain.dt'].rows)] || []).map((x) => String(x).trim()))));

const autoTb = detectPlatformInMatrix(tb);
check('A2 回归：淘宝（单级表头）自动判定 ⇒ taobao 且表头行 = 0（不许被本次改动改坏）',
  !!autoTb && autoTb.platform === 'taobao' && autoTb.headerRow === 0, JSON.stringify(autoTb));
const autoMt = detectPlatformInMatrix(mt);
check('A3 回归：美团多 sheet（只第 2 个 sheet 命中）⇒ meituan 且指到「订单明细」',
  !!autoMt && autoMt.platform === 'meituan' && autoMt.sheet === '订单明细', JSON.stringify(autoMt));
check('A4 反例：无关矩阵 ⇒ null（不许"猜一个"）',
  detectPlatformInMatrix({ sheets: { x: { rows: [['foo', 'bar'], ['1', '2']] } } }) === null, '');

// 云端副本行为等价（R245 起两副本靠人工同步；本函数是 R250 新加的 ⇒ 必须两处都在且行为一致）
let cfSvc = null;
try { cfSvc = require(path.join(__dirname, '..', 'cloudfunctions', 'importSalesBill', 'service.js')); }
catch (e) {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  try { cfSvc = require(path.join(__dirname, '..', 'cloudfunctions', 'importSalesBill', 'service.js')); } catch (e2) { cfSvc = null; }
  Module._load = orig;
}
check('B1 云端副本导出 detectPlatformInMatrix（新函数不许只改一处）',
  !!(cfSvc && typeof cfSvc.detectPlatformInMatrix === 'function'), '');
const same = (m) => JSON.stringify(cfSvc && cfSvc.detectPlatformInMatrix(m)) === JSON.stringify(detectPlatformInMatrix(m));
check('B2 云端副本 ≡ 前端副本（4 个 fixture + 忠实两级表头样本，逐条行为等价）',
  !!(cfSvc && same(jdOrderM) && same(tb) && same(mt) && same(jdSkuM) && same(jdFilled)),
  cfSvc ? ('jd=' + JSON.stringify(cfSvc.detectPlatformInMatrix(jdOrderM))
    + ' 忠实=' + JSON.stringify(cfSvc.detectPlatformInMatrix(jdFilled))) : '云端副本不可加载');

// 调用点：云函数 index.js 的平台自动判定必须走这个唯一入口（否则修好了函数、调用点没跟上）
const idxSrcRaw = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'importSalesBill', 'index.js'), 'utf8');
const idxSrc = idxSrcRaw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const block = (() => {           // 取 `if (!platform) { … }` 这一段（行号无关）
  const i = idxSrc.indexOf('if (!platform) {');
  if (i < 0) return '';
  let d = 0;
  for (let j = idxSrc.indexOf('{', i); j < idxSrc.length; j++) {
    if (idxSrc[j] === '{') d++;
    else if (idxSrc[j] === '}') { d--; if (d === 0) return idxSrc.slice(i, j + 1); }
  }
  return '';
})();
check('B3 云函数 index.js 的平台自动判定调用 detectPlatformInMatrix(matrix)（剥注释后判）',
  block.indexOf('detectPlatformInMatrix(matrix)') >= 0, 'block 长度=' + block.length);
check('B4 自失效护栏：B3 的扫描面非空（取不到 `if (!platform) {` 段时必须红）',
  block.length > 40, 'block 长度=' + block.length);

console.log('\n' + '='.repeat(60));
console.log(`===== 账单解析自测结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
