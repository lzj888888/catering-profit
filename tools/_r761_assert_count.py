#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# R761：promo_calc 自测 64→82 条，同步两处声明（守卫判据 + 重启键文档）
p1 = 'tools/check_suite_assert_counts.js'
s1 = open(p1, encoding='utf-8', newline='').read()
old = "{ key: 'promo_calc', rel: 'utils/promoCalc.selftest.js' }, // 64 条"
assert s1.count(old) == 1, s1.count(old)
s1 = s1.replace(old, "{ key: 'promo_calc', rel: 'utils/promoCalc.selftest.js' }, // 82 条（R761 补 18：券口径纠偏+限用提示+第三段反算）", 1)
open(p1, 'w', encoding='utf-8', newline='').write(s1)
print(p1, 'ok')

p2 = 'specs/dev-specs/★知识存储点_2026-09-10.md'
s2 = open(p2, encoding='utf-8', newline='').read()
old2 = '`promo_calc`=64'
assert s2.count(old2) == 1, s2.count(old2)
s2 = s2.replace(old2, '`promo_calc`=82', 1)
open(p2, 'w', encoding='utf-8', newline='').write(s2)
print(p2, 'ok')
