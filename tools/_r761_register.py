#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# R761 登记：verify_all 加 promo-three-stage 套件（342→343）、重启键文档套件数、轮次号 760→761
import re

# 1) verify_all.js（CRLF）
p = 'verify_all.js'
b = open(p, 'rb').read()
s = b.decode('utf-8')
assert s.count('// 串联：342 个套件') == 1, s.count('// 串联：342 个套件')
s = s.replace('// 串联：342 个套件', '// 串联：343 个套件', 1)
anchor = "  ['promo-two-stage', 'tools/check_promo_two_stage.js'],"
assert s.count(anchor) == 1, s.count(anchor)
add = (anchor + '\r\n'
       + "  // R761：活动测算三段分离守卫（页面桩真跑 recalc，不依赖 IDE）。\r\n"
       + "  //   李老师原话补第三段「填活动后毛利率反算」；豆包评审定代金券 face=实付 + 限用不改折扣。\r\n"
       + "  //   守：A 券口径纠偏 + B 反算对拍 + C 三段独立与反恒真，12 断言。\r\n"
       + "  ['promo-three-stage', 'tools/check_promo_three_stage.js'],")
s = s.replace(anchor, add, 1)
open(p, 'wb').write(s.encode('utf-8'))
print(p, 'CRLF', s.count('\r\n'), 'LF', s.count('\n') - s.count('\r\n'))

# 2) 重启键文档：串 **342** → 343（只改套件数那一处，不碰 commit 哈希）
p2 = 'specs/dev-specs/★知识存储点_2026-09-10.md'
s2 = open(p2, encoding='utf-8', newline='').read()
assert s2.count('串 **342** 个套件') == 1, s2.count('串 **342** 个套件')
s2 = s2.replace('串 **342** 个套件', '串 **343** 个套件', 1)
open(p2, 'w', encoding='utf-8', newline='').write(s2)
print(p2, 'ok')

# 3) ROUND_INDEX 760/761 → 761/762
p3 = 'review/ROUND_INDEX.md'
s3 = open(p3, encoding='utf-8', newline='').read()
assert s3.count('CURRENT: 760\nNEXT: 761') == 1 or s3.count('CURRENT: 760\r\nNEXT: 761') == 1
s3 = s3.replace('CURRENT: 760\r\nNEXT: 761', 'CURRENT: 761\r\nNEXT: 762').replace('CURRENT: 760\nNEXT: 761', 'CURRENT: 761\nNEXT: 762')
open(p3, 'w', encoding='utf-8', newline='').write(s3)
print(p3, 'ok')
