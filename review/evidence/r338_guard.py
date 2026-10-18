import io

p = 'tools/check_m2_matrix.js'
s = io.open(p, encoding='utf-8').read()

ANCHOR = """if (problems.length) {
  console.log('❌ M2 矩阵/对比 + 页面完整性守卫失败 ' + problems.length + ' 处：');"""

assert s.count(ANCHOR) == 1

BLOCK = """// --- R338：已有店铺的「安全垫」（M1 有，M2 原先没有）---
//   为什么守：同一个老板在 M1 看到「营收再掉 12.3% 就亏」，在 M2 看不到这一句 ——
//   两个模块像两套软件。三个静默退化点：① 换了分母（除以保本而不是营收）② 目标=保本时显示 0%
//   ③ 另写一句话（文案分叉，以后改口径漏一处）。
{
  chk(/cushion_pct:\\s*_cushion/.test(idxJs)
    && /Math\\.round\\(\\(\\(_tgFen\\s*-\\s*_beFen\\)\\s*\\*\\s*1000\\)\\s*\\/\\s*_tgFen\\)\\s*\\/\\s*10/.test(idxJs),
    'index.js 安全垫未按「(目标 − 保本) ÷ 目标」一位小数派生（R338：换分母会把缓冲算大，属危险方向）');

  // 目标利润=0 ⇒ 目标营收 = 保本营收 ⇒ 安全垫恒 0。必须显示「保本线」，不能显示 0%。
  // 判语义（两种等价写法都算过），不钉某个字面量。
  chk(/(Math\\.abs\\(_cushion\\)\\s*<[^)]*|_cushion\\s*===\\s*0)[\\s\\S]{0,220}cushionBreakEven/.test(idxJs),
    'index.js 安全垫缺「目标=保本 ⇒ 显示保本线」分支（R338：显示 0% 会让老板以为系统坏了）');

  chk(/result\\.cushion_text/.test(idxWxmlS),
    'index.wxml 未渲染安全垫（R338：算了不显示等于没做）');

  // 文案必须复用 M1 的 TERMS.card.beMarginDrop，不许在 M2 里另写一句
  chk(/TERMS\\.card\\.beMarginDrop/.test(idxJs) && /TERMS\\.card\\.beMargin\\b/.test(idxJs),
    'index.js 安全垫文案未复用 M1（R338：两模块各写一句话，改口径必漏一处）');
}

""" + ANCHOR

s = s.replace(ANCHOR, BLOCK, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('guard ok')
