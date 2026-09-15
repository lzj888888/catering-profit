# -*- coding: utf-8 -*-
"""词级 OCR 定位: ocr_word.py <png> [kw...]
坐标 = 原图坐标（若传入的是放大裁剪图，请用 --crop L,T,S 换算回原图）。
"""
import sys
sys.path.insert(0, r'C:\Users\lzj\AppData\Local\Temp\ocrlibs')
from PIL import Image
import winocr

args = sys.argv[1:]
png = args.pop(0)
cl, ct, s = 0.0, 0.0, 1.0
if '--crop' in args:
    i = args.index('--crop')
    cl, ct, s = float(args[i+1]), float(args[i+2]), float(args[i+3])
    del args[i:i+4]
kws = args

res = winocr.recognize_pil_sync(Image.open(png), 'zh-Hans-CN')
items = []
for ln in res.get('lines', []):
    for w in ln.get('words', []):
        b = w['bounding_rect']
        cx = cl + (b['x'] + b['width'] / 2) / s
        cy = ct + (b['y'] + b['height'] / 2) / s
        items.append((w.get('text', ''), cx, cy))

if not kws:
    for t, cx, cy in items:
        print('  [%7.1f,%6.1f] %s' % (cx, cy, t))
    sys.exit(0)
for kw in kws:
    hit = [it for it in items if kw in it[0]]
    print(('HIT   ' if hit else 'MISS  ') + kw, ' '.join('(%s@%.1f,%.1f)' % (t, cx, cy) for t, cx, cy in hit))
