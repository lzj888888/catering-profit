#!/usr/bin/env node
// tools/check_dish_category_free.js —— R148 · 菜品分类「自由定义」守卫（round148 新增）
//
// ============ 为什么要有这条（2026-09-26 李老师真机/业务反馈 · 真实触发）============
// 李老师原话：菜品分类按热菜/凉菜分，但实际火锅要分荤菜/素菜，还有"大口吃肉"这类营销栏目名。
// 查证结果（不是假想）：
//   · `开发规范v1.0_ModuleM3_菜品成本卡.md` §菜品分类 明写「热菜/凉菜/锅底/小吃/饮品，**支持自定义**」；
//   · 但 `pages/card/edit.wxml` 实现是 `<picker mode="selector" range="{{categoryOptions}}">`
//     —— **只能从 7 个预设里选，根本没有输入口**。规范与实现不符，是真缺口。
//   · 根子上的原因：分类横跨 4 个**正交**维度（出品形态 热菜/凉菜 · 食材属性 荤菜/素菜 ·
//     业态专属 锅底/蘸料/涮品 · 营销栏目 大口吃肉/招牌推荐），同一道菜可同时落在多个维度上
//     ⇒ **加选项永远补不完**，只能自由定义。
//
// ============ 三条判据 ============
// 【L1 · 分类必须能输入】`pages/card/edit.wxml` 里 category 必须是可输入控件：
//     存在 value="{{category}}" 的 <input>；且**不得**存在把 category 锁死的 picker（picker 只能选）。
//     ⚠️ 为什么扫"picker + category"：只查「有没有 input」不够——若将来又加回 picker 做主控件，
//        input 仍在，扫描会假绿。必须**同时**禁止 picker 绑定 category。
// 【L2 · 建议池只许追加】`TERMS.card.dishCats` 必须**包含**基线 7 项（热菜/凉菜/主食/汤羹/饮品/小吃/其他）。
//     旧卡的自由输入值靠这个池子回显 ⇒ 删一项 ⇒ 老数据回显丢失（R129 同族：可见名当机器键的翻版）。
// 【L3 · 保存必须 trim】`pages/card/edit.js` 的 doSave 里 category 必须过 `.trim()`：
//     否则"热菜 "与"热菜"会变成两个分类，筛选时自己人都找不到自己。
//     ⚠️ 只要求 trim，**不**要求折叠中间空格/同义词归并——老板填"大口吃肉"是有意的。
// 【L4 · 原料分类不许跟着自由化】`shop_material.category` 保持**枚举**（采购/仓储视角，R140 把守），
//     与菜品分类（菜单视角，自由）是两套语义。判据：原料编辑页仍为 picker 且枚举键完整。
//
// 运行：node tools/check_dish_category_free.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 基线：dishCats 的**初始值**，只许追加不许删（L2）
const BASE_CATS = ['热菜', '凉菜', '主食', '汤羹', '饮品', '小吃', '其他'];
// 原料分类枚举键（L4，与 v1.2 §D20 / R140 一致）
const MAT_CAT_KEYS = ['meat', 'veg', 'dry', 'season', 'pack', 'other'];

const fails = [];
const ok = (name, cond, extra) => {
  if (cond) process.stdout.write(`  ✅ ${name}${extra ? ' —— ' + extra : ''}\n`);
  else fails.push(name + (extra ? ' —— ' + extra : ''));
  return cond;
};

// ===== L1 · 分类必须能输入，且不能被 picker 锁死 =====
const EDIT_WXML = 'pages/card/edit.wxml';
const wxml = R(EDIT_WXML);
const hasCatInput = /<input[^>]*value="\{\{category\}\}"[^>]*bindinput=/.test(wxml)
  || /<input[^>]*bindinput="onCategoryInput"/.test(wxml);
ok('L1-a 分类字段是可输入控件（value="{{category}}" 的 input）', hasCatInput, EDIT_WXML);
// picker 锁死判据：picker 标签内出现 category（range/range-key/value 或 bindchange=onCategory）
const pickerLocksCat = /<picker[\s\S]{0,400}?(category|onCategory)[\s\S]{0,400}?<\/picker>/.test(wxml);
ok('L1-b 分类**不得**用 picker 锁死（picker 只能选预设，火锅/营销栏目选不出来）', !pickerLocksCat,
  pickerLocksCat ? '发现 picker 绑定 category' : '无 category picker');

// ===== L2 · 建议池只许追加 =====
const terms = R('miniprogram/i18n/terms.js');
const m = terms.match(/dishCats:\s*\[([^\]]*)\]/);
const cats = m ? (m[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, '')) : [];
const missing = BASE_CATS.filter((c) => cats.indexOf(c) < 0);
ok('L2 建议池包含基线 7 项（只许追加，删了会让旧卡回显丢失）', cats.length > 0 && missing.length === 0,
  missing.length ? '缺失：' + missing.join('、') : `现 ${cats.length} 项`);

// ===== L3 · 保存必须 trim =====
const editJs = R('pages/card/edit.js');
const doSave = editJs.slice(editJs.indexOf('async doSave()'));
const trimmed = /card\.category\s*=\s*String\([^)]*\)\.trim\(\)/.test(doSave)
  || /category:\s*[^,]*\.trim\(\)/.test(doSave);
ok('L3 保存时 category 过 .trim()（防"热菜 "与"热菜"裂成两类）', trimmed);

// ===== L4 · 原料分类保持枚举，不许跟着自由化 =====
const matWxml = R('pages/material/edit.wxml');
const matIsPicker = /<picker[^>]*categoryOptions/.test(matWxml);
ok('L4-a 原料分类仍是 picker（采购视角枚举，与菜品分类两套语义）', matIsPicker, 'material/edit.wxml');
const matSrc = R('cloudfunctions/saveMaterial/validate.js') + R('pages/material/edit.js');
const missKeys = MAT_CAT_KEYS.filter((k) => !new RegExp(`['"]${k}['"]`).test(matSrc));
ok('L4-b 原料分类枚举键完整（meat/veg/dry/season/pack/other）', missKeys.length === 0,
  missKeys.length ? '缺失：' + missKeys.join('、') : '6 键齐全');

const pass = 6 - fails.length;
process.stdout.write(`\n[R148 dish-category-free] 菜品分类自由定义守卫\n`);
for (const f of fails) process.stdout.write(`  ❌ ${f}\n`);
// 🔒 R69 收尾行：verify_all.js 要求末尾 3 个非空行含「N 通过」
process.stdout.write(fails.length
  ? `❌ 菜品分类守卫：${pass} 通过 / ${fails.length} 失败\n`
  : `✅ 菜品分类守卫：${pass} 通过 / 0 失败\n`);
process.exit(fails.length ? 1 : 0);
