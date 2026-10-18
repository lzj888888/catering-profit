# -*- coding: utf-8 -*-
"""R325d：补两条判据 —— ① 引用集 ⊆ 赋值集 ② 缺项分支必须在 safe 之前。"""
import io

p = 'tools/check_m2_matrix.js'
s = io.open(p, encoding='utf-8').read()

anchor = """  // ⑥ 反恒真：写反的乘法顺序必须判不通过
  const badSample = 'const fixed = Math.round(best.marginPct / 100 * best.breakMonthly);';
  chk(!/best\\.breakMonthly\\s*\\*\\s*best\\.marginPct\\s*\\/\\s*100/.test(badSample),
    'R325-⑥ 判据恒真：写反的样本也通过了 ②');
}"""
assert s.count(anchor) == 1

BLOCK = """  // ⑥ 反恒真：写反的乘法顺序必须判不通过
  const badSample = 'const fixed = Math.round(best.marginPct / 100 * best.breakMonthly);';
  chk(!/best\\.breakMonthly\\s*\\*\\s*best\\.marginPct\\s*\\/\\s*100/.test(badSample),
    'R325-⑥ 判据恒真：写反的样本也通过了 ②');

  // ⑦ 🔴「读到了 ≠ 送出去了」：buildCash 里引用的每个 T.xxx，必须在 data.t 映射里**被赋值**。
  //    只判「页面用了哪些文案」不够 —— 映射里漏一个键，拿到的是 undefined，
  //    文案变成空串或 "undefined"，而**运行时零报错**（R298Y 同族病）。
  const cashBody = (mtxJs.match(/\\n  buildCash\\(\\)\\s*\\{([\\s\\S]*?)\\n  \\},/) || [])[1] || '';
  const refs = Array.from(new Set((cashBody.match(/T\\.[A-Za-z0-9_]+/g) || []).map((x) => x.slice(2))));
  const missingKeys = refs.filter((k) => !new RegExp('\\\\n\\\\s+' + k + ':\\\\s').test(mtxJs));
  chk(cashBody.length > 0 && refs.length >= 8,
    'R325-⑦ 没能定位 buildCash 或其引用的文案键过少（判据本身失效，别当成通过）');
  chk(missingKeys.length === 0,
    'buildCash 引用了未在 t 映射赋值的文案键：' + missingKeys.join(', ') + '（R325：拿到 undefined 且零报错）');

  // ⑧ 缺设备/货款时必须**先**短路，不给「够/能撑几个月」——顺序写错（放到 safe 之后）等于没做。
  const iIncomplete = mtxJs.indexOf('} else if (incomplete) {');
  const iSafe = mtxJs.indexOf("r.level === 'safe'");
  chk(iIncomplete > 0 && iSafe > iIncomplete,
    'matrix.js 缺项分支不在 safe 之前（R325：会先报「够」，把下限当完整数）');
}"""

s = s.replace(anchor, BLOCK, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('guard patched +2')
