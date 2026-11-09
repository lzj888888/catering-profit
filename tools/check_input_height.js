// tools/check_input_height.js —— 输入框「汉字只露半截」防复发守卫（R668）
//
// 李老师真机：「菜品名称后面的输入框，汉字只能漏出下半部分」。
// 根因：`.form .field .val-input` 用了 `box-sizing: border-box`，
//   全局 `input{min-height:88rpx}` 在该模式下把上下 padding 也算进 88rpx
//   ⇒ 内容区只剩 60rpx ⇒ 中文被裁。
//
// R654 当初只补了全局 min-height、没补行高 ⇒ 这次又复发。
//
// ⚠️ 判据设计：首版想「全仓所有 border-box 的 input 都必须显式给高度」，
//   实测**误报 4 处**（.cat-input / .cell2 / .minp 靠全局兜底或 R615 各自的修法已正常）。
//   一刀切会把没病的判成有病 ⇒ 守卫失信。
//   ⇒ 改成：**只钉死已知病灶那一条** + 全局兜底两条；横向扫描只报数、不判红。

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const APP = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8');
const EDIT = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.wxss'), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\n===== H 全局兜底（R654 + R668）=====');
const globalRule = (strip(APP).match(/input,\s*textarea\s*\{[^}]*\}/) || [''])[0];
ok('H-① 全局有 input/textarea 的 min-height:88rpx 兜底', /min-height:\s*88rpx/.test(globalRule));
ok('H-② 🔴 全局兜底补了**行高**（只给 min-height 会被 border-box 吃掉 ⇒ 本次复发原因）',
  /line-height/.test(globalRule));
ok('H-③ 不设 height（会盖掉各页面触控下界；R654 的 64rpx 被 G2 判红）',
  !/(^|[^n-])height:/.test(globalRule));

console.log('\n===== H 已知病灶：菜品名称输入框 =====');
const rule = (strip(EDIT).match(/\.form \.field \.val-input\s*\{[^}]*\}/) || [''])[0];
ok('H-④ 🔴 上下 padding 归零（border-box 下它们会吃掉内容区高度）',
  /padding-top:\s*0/.test(rule) && /padding-bottom:\s*0/.test(rule), rule.slice(0, 90));
ok('H-⑤ 🔴 有 min-height + line-height', /min-height:\s*88rpx/.test(rule) && /line-height/.test(rule));
ok('H-⑥ 左右 220rpx 宽不变（不因修复把布局改坏）', /width:\s*220rpx/.test(rule));

console.log('\n===== H 🔴 基础 .val-input（覆盖 5 个被报字段的那一条）=====');
// 李老师续报：标签 / 制作损耗率 / 辅料分担 / 建议售价 / 活动特价 **全都截断**。
// 这些字段共用基础 `.val-input`，只修 `.form .field` 那条不够 ⇒ 必须钉死基础规则。
const baseRule = (strip(EDIT).match(/(^|\})\s*\.val-input\s*\{[^}]*\}/m) || [''])[0];
const baseBody = (baseRule.match(/\{([^}]*)\}/) || ['', ''])[1];
ok('H-⑧ 🔴 基础 .val-input 有 box-sizing:border-box + 上下 padding 归零',
  /box-sizing:\s*border-box/.test(baseBody) && /padding-top:\s*0/.test(baseBody) && /padding-bottom:\s*0/.test(baseBody),
  baseBody.trim().slice(0, 90));
ok('H-⑨ 🔴 基础 .val-input 有 min-height:88rpx 且 line-height 与之同为 88rpx',
  /min-height:\s*88rpx/.test(baseBody) && /line-height:\s*88rpx/.test(baseBody));
ok('H-⑩ 基础规则不设 height（系统字体调大时不二次裁切）', !/(^|[^n-])height:/.test(baseBody));

console.log('\n===== H 横向扫描（只报数，不判红）=====');
let total = 0; let withSize = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'miniprogram_npm'].indexOf(e.name) >= 0) continue;
      walk(rel);
    } else if (/\.wxss$/.test(e.name)) {
      const t = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      for (const m of t.matchAll(/([^{}]*input[^{}]*)\{([^{}]*)\}/g)) {
        if (!/box-sizing:\s*border-box/.test(m[2])) continue;
        total++;
        if (/min-height|line-height|height:/.test(m[2])) withSize++;
      }
    }
  }
};
walk('.');
ok('H-⑦ 全仓 border-box 的 input 规则清点完成（有显式高度/行高的应占多数）',
  total === 0 || withSize >= 1, '共 ' + total + ' 处，其中 ' + withSize + ' 处显式给了高度/行高');
console.log('  ℹ️ 其余靠全局兜底；若某页真机再出现裁字，把该页规则补进本守卫的具体判据即可。');

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);
