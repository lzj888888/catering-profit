# -*- coding: utf-8 -*-
"""钉住 InsCode（TOPMOST）+ 点一下 + 截图。用法: python -u ic_click.py <x> <y> <tag> [--shiftpos x y]"""
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
x = int(sys.argv[1]); y = int(sys.argv[2]); tag = sys.argv[3]
ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class MI(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class IU(ctypes.Union):
    _fields_ = [("mi", MI)]


class INP(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", IU)]


SI = ctypes.windll.user32.SendInput
SI.restype = wintypes.UINT


def si_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.45)
    n = 0
    for f in (0x0002, 0x0004):
        n += SI(1, ctypes.byref(INP(type=0, u=IU(mi=MI(0, 0, 0, f, 0, None)))), ctypes.sizeof(INP))
        time.sleep(0.12)
    return n


h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(0.9)
win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 20, 20, 1620, 1000, 0x0040); time.sleep(0.7)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.4)
print('click', (x, y), 'ret =', si_click(x, y), flush=True)
time.sleep(1.8)
ImageGrab.grab().save(OUT + '/%s_full.png' % tag)
im = Image.open(OUT + '/%s_full.png' % tag)
im.resize((960, 540), Image.LANCZOS).save(OUT + '/%s_small.png' % tag)
# 顺便裁侧栏放大，便于读会话名
im.crop((20, 120, 400, 1020)).resize((760, 1800), Image.LANCZOS).save(OUT + '/%s_side.png' % tag)
print('saved', tag, flush=True)
