# -*- coding: utf-8 -*-
"""实验：验证「点击 → 键盘输入」是否真的落到 InsCode 输入框（像素 diff 判据）。

判据：点击后发一个可见字符 'x'，输入行区域像素必须变化；不变化 = 焦点没进输入框。
"""
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
    n = key(vk); time.sleep(0.08); n += key(vk, up=True)
    return n


def mouse_click(x, y, hold=0.45):
    win32api.SetCursorPos((x, y)); time.sleep(hold)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.08)
    return n


def shot(name):
    p = OUT + '/' + name
    ui.screenshot(p)
    return p


def diff_region(a, b, box):
    ia = Image.open(a).convert('RGB').crop(box)
    ib = Image.open(b).convert('RGB').crop(box)
    d = ImageChops.difference(ia, ib)
    return sum(d.convert('L').point(lambda v: 1 if v > 12 else 0).getdata())


h = ui.find_inscode()
print('hwnd', h, win32gui.GetWindowRect(h), flush=True)
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e, flush=True)
time.sleep(1.2)

BOX = (660, 1005, 1520, 1055)   # 输入框文本行
for cand in [(743, 1032), (1000, 1032), (743, 1040), (900, 1020)]:
    a = shot('h_a.png'); time.sleep(1.0)
    n = mouse_click(*cand)
    time.sleep(0.9)
    t = tap(0x58)   # 'x'
    time.sleep(1.2)
    b = shot('h_b.png'); time.sleep(0.8)
    d = diff_region(a, b, BOX)
    print('click %s  clickN=%d  tapN=%d  pixdiff=%d' % (cand, n, t, d), flush=True)
    # 清理
    tap(0x41) if False else None
    key(0x11); time.sleep(0.06); tap(0x41); key(0x11, up=True); time.sleep(0.3)
    tap(0x2E)
    time.sleep(0.6)
    if d > 50:
        print('FOCUS-OK at', cand, flush=True)
        break
else:
    print('FOCUS-FAILED-ALL', flush=True)
