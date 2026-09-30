# -*- coding: utf-8 -*-
"""粘贴旁证：比较 n0_before / n1_pasted 两帧在「输入框带」的像素差异。
差异大 = 输入框文字变了（载荷进去了）。仅旁证，硬判据是发送后的 DB。"""
import sys
from PIL import Image, ImageChops

A = sys.argv[1] if len(sys.argv) > 1 else 'n0_before.png'
B = sys.argv[2] if len(sys.argv) > 2 else 'n1_pasted.png'
ia = Image.open(A).convert('RGB'); ib = Image.open(B).convert('RGB')
print('sizes', ia.size, ib.size)
w, h = ia.size
# 输入框带：窗口底部工具条上方一条
box = (80, 900, 1420, 1010)
ca = ia.crop(box); cb = ib.crop(box)
d = ImageChops.difference(ca, cb)
bbox = d.getbbox()
hist = d.convert('L').histogram()
changed = sum(hist[16:])       # 灰度差 >15 的像素数
print('input-band diff bbox =', bbox)
print('changed px (delta>15) =', changed)


def darkcount(im, box):
    c = im.crop(box).convert('L')
    return sum(1 for p in c.getdata() if p < 90)


print('n0 dark px in band =', darkcount(ia, box))
print('n1 dark px in band =', darkcount(ib, box))
print('VERDICT =', 'PASTE-OK(像素已变)' if changed > 3000 else 'SUSPECT(变化过小)')
