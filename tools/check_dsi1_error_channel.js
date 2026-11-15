// DSI-1 行级错误可达性守卫（R747 / GAP-4）
//
// 守的是什么事故：DSI-1 解析器 dsi1.js 的错误文案带「第 N 行 + 具体问题」（人话，可照着改表），
//   但 handleDSI1Import 原来 `fail(INVALID_PARAM, parsed.error)` ⇒ utils/api.js:60/69
//   把 msg 整条覆盖成 msgOf(code) 通用「参数有误」，原始 msg 只落 console.warn
//   ⇒ 老板看不到行号，没法改表（注释承诺「原样透出」与实际相反，R298Y「读到了≠送出去了」同族）。
//
// 修法（局部，不动 api.js 全局）：解析失败走 ok({diagnosis:{reason:'dsi1_invalid',detail}})；
//   前端 diagnosis 分支加 dsi1_invalid 原样显示 detail。fail-closed 语义不变（不落库、不预览）。
//
// 判据分层（防假绿）：
//   A 云函数确实不再 fail（源码形态 + 行为）
//   B 前端确实消费 dsi1_invalid.detail（非只改后端）
//   C api.js 的全局覆盖设计没被动（防为了这一处把 82 个 fail 的 msg 全泄漏）
//   D 真跑 DSI-1 解析器确认错误文案带行号（detail 有内容可显示）
//   E 变异回灌：把任一改动回退必须被本守卫抓到
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const XLSX = require('C:/Users/lzj/.workbuddy/binaries/node/workspace/node_modules/xlsx');
const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'xlsx') return XLSX;
  if (req === 'wx-server-sdk') return {
    init() {}, DYNAMIC_CURRENT_ENV: 'x',
    database: () => ({ collection: () => ({}), command: {} }),
    getWXContext: () => ({}),
  };
  return origLoad.apply(this, arguments);
};
const DSI = require(path.join(ROOT, 'cloudfunctions/importSalesBill/dsi1.js'));
Module._load = origLoad;

const IDX = read('cloudfunctions/importSalesBill/index.js');
const PAGE = read('subpkg/biz/takeaway/index.js');
const API = read('utils/api.js');

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(s) { console.log('\n=== ' + s + ' ==='); }

sec('A 云函数：解析失败走 ok diagnosis，不再 fail');
ok('A-① handleDSI1Import 内 parseDSI1 失败分支已改走 ok',
  /if \(!parsed\.ok\)[\s\S]{0,400}return ok\(\{[\s\S]{0,160}dsi1_invalid/.test(IDX));
ok('A-② 不再有 `fail(INVALID_PARAM, parsed.error)`（旧承诺和实现相反的那句）',
  !/fail\(ERROR_CODES\.INVALID_PARAM,\s*parsed\.error\)/.test(IDX));
ok('A-③ diagnosis 带 detail（行级错误原文）+ reason 可判',
  /reason:\s*'dsi1_invalid'[\s\S]{0,80}detail:\s*parsed\.error/.test(IDX));
ok('A-④ fail-closed：该分支不落库不预览（diagnosis 通道语义）',
  /return ok\(\{[\s\S]{0,200}diagnosis[\s\S]{0,200}\}\);[\s\S]{0,60}\}/.test(IDX));

sec('B 前端：确实消费 dsi1_invalid.detail（前后端都改才算闭环）');
ok('B-① takeaway 页 diagnosis 块有 dsi1_invalid 分支',
  /dg\.reason === 'dsi1_invalid'/.test(PAGE));
ok('B-② 分支直接用 dg.detail（不重造第二份文案）',
  /dg\.reason === 'dsi1_invalid'[\s\S]{0,500}body = dg\.detail/.test(PAGE));
ok('B-③ 前端 diagnosis 块仍保留其他 reason（R286/R434 不回归）',
  /empty_table/.test(PAGE) && /mixed_goods_column/.test(PAGE) && /cols_ok_but_excluded/.test(PAGE));

sec('C api.js 全局覆盖设计未被破坏（82 个 fail 的 msg 不因此泄漏）');
ok('C-① api.js 仍以 msgOf(code) 为 UI 文案口径',
  /const msg = \(terms && terms\.msgOf\) \? terms\.msgOf\(r\.code\)/.test(API));
ok('C-② 后端原始 msg 仍只落 console.warn（不进 UI）',
  /console\.warn\('\[api\.call\] 后端原始 msg:'/.test(API));

sec('D 真跑 DSI-1 解析器：detail 有行号人话可显示');
{
  // 造一张「销量列填 abc」的 DSI-1 标准表（7 列：日期/渠道/平台/商品名/销量/销售额/[空]）
  const rows = [
    ['日期', '渠道', '平台', '商品名称', '销量', '销售额', '备注'],
    ['2026-09-10', '堂食', '', '小酥肉', 'abc', '90.00', ''],
  ];
  const parsed = DSI.parse(rows);
  ok('D-① 解析器判失败', parsed.ok === false);
  ok('D-② 错误文案带行号与具体值（老板能照着改）',
    typeof parsed.error === 'string' && /第\s*2\s*行/.test(parsed.error) && parsed.error.indexOf('abc') >= 0,
    parsed.error);
}

sec('E 变异回灌（证明 A/B 判据有牙）');
{
  const idxOld = "return fail(ERROR_CODES.INVALID_PARAM, parsed.error);";
  const idxNew = "return ok({ diagnosis: { reason: 'dsi1_invalid', detail: parsed.error } });";
  ok('E-① 把云函数改回旧 fail ⇒ A-①/A-② 必须转红',
    !/return ok\(\{[\s\S]{0,160}dsi1_invalid/.test(idxOld)
    && /fail\(ERROR_CODES\.INVALID_PARAM,\s*parsed\.error\)/.test(idxOld)
    && /dsi1_invalid/.test(idxNew));
  const pageOld = "body = (TK.importDiagBody || '').replace('{cols}', miss.join('、'));";
  ok('E-② 把前端分支摘掉 ⇒ B-② 必须转红',
    !/dg\.reason === 'dsi1_invalid'/.test(pageOld));
}

console.log('\n===== DSI-1 行级错误通道守卫：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
process.exit(fails.length === 0 ? 0 : 1);
