# -*- coding: utf-8 -*-
"""R207：挂入第 132 个套件后的三处同步（重启键断言数行 / 演进链尾部 / CASES 表）。"""
import io

K = 'specs/dev-specs/★知识存储点_2026-09-10.md'
C = 'tools/check_suite_assert_counts.js'

# ── 1) 断言数声明行：登记新套件 + 「四十四者」→「四十五者」 ──
s = io.open(K, encoding='utf-8').read()
old = '`check_material_batch`=23（**四十四者**'
new = '`check_material_batch`=23 / `check_home_ui_v3`=29（**四十五者**'
assert s.count(old) == 1, '锚点「四十四者」命中 %d 次，应为 1' % s.count(old)
s = s.replace(old, new)

# ── 2) 演进链尾部（第 6 处，最易漏：不在文件头、在History链最后一节末尾）──
tail = '同批新增页面 `pages/material/batch`（提审材料 §4 页面清单 22→23 已同步））**'
assert s.count(tail) == 1, '演进链尾部锚点命中 %d 次' % s.count(tail)
add = (' → **132（R207：新增 `tools/check_home_ui_v3.js`，首页 UI（v3）冻结条款守卫 —— '
       '起因＝李老师反馈「通篇长得差不多、无聊单调」；经三轮评审确定：首页 4 张卡走同一模板'
       '（白底圆角 + 标题 + 一行小字）零图标零层次，视觉上就是「4 行重复文本」。'
       'v3 落地＝纯色头卡（含本月经营参考利润，绝不显示 ¥0）+ 三张形状图标模块卡（不用颜色区分，'
       '红绿已绑定涨跌语义）+ 全局金额等宽 tabular-nums + 色条圆角 overflow 兜底。'
       '🔴 **纯视觉改动此前零套件在管** —— 没有类型检查、没有报错，改回旧写法也无人察觉 ⇒ 29 条断言常驻；'
       '其中最硬的一条＝**UI 改版不许吃掉功能**（店铺切换是原「当前店铺卡」唯一用途，设置无 tabBar 替代入口）。'
       '变异回灌 4/4 全部点名目标断言：M1 渐变还原→A-② / M2 空态塞回金额→A-⑦ / M3 删 goSwitch→C-② / M4 拆 tabular-nums→D-①）**')
s = s.replace(tail, tail + add)
io.open(K, 'w', encoding='utf-8', newline='').write(s)
print('重启键 OK：四十五者=%d  演进链 132=%d' % (s.count('四十五者'), s.count('**132（R207')))

# ── 3) CASES 表登记新套件（数值单源，格式敏感）──
c = io.open(C, encoding='utf-8').read()
oldc = "  { key: 'check_material_batch', rel: 'tools/check_material_batch.js' }, // 23 条（R204：A 解析行为 9 / B 页面接线 8 / C 护栏 4 / D 正负样本 2）"
newc = oldc + "\n  { key: 'check_home_ui_v3', rel: 'tools/check_home_ui_v3.js' }, // 29 条（R207：S 护栏 5 / A 头卡 10 / B 口径 4 / C 模块卡与入口保全 7 / D 全局单源 3）"
if oldc in c:
    c = c.replace(oldc, newc)
else:
    raise SystemExit('CASES 锚点没命中，手工确认格式')
io.open(C, 'w', encoding='utf-8', newline='').write(c)
print('CASES OK')
