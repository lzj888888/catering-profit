# -*- coding: utf-8 -*-
"""R325：给现金卡加断言（check_m2_matrix 52 -> 58）。"""
import io

p = 'tools/check_m2_matrix.js'
s = io.open(p, encoding='utf-8').read()

anchor = """  chk(/onToggleAdv/.test(mwxml) && /advNote/.test(mwxml),
    'matrix.wxml 缺高级维度开关或「按毛利率 X% · 人工 N 人测算」说明（R322：收起不等于不告知）');
}"""
assert s.count(anchor) == 1

BLOCK = anchor + """

// --- R325：现金卡（钱够不够开 · 能撑几个月）---
//   这类改动的失效方式**全是静默的**：
//     不重算 ⇒ 老板换了租金档位，卡上还是上一次的数；
//     反推公式写反 ⇒ 月固定支出偏小 ⇒ 能撑月数偏大（**危险方向**，宁可说紧）；
//     未填设备却按完整算 ⇒ 把下限当完整数；
//     没填现金却报「够」⇒ 直接骗人。
{
  // ① 生成结果后必须重算（锚在 onGenerate 函数体内，不用全文匹配 —— 同文件别处也有 buildCash 的定义）
  const genBody = (mtxJs.match(/async onGenerate\\(\\)\\s*\\{([\\s\\S]*?)\\n  \\},/) || [])[1] || '';
  chk(/this\\.buildCash\\(\\)/.test(genBody),
    'matrix.js onGenerate 生成结果后未调用 buildCash（R325：现金卡会一直显示上一次的租金档位）');
  // ② 反推方向：固定费用 = 保本营收 × 毛利率 ÷ 100（写反 ⇒ 能撑月数偏大，属危险方向）
  chk(/best\\.breakMonthly\\s*\\*\\s*best\\.marginPct\\s*\\/\\s*100/.test(mtxJs),
    'matrix.js 每月固定支出未按「保本营收 × 毛利率」反推（R325：方向写反 ⇒ 能撑月数偏大）');
  // ③ 未填设备/货款必须明说「实际更多」（不许把下限当完整）
  chk(/equipMissing\\s*\\|\\|\\s*r\\.stockMissing/.test(mtxJs) && /cashIncompleteNote/.test(mtxJs),
    'matrix.js 未填设备/货款时未给「实际要拿的更多」提示（R325：把下限当完整数 = 假精确）');
  // ④ 没填现金不许给结论
  chk(/if\\s*\\(\\s*!r\\.budgetFen\\s*\\)\\s*\\{[\\s\\S]{0,120}?cashNeedBudget/.test(mtxJs),
    'matrix.js 未填现金时仍可能给出「够/不够」（R325：没有预算就没有结论）');
  // ⑤ 页面必须 4 个输入 + 真渲染判定句
  chk((mtxWxml.match(/bindinput="onCashInput"/g) || []).length === 4,
    'matrix.wxml 现金卡输入框不是 4 个（R325：租金/现金/设备/首批货款）');
  chk(/cashRes\\.levelCls/.test(mtxWxml) && /cashRes\\.verdictText/.test(mtxWxml),
    'matrix.wxml 未渲染判定句（R325：算了不给结论等于没做）');
  // ⑥ 反恒真：写反的乘法顺序必须判不通过
  const badSample = 'const fixed = Math.round(best.marginPct / 100 * best.breakMonthly);';
  chk(!/best\\.breakMonthly\\s*\\*\\s*best\\.marginPct\\s*\\/\\s*100/.test(badSample),
    'R325-⑥ 判据恒真：写反的样本也通过了 ②');
}"""

s = s.replace(anchor, BLOCK, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('guard patched')
