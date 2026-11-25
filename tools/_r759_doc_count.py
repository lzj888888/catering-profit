# R759 重启键文档套件数 341 -> 342（两处；注意第 2 处是 commit 哈希不能动）
p = 'specs/dev-specs/★知识存储点_2026-09-10.md'
s = open(p, encoding='utf-8', newline='').read()
a = '串 **341** 个套件'
bb = '现 **341**（R739'
assert s.count(a) == 1, 'a=%d' % s.count(a)
assert s.count(bb) == 1, 'b=%d' % s.count(bb)
s = s.replace(a, '串 **342** 个套件').replace(bb, '现 **342**（R739')
open(p, 'w', encoding='utf-8', newline='').write(s)
print('done')
