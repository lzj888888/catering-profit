# -*- coding: utf-8 -*-
# _patch_r209_doc.py —— 在重启键「套件数会漂」演进链尾部追加第 134 条（字节级定位，避免长行 Read 截断）
import io, os
ROOT = r'C:\Users\lzj\WorkBuddy\Claw\catering-profit'
REL = 'specs/dev-specs/★知识存储点_2026-09-10.md'
p = os.path.join(ROOT, REL)
with io.open(p, 'r', encoding='utf-8', newline='') as f:
    s = f.read()

ANCHOR = 'M6→D-①D-③）\r'
n = s.count(ANCHOR)
print('anchor count =', n)
if n != 1:
    raise SystemExit('锚点不唯一，停手')

ADD = (' → **134（R209：新增 `tools/check_month_picker.js`，月份选择器守卫 —— 起因＝李老师真机反馈'
       '「月度盈利核算选月份只能选本月，选以前月份提示填写错误」。实锤是**纯前端类型 bug 而非产品限制**：'
       '`<picker mode="selector">` 的 `e.detail.value` 是**选中项下标（数字）**，`pages/month/index.js::onMonthChange`'
       ' 却把它直接当月份字符串往下传 ⇒ `getLedger` 收到 month=0/1/2 ⇒ validate 判 `INVALID_PARAM` ⇒'
       ' 前端弹 ERR.INVALID_PARAM「填写有误，请检查后重试」；而**本月**是 bootstrap 用 `ui.nowMonth()` 字符串拉的那次'
       ' ⇒ 观感恰好等于「只能停在本月」。🔴 B 组实跑生产 `getLedger/validate.js` 证明历史月份（2026-09）从来放行 ——'
       ' 产品从没限制过选历史月。全站 17 处 selector picker 里**只有这一处走漏**（其余一律 `Number(e.detail.value)`'
       ' 取数组元素）⇒ C 组做成同类回归 + 关键锚点在场护栏。A 组**把 handler 函数体抠出来用伪造 Page 上下文实跑**'
       '（判行为不判字面）：传出去的必须是 `months[i]` 字符串 / 重复与越界都不许发请求 / 高亮跟随；18 条断言；'
       ' 变异回灌 3/3 全部点名目标断言：M1 改回裸传→A-①②③④⑤+C-② / M2 去掉 early return→A-③A-④ / M3 高亮不跟随→A-⑤）**\r')

s2 = s.replace(ANCHOR, ADD, 1)
with io.open(p, 'w', encoding='utf-8', newline='') as f:
    f.write(s2)
print('patched, size', os.path.getsize(p))
