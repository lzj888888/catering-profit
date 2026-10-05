# -*- coding: utf-8 -*-
import sys, os, time, ctypes, subprocess
from PIL import Image
from collections import deque
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32
h = [x for x in find_windows(title='豆包') if rect(x)[2]-rect(x)[0] > 1000][0]
wb = find_window(title='WorkBuddy')
if wb: u.SetWindowPos(wb, -2, 0,0,0,0, 0x0001|0x0002|0x0010)
u.ShowWindow(h, 9); time.sleep(0.4)
u.SetWindowPos(h, -1, 0,0,0,0, 0x0001|0x0002|0x0040)
focus(h, settle=0.8); time.sleep(0.8)
f = os.path.join(OUT, 'look_full.png')
screenshot_screen(f)
im = Image.open(f)
c = os.path.join(OUT, 'look_lower.png')
im.crop((500, 520, 1600, 1010)).save(c)
r = subprocess.run([PY, OCR, 'read', c], capture_output=True, text=True, encoding='utf-8', errors='replace')
t = (r.stdout or '').strip()
open(os.path.join(OUT, 'look_lower.txt'), 'w', encoding='utf-8').write(t)
print('LOWER OCR len =', len(t))
print(t[:1500])
print('...TAIL...')
print(t[-400:])

# 蓝钮检测（限定输入框右下角）
px = im.convert('RGB').load(); W, H = im.size
x0, x1, y0, y1 = 1150, min(1580, W), 700, min(1010, H)
mask = [[False]*(x1-x0) for _ in range(y1-y0)]
for y in range(y0, y1):
    for x in range(x0, x1):
        r_, g_, b_ = px[x, y]
        if b_ > 170 and b_ - r_ > 60 and g_ > 80:
            mask[y-y0][x-x0] = True
seen = [[False]*(x1-x0) for _ in range(y1-y0)]
best = None
for j in range(y1-y0):
    for i in range(x1-x0):
        if mask[j][i] and not seen[j][i]:
            q = deque([(i, j)]); seen[j][i] = True; pts = []
            while q:
                ci, cj = q.popleft(); pts.append((ci, cj))
                for di, dj in ((1,0),(-1,0),(0,1),(0,-1)):
                    ni, nj = ci+di, cj+dj
                    if 0 <= ni < x1-x0 and 0 <= nj < y1-y0 and mask[nj][ni] and not seen[nj][ni]:
                        seen[nj][ni] = True; q.append((ni, nj))
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            w = max(xs)-min(xs)+1; hh = max(ys)-min(ys)+1
            fill = len(pts)/float(w*hh)
            if 700 <= len(pts) <= 5000 and abs(w-hh) <= 14 and fill > 0.5:
                if best is None or len(pts) > best[0]:
                    best = (len(pts), sum(xs)/len(xs)+x0, sum(ys)/len(ys)+y0, w, hh, round(fill,2))
print('蓝钮候选 =', best)
