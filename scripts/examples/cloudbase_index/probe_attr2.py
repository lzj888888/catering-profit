# -*- coding: utf-8 -*-
"""探针 2：对字段列「sort」那一小格做**图像增强**后 OCR，看能否直接读出 sort。

已知：crop=(1010,582,1245,702) scale=3/5 都把 `sort` 读成 `SO戊`（稳定误读，不是抖动）。
现在试：更大 scale、超采样、灰度+自动对比度、反相、Otsu 二值化。
"""
import sys, re, subprocess
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from PIL import Image, ImageOps
from win_gui import *

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
TMP = r'C:/Users/lzj/AppData/Local/Temp'
LINE_RE = re.compile(r"\[\s*([\d.]+),\s*([\d.]+)\]\s*'(.*)'")
SRC = '%s/pa_plan.png' % TMP   # 上一个探针留下的整窗截图

im = Image.open(SRC).convert('RGB')
# 目标小格：字段列 y 582..702（含 enabled / sort 两行）
box = (1010, 582, 1245, 702)
tile = im.crop(box)
print('tile size =', tile.size, flush=True)
print('tile 采样色（左上/中/右下）:', tile.getpixel((2, 2)), tile.getpixel((60, 60)), tile.getpixel((200, 100)),
      flush=True)

variants = {}

# A. 超采样到 8x / 12x，直接放大
for f in (6, 8, 12):
    big = tile.resize((tile.width * f, tile.height * f), Image.LANCZOS)
    variants['upscale%d' % f] = ('%s/pa_up%d.png' % (TMP, f), big)

# B. 灰度 + 自动对比度
g = ImageOps.autocontrast(tile.convert('L')).convert('RGB')
variants['auto_contrast'] = ('%s/pa_ac.png' % TMP,
                            g.resize((g.width * 6, g.height * 6), Image.LANCZOS))

# C. 反相（若底色深、字浅）
inv = ImageOps.autocontrast(ImageOps.invert(tile.convert('L'))).convert('RGB')
variants['invert'] = ('%s/pa_inv.png' % TMP,
                      inv.resize((inv.width * 6, inv.height * 6), Image.LANCZOS))

# D. 灰度 → Otsu 二值化（保底阈值 128 也来一份）
gl = tile.convert('L')
hist = gl.histogram()
total = sum(hist)
sum_all = sum(i * h for i, h in enumerate(hist))
sumB = wB = 0.0
best, thr = -1.0, 128
for i in range(256):
    wB += hist[i]
    if wB == 0:
        continue
    wF = total - wB
    if wF == 0:
        break
    sumB += i * hist[i]
    mB = sumB / wB
    mF = (sum_all - sumB) / wF
    between = wB * wF * (mB - mF) ** 2
    if between > best:
        best, thr = between, i
print('Otsu 阈值 =', thr, flush=True)
for name, t in (('otsu', thr), ('fixed128', 128)):
    bw = gl.point(lambda p, t=t: 0 if p < t else 255).convert('RGB')
    variants['bw_%s' % name] = ('%s/pa_bw_%s.png' % (TMP, name),
                                bw.resize((bw.width * 6, bw.height * 6), Image.LANCZOS))

for name, (path, img) in variants.items():
    img.save(path)
    r = subprocess.run([PY, OCR, 'list', path], capture_output=True, text=True, timeout=90)
    toks = [m.group(3) for m in LINE_RE.finditer(r.stdout or '')]
    print('%-14s scale=1 -> %s' % (name, toks), flush=True)

print('\n对照：原图 crop scale=8/12 直接读', flush=True)
for sc in (8, 12):
    r = subprocess.run([PY, OCR, 'list', SRC, '--crop', '1010', '582', '1245', '702', '--scale', str(sc)],
                       capture_output=True, text=True, timeout=90)
    print('scale=%-3d -> %s' % (sc, [m.group(3) for m in LINE_RE.finditer(r.stdout or '')]), flush=True)
print('\nDONE', flush=True)
