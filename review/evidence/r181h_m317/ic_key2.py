# -*- coding: utf-8 -*-
"""钉住 InsCode + 发按键（支持组合键）+ 截图。
用法: python -u ic_key2.py "c-41" "2E" ... -- <tag>
  c-XX = Ctrl+XX   s-XX = Shift+XX   a-XX = Alt+XX   裸 XX = 单键
"""
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
tag = 'k2'
if '--' in argv:
    i = argv.index('--'); tag = argv[i + 1]; argv = argv[:i]
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


def kd(vk, up=False):
    return SI(1, ctypes.byref(INP(type=1, u=IU(ki=KI(vk, 0, 0x0002 if up else 0, 0, None)))), ctypes.sizeof(INP))


MODS = {'c': 0x11, 's': 0x10, 'a': 0x12}


def send_spec(spec):
    if '-' in spec:
        m, key = spec.split('-', 1)
        mod = MODS[m.lower()]
        kd(mod); time.sleep(0.06)
        vk = int(key, 16)
        kd(vk); time.sleep(0.08); kd(vk, up=True)
        kd(mod, up=True); time.sleep(0.2)
    else:
        vk = int(spec, 16)
        kd(vk); time.sleep(0.08); kd(vk, up=True); time.sleep(0.2)


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
for a in argv:
    send_spec(a); print('  sent', a, flush=True)
time.sleep(1.6)
ImageGrab.grab().save(OUT + '/%s_full.png' % tag)
Image.open(OUT + '/%s_full.png' % tag).resize((960, 540), Image.LANCZOS).save(OUT + '/%s_small.png' % tag)
print('saved', tag, flush=True)
