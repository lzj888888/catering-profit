# -*- coding: utf-8 -*-
"""诊断：在输入框区做多点「点击→打字→像素 diff」探测，找出能真正聚焦的落点。
只打字（不发送），每点试完立刻 Ctrl+A + Del 清空。
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
from PIL import Image, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
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


def kd(vk, up=False):
    return _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(vk, 0, 0x0002 if up else 0, 0, None))))


def tap(vk, d=0.08):
    n = kd(vk); time.sleep(d); n += kd(vk, up=True); time.sleep(d); return n


def uni(ch):
    """Unicode 字符注入（不依赖键盘布局）。"""
    n = _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(0, ord(ch), 0x0004, 0, None))))
    time.sleep(0.03)
    n += _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(0, ord(ch), 0x0004 | 0x0002, 0, None))))
    time.sleep(0.05)
    return n


def click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.45)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.12)
    return n


def clear_box():
    kd(0x11); time.sleep(0.06); tap(0x41); kd(0x11, up=True); time.sleep(0.35)
    tap(0x2E); tap(0x2E); time.sleep(0.8)


h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.5)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(1.0)
win32gui.SetWindowPos(h, -1, 20, 20, 1620, 1000, 0x0040); time.sleep(0.7)
win32gui.SetWindowPos(h, -2, 20, 20, 1620, 1000, 0x0040); time.sleep(0.3)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception as e:
    print('fg err', e, flush=True)
time.sleep(1.5)
L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), 'fg =', win32gui.GetForegroundWindow(), flush=True)

BOX = (L + 520, B - 118, R - 250, B - 5)   # 输入框整体（含工具栏行）
print('diff BOX =', BOX, flush=True)


def diff_in_box(a, b):
    ia = Image.open(a).convert('RGB').crop(BOX)
    ib = Image.open(b).convert('RGB').crop(BOX)
    dd = ImageChops.difference(ia, ib).convert('L')
    return sum(dd.histogram()[16:]), dd.getbbox()


base = OUT + '/f0_base.png'
ui.screenshot(base); time.sleep(0.8)

CANDS = [(700, 930), (700, 940), (700, 950), (620, 935), (900, 935), (760, 925)]
best = None
for i, (x, y) in enumerate(CANDS):
    click(x, y)
    time.sleep(0.5)
    uni('A'); uni('1'); time.sleep(0.9)
    p = OUT + '/f_%d_%d_%d.png' % (i, x, y)
    ui.screenshot(p); time.sleep(0.5)
    d, bb = diff_in_box(base, p)
    ok = d > 50
    print('cand#%d (%d,%d) diff=%d bbox=%s  %s' % (i, x, y, d, bb, 'HIT' if ok else '-'), flush=True)
    if ok and best is None:
        best = (x, y, d)
    clear_box()
    ui.screenshot(OUT + '/f_%d_cleared.png' % i); time.sleep(0.4)

print('BEST =', best, flush=True)
