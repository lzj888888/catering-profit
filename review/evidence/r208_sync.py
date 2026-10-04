# -*- coding: utf-8 -*-
"""R208 六处同步：verify_all 头注 + 重启键三处 + 演进链尾部 + CASES"""
import io, sys

OLD_HEAD = '串联：132 个套件'
NEW_HEAD = '串联：133 个套件'

OLD_KEY1 = '串 **132** 个套件'
NEW_KEY1 = '串 **133** 个套件'
OLD_KEY2 = '现 **132**；'
NEW_KEY2 = '现 **133**；'
OLD_KEY3 = '四十五者'
NEW_KEY3 = '四十六者'

# 演进链尾部：在 R207 那条之后接一条 R208
OLD_CHAIN = '（提审材料 §4 页面清单 22→23 已同步））** → **132（R207'
NEW_CHAIN = '（提审材料 §4 页面清单 22→23 已同步））** → **132（R207'

def rw(p, pairs, must=True):
    s = io.open(p, encoding='utf-8').read()
    for old, new, cnt in pairs:
        c = s.count(old)
        print('  %-46s x%d' % (old[:44], c))
        if must and c != cnt:
            print('!! Expect %d got %d -> abort' % (cnt, c)); sys.exit(1)
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('OK', p)

print('== verify_all.js ==')
rw('verify_all.js', [(OLD_HEAD, NEW_HEAD, 1)])

K = 'specs/dev-specs/★知识存储点_2026-09-10.md'
print('== 重启键 ==')
rw(K, [(OLD_KEY1, NEW_KEY1, 1), (OLD_KEY2, NEW_KEY2, 1), (OLD_KEY3, NEW_KEY3, 1)])

print('== 演进链尾部 ==')
s = io.open(K, encoding='utf-8').read()
tail_old = '🔴 **纯视觉改动此前零套件在管**'
i = s.rfind(tail_old)
print('  tail idx=', i, 'total=', len(s))
print('  tail ends with:', repr(s[i:i + 400][-160:]))
