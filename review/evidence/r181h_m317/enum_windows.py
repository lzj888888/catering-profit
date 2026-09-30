# -*- coding: utf-8 -*-
"""枚举所有顶层窗口，挑出 InsCode 相关（class/title/rect/可见/最小化）。
同时比较两张截图的全图差异，判「截图是否新鲜」。"""
import ctypes
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
import win32gui
from PIL import Image, ImageChops
import sys, os

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'

rows = []


def cb(h, _):
    if not win32gui.IsWindowVisible(h):
        return True
    t = win32gui.GetWindowText(h)
    c = win32gui.GetClassName(h)
    r = win32gui.GetWindowRect(h)
    pid = ctypes.c_ulong()
    ctypes.windll.user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
    low = (t + ' ' + c).lower()
    if 'inscode' in low or 'tauri' in c.lower() or (r[2] - r[0]) > 800:
        rows.append((h, c, t[:70], r, pid.value, win32gui.IsIconic(h)))
    return True


win32gui.EnumWindows(cb, 0)
for h, c, t, r, pid, icon in rows:
    print('hwnd=%-8d pid=%-7d iconic=%s rect=%s\n   class=%s\n   title=%s' % (h, pid, icon, r, c, t))

print('\n--- 截图新鲜度 ---')
for a, b in [('n0_before.png', 'n1_pasted.png'), ('probe_A0.png', 'probe_B4.png'),
             ('probe_A0.png', 'probe_A4.png')]:
    pa, pb = OUT + '/' + a, OUT + '/' + b
    if not (os.path.exists(pa) and os.path.exists(pb)):
        print(a, b, 'MISSING'); continue
    ia = Image.open(pa).convert('RGB'); ib = Image.open(pb).convert('RGB')
    # 任务栏时钟区
    ca = ia.crop((1600, 1050, 1780, 1080)); cb2 = ib.crop((1600, 1050, 1780, 1080))
    clock = sum(ImageChops.difference(ca, cb2).convert('L').histogram()[8:])
    full = sum(ImageChops.difference(ia, ib).convert('L').histogram()[8:])
    print('%-16s vs %-16s  clock_diff=%-8d full_diff=%d' % (a, b, clock, full))
