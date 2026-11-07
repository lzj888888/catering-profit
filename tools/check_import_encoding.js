// 导入编码守卫（R615 · 队列 #9）
//
// 守的是什么事故：老板从美团/京东后台下的是 **GBK 编码的 CSV**，云端 XLSX.read(buffer)
//   把 GBK 双字节当 Latin-1 逐字节解 ⇒ 中文全毁（`日期`→`ÈÕÆÚ`）⇒ 形态判不出 ⇒
//   页面只回一句「无法识别账单平台」，老板以为自己导错了表。**静默失败，零报错。**
//
// 为什么用桩而不 require 真 xlsx：守卫要在任何机器上零依赖跑得起来（本地/CI 都没装 xlsx）。
//   桩的语义严格对齐真库：type:'string' ⇒ 按 CSV 切分；type:'buffer' ⇒ 返回哨兵 sheet。
//   这样既验证「文本走文本分支、二进制走二进制分支」，又验证整条解析链。
//   真 xlsx 库下的端到端回归见 review/evidence/r615_encoding/（真库实跑 3 组 10 行 270.00 元）。
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const MT_CSV = path.join(ROOT, 'review/evidence/r242_mt_goods/mt_goods_20260907_20260913.csv');
const MT_UTF8 = path.join(ROOT, 'review/evidence/r242_mt_goods/_v3_utf8_nobom.csv');

let pass = 0;
let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}

// ===== xlsx 桩 =====
const calls = [];
function splitCsv(text) {
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.length).map((l) => l.split(','));
}
function makeWb(name, rows) {
  return {
    SheetNames: [name],
    Sheets: { [name]: {} },
    __rows: rows,
  };
}
const xlsxStub = {
  read(input, opts) {
    const type = (opts && opts.type) || 'buffer';
    calls.push({ type, isString: typeof input === 'string' });
    if (type === 'string') {
      const rows = splitCsv(input);
      const wb = makeWb('Sheet1', rows);
      return wb;
    }
    // 二进制分支：不真解析，只回哨兵，用来证明「没被文本解码器误吞」
    return makeWb('__BINARY__', [['__BINARY_BRANCH__']]);
  },
  utils: {
    sheet_to_json(ws) {
      // 桩把 rows 挂在 wb 上，这里通过闭包拿不到 ⇒ 改用全局登记的最近一次
      return xlsxStub.__lastRows || [];
    },
  },
};
// 让桩的 read 把 rows 记到 __lastRows（sheet_to_json 随后取）
const _read = xlsxStub.read;
xlsxStub.read = function (input, opts) {
  const wb = _read.call(xlsxStub, input, opts);
  xlsxStub.__lastRows = wb.__rows || [];
  return wb;
};
const _load = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'xlsx') return xlsxStub;
  return _load.call(this, req, parent, isMain);
};
const S = require(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'));
Module._load = _load;

// ===================== A 组：编码嗅探纯逻辑 =====================
console.log('\n=== A 组 decodeTextBuffer（编码嗅探）===');

const gbkBuf = fs.readFileSync(MT_CSV);
const a1 = S.decodeTextBuffer(gbkBuf);
ok('A-① 真美团 GBK CSV ⇒ 识别为 gbk，且解出正确表头',
  a1 && a1.encoding === 'gbk' && a1.text.indexOf('日期,商品名') === 0,
  a1 ? a1.encoding + ' / 首列=' + a1.text.split(',')[0] : 'null');

ok('A-② GBK 解出的正文含正确菜名（不是乱码）',
  a1 && a1.text.indexOf('煮小酥肉') >= 0 && a1.text.indexOf('\uFFFD') < 0);

const u8Buf = fs.readFileSync(MT_UTF8);
const a2 = S.decodeTextBuffer(u8Buf);
ok('A-③ UTF-8 CSV ⇒ 识别为 utf8（不误判成 gbk）',
  a2 && a2.encoding === 'utf8' && a2.text.indexOf('日期,商品名') === 0,
  a2 ? a2.encoding : 'null');

const a3 = S.decodeTextBuffer(Buffer.from('日期,商品名\n20260910,煮小酥肉\n', 'utf8'));
ok('A-④ 无 BOM 的 UTF-8 中文 ⇒ utf8', a3 && a3.encoding === 'utf8');

const a4 = S.decodeTextBuffer(Buffer.concat([Buffer.from([0xFF, 0xFE]),
  Buffer.from('日期,商品名\n', 'utf16le')]));
ok('A-⑤ UTF-16LE + BOM（Excel「Unicode 文本」）⇒ utf16le', a4 && a4.encoding === 'utf16le',
  a4 ? a4.encoding + ' / 首列=' + a4.text.split(',')[0] : 'null');

const xlsxBuf = fs.readFileSync(path.join(ROOT, '_probe_tmp/taobao_goods.xlsx'));
ok('A-⑥ 真 xlsx（PK 头）⇒ 返回 null，必须原路交 XLSX.read',
  S.decodeTextBuffer(xlsxBuf) === null);

ok('A-⑦ xls（OLE 头 D0CF11E0）⇒ 返回 null',
  S.decodeTextBuffer(Buffer.concat([Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), Buffer.alloc(64)])) === null);

ok('A-⑧ 空 / 超短 buffer ⇒ null（不崩）',
  S.decodeTextBuffer(Buffer.alloc(0)) === null && S.decodeTextBuffer(Buffer.from('a')) === null);

ok('A-⑨ 纯 ASCII CSV ⇒ utf8（不因为「非中文」被误判）',
  (() => { const r = S.decodeTextBuffer(Buffer.from('date,name\n20260910,abc\n', 'utf8'));
    return r && r.encoding === 'utf8'; })());

ok('A-⑩ countReplacement 单源在场（判据不靠猜字符集）',
  typeof S.countReplacement === 'function' && S.countReplacement('中文abc') === 0
  && S.countReplacement('a\uFFFDb') === 1);

// ===================== B 组：端到端（真 GBK 样例 → 能判出形态并解析）=====================
console.log('\n=== B 组 bufferToMatrix 端到端（真美团 GBK 样例）===');

calls.length = 0;
const mtx = S.bufferToMatrix(gbkBuf);
ok('B-① GBK 文本走 type:"string" 分支（不是把二进制硬塞给 XLSX）',
  calls.length === 1 && calls[0].type === 'string' && calls[0].isString === true,
  JSON.stringify(calls[0]));

const sheetName = Object.keys(mtx.sheets)[0];
const rows = mtx.sheets[sheetName].rows;
ok('B-② matrix 表头 14 列全对（中文未坏）',
  rows[0].length === 14 && rows[0][0] === '日期' && rows[0][1] === '商品名'
  && rows[0][5] === '商品销量' && rows[0][7] === '商品销售额',
  'R1=' + JSON.stringify(rows[0].slice(0, 4)));

const det = S.detectDishMatrix(mtx);
ok('B-③ 能判出形态 C（waimai_goods）—— 修复前这里是 null',
  det.shape === S.DISH_SHAPES.C, JSON.stringify(det));

const parsed = S.parseDishSalesC(rows, {});
const groups = parsed.groups || [];
const nRows = groups.reduce((s, g) => s + (g.rows || []).length, 0);
const qtySum = groups.reduce((s, g) => s + (g.rows || []).reduce((a, r) => a + (r.qty || 0), 0), 0);
const amtSum = groups.reduce((s, g) => s + (g.rows || []).reduce((a, r) => a + (r.amountFen || 0), 0), 0);
ok('B-④ 解析出 3 个日期组 / 10 行',
  groups.length === 3 && nRows === 10, groups.length + ' 组 / ' + nRows + ' 行');
ok('B-⑤ 销量合计 12 份、金额合计 270.00 元（与 242 期手工核算一致）',
  qtySum === 12 && amtSum === 27000, 'qty=' + qtySum + ' amountFen=' + amtSum);
ok('B-⑥ 日期组 = 2026-09-10 / 09-12 / 09-13（YYYYMMDD 已归一）',
  groups.map((g) => g.bizDate).join(',') === '2026-09-10,2026-09-12,2026-09-13',
  groups.map((g) => g.bizDate).join(','));
ok('B-⑦ 菜名正确（煮小酥肉），不是乱码',
  groups.some((g) => (g.rows || []).some((r) => r.name === '煮小酥肉')));

ok('B-⑧ 「订单交易额」不被当销售额（整单口径会重复计钱）',
  amtSum === 27000 && amtSum !== Math.round(335.2 * 100),
  'amountFen=' + amtSum + '（335.2 元=33520 是错的口径）');

// ===================== C 组：二进制不能被文本路径误吞 =====================
console.log('\n=== C 组 回归：xlsx/xls 仍走二进制分支 ===');

calls.length = 0;
const mtxX = S.bufferToMatrix(xlsxBuf);
ok('C-① 真 xlsx ⇒ 走 type:"buffer"（没被文本解码器吞掉）',
  calls.length === 1 && calls[0].type === 'buffer',
  JSON.stringify(calls[0]));
ok('C-② 走二进制分支时拿到的是哨兵 sheet（证明不是被当成 CSV 解）',
  Object.keys(mtxX.sheets).indexOf('__BINARY__') >= 0,
  JSON.stringify(Object.keys(mtxX.sheets)));

ok('C-③ 源码层：zip/OLE 头的判断在文本解码之前（顺序错了正常 xlsx 会全乱）',
  (() => {
    const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'), 'utf8');
    const iZip = src.indexOf("b[0] === 0x50 && b[1] === 0x4B");
    const iUtf = src.indexOf("b.toString('utf8')");
    return iZip > 0 && iUtf > 0 && iZip < iUtf;
  })());

ok('C-④ 源码层：GBK 回退用 TextDecoder（零依赖，不真 require iconv-lite 加包体积）',
  (() => {
    const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'), 'utf8');
    // 🔴 判「真的 require 了」而不是字面出现 —— 注释里写明「不引 iconv-lite」会被字面判据误伤
    //   （本仓踩过同类坑：判据要判行为，不判字面）。
    return src.indexOf("new TextDecoder('gbk')") > 0
      && !/require\(\s*['"]iconv-lite['"]\s*\)/.test(src);
  })());

ok('C-⑤ bufferToMatrix 必须先嗅探再 read（守卫防「有人把嗅探删了」）',
  (() => {
    const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions/importSalesBill/service.js'), 'utf8');
    const iDec = src.indexOf('const dec = decodeTextBuffer(buffer)');
    const iRead = src.indexOf('XLSX.read(dec.text');
    return iDec > 0 && iRead > 0 && iDec < iRead;
  })());

console.log('\n===== 导入编码守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
