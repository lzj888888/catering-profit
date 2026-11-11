// tools/check_material_batch.js —— 【round204】原料批量录入守卫（粘贴解析的正确性 + 页面接线）
// 运行：node tools/check_material_batch.js        （EXIT 0 = 全绿）
//
// 为什么需要它（与本仓既有「纯函数下沉」定式同族：R150 specDerive / R151 units / M3.17 takeawayDerive）：
//   原料批量录入的**全部正确性都在解析器里** —— 分隔符（Tab/逗号/分号/空格）、表头、列序、
//   元转分、单位池校验、计数族换算不许瞎猜。这些写进页面就只能靠真机点，一次只能测一种粘贴形态。
//   ⇒ 解析下沉成 `utils/materialBatch.js` 纯函数（无 wx 依赖），本守卫直接 require **实跑**判行为。
//
// 判据分组：
//   A 解析行为（9 条）：六列还原 / 表头跳过 / 两列速记 / 元转分 / 计数族必填 / 非法单位不叠噪音 /
//                        出成率越界 / 名称含空格不拆 / 空行不计
//   B 页面接线（8 条）：四件套 / app.json 注册 / 列表页入口 / 走 saveMaterial / 幂等键每条唯一 /
//                        脏行默认不选 / 调纯函数不内联 / WXML 不调方法
//   C 自失效护栏（4 条）：扫描面非退化 / 纯函数可 require / 空输入零行（防恒绿）/
//                        🔴 反恒真：计数族必须没有建议值（若哪天被加了建议值 ⇒ A-④ 判据基础消失 ⇒ 转红）
//   D 正负样本（2 条）：正样本「斤」带出 500 / 负样本单价非数字必红
//
// ⚠️ 本守卫**不算成本**（那是引擎的事），只守「老板手抄的一行 → saveMaterial 入参」这一段。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const batch = require(path.join(ROOT, 'utils', 'materialBatch.js'));
const units = require(path.join(ROOT, 'utils', 'units.js'));

let pass = 0;
let failN = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN += 1; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
function read(rel) {
  const p = path.join(ROOT, rel);
  try { return fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); } catch (e) { return null; }
}

console.log('===== round204 · 原料批量录入守卫 =====');

// —— A 组：解析行为（require 生产纯函数实跑）——
const r1 = batch.parsePaste('炸鸡腿\t箱装24\t件\t195\t24000\t95', '斤');
const a1 = r1.rows[0];
check('A-① Excel 六列（Tab 分隔）逐字段还原',
  r1.rows.length === 1 && a1.ok && a1.row.name === '炸鸡腿' && a1.row.brand_spec === '箱装24'
  && a1.row.purchase_unit === '件' && a1.row.purchase_price_fen === 19500
  && a1.row.convert_factor === 24000 && a1.row.yield_rate === 95,
  a1 ? JSON.stringify(a1.row) : '零行');

const r2 = batch.parsePaste('名称,采购单价\n炸鸡腿,18.5\n牛腩,42', '斤');
check('A-② 首行表头自动跳过且不丢数据行',
  r2.headerSkipped === true && r2.rows.length === 2 && r2.rows.every((x) => x.ok),
  'headerSkipped=' + r2.headerSkipped + ' 行数=' + r2.rows.length);

check('A-③ 两列速记（名称·单价）第 2 列当单价、单位取默认',
  r2.rows[0] && r2.rows[0].row.purchase_price_fen === 1850 && r2.rows[0].row.purchase_unit === '斤',
  r2.rows[0] ? r2.rows[0].row.purchase_unit + ' / ' + r2.rows[0].row.purchase_price_fen + ' 分' : '零行');

const r4 = batch.parsePaste('纸巾,箱装,箱,120', '斤');
check('A-④ 计数族缺换算系数判错（箱/件没有通用换算，绝不替老板猜）',
  r4.rows[0] && r4.rows[0].ok === false
  && r4.rows[0].errors.some((e) => e.indexOf('换算系数必填') >= 0)
  && r4.rows[0].row.convert_factor === 0,
  r4.rows[0] ? JSON.stringify(r4.rows[0].errors) : '零行');

const r5 = batch.parsePaste('酱油,瓶装,坛,12', '斤');
check('A-⑤ 非法单位判错且不叠「换算系数必填」噪音（根因只有单位）',
  r5.rows[0] && r5.rows[0].ok === false && r5.rows[0].errors.length === 1
  && r5.rows[0].errors[0].indexOf('单位不在可选池') >= 0,
  r5.rows[0] ? JSON.stringify(r5.rows[0].errors) : '零行');

const r6 = batch.parsePaste('土豆,,斤,3,500,120', '斤');
check('A-⑥ 出成率越界判错',
  r6.rows[0] && r6.rows[0].ok === false && r6.rows[0].errors.some((e) => e.indexOf('出成率') >= 0),
  r6.rows[0] ? JSON.stringify(r6.rows[0].errors) : '零行');

check('A-⑦ 元 → 分整数（18.5 元 ⇒ 1850 分，不留浮点）',
  r2.rows[0] && r2.rows[0].row.purchase_price_fen === 1850
  && r2.rows[1] && r2.rows[1].row.purchase_price_fen === 4200,
  '18.5→' + (r2.rows[0] ? r2.rows[0].row.purchase_price_fen : '?') + ' / 42→' + (r2.rows[1] ? r2.rows[1].row.purchase_price_fen : '?'));

// ⚠️ 样本必须用**双空格**分隔才真正覆盖空格分支：逗号样本走的是逗号分支，
//   改坏空格规则它也照样绿（R204 变异 M5 当场实证 —— 这就是「样本没打到判据」的假绿）。
const r8 = batch.parsePaste('耙 牛肉  箱装  斤  42  500  100', '斤');
check('A-⑧ 名称内含空格时保留完整（双空格才作列分隔，单空格不拆列）',
  r8.rows[0] && r8.rows[0].row.name === '耙 牛肉' && r8.rows[0].row.brand_spec === '箱装',
  r8.rows[0] ? r8.rows[0].row.name + ' | ' + r8.rows[0].row.brand_spec : '零行');

const r9 = batch.parsePaste('炸鸡腿,18.5\n\n\n牛腩,42', '斤');
check('A-⑨ 空行不计入行集合', r9.rows.length === 2 && r9.blankLines === 2,
  '行数=' + r9.rows.length + ' 空行=' + r9.blankLines);

// —— B 组：页面接线 ——
const FOUR = ['subpkg/biz/material/batch.js', 'subpkg/biz/material/batch.json', 'subpkg/biz/material/batch.wxml', 'subpkg/biz/material/batch.wxss'];
const missing = FOUR.filter((f) => !fs.existsSync(path.join(ROOT, f)));
check('B-① 批量页四件套齐全', missing.length === 0, missing.length ? '缺：' + missing.join(' | ') : FOUR.length + ' 个齐全');

let appPages = [];
try {
  // R423 分包化：页面全集 = 主包 + 分包展开（旧写法只取 pages ⇒ 分包页被判未注册）
  const _a = JSON.parse(read('app.json'));
  const _sub = [].concat.apply([], ((_a.subpackages || _a.subPackages) || []).map(function (sp) {
    var r = String(sp.root || '').replace(/\/+$/, '');
    return (sp.pages || []).map(function (x) { return r ? r + '/' + x : x; });
  }));
  appPages = (Array.isArray(_a.pages) ? _a.pages : []).concat(_sub);
} catch (e) { appPages = []; }
check('B-② 批量页已在 app.json::pages 注册', appPages.indexOf('subpkg/biz/material/batch') >= 0,
  'app.json 共 ' + appPages.length + ' 页');

const idxWxml = read('subpkg/biz/material/index.wxml') || '';
const idxJs = read('subpkg/biz/material/index.js') || '';
check('B-③ 原料库列表页有批量入口（wxml 按钮 + js 跳转，两处都在）',
  // R423 分包化：跳转目标改为 /subpkg/biz/material/batch（兼容主包旧形式）
  /bindtap="goBatch"/.test(idxWxml) && /goBatch\s*\(/.test(idxJs) && /\/(?:pages\/material|subpkg\/biz\/material)\/batch/.test(idxJs),
  'wxml=' + /bindtap="goBatch"/.test(idxWxml) + ' js=' + /goBatch\s*\(/.test(idxJs));

const bJs = read('subpkg/biz/material/batch.js') || '';
check('B-④ 保存复用既有 saveMaterial（不新增云函数，避免牵动四处同步面）',
  /api\.call\(\s*'saveMaterial'/.test(bJs), '命中 saveMaterial 调用');

check('B-⑤ 幂等键每条唯一（同一批第 k 条不同键，重放不互相顶掉）',
  /client_request_id:\s*'matb_'\s*\+\s*stamp/.test(bJs) || /'matb_'\s*\+\s*stamp/.test(bJs),
  '命中 matb_ + stamp 形态');

check('B-⑥ 解析有问题的行默认不勾选（fail-closed：脏数据不许混进导入）',
  /checked:\s*x\.ok/.test(bJs), '命中 checked: x.ok');

check('B-⑦ 页面调纯函数解析，不在页面里内联重写一套解析',
  /batch\.parsePaste\(/.test(bJs), '命中 parsePaste 调用');

const bWxml = read('subpkg/biz/material/batch.wxml') || '';
const callInWxml = /\{\{[^}]*[A-Za-z_$][\w$]*\s*\(/.test(bWxml);
check('B-⑧ WXML 插值内不调方法（微信不支持，且恒 false 不报错）', !callInWxml,
  callInWxml ? '发现插值内函数调用' : '零命中');

// —— C 组：自失效护栏 ——
let matFiles = 0;
try { matFiles = fs.readdirSync(path.join(ROOT, 'subpkg', 'biz', 'material')).length; } catch (e) { matFiles = 0; }
check('C-① 扫描面非退化（subpkg/biz/material 下文件数 ≥ 8）', matFiles >= 8, matFiles + ' 个');

check('C-② 解析纯函数可 require 且导出 parsePaste',
  typeof batch.parsePaste === 'function' && typeof batch.buildRow === 'function',
  'parsePaste + buildRow 就位');

const empty = batch.parsePaste('', '斤');
check('C-③ 空输入零行（防「扫描面空 ⇒ 恒绿」）', empty.rows.length === 0 && empty.headerSkipped === false,
  '行数=' + empty.rows.length);

const packUnits = ['箱', '桶', '件'];
const badPack = packUnits.filter((u) => units.suggestConvert(u) != null);
check('C-④ 反恒真：计数族单位仍然没有通用换算建议值（一旦有了 ⇒ A-④ 判据基础消失，必须改判据）',
  badPack.length === 0, badPack.length ? '被加了建议值：' + badPack.join(',') : '箱/桶/件 仍为 null');

// —— D 组：正负样本互证 ——
const d1 = batch.parsePaste('土豆,,斤,3', '斤');
check('D-① 正样本：「斤」自动带出建议换算 500 且可直接导入',
  d1.rows[0] && d1.rows[0].ok === true && d1.rows[0].row.convert_factor === 500,
  d1.rows[0] ? '换算=' + d1.rows[0].row.convert_factor : '零行');

const d2 = batch.parsePaste('土豆,,斤,三元', '斤');
check('D-② 负样本：单价不是数字必红（不静默当 0）',
  d2.rows[0] && d2.rows[0].ok === false && d2.rows[0].errors.some((e) => e.indexOf('单价') >= 0),
  d2.rows[0] ? JSON.stringify(d2.rows[0].errors) : '零行');

const r9a = batch.parsePaste('土豆,,斤,3\n,,,,,\n牛腩,42', '斤');
check('A-⑩ 全是分隔符的逗号空行按空行跳过（不产出「缺名称」假错行）',
  r9a.rows.length === 2 && r9a.rows.every((x) => x.ok) && r9a.blankLines === 1,
  '行数=' + r9a.rows.length + ' 空行=' + r9a.blankLines);

// ⚠️ 样本必须是**真正会走到 R211 那句排查**的形态 —— 本轮两次踩同一类坑：
//   ① 纯 Tab 空行：被 `splitRow` 开头的 `!s.trim()` 挡掉了（`trim()` 连 \t 一起吃）；
//   ② 「空格+Tab」空行：同样理由被挡掉。两者删掉 R211 那句都照样绿（**假绿**）。
//   ⇒ 真正漏网的是**带可见分隔符**的空行（`,,,,,` / `;;;;;`）——分隔符不是空白，trim 吃不掉。
//     「表格软件另存为 CSV」选分号分隔是常见选项，故 A-⑪ 取分号形态作为第二条独立通路。
const r9b = batch.parsePaste('土豆;箱装;斤;3\n;;;;;\n牛腩;;斤;42', '斤');
check('A-⑪ 分号空行同样跳过（有些 CSV 用分号分隔，不是只有逗号）',
  r9b.rows.length === 2 && r9b.rows.every((x) => x.ok) && r9b.blankLines === 1,
  '行数=' + r9b.rows.length + ' 空行=' + r9b.blankLines);

const r9c = batch.parsePaste('土豆,,斤,3\n' + ' , , , , , \n'.repeat(40) + '牛腩,42', '斤');
check('A-⑫ 模板级压力：40 行「含空格的空行」夹在中间，只留 2 条真数据且都合格（不许真数据被红海淹没）',
  r9c.rows.length === 2 && r9c.rows.every((x) => x.ok) && r9c.blankLines === 40,
  '行数=' + r9c.rows.length + ' 空行=' + r9c.blankLines);


// ===================== C2 · 菜品卡「粘贴配料表」解析（R443）=====================
// 与上面原料档案的批量录入同族，但**落点不同**：那边产出 saveMaterial 入参，这边产出**卡内配料行候选**。
// 三条红线的判据都在这：不自动建原料 / 单位必须过单位池 / 数量读不成不静默当 0。
const cp = require('../utils/cardPaste.js');
const MATS = [{ id: 'm1', name: '鸡腿肉' }, { id: 'm2', name: '土豆' }];

const c1 = cp.parseCardPaste('鸡腿肉\t200\t克\n土豆\t100\t克', MATS);
check('C2-① Tab 三列还原：名称/数量/单位 ⇒ 2 行全 ok，净重 200 / 100 克',
  c1.rows.length === 2 && c1.okCount === 2 && c1.rows[0].qtyBase === 200 && c1.rows[1].qtyBase === 100,
  JSON.stringify(c1.rows.map((r) => [r.name, r.qtyBase, r.status])));

const c2 = cp.parseCardPaste('鸡腿肉 200g', MATS);
check('C2-② 单空格速记「鸡腿肉 200g」能拆（g 视作克），不是把整行当成名称',
  c2.rows.length === 1 && c2.rows[0].status === 'ok' && c2.rows[0].unit === '克' && c2.rows[0].qtyBase === 200,
  JSON.stringify(c2.rows[0]));

const c3 = cp.parseCardPaste('土豆\t100', MATS);
check('C2-③ 没写单位 ⇒ 按克（基准单位 = 定义，不是猜测）',
  c3.rows[0].status === 'ok' && c3.rows[0].unit === '克' && c3.rows[0].qtyBase === 100,
  JSON.stringify(c3.rows[0]));

const c4 = cp.parseCardPaste('土豆\t0.2kg', MATS);
check('C2-④ kg 别名必须换成「千克」⇒ 0.2kg = 200 克（原样喂 factorOf 当 1 倍 ⇒ 1000 倍错账）',
  c4.rows[0].status === 'ok' && c4.rows[0].qtyBase === 200,
  'qtyBase=' + c4.rows[0].qtyBase);

const c5 = cp.parseCardPaste('牛排\t200\t克', MATS);
check('C2-⑤ 名称对不上原料档案 ⇒ no_match（绝不自动建原料）',
  c5.rows[0].status === 'no_match' && c5.rows[0].material === null && c5.okCount === 0,
  JSON.stringify(c5.rows[0]));

const c6 = cp.parseCardPaste('土豆\t2\t把', MATS);
check('C2-⑥ 单位不在单位池 ⇒ bad_unit（「把」不在 QTY_UNITS，不许 fail-soft 当 1 倍）',
  c6.rows[0].status === 'bad_unit',
  JSON.stringify(c6.rows[0]));

const c7 = cp.parseCardPaste('土豆\t两斤\t克', MATS);
check('C2-⑦ 数量读不成 ⇒ bad_qty（不静默当 0）',
  c7.rows[0].status === 'bad_qty',
  JSON.stringify(c7.rows[0]) + ' / ' + c7.rows[0].status);

const c8 = cp.parseCardPaste('   \n# 注释行\n土豆\t100\t克', MATS);
check('C2-⑧ 空行与 # 注释不产出行（防噪音行 + 防"扫空恒绿"）',
  c8.rows.length === 1 && c8.okCount === 1,
  'rows=' + c8.rows.length);


// ===================== E · R705：粘错表 / 全坏 / 按钮看不清 =====================
// 事故（李老师 2026-11-11 真机）：把**菜品销售表**粘进原料批量录入 ⇒ 12 条全报
//   「单位不在可选池：68」（售价被当成采购单位），一条都导不进；
//   底部「导入选中的原料」按钮既 disabled 又被 `.top-add` 的 200rpx 定宽挤成 104px ⇒
//   字看不清。他以为「全选/全不选/按钮」都点不动，只能退出去重进。
// 这里钉死三层：① 三列「名|规格|价」要认得对 ② 销售表要整表拦而不是硬解析
//   ③ 样式层不许再退回「定宽 + 无效 disabled 类」。

// --- E-① 三列 名|分类|价：价格要落到 priceYuan，不能落到 purchase_unit ---
const e1 = batch.parsePaste('耙牛肉\t卤味烧腊\t68\n耙肥肠\t卤味烧腊\t58', '斤');
check('E-① 三列「名称|分类|单价」⇒ 两条全 ok，第 3 列是**价**不是单位',
  e1.rows.length === 2 && e1.rows.every((r) => r.ok)
  && e1.rows[0].row.name === '耙牛肉' && e1.rows[0].row.purchase_price_fen === 6800,
  JSON.stringify(e1.rows.map((r) => [r.row.name, r.row.brand_spec, r.row.purchase_price_fen, r.ok])));

// --- E-② 同一形态：单位回落到默认单位，绝不变成 '68' ---
check('E-② 三列形态下 purchase_unit 回落到默认单位（不是 68）',
  e1.rows[0].row.purchase_unit === '斤' && e1.rows[1].row.purchase_unit === '斤',
  'unit=' + JSON.stringify(e1.rows.map((r) => r.row.purchase_unit)));

// --- E-③ 五列菜品表（真表头 + 真实数据）⇒ 整表拦，不产红行 ---
const e3 = batch.parsePaste(
  '菜品名称\t菜品分类\t销售数量\t销售额(元)\t售价\n耙牛肉\t卤味烧腊\t12\t816\t68', '斤');
check('E-③ 菜品销售表 ⇒ blocked=sales_table 且 rows 为空（不刷 12 条红行）',
  e3.blocked === 'sales_table' && e3.rows.length === 0,
  'blocked=' + e3.blocked + ' rows=' + e3.rows.length);

// --- E-④ 四列 名|分类|销量|售价 同样要拦 ---
const e4 = batch.parsePaste('耙牛肉\t卤味烧腊\t12\t68', '斤');
check('E-④ 四列「名称|分类|销量|售价」⇒ 同样整表拦',
  e4.blocked === 'sales_table' && e4.rows.length === 0,
  'blocked=' + e4.blocked);

// --- E-⑤ 回归：标准六列**不许**被拦（拦错就等于把正常功能做没了）---
const e5 = batch.parsePaste('炸鸡腿\t箱装24\t件\t195\t24000\t95', '斤');
check('E-⑤ 反误伤：标准六列（第 3 列是合法单位「件」）不被拦，且价格/换算/出成率都在',
  e5.blocked == null && e5.rows.length === 1 && e5.rows[0].ok
  && e5.rows[0].row.purchase_unit === '件' && e5.rows[0].row.purchase_price_fen === 19500
  && e5.rows[0].row.convert_factor === 24000 && e5.rows[0].row.yield_rate === 95,
  'blocked=' + e5.blocked + ' ' + JSON.stringify(e5.rows[0] && e5.rows[0].row));

// --- E-⑥ 回归：三列「名|规格|单位」第 3 列是单位词 ⇒ 不许被当成价 ---
const e6 = batch.parsePaste('炸鸡腿\t箱装24\t件', '斤');
check('E-⑥ 反误伤：三列里第 3 列是「件」⇒ 仍走位置语义（不当价），且要求填换算',
  e6.blocked == null && e6.rows[0].row.purchase_unit === '件'
  && e6.rows[0].row.purchase_price_fen === 0
  && e6.rows[0].errors.join('').indexOf('换算系数必填') >= 0,
  JSON.stringify(e6.rows[0] && e6.rows[0].errors));

// --- E-⑥b 带「元」的价格**不许猜**：三列形态要求第 3 列是纯数字 ---
//   红线 R138/R317：不许编价。`68元` 既不是纯数字、也不是单位词 ⇒ 必须落到
//   「单位不在可选池」，让老板自己改成 68，而不是我们剥掉「元」字替他猜。
//   （这条也把「第 3 列必须是数字」这个条件钉死 —— 变异 M6 删掉它会立刻红。）
const e6b = batch.parsePaste('耙牛肉\t卤味烧腊\t68元', '斤');
check('E-⑥b 三列里第 3 列是「68元」⇒ 报单位不合法（不剥「元」字猜价）',
  e6b.blocked == null && e6b.rows.length === 1 && e6b.rows[0].ok === false
  && e6b.rows[0].row.purchase_price_fen === 0
  && e6b.rows[0].errors.join('').indexOf('单位不在可选池') >= 0,
  JSON.stringify(e6b.rows[0] && e6b.rows[0].errors));

// --- E-⑦ 反恒真：判据必须有分辨力（两种样本给出相反答案）---
check('E-⑦ 反恒真：looksLikeSalesTable 对销售表 true、对原料表 false（不是恒真/恒假）',
  batch.looksLikeSalesTable(['耙牛肉', '卤味烧腊', '12', '68']) === true
  && batch.looksLikeSalesTable(['土豆', '箱装', '斤', '3']) === false
  && batch.looksLikeSalesTable(['耙牛肉', '68']) === false,
  'sales=' + batch.looksLikeSalesTable(['耙牛肉', '卤味烧腊', '12', '68'])
  + ' normal=' + batch.looksLikeSalesTable(['土豆', '箱装', '斤', '3']));

// --- E-⑧ 接线层：页面真的走 blocked 分支（函数存在 ≠ 页面调用）---
const eWxml = read('subpkg/biz/material/batch.wxml') || '';
const eJs = read('subpkg/biz/material/batch.js') || '';
check('E-⑧ 接线：batch.js 判 r.blocked 并把 blocked/blockSample 送进 setData',
  /r\.blocked\s*===\s*'sales_table'/.test(eJs) && /blocked:\s*true/.test(eJs)
  && /blockSample:/.test(eJs));
check('E-⑧b 渲染：wxml 有拦截块（guard-block）且在 rows 空态之前',
  // 精确匹配完整 class 串：子串匹配会把 `guard-block-hidden` 也算命中（变异 M11 的教训）
  eWxml.indexOf('class="guard guard-block"') >= 0
  && eWxml.indexOf('class="guard guard-block"') < eWxml.indexOf("{{!blocked && rows.length === 0}}"));

// --- E-⑨ 「全坏」不许留一排点不动的按钮 ---
// ⚠️ 变异 M9 教训：只查 `allBadTitle:` 这个**键名**存在 ⇒ 把它赋成常量 false 照样绿。
//   必须查到**判据表达式本身**（okCount === 0 且确实取了 badCount）。
check('E-⑨ 全坏：allBadTitle 由 okCount === 0 判定 + 「回顶部改」按钮（onBackTop 真实现）',
  /allBadTitle:\s*rows\.length\s*>\s*0\s*&&\s*okCount\s*===\s*0/.test(eJs)
  && /matBatchAllBadTitle\(badCount\)/.test(eJs)
  && /onBackTop\(/.test(eJs) && /wx\.pageScrollTo/.test(eJs)
  && eWxml.indexOf('guard-bad') >= 0 && /bindtap="onBackTop"/.test(eWxml));
check('E-⑨b 全坏时「全选/全不选」「导入」都以 okCount > 0 为前提（否则就是死按钮）',
  (eWxml.match(/wx:if="\{\{okCount > 0\}\}"/g) || []).length >= 2,
  '命中 ' + (eWxml.match(/wx:if="\{\{okCount > 0\}\}"/g) || []).length + ' 处');

// --- E-⑩ 按钮宽度：不许再用列表页的 200rpx 定宽类（7 个字挤成 104px 是看不清的首因）---
check('E-⑩ batch.wxml 不再使用 .top-add（flex:0 0 200rpx 定宽），改用 full-btn',
  eWxml.indexOf('top-add') < 0 && /full-btn/.test(eWxml)
  && /\n\.full-btn\s*\{[^}]*flex:\s*1/.test(read('subpkg/biz/material/batch.wxss') || ''),
  'top-add=' + eWxml.indexOf('top-add'));

// --- E-⑪ disabled 字看不清：全局必须有 `[disabled]` 真样式（类选择器从来没生效过）---
//   判据**函数化**，好让 E-⑫ 用同一把尺子量影子样本（否则反恒真只是"写死 true"）。
const eApp = read('app.wxss') || '';
// 🔴 必须**逐属性**验 background 与 color 各自都带 !important ——
//   变异回灌 M4 教训：只写 `/!important/.test(rule)` 时，删掉 background 那条
//   仍能靠 color 的 !important 混过（判据过松 ⇒ 改坏也绿）。而这两条正对应
//   「深蓝渐变底压过灰底」和「30% 黑字」两个独立成因，缺一条字就看不清。
const disGuarded = (css) => {
  const rule = (css.match(/\.btn\[disabled\][^{]*\{[^}]*\}/) || [''])[0];
  if (!/\.btn\[disabled\]/.test(css)) return false;
  // ⚠️ 必须带左边界：`color:` 会命中 `border-color:` 的子串 —— 变异 M4b 就是这么漏的
  const imp = (prop) => new RegExp('(^|[;{\\s])' + prop + '\\s*:[^;]*!\\s*important').test(rule);
  return imp('background') && imp('color');
};
check('E-⑪ app.wxss 有 `.btn[disabled]` 规则（属性选择器，且带 !important 压过内置样式）',
  disGuarded(eApp) === true,
  '规则长度=' + ((eApp.match(/\.btn\[disabled\][^{]*\{[^}]*\}/) || [''])[0].length));

// --- E-⑫ 反恒真：同一判据对「旧写法」必须给 false（证明 E-⑪ 不是写什么都能过）---
const eShadow = '.btn.disabled { background: #ccc; color: #fff; box-shadow: none; }';
check('E-⑫ 反恒真：影子样本 `.btn.disabled{…}`（全仓零引用的旧写法）判红，真 app.wxss 判绿',
  disGuarded(eShadow) === false && disGuarded(eApp) === true,
  'shadow=' + disGuarded(eShadow) + ' real=' + disGuarded(eApp));

console.log('\n===== 原料批量录入守卫：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
