# -*- coding: utf-8 -*-
"""OCR 定位：在 png 里找到关键词的屏幕/窗口坐标中心。
用法: ocr_locate.py <png> <kw1> [kw2 ...]
"""
import sys, os
sys.path.insert(0, r'C:\Users\lzj\AppData\Local\Temp\ocrlibs')
from PIL import Image
import winocr

png = sys.argv[1]
kws = sys.argv[2:]
W = 3
res = winocr.recognize_pil_sync(Image.open(png), 'zh-Hans-CN')

# 组装成「行 -> 连续词串」并给出包围盒，便于匹配多字词
items = []
for ln in res.get('lines', []):
    words = ln.get('words', [])
    if not words:
        continue
    chars = ''.join(w.get('text', '') for w in words)
    r = [w['bounding_rect'] for w in words]
    x0 = min(v['x'] for v in r); x1 = max(v['x'] + v['width'] for v in r)
    y0 = min(v['y'] for v in r); y1 = max(v['y'] + v['height'] for v in r)
    items.append({'text': chars, 'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2})

if not kws:
    for it in items:
        print('  [%7.1f,%6.1f] %s' % (it['cx'], it['cy'], it['text']))
    sys.exit(0)

for kw in kws:
    hits = [it for it in items if kw in it['text']]
    if not hits:
        print('MISS  %-14s' % kw)
        continue
    for h in hits:
        print('HIT   %-14s center=(%7.1f, %6.1f)  line=%r' % (kw, h['cx'], h['cy'], h['text'][:70]))
