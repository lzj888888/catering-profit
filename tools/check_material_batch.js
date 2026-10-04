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
const FOUR = ['pages/material/batch.js', 'pages/material/batch.json', 'pages/material/batch.wxml', 'pages/material/batch.wxss'];
const missing = FOUR.filter((f) => !fs.existsSync(path.join(ROOT, f)));
check('B-① 批量页四件套齐全', missing.length === 0, missing.length ? '缺：' + missing.join(' | ') : FOUR.length + ' 个齐全');

let appPages = [];
try { appPages = JSON.parse(read('app.json')).pages || []; } catch (e) { appPages = []; }
check('B-② 批量页已在 app.json::pages 注册', appPages.indexOf('pages/material/batch') >= 0,
  'app.json 共 ' + appPages.length + ' 页');

const idxWxml = read('pages/material/index.wxml') || '';
const idxJs = read('pages/material/index.js') || '';
check('B-③ 原料库列表页有批量入口（wxml 按钮 + js 跳转，两处都在）',
  /bindtap="goBatch"/.test(idxWxml) && /goBatch\s*\(/.test(idxJs) && /\/pages\/material\/batch/.test(idxJs),
  'wxml=' + /bindtap="goBatch"/.test(idxWxml) + ' js=' + /goBatch\s*\(/.test(idxJs));

const bJs = read('pages/material/batch.js') || '';
check('B-④ 保存复用既有 saveMaterial（不新增云函数，避免牵动四处同步面）',
  /api\.call\(\s*'saveMaterial'/.test(bJs), '命中 saveMaterial 调用');

check('B-⑤ 幂等键每条唯一（同一批第 k 条不同键，重放不互相顶掉）',
  /client_request_id:\s*'matb_'\s*\+\s*stamp/.test(bJs) || /'matb_'\s*\+\s*stamp/.test(bJs),
  '命中 matb_ + stamp 形态');

check('B-⑥ 解析有问题的行默认不勾选（fail-closed：脏数据不许混进导入）',
  /checked:\s*x\.ok/.test(bJs), '命中 checked: x.ok');

check('B-⑦ 页面调纯函数解析，不在页面里内联重写一套解析',
  /batch\.parsePaste\(/.test(bJs), '命中 parsePaste 调用');

const bWxml = read('pages/material/batch.wxml') || '';
const callInWxml = /\{\{[^}]*[A-Za-z_$][\w$]*\s*\(/.test(bWxml);
check('B-⑧ WXML 插值内不调方法（微信不支持，且恒 false 不报错）', !callInWxml,
  callInWxml ? '发现插值内函数调用' : '零命中');

// —— C 组：自失效护栏 ——
let matFiles = 0;
try { matFiles = fs.readdirSync(path.join(ROOT, 'pages', 'material')).length; } catch (e) { matFiles = 0; }
check('C-① 扫描面非退化（pages/material 下文件数 ≥ 8）', matFiles >= 8, matFiles + ' 个');

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

console.log('\n===== round204 · 原料批量录入守卫：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
