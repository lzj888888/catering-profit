# -*- coding: utf-8 -*-
"""R193 第二轮：把 m2.draftCleared 换成实际用到的两个键（避免"定义未使用"），双副本一致。"""
import io, hashlib

FILES = ['miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js']
OLD = "    draftCleared: '已清空，可重新填写',\n"
NEW = (
    "    draftClearConfirm: '清空后本次填写的数不可恢复，确定？',\n"
    "    // showModal confirmText ≤4 字符（超了整窗 fail 且静默）\n"
    "    draftClearOk: '清空',\n"
)

for p in FILES:
    s = io.open(p, encoding='utf-8').read()
    assert s.count(OLD) == 1, (p, s.count(OLD))
    io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(OLD, NEW, 1))
    print('ok', p)

h = [hashlib.md5(io.open(p, 'rb').read()).hexdigest() for p in FILES]
print('md5:', h)
assert h[0] == h[1]
print('MD5 OK')
