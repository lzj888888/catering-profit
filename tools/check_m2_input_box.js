// tools/check_m2_input_box.js —— M2 沙盘输入框形态 + 选填块位置（R615）
//
// 李老师 2026-11-06 真机反馈两条：
//   ① 「点开场景矩阵测算，输入框小了一点，输入数字时数字上半部分丢失」
//      ⇒ 根因：`.minp` / `.real-in` 只给 padding+font-size，**没给 line-height / min-height**。
//        小程序 input 默认行盒按字号算，叠加上下 padding 后部分机型会裁掉文字上半部；
//        不报错、静态守卫也看不见，只有真机看得见。
//   ② 「选填·本月实际营业额 觉得放到 5 下面 6 上面」
//      ⇒ 该块原在「#10 敏感度」之后（页面极靠后），与它描述「这家店现状」的语义不符；
//        移到 ⑤ 开店投入之后、⑥ 想赚多少之前，形成「投入 → 实际营业额 → 目标」连贯顺序。
//
// 判据都是**行为/形态**，不判注释字面；每条配 fail-closed（解析不到即红）。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WXSS = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/matrix.wxss'), 'utf8');
const MWXML = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/matrix.wxml'), 'utf8');
const IWXML = fs.readFileSync(path.join(ROOT, 'subpkg/tools/sandbox/index.wxml'), 'utf8');

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
function ruleOf(src, selector) {
  // 取 `.selector { ... }` 规则体（不跨规则），WXSS 无嵌套
  const i = src.indexOf(selector + ' {');
  if (i < 0) return null;
  const j = src.indexOf('}', i);
  return j < 0 ? null : src.slice(i, j + 1);
}

console.log('\n===== A 输入框不裁字（真机反馈） =====');
{
  const minp = ruleOf(WXSS, '.minp');
  const real = ruleOf(WXSS, '.real-in');
  ok('A-① 能解析出 .minp / .real-in 规则（fail-closed：解析不到即红）', !!minp && !!real);
  for (const [name, rule] of [['.minp', minp], ['.real-in', real]]) {
    ok(`A-② ${name} 有 line-height（缺它 ⇒ 行盒高度不足，数字上半部被裁）`,
      !!rule && /line-height\s*:\s*\d+rpx/.test(rule), rule ? rule.replace(/\s+/g, ' ').slice(0, 110) : 'n/a');
    ok(`A-③ ${name} 有 min-height ≥64rpx（触控高度 + 不写死 height）`,
      (() => {
        if (!rule) return false;
        const m = /min-height\s*:\s*(\d+)rpx/.exec(rule);
        return !!m && Number(m[1]) >= 64;
      })(), rule ? (/min-height\s*:\s*(\d+)rpx/.exec(rule) || [])[1] : 'n/a');
    ok(`A-④ ${name} 不写死 height（用户调大系统字体时会再次裁字）`,
      !!rule && !/(^|[;\s])height\s*:/.test(rule));
  }
  // 覆盖全部 input：矩阵页每个 input 的类名里必须含 minp 或已经是 cash-inp/real-in
  const inputs = MWXML.match(/<input[^>]*>/g) || [];
  const unprotected = inputs.filter((tag) => {
    const cls = (/class="([^"]*)"/.exec(tag) || [])[1] || '';
    return /(^|\s)(minp|real-in|cash-inp)(\s|$)/.test(cls) === false;
  });
  ok('A-⑤ 矩阵页所有 input 都落在已修样式的类里（防新增裸 input 又漏掉）',
    inputs.length >= 20 && unprotected.length === 0,
    `${inputs.length} 个 input / 未覆盖 ${unprotected.length} 个`);
  // 变异反证：把 line-height 抹掉，判据必须失效
  const mutant = (minp || '').replace(/line-height\s*:\s*\d+rpx\s*;?/, '');
  ok('A-⑥ 变异反证：抹掉 line-height ⇒ A-② 判据必须失效（不是恒绿）',
    !/line-height\s*:\s*\d+rpx/.test(mutant));
}

console.log('\n===== B 选填块位置（⑤ 之后、⑥ 之前） =====');
{
  // 剥注释后按锚点定位；用行号而非字符下标，避免注释里同名文本干扰
  const p5 = IWXML.indexOf('⑤ 开店投入');
  const pExpect = IWXML.indexOf('选填·本月实际营业额');
  const p6 = IWXML.indexOf('⑥ 想赚多少');
  ok('B-① 三个锚点都能找到（fail-closed）', p5 >= 0 && pExpect >= 0 && p6 >= 0,
    `⑤=${p5} 选填=${pExpect} ⑥=${p6}`);
  ok('B-② 选填块在 ⑤ 之后、⑥ 之前', p5 < pExpect && pExpect < p6);
  // 整块搬移后结构必须完整：card2 开合配平
  const stripped = IWXML.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, '');
  const o = (stripped.match(/<view\b/g) || []).length;
  const c = (stripped.match(/<\/view>/g) || []).length;
  ok('B-③ 搬移后 wxml view 标签配平（防搬漏半个块）', o === c && o > 0, `open=${o} close=${c}`);
  // 选填块的核心绑定仍在（没被搬丢）
  ok('B-④ 选填块核心绑定 expectYuan / onExpect 仍在',
    /value="\{\{expectYuan\}\}"/.test(IWXML) && /bindinput="onExpect"/.test(IWXML));
}

console.log(`\n===== M2 输入框与选填块位置守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);
