# -*- coding: utf-8 -*-
"""聚焦探针：逐候选点 点击 → 打 ASCII 'aaa' → 全窗底部 diff。
diff 大 = 该点确实把焦点给了输入框（键盘输入被吃进去了）。"""
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


def key(vk, up=False):
    return _one(INPUT(type=1, u=_IU(ki=KEYBDINPUT(vk, 0, 0x0002 if up else 0, 0, None))))


def tap(vk, d=0.09):
    n = key(vk); time.sleep(d); n += key(vk, up=True); time.sleep(d); return n


def mouse_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.5)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.1)
    return n


h = ui.find_inscode()
print('hwnd =', h, 'metrics =', ctypes.windll.user32.GetSystemMetrics(0),
      ctypes.windll.user32.GetSystemMetrics(1), flush=True)
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
try:
    win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(0.8)
except Exception:
    pass
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.4)
L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), 'fg =', win32gui.GetForegroundWindow(), flush=True)

# 按 r181f 相对偏移(窗口原点 x=80,y=20 时的实测点)换算到本窗口
CANDS = [(1019, 985), (961, 945), (1019, 945), (961, 985),
         (700, 985), (700, 945), (861, 1010), (1200, 985)]


def d(p1, p2, box):
    a = Image.open(p1).convert('RGB').crop(box)
    b = Image.open(p2).convert('RGB').crop(box)
    dd = ImageChops.difference(a, b).convert('L')
    return sum(dd.histogram()[16:]), dd.getbbox()


for i, (cx, cy) in enumerate(CANDS):
    win32api.SetCursorPos((cx, cy)); time.sleep(0.3)
    got = win32api.GetCursorPos()
    n = mouse_click(cx, cy)
    time.sleep(1.0)
    pA = OUT + '/fo_A%d.png' % i
    ui.screenshot(pA); time.sleep(0.8)
    for vk in (0x41, 0x41, 0x41):
        tap(vk)
    time.sleep(1.0)
    pB = OUT + '/fo_B%d.png' % i
    ui.screenshot(pB); time.sleep(0.8)
    ch, bbox = d(pA, pB, (L, max(0, T + 800), R, min(1080, B + 5)))
    print('cand#%d %-14s cur=%-14s click=%d type_diff=%d bbox=%s' % (i, (cx, cy), got, n, ch, bbox), flush=True)
    if ch > 1500:
        print('FOCUS-OK at', (cx, cy), flush=True)
        for _ in range(6):
            tap(0x08)      # 回退键清掉刚打的
        sys.exit(0)

print('FOCUS-NOT-FOUND', flush=True)
sys.exit(5)
