# -*- coding: utf-8 -*-
"""清空 InsCode 输入框并双帧校验（对抗"截图旧帧"）。"""
import ctypes, sys, time, subprocess
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181f_m320_feed'
PY = r'C:/Users/lzj/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
OCR = r'C:/Users/lzj/.workbuddy/skills/win-desktop-control/scripts/ocr_screen.py'

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


def tap(vk, d=0.07):
    n = key(vk); time.sleep(d); n += key(vk, up=True); return n


def mouse_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.4)
    n = 0
    for f in (0x0002, 0x0004):
        n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None)))); time.sleep(0.07)
    return n


def triple_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.35)
    n = 0
    for i in range(3):
        for f in (0x0002, 0x0004):
            n += _one(INPUT(type=0, u=_IU(mi=MOUSEINPUT(0, 0, 0, f, 0, None))))
        time.sleep(0.05)
    return n


def shot(name):
    p = OUT + '/' + name
    ui.screenshot(p)
    return p


def ocr(png, kw):
    r = subprocess.run([PY, OCR, 'find', png, kw], capture_output=True, text=True, errors='replace')
    return r.stdout.strip()


def placeholder_present():
    p = shot('c_probe.png')
    time.sleep(1.0)
    p2 = shot('c_probe2.png')
    time.sleep(0.8)
    o1 = ocr(p, '描述你的任务')
    o2 = ocr(p2, '描述你的任务')
    return ('HIT' in o1), ('HIT' in o2), o1, o2


h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.2)

print('before: placeholder?', placeholder_present(), flush=True)

for attempt in range(3):
    print('--- attempt %d ---' % (attempt + 1), flush=True)
    print('triple-click n =', triple_click(743, 1032), flush=True)
    time.sleep(0.6)
    tap(0x2E); time.sleep(0.15); tap(0x2E); time.sleep(0.6)
    # 兜底：Home 后连按 Backspace 若干（清多行的头）
    tap(0x24); time.sleep(0.2)   # Home
    for _ in range(40):
        tap(0x08, 0.01)
    time.sleep(0.8)
    res = placeholder_present()
    print('after: placeholder?', res, flush=True)
    if res[0] and res[1]:
        print('CLEARED', flush=True)
        break
else:
    print('CLEAR-FAILED', flush=True)
