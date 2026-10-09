# -*- coding: utf-8 -*-
# R247：verify_all.js 四处同步（头注数量 / 头注注释块 / SUITES 条目 + 其上方注释）
# 两阶段：全部锚点断言命中 == 1 才统一落盘；任一不符 → 一个文件都不写。
import sys

P = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/verify_all.js'
raw = open(P, 'rb').read()
nl = '\r\n' if b'\r\n' in raw else '\n'
s = raw.decode('utf-8').replace('\r\n', '\n')
orig = s

# ---- 1) 头注数量 ----
a1 = '// 串联：153 个套件 = '
assert s.count(a1) == 1, ('a1 hit', s.count(a1))
s = s.replace(a1, '// 串联：154 个套件 = ')

# ---- 2) 头注注释块（补 R247 条目）----
a2 = '''//         24 条断言）
//       🔒 另：本文件对**每个套件的 stdout**做'''
assert s.count(a2) == 1, ('a2 hit', s.count(a2))
b2 = '''//         24 条断言）
//       + R247：**形态 C 平台 picker 一致性守卫**（tools/check_picker_platform.js，R247）
//         —— 根因：形态 C（外卖商品销量）必须由用户**手选平台**，而 picker 的 value 与
//         云端 `SALES_SCHEMA.platform.enum`、术语单源 `reviewPlatformNames` 之间有三个
//         **全静默**的失效点：① 越界 value 被云函数拒收；② 缺术语键 ⇒ `label = NAMES[v] || v`
//         **回落成机器值**（界面直接显示 `jd_sku`，R246 接京东时实测）；③ enum 新增平台而
//         picker 没加 ⇒ 新平台选不到、且门禁全绿零报错。
//         判据 = S 扫描面（三道下界护栏防扫空） + A 正向（picker ⊆ enum 且每项有术语键）
//         + B 反向（enum 成员未进 picker 者必须逐一在显式排除名单内） + C 合成样本自检（4 条）。
//         15 条断言。
//       🔒 另：本文件对**每个套件的 stdout**做'''
s = s.replace(a2, b2)

# ---- 3) SUITES 末尾追加 + 上方注释块 ----
a3 = """  ['m2-biz-inputs',        'tools/check_m2_biz_inputs.js'],
];"""
assert s.count(a3) == 1, ('a3 hit', s.count(a3))
b3 = """  ['m2-biz-inputs',        'tools/check_m2_biz_inputs.js'],
  // ===== R247 形态 C 平台 picker 一致性守卫（同族病：见头部注释同名条目）=====
  //   根因：形态 C 平台由用户手选，picker 的 value 与云端 enum / 术语单源两处都存在
  //   **静默**失效 —— 越界值被云函数拒收 · 缺术语键 ⇒ label 回落成机器值 · enum 加平台
  //   而 picker 漏加 ⇒ 选不到且零报错。三条此前均无任何套件在守。
  //   判据 = S 扫描面（含三道下界护栏）+ A 正向（⊆ enum + 每项有术语键）
  //        + B 反向（enum \\ picker ⊆ 显式排除名单）+ C 合成样本自检（4 条，防恒绿）。
  ['picker-platform',      'tools/check_picker_platform.js'],
];"""
s = s.replace(a3, b3)

if s == orig:
    sys.exit('NO-CHANGE')

open(P, 'wb').write(s.replace('\n', nl).encode('utf-8'))
print('verify_all.js written; nl =', repr(nl))
