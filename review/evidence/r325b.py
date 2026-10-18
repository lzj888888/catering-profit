# -*- coding: utf-8 -*-
"""R325b：现金卡的「元」占位符走 terms（守卫判据：wxml 不得新增硬编码中文）。"""
import io

for q in ['miniprogram/i18n/terms.js', 'specs/dev-specs/i18n/terms.js']:
    t = io.open(q, encoding='utf-8').read()
    a = "    cashWan: '万',"
    assert t.count(a) == 1, (q, t.count(a))
    t = t.replace(a, a + "\n    cashYuanPh: '元',", 1)
    io.open(q, 'w', encoding='utf-8', newline='').write(t)

p = 'pages/sandbox/matrix.js'
s = io.open(p, encoding='utf-8').read()
a = "      cashDepositNote: M.cashDepositNote,"
assert s.count(a) == 1
s = s.replace(a, a + "\n      cashYuanPh: M.cashYuanPh,", 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)

p2 = 'pages/sandbox/matrix.wxml'
w = io.open(p2, encoding='utf-8').read()
n = w.count('placeholder="元"')
# 只替换现金卡内的 4 处（它们都紧跟 cash-inp）
w2 = w.replace('class="cash-inp"', 'class="cash-inp"').replace(
    'bindinput="onCashInput" adjust-position="{{true}}" cursor-spacing="20" placeholder="元"',
    'bindinput="onCashInput" adjust-position="{{true}}" cursor-spacing="20" placeholder="{{t.cashYuanPh}}"')
assert w2 != w
io.open(p2, 'w', encoding='utf-8', newline='').write(w2)
print('ok; 原 placeholder=元 共', n, '处，现金卡已改 4 处')
