# R759 promo_calc 断言数 53 -> 64（自测扩了 11 条）
p1 = 'tools/check_suite_assert_counts.js'
s = open(p1, encoding='utf-8', newline='').read()
old = "// 53 条（R757 活动测算：10 类活动折算 + 国外基准对拍 + 流水≠客流）"
assert s.count(old) == 1, 'guard count=%d' % s.count(old)
s = s.replace(old, "// 64 条（R757 10 类折算 + R759 折扣换算独立入口/推导式 11 条；国外基准对拍 + 流水≠客流）")
open(p1, 'w', encoding='utf-8', newline='').write(s)
print('patched guard')

p2 = 'specs/dev-specs/★知识存储点_2026-09-10.md'
s = open(p2, encoding='utf-8', newline='').read()
old = '`promo_calc`=53（**R757 活动测算：与国外基准对拍 + 流水≠客流**）'
assert s.count(old) == 1, 'doc count=%d' % s.count(old)
s = s.replace(old, '`promo_calc`=64（**R757 活动测算：与国外基准对拍 + 流水≠客流；R759 折扣换算独立入口 + 推导式 11 条**）')
open(p2, 'w', encoding='utf-8', newline='').write(s)
print('patched doc')
