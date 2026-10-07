// tools/check_shape_machine_value.js —— R232j 形态机器值契约守卫
// 运行：node tools/check_shape_machine_value.js   （由 verify_all.js 的 [shape-machine-value] 套件调用）
//
// 为什么需要它
// 云函数 importSalesBill 返回的 `shape` 是**机器值**（'dish_sales' / 'combo_detail' / 'waimai_goods'），
// 不是字母序号。前端 pages/takeaway/index.js 曾写 `d.shape === 'C'` —— 与 'waimai_goods' 永不相等
// ⇒ isC 恒 false ⇒ 形态 C 表格被当成外卖账单渲染 ⇒ 平台/识别到/归月到**全空白**、没有平台 picker、
//   门禁因为 platform 空而必挂「门禁未通过，已阻断导入」⇒ 用户看到一张**永远导不进去**的卡。
// 这是 2026-10-07 真机实测发现的 P0（合计 1823.08 正确 ⇒ 解析层没问题，纯前端契约错位）。
//
// 判据纪律：判行为不判字面
// 不查源码里有没有 `'C'` 这个字符串（注释里就有，会被骗过），而是：
//   ① 从生产 service.js 真取 DISH_SHAPES 三值（require，不手抄常量）；
//   ② 从 pages/takeaway/index.js 真取它声明的 DISH_SHAPES（静态提取）；
//   ③ 断言两侧**逐字相等**（这就是契约本身）；
//   ④ 把前端那份喂给「云函数真返回值」，断言页面判得出形态 C（端到端行为）。
//
// 输出纪律：顶部横幅**不得**用 '===== … =====' 装饰（R66 的 SECTION_HEAD 会判它是
// 「段标题下零断言」⇒ 断言全绿也红）。段标题用 sec() 生成，保持既有样式。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVC_REL = 'cloudfunctions/importSalesBill/service.js';
const PAGE_REL = 'pages/takeaway/index.js';
const WXML_REL = 'pages/takeaway/index.wxml';

let pass = 0, failN = 0;
const sec = (t) => console.log('\n===== ' + t + ' =====');
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

// ---------- 加载生产 service.js（stub xlsx，与其它守卫同款手法）----------
let S = null;
{
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  try { S = require(path.join(ROOT, SVC_REL)); } catch (e) { S = null; }
  finally { Module._load = orig; }
}

// ---------- 从页面源码静态提取 DISH_SHAPES 对象字面量 ----------
// 只认 `const DISH_SHAPES = { ... };` 这一种形态，取其中的 A/B/C 三键。
function extractPageShapes(src) {
  const m = src.match(/const\s+DISH_SHAPES\s*=\s*\{([\s\S]*?)\};/);
  if (!m) return null;
  const body = m[1];
  const out = {};
  for (const k of ['A', 'B', 'C']) {
    const km = body.match(new RegExp('\\b' + k + '\\s*:\\s*\'([^\']+)\''));
    if (km) out[k] = km[1];
  }
  return Object.keys(out).length === 3 ? out : null;
}

const svcSrc = fs.readFileSync(path.join(ROOT, SVC_REL), 'utf8');
const pageSrc = fs.readFileSync(path.join(ROOT, PAGE_REL), 'utf8');
const wxmlSrc = fs.readFileSync(path.join(ROOT, WXML_REL), 'utf8');

// 云函数侧的 DISH_SHAPES 未导出 ⇒ 从源码静态取（形态与前端同一正则 ⇒ 可比）
const svcShapes = extractPageShapes(svcSrc);
const pageShapes = extractPageShapes(pageSrc);

sec('V-1 契约两侧都能取到（非退化：取不到即判红，不许「都为空所以相等」）');
check('V-1-① 云函数侧 DISH_SHAPES 可提取', !!svcShapes, JSON.stringify(svcShapes));
check('V-1-② 页面侧 DISH_SHAPES 可提取', !!pageShapes, JSON.stringify(pageShapes));
check('V-1-③ 页面侧已导出可被 wxml 使用的 shapeC 下发位',
  /shapeC\s*:\s*DISH_SHAPES\.C/.test(pageSrc));

sec('V-2 两侧逐字相等（这就是契约本身）');
check('V-2-① A 值一致', !!svcShapes && !!pageShapes && svcShapes.A === pageShapes.A,
  (svcShapes && svcShapes.A) + ' vs ' + (pageShapes && pageShapes.A));
check('V-2-② B 值一致', !!svcShapes && !!pageShapes && svcShapes.B === pageShapes.B,
  (svcShapes && svcShapes.B) + ' vs ' + (pageShapes && pageShapes.B));
check('V-2-③ C 值一致', !!svcShapes && !!pageShapes && svcShapes.C === pageShapes.C,
  (svcShapes && svcShapes.C) + ' vs ' + (pageShapes && pageShapes.C));
check('V-2-④ C 值是机器值不是字母序号',
  !!svcShapes && svcShapes.C !== 'C' && /^[a-z_]+$/.test(svcShapes.C),
  svcShapes && svcShapes.C);

sec('V-3 页面不得再用字母序号比对 shape（行为判据：真值必须判得出 C）');
// 行为判据：把「云函数真返回值」喂给页面声明的比较式，必须为真。
const cloudReturns = svcShapes ? svcShapes.C : '__none__';
const pageWouldMatch = pageShapes ? (cloudReturns === pageShapes.C) : false;
check('V-3-① 云函数返回 C ⇒ 页面判得出（行为）', pageWouldMatch,
  'cloud=' + cloudReturns + ' page=' + (pageShapes && pageShapes.C));
// 反例：若页面还用 'C'，同一断言必须为假（证明本判据真的能红）
const letterWouldMatch = (cloudReturns === 'C');
check('V-3-② 反例：字母序号 \'C\' 判不出（自失效护栏）', letterWouldMatch === false,
  '若此项为真，说明 V-3-① 恒真、判据失效');

sec('V-4 源码面无残留字母序号比对（去掉注释后再扫，避免被注释骗过）');
// 去注释：先删块注释、再删行注释；字符串里的 'C' 不在比对式形态，故按正则扫 `shape === 'C'`
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const pageCode = stripComments(pageSrc);
const strayCmp = pageCode.match(/shape\s*===\s*'C'/g) || [];
check('V-4-① 页面源码（去注释）无 `shape === \'C\'`', strayCmp.length === 0,
  '命中 ' + strayCmp.length + ' 处');
const wxmlStray = wxmlSrc.match(/importShape\s*===\s*'C'/g) || [];
check('V-4-② wxml 无 `importShape === \'C\'`', wxmlStray.length === 0,
  '命中 ' + wxmlStray.length + ' 处');
check('V-4-③ wxml 走 data 下发的 shapeC（不在模板里写字面量）',
  /importShape\s*===\s*shapeC/.test(wxmlSrc));

console.log('\n' + pass + ' 通过 / ' + failN + ' 失败');
process.exitCode = failN ? 1 : 0;
