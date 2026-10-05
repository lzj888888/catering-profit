# -*- coding: utf-8 -*-
import sys, os, time, ctypes, subprocess
from PIL import Image
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32
wb = find_window(title='WorkBuddy')
if wb: u.SetWindowPos(wb, -2, 0,0,0,0, 0x0001|0x0002|0x0010)
h = [x for x in find_windows(title='豆包') if rect(x)[2]-rect(x)[0] > 1000][0]
u.ShowWindow(h, 9); time.sleep(0.4)
u.SetWindowPos(h, -1, 0,0,0,0, 0x0001|0x0002|0x0040)
focus(h, settle=0.8); time.sleep(0.8)
print('rect =', rect(h), 'fg_ok =', u.GetForegroundWindow()==h)
full = os.path.join(OUT, 'diag_full.png')
screenshot_screen(full)
print('shot', os.path.getsize(full))
# 用 ocr find 定位输入框占位符
for kw in ['发消息', '消息或按', '按住空格', '任意']:
    r = subprocess.run([PY, OCR, 'find', full, kw], capture_output=True, text=True, encoding='utf-8', errors='replace')
    print('FIND %-8s ->' % kw, (r.stdout or '').strip()[:300])
# 底部区域放大保存，供目视
crop = os.path.join(OUT, 'diag_bottom.png')
Image.open(full).crop((500, 820, 1600, 1010)).resize((2200, 380)).save(crop)
print('bottom crop saved:', crop)
