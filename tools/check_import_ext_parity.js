// 导入扩展名对等守卫（R748）
//
// 守的是什么事故：「云端能解析的格式」⊃「前端 picker 放行的格式」。
//   实况（2026-11-17 交叉审计 G2）：`bufferToMatrix` 早已支持 CSV（R615 专为真实美团 GBK CSV
//   加了编码嗅探，样本就在 review/evidence/r242_mt_goods/ 里）与 xls（OLE），
//   而 `subpkg/biz/takeaway/index.js` 的 chooseMessageFile 只放行 `['xlsx']`
//   ⇒ 老板从美团/京东后台导出的 csv 在微信选文件列表里**是灰的**，
//     页面零报错，最后归因成「小程序不支持我的表」。
//
// 为什么必须有这条守卫：既有三条守卫各管一摊 ——
//   `check_import_encoding` 管**后端解码**（GBK 会不会毁）、
//   `check_fn_deps` 管云端依赖声明、`check_pages` 管页面声明；
//   **没有一条在守「前端入口 ⊇ 后端能力」**。本仓 ROADMAP:1518 早就把
//   「云端 enum 新增而 picker 漏加 ⇒ 选不到，且门禁全绿、零报错」记成已知风险模式，
//   但一直没有判据 —— 本文件把它变成机器判红。
//
// 设计要点：
//   · A 段用**真样本 + xlsx 桩**证明后端 CSV 能力（零依赖，任何机器都能跑）；
//   · B 段把 picker 的 extension 抽成**纯函数判据**（extListOf / judgeExt），
//   · D 段拿变异体喂同一条判据，**自证判据有牙**（防止将来有人把判据改空后恒绿）。
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const TAKEAWAY = path.join(ROOT, 'subpkg/biz/takeaway/index.js');
const REVENUE = path.join(ROOT, 'subpkg/biz/revenue/index.js');
const SVC = path.join(ROOT, 'cloudfunctions/importSalesBill/service.js');
const MT_CSV = path.join(ROOT, 'review/evidence/r242_mt_goods/mt_goods_20260907_20260913.csv');

// 后端**实测可用**的格式面（依据：bufferToMatrix 走 XLSX.read，文本类先 decodeTextBuffer）
const BACKEND_FORMATS = ['xlsx', 'xls', 'csv'];
// 其中**必须有前端入口**的（xlsx 是基线；csv 是这次事故的主体）
const MUST_HAVE = ['xlsx', 'csv'];

let pass = 0;
let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}

// ===== xlsx 桩：与 check_import_encoding 同款语义（type:'string' 按 CSV 切分）=====
function splitCsv(text) {
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.length).map((l) => l.split(','));
}
const xlsxStub = {
  __cur: null,
  read(input, opts) {
    const type = (opts && opts.type) || 'buffer';
    const name = type === 'string' ? 'Sheet1' : '__BINARY__';
    const rows = type === 'string' ? splitCsv(input) : [['__BINARY_BRANCH__']];
    xlsxStub.__cur = rows;
    return { SheetNames: [name], Sheets: { [name]: {} } };
  },
  utils: {
    sheet_to_json() { return xlsxStub.__cur || []; },
  },
};
const _load = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'xlsx') return xlsxStub;
  return _load.call(this, req, parent, isMain);
};
let S;
try { S = require(SVC); } finally { Module._load = _load; }

// ===================== A 组：后端 CSv 能力基线（真样本） =====================
console.log('\n=== A 组 后端可解析格式基线（真样本，零依赖）===');

ok('A-① 真美团 GBK CSV 存在且可读', fs.existsSync(MT_CSV), MT_CSV.replace(ROOT, ''));
const csvBuf = fs.readFileSync(MT_CSV);
const mtx = S.bufferToMatrix(csvBuf);
const sheetNames = Object.keys((mtx && mtx.sheets) || {});
const rows0 = (mtx.sheets[sheetNames[0]] || {}).rows || [];
const head = (rows0[0] || []).join(',');
ok('A-② 后端 bufferToMatrix 能吃下 CSV 并解出中文表头',
  head.indexOf('日期') >= 0 && head.indexOf('商品名') >= 0, head.slice(0, 60));
ok('A-③ 表头不是乱码（不含替换符 U+FFFD）', head.indexOf('\uFFFD') < 0);
ok('A-④ 行数 > 1（真数据，不是只有表头）', rows0.length > 1, rows0.length + ' 行');

const srcSvc = fs.readFileSync(SVC, 'utf8');
ok('A-⑤ 后端仍保留 CSV 编码嗅探（decodeTextBuffer 在 bufferToMatrix 里、且在 XLSX.read 之前）',
  (() => {
    const iDec = srcSvc.indexOf('const dec = decodeTextBuffer(buffer)');
    const iRead = srcSvc.indexOf('XLSX.read(dec.text');
    return iDec > 0 && iRead > 0 && iDec < iRead;
  })());

// ===================== B 组：前端 picker ⊇ 后端能力 =====================
console.log('\n=== B 组 前端可选扩展名对等（判据是纯函数）===');

/** 从页面源码里抽 extension 数组（纯函数 · 可对变异体求值）*/
function extListOf(src) {
  const m = String(src).match(/chooseMessageFile\(\{[^}]*extension:\s*\[([^\]]*)\]/);
  if (!m) return null;
  return m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
/** 判据：必须含 MUST_HAVE，且不得出现后端解不了的格式 */
function judgeExt(list) {
  if (!Array.isArray(list) || !list.length) return { ok: false, why: '抽不到 extension 数组' };
  const miss = MUST_HAVE.filter((x) => list.indexOf(x) < 0);
  if (miss.length) return { ok: false, why: '缺少必须项：' + miss.join(',') };
  const extra = list.filter((x) => BACKEND_FORMATS.indexOf(x) < 0);
  if (extra.length) return { ok: false, why: '放行了后端解不了的格式：' + extra.join(',') };
  return { ok: true, why: list.join(' / ') };
}

const srcTake = fs.readFileSync(TAKEAWAY, 'utf8');
const extTake = extListOf(srcTake);
const jTake = judgeExt(extTake);
ok('B-① 销量导入 picker ⊇ {xlsx, csv}（G2 直接判据）', jTake.ok, jTake.why);

const hasXls = Array.isArray(extTake) && extTake.indexOf('xls') >= 0;
console.log((hasXls ? '✅' : '⚠️ ') + 'B-② 是否也放行 xls（后端 OLE 可解；未硬要求，只提示）'
  + ' ｜ ' + (hasXls ? '已放行' : '未放行 —— 老 .xls 仍需改后缀'));

const srcRev = fs.readFileSync(REVENUE, 'utf8');
const extRev = extListOf(srcRev);
ok('B-③ 营收导入 picker 同样不得窄于后端能力', !!extRev && judgeExt(extRev).ok,
  extRev ? judgeExt(extRev).why : '抽不到');

// ===================== C 组：两处 picker 不许「一处宽一处窄」而无人知 =====================
console.log('\n=== C 组 跨入口一致性 ===');
const onlyInTake = (extTake || []).filter((x) => (extRev || []).indexOf(x) < 0);
const onlyInRev = (extRev || []).filter((x) => (extTake || []).indexOf(x) < 0);
console.log('ℹ️  C-① 差异（仅销量页）: ' + (onlyInTake.join(',') || '无')
  + ' ｜ 差异（仅营收页）: ' + (onlyInRev.join(',') || '无'));
ok('C-② 两处 picker 都至少覆盖 csv|xlsx 基线',
  judgeExt(extTake).ok && judgeExt(extRev).ok);

// ===================== D 组：判据有牙（变异自证，不写盘） =====================
console.log('\n=== D 组 判据自证（喂变异体，必须转红）===');
const mutated = "const res = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx'] });";
const jMut = judgeExt(extListOf(mutated));
ok('D-① 变异回退成只有 xlsx ⇒ 判据必须红（否则本守卫是假绿）', jMut.ok === false, jMut.why);
const mutated2 = "wx.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx', 'csv', 'pdf'] });";
const jMut2 = judgeExt(extListOf(mutated2));
ok('D-② 变异塞入后端解不了的 pdf ⇒ 判据必须红', jMut2.ok === false, jMut2.why);
ok('D-③ 抽不到 extension（有人改写调用形式）⇒ 必须红且点名，不许静默通过',
  judgeExt(extListOf('wx.chooseMessageFile({count:1})')).ok === false);

console.log('\n===== 导入扩展名对等守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
