# -*- coding: utf-8 -*-
"""注入可用性决定性测试：Ctrl+M（模型浮层）前后截图 diff。
diff 大 = SendInput 注入真生效（浮层出来了），随后再按 Ctrl+M 关掉。"""
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


def chord(mod, vk):
    n = key(mod); time.sleep(0.05); n += key(vk); time.sleep(0.05)
    n += key(vk, up=True); time.sleep(0.05); n += key(mod, up=True)
    return n


h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.5)
print('fg =', win32gui.GetForegroundWindow(), 'want =', h, flush=True)
print('ui.send_vk(0x0D) probe =', ui.send_vk(0x0D), flush=True)

p0 = OUT + '/inj_A.png'
ui.screenshot(p0); time.sleep(1.0)
print('ctrl+M n =', chord(0x11, 0x4D), flush=True)
time.sleep(2.0)
p1 = OUT + '/inj_B.png'
ui.screenshot(p1); time.sleep(0.8)

ia = Image.open(p0).convert('RGB'); ib = Image.open(p1).convert('RGB')
d = ImageChops.difference(ia, ib).convert('L')
print('ctrlM diff =', sum(d.histogram()[16:]), 'bbox =', d.getbbox(), flush=True)

# 关掉浮层（Esc + 再 Ctrl+M）
chord(0x11, 0x4D); time.sleep(0.6)
print('closed overlay', flush=True)
