// review/evidence/r241_next/probe_incoming.js
// R241 —— 「外部数据到达」预置复测脚本（第 2 步：拿真表头喂生产解析器）
//
// 用途：李老师发来京东 / 美团数据后，跑这条命令，直接得到：
//   ① 每个 sheet 被认成哪个平台（detectPlatform）
//   ② 商品销量表能否判出形态（detectDishShape / detectDishMatrix）
//   ③ 撞不撞 index.js 的平台白名单（sheetNameByPlatform）
//   ④ 白名单里没有的时刻报什么错（复现「京东进不来」）
//
// 纪律：
//   · require **生产解析器**（绝不手写等价公式 —— 那是第二个真相源）
//   · 先跑【正样本基线】证明脚本不是恒绿，再写真数据结论（R182 自失效护栏）
//   · 白名单键**从 index.js 源码抽取**，不手抄（源码变了脚本跟着变）
//
// 运行：
//   node probe_incoming.js                 # 读同目录 incoming_dump.json
//   node probe_incoming.js <dump.json>     # 指定 dump

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..', '..');
const SVC = path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'service.js');
const IDX = path.join(ROOT, 'cloudfunctions', 'importSalesBill', 'index.js');

// ---- service.js 顶部 require('xlsx')（云函数依赖，本地未装）⇒ 自建 stub，只供加载 ----
// 必须在本文件 require service.js **之前**完成。
// ⚠️ 不能用 module.paths.push：require('xlsx') 发生在 **service.js 的模块作用域**里，
//    用的是 service.js 自己的 paths ⇒ 只有给 Module._resolveFilename 打补丁才拦得住。
(function ensureXlsx() {
  try { require.resolve('xlsx'); return; } catch (e) { /* 需要 stub */ }
  const dir = path.join(os.tmpdir(), 'r241_stub');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'xlsx_stub.js');
  fs.writeFileSync(file,
    "// 仅供纯函数探针加载 service.js（本探针不调用 bufferToMatrix / xlsx 分支）\n" +
    "module.exports = { read: function () { throw new Error('stub xlsx：本探针不测 xlsx 分支'); } };\n");
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request) {
    if (request === 'xlsx') return file;
    return origResolve.apply(this, arguments);
  };
})();

const S = require(SVC);

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  ' + extra : '')); }
}
function line() { console.log('  ' + '-'.repeat(64)); }

// ---- 从 index.js 源码抽取平台白名单键（不手抄） ----
function readAllowList() {
  const src = fs.readFileSync(IDX, 'utf8');
  const m = src.match(/const\s+sheetNameByPlatform\s*=\s*\{([^}]*)\}/);
  if (!m) return { keys: [], sheetByPlatform: {}, raw: '(未匹配到常量，需人工核对 index.js)' };
  const body = m[1];
  const sheetByPlatform = {};
  body.split(',').forEach(function (kv) {
    const p = kv.split(':');
    if (p.length < 2) return;
    const k = p[0].trim().replace(/^['"]|['"]$/g, '');
    const v = p.slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
    if (k) sheetByPlatform[k] = v;
  });
  return { keys: Object.keys(sheetByPlatform), sheetByPlatform: sheetByPlatform, raw: m[0] };
}

const AL = readAllowList();
console.log('=== 0 生产源码现状（从 index.js 抽取，非手抄）===');
console.log('  白名单键          : ' + JSON.stringify(AL.keys));
console.log('  平台 → sheet 名   : ' + JSON.stringify(AL.sheetByPlatform));
console.log('  原文              : ' + AL.raw.replace(/\s+/g, ' '));
line();

// ---- 正样本基线：证明识别函数不是恒 null（自失效护栏）----
console.log('=== 1 正样本基线（证明本脚本能认出「该认出的」）===');
const FAKE_TAOBAO = [['账单日期', '订单编号', '订单类型', '结算金额', '退单'], ['2026-08-01', 'A1', '正常', '100.00', '']];
const FAKE_MEITUAN = [['账单日期', '订单编号', '交易类型', '商家应收款', '账单金额'], ['2026-08-01', 'B1', '正常', '90.00', '100.00']];
ok(S.detectPlatform(FAKE_TAOBAO[0]) === 'taobao', '假淘宝表头 → taobao', '实得 ' + S.detectPlatform(FAKE_TAOBAO[0]));
ok(S.detectPlatform(FAKE_MEITUAN[0]) === 'meituan', '假美团表头 → meituan', '实得 ' + S.detectPlatform(FAKE_MEITUAN[0]));
ok(AL.keys.length >= 2, '白名单至少含 2 个键（非退化）', '实得 ' + AL.keys.length);
line();

// ---- 真数据复测 ----
const dumpPath = process.argv[2] || path.join(HERE, 'incoming_dump.json');
if (!fs.existsSync(dumpPath)) {
  console.log('=== 2 真数据复测：跳过 ===');
  console.log('  未找到 ' + dumpPath);
  console.log('  用法：先 python probe_incoming.py <你的xlsx> 生成 dump，再跑本脚本。');
  process.exitCode = fail ? 1 : 0;
} else {
  const files = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  console.log('=== 2 真数据复测（' + files.length + ' 个文件）===');
  for (const f of files) {
    console.log('\n【文件】' + f.file);
    const fileMtx = { sheets: {} };
    for (const sh of f.sheets) fileMtx.sheets[sh.name] = { rows: sh.head || [] };
    let fdm = null;
    try { fdm = S.detectDishMatrix(fileMtx); } catch (e) { fdm = { shape: 'err:' + e.message, sheet: '' }; }
    console.log('  整簿形态判定 detectDishMatrix ⇒ ' + JSON.stringify(fdm));
    for (const sh of f.sheets) {
      const rows = sh.head || [];
      const mtx = { sheets: {} };
      mtx.sheets[sh.name] = { rows: rows };
      const hIdx = S.guessHeader(rows);
      const hdr = (rows[hIdx] || []).map(function (x) { return String(x).trim(); });
      const p = S.detectPlatform(hdr);
      const shape = S.detectDishShape(rows);
      const dm = fdm;

      console.log('  · sheet「' + sh.name + '」 行数=' + sh.rowCount);
      console.log('      猜的表头行 = R' + (hIdx + 1) + '：' + JSON.stringify(hdr).slice(0, 200));
      console.log('      detectPlatform  ⇒ ' + JSON.stringify(p));
      console.log('      detectDishShape ⇒ ' + JSON.stringify(shape));
      if (dm && dm.shape === shape && dm.sheet === sh.name) console.log('      （本 sheet 即 detectDishMatrix 选中的形态表）');

      // 复现 index.js:72 的判据：平台认不出 / 认出了但 sheet 名不在白名单 ⇒ 阻断
      const blocked = !p || !mtx.sheets[AL.sheetByPlatform[p]];
      if (blocked) {
        console.log('      ⛔ 按 index.js 现有判据：**会被阻断**');
        console.log('         报错文案：「无法识别账单平台（请确认是淘宝闪购、美团外卖账单，或堂食《菜品销售统计》）」');
        if (p) console.log('         （认成了 ' + p + '，但白名单要的 sheet 名是「' + AL.sheetByPlatform[p] + '」，与本表 sheet 名不符）');
      } else {
        console.log('      ✅ 按 index.js 现有判据：放行 → 会走 ' + p + ' 解析规则');
      }
    }
  }
  console.log('\n=== 3 结论判据 ===');
  console.log('  · 若上面出现 ⛔ ⇒ 该平台今天进不来，需按 NOTE_2026-10-08_round241 决策 1 处置');
  console.log('  · 若出现「认成了某平台但列名其实不是它的」⇒ 命中静默误判（决策 3）');
  process.exitCode = fail ? 1 : 0;
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
