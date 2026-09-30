# -*- coding: utf-8 -*-
"""把 InsCode 归位 + 钉最前 + 全屏截图。用法: python -u ic_front.py <tag>"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image, ImageGrab

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
tag = sys.argv[1] if len(sys.argv) > 1 else 'front'

h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.5)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(1.0)
win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 20, 20, 1620, 1000, 0x0040); time.sleep(0.8)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e, flush=True)
time.sleep(1.6)

fg = win32gui.GetForegroundWindow()
print('InsCode hwnd =', h, '| fg =', fg, '| fg title =', repr(win32gui.GetWindowText(fg)), flush=True)


def top_at(x, y):
    hw = ctypes.windll.user32.WindowFromPoint(wintypes.POINT(x, y))
    if not hw:
        return None, None
    r = win32gui.GetAncestor(hw, win32con.GA_ROOT)
    return r, win32gui.GetWindowText(r)


for pt in [(700, 955), (860, 500), (1340, 981)]:
    r, t = top_at(*pt)
    print('  topmost at %s -> hwnd=%s title=%r %s' % (pt, r, t, '<= InsCode' if r == h else ''), flush=True)

L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), flush=True)
ImageGrab.grab().save(OUT + '/%s_full.png' % tag)
im = Image.open(OUT + '/%s_full.png' % tag)
im.resize((960, 540), Image.LANCZOS).save(OUT + '/%s_small.png' % tag)
print('saved %s_full.png / %s_small.png' % (tag, tag), flush=True)
