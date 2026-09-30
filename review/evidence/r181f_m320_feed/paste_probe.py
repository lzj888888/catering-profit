# -*- coding: utf-8 -*-
"""对照实验：验证 Ctrl+V 是否被 InsCode 接收（打字 vs 粘贴）。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181f_m320_feed'
BOX = (660, 1005, 1520, 1055)
ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class _IU(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _IU)]


_SI = ctypes.windll.user32.SendInput
_SI.restype = wintypes.UINT


def _one(i):
    return _SI(1, ctypes.byref(i), ctypes.sizeof(INPUT))


def key(vk, up=False):
    return _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(vk, 0, 0x0002 if up else 0, 0, None))))


def tap(vk):
    n = key(vk); time.sleep(0.07); n += key(vk, up=True); return n


def mouse_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.45)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.08)
    return n


def shot(name):
    p = OUT + '/' + name
    ui.screenshot(p)
    return p


def diff(a, b):
    ia = Image.open(a).convert('RGB').crop(BOX)
    ib = Image.open(b).convert('RGB').crop(BOX)
    return sum(1 for v in ImageChops.difference(ia, ib).convert('L').tobytes() if v > 12)


def clear():
    key(0x11); time.sleep(0.06); tap(0x41); key(0x11, up=True); time.sleep(0.35)
    tap(0x2E); tap(0x2E); time.sleep(0.7)


h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.2)

# A) 打字 abc
a = shot('p0.png'); time.sleep(1.0)
mouse_click(743, 1032); time.sleep(0.9)
clear()
a = shot('p1_typed_before.png'); time.sleep(0.9)
for vk in (0x41, 0x42, 0x43):
    tap(vk); time.sleep(0.15)
time.sleep(1.2)
b = shot('p2_typed_after.png'); time.sleep(0.8)
print('TYPE  pixdiff =', diff(a, b), flush=True)
clear()

# B) 剪贴板 abc + Ctrl+V
print('clip =', ui.set_clipboard('abc'), ui.get_clipboard(), flush=True)
time.sleep(0.5)
a = shot('p3_paste_before.png'); time.sleep(0.9)
mouse_click(743, 1032); time.sleep(0.9)
key(0x11); time.sleep(0.06); tap(0x56); key(0x11, up=True); time.sleep(1.5)
b = shot('p4_paste_after.png'); time.sleep(0.8)
print('PASTE pixdiff =', diff(a, b), flush=True)

# C) 用 Shift+Insert 粘贴（另一个粘贴通道）
clear()
a = shot('p5_sins_before.png'); time.sleep(0.9)
mouse_click(743, 1032); time.sleep(0.9)
key(0x10); time.sleep(0.06); tap(0x2D); key(0x10, up=True); time.sleep(1.5)
b = shot('p6_sins_after.png'); time.sleep(0.8)
print('SHIFT-INS pixdiff =', diff(a, b), flush=True)
clear()
print('DONE', flush=True)
