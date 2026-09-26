// round148 · R148（菜品分类自由定义守卫）变异回灌
// 每条变异独立注入 → 跑守卫 → 期望转红并**点名到对应断言** → 还原 → md5 校验
'use strict';
const fs = require('fs');
const cp = require('child_process');
const R = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit/';
const crypto = require('crypto');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

const TARGETS = ['pages/card/edit.wxml', 'miniprogram/i18n/terms.js', 'pages/card/edit.js'];
const base = {};
for (const t of TARGETS) base[t] = fs.readFileSync(R + t, 'utf8');
const baseH = {};
for (const t of TARGETS) baseH[t] = md5(R + t);

const MUTS = [
  {
    id: 'V1',
    desc: '分类改回 picker（只能选预设 —— 本次事故的原形态）',
    file: 'pages/card/edit.wxml',
    old: '<input class="cat-input" value="{{category}}" placeholder="{{t.categoryPh}}" bindinput="onCategoryInput" adjust-position="{{true}}" cursor-spacing="20" />',
    neo: '<picker mode="selector" range="{{categoryOptions}}" bindchange="onCategory"><view class="picker">{{category || t.categoryPh}}</view></picker>',
    expectName: 'L1',
  },
  {
    id: 'V2',
    desc: '建议池删掉「凉菜」（旧卡自由值回显会丢失）',
    file: 'miniprogram/i18n/terms.js',
    old: "dishCats: ['热菜', '凉菜', '荤菜', '素菜', '锅底', '蘸料', '主食', '汤羹', '饮品', '小吃', '其他'],",
    neo: "dishCats: ['热菜', '荤菜', '素菜', '锅底', '蘸料', '主食', '汤羹', '饮品', '小吃', '其他'],",
    expectName: 'L2',
  },
  {
    id: 'V3',
    desc: '保存去掉 trim（"热菜 "与"热菜"裂成两类）',
    file: 'pages/card/edit.js',
    old: "card.category = String(this.data.category || '').trim();",
    neo: "card.category = String(this.data.category || '');",
    expectName: 'L3',
  },
  {
    id: 'V4',
    desc: '原料分类跟着自由化（两套语义被一刀切）',
    file: 'pages/card/edit.wxml',
    old: '<input class="cat-input" value="{{category}}"',
    neo: '<input class="cat-input" value="{{category}}"',
    expectName: 'L4',
    skip: true, // 该变异作用于 material 页，单独在下方 V4b 做
  },
  {
    id: 'V4b',
    desc: '原料分类改成自由输入（采购枚举被拆 ⇒ R140 同族）',
    file: 'pages/material/edit.wxml',
    old: '<picker mode="selector" range="{{categoryOptions}}" range-key="label" value="{{categoryIndex}}" bindchange="onCategory">',
    neo: '<input class="cat-input" value="{{category}}" bindinput="onCategory" />',
    expectName: 'L4-a',
    extra: 'pages/material/edit.wxml',
  },
  {
    id: 'V5',
    desc: '保留 input 但**同时**加回 picker（只查"有没有 input"的守卫会假绿）',
    file: 'pages/card/edit.wxml',
    old: '<view class="chip-row" wx:if="{{catChips.length}}">',
    neo: '<picker mode="selector" range="{{categoryOptions}}" bindchange="onCategory"><view class="picker">{{category}}</view></picker>\n    <view class="chip-row" wx:if="{{catChips.length}}">',
    expectName: 'L1-b',
  },
];

const runGuard = () => {
  const r = cp.spawnSync(process.execPath, ['tools/check_dish_category_free.js'], { cwd: R, encoding: 'utf8', maxBuffer: 1 << 24 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { rc: r.status, out };
};

const lines = [];
const P = (s) => { lines.push(s); process.stdout.write(s + '\n'); };

P('===== R148 变异回灌 =====');
const baseRun = runGuard();
P(`基线守卫 rc=${baseRun.rc}（应为 0）`);

let red = 0, green = 0;
for (const m of MUTS) {
  if (m.skip) continue;
  const files = [m.file].concat(m.extra ? [m.extra] : []);
  const snap = {};
  for (const f of files) { snap[f] = fs.readFileSync(R + f, 'utf8'); }
  let replaced = false;
  for (const f of files) {
    const cur = fs.readFileSync(R + f, 'utf8');
    if (cur.indexOf(m.old) >= 0) { fs.writeFileSync(R + f, cur.replace(m.old, m.neo)); replaced = true; }
  }
  if (!replaced) { P(`❌ ${m.id} 变异未注入（锚点找不到）—— 该条无效`); continue; }
  const r = runGuard();
  const hit = r.out.indexOf('❌ ' + m.expectName) >= 0;
  const isRed = r.rc !== 0;
  if (isRed && hit) { red++; P(`✅ ${m.id} 转红且点名 ${m.expectName} —— ${m.desc}`); }
  else if (isRed) { green++; P(`⚠ ${m.id} 转红但**没点名** ${m.expectName}（可能别的断言先红）—— ${m.desc}`); }
  else { green++; P(`❌ ${m.id} 仍绿 ⇒ 守卫漏抓 —— ${m.desc}`); }
  for (const f of files) fs.writeFileSync(R + f, snap[f]);
}

P('\n===== 还原校验 =====');
let restored = true;
for (const t of TARGETS.concat(['pages/material/edit.wxml'])) {
  const h = md5(R + t);
  if (baseH[t]) { const ok = h === baseH[t]; if (!ok) restored = false; P(`  ${ok ? '✅' : '❌'} ${t} ${h.slice(0, 8)} ${ok ? '≡ 基线' : '≠ 基线 ' + baseH[t].slice(0, 8)}`); }
  else P(`  · ${t} ${h.slice(0, 8)}（基线未记录，仅记录现值）`);
}
const after = runGuard();
P(`还原后守卫 rc=${after.rc}（应为 0）`);
P(`\n===== 结论：${red} 条转红并被点名 / ${green} 条未达预期 =====`);
fs.writeFileSync(R + 'review/evidence/mutation_r148.txt', lines.join('\n'));
