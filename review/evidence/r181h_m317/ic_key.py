# -*- coding: utf-8 -*-
"""钉住 InsCode（TOPMOST）+ 发按键 + 截图。用法: python -u ic_key.py <vk1> [<vk2> ...] -- <tag>"""
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
argv = sys.argv[1:]
tag = 'keytag'
if '--' in argv:
    i = argv.index('--'); tag = argv[i + 1]; argv = argv[:i]
vks = [int(a, 16) for a in argv]
print('vks =', [hex(v) for v in vks], flush=True)
ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class KI(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class IU(ctypes.Union):
    _fields_ = [("ki", KI)]


class INP(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", IU)]


SI = ctypes.windll.user32.SendInput
SI.restype = wintypes.UINT


def k(vk, up=False):
    return SI(1, ctypes.byref(INP(type=1, u=IU(ki=KI(vk, 0, 0x0002 if up else 0, 0, None)))), ctypes.sizeof(INP))


h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.3)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(0.8)
win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, 20, 20, 1620, 1000, 0x0040); time.sleep(0.6)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.3)
for v in vks:
    k(v); time.sleep(0.09); k(v, up=True); time.sleep(0.25)
    print('  sent', hex(v), flush=True)
time.sleep(1.8)
ImageGrab.grab().save(OUT + '/%s_full.png' % tag)
im = Image.open(OUT + '/%s_full.png' % tag)
im.resize((960, 540), Image.LANCZOS).save(OUT + '/%s_small.png' % tag)
print('saved', tag, flush=True)
