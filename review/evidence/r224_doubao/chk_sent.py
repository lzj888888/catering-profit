# -*- coding: utf-8 -*-
import sys, os, time, ctypes, subprocess
from PIL import Image
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
TAG = sys.argv[1]
u = ctypes.windll.user32
wb = find_window(title='WorkBuddy')
if wb: u.SetWindowPos(wb, -2, 0,0,0,0, 0x0001|0x0002|0x0010)
h = [x for x in find_windows(title='豆包') if rect(x)[2]-rect(x)[0] > 1000][0]
u.ShowWindow(h, 9); time.sleep(0.4)
u.SetWindowPos(h, -1, 0,0,0,0, 0x0001|0x0002|0x0040)
focus(h, settle=0.8); time.sleep(0.8)
for _ in range(8):
    scroll(1000, 500, -900); time.sleep(0.3)
time.sleep(1.2)
f = os.path.join(OUT, 'chk_%s_%s.png' % (TAG, time.strftime('%H%M%S')))
screenshot_screen(f)
im = Image.open(f)
c = f + '.low.png'
im.crop((500, 500, 1600, 1010)).save(c)
r = subprocess.run([PY, OCR, 'read', c], capture_output=True, text=True, encoding='utf-8', errors='replace')
t = (r.stdout or '').strip()
print('CHECK OCR len =', len(t))
print(t[:900])
print('...TAIL...')
print(t[-500:])
