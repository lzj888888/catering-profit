# -*- coding: utf-8 -*-
"""R224 探针：找豆包主窗 -> 还原 -> 置前 -> 截图 -> OCR 对话区尾部"""
import sys, os, time, ctypes, subprocess
from PIL import Image
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts')
from win_gui import *

PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'
OUT = r'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_r224_doubao'
u = ctypes.windll.user32

print('=== 所有含「豆包」的窗口 ===')
for h in find_windows(title='豆包'):
    print('  hwnd=%s rect=%s w=%d title=%r' % (h, rect(h), rect(h)[2]-rect(h)[0], get_title(h) if hasattr(sys.modules[__name__],'get_title') else ''))

cands = [x for x in find_windows(title='豆包') if rect(x)[2] - rect(x)[0] > 1000]
print('主窗候选 =', cands)
if not cands:
    print('NO_DOUBAO_MAIN'); sys.exit(2)
h = cands[0]

wb = find_window(title='WorkBuddy')
if wb:
    u.SetWindowPos(wb, -2, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
u.ShowWindow(h, 9); time.sleep(0.8)
print('after SW_RESTORE rect =', rect(h))
u.SetWindowPos(h, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)
focus(h, settle=0.8); time.sleep(1.0)
fg = u.GetForegroundWindow()
print('fg=%s equal=%s' % (fg, fg == h))
print('hwnd=%s rect=%s' % (h, rect(h)))

full = os.path.join(OUT, 'p0_full.png')
screenshot_screen(full)
print('shot bytes =', os.path.getsize(full))
crop = os.path.join(OUT, 'p0_conv.png')
Image.open(full).crop((500, 55, 1545, 830)).save(crop)
r = subprocess.run([PY, OCR, 'read', crop], capture_output=True, text=True, encoding='utf-8', errors='replace')
t = (r.stdout or '').strip()
open(os.path.join(OUT, 'p0_conv.txt'), 'w', encoding='utf-8').write(t)
print('CONV_LEN =', len(t))
print('CONV_TAIL:', t[-600:])
# 输入框区
crop2 = os.path.join(OUT, 'p0_inbox.png')
Image.open(full).crop((500, 830, 1580, 1010)).save(crop2)
r2 = subprocess.run([PY, OCR, 'read', crop2], capture_output=True, text=True, encoding='utf-8', errors='replace')
print('INBOX:', repr((r2.stdout or '').strip()[:200]))
