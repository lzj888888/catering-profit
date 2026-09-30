# -*- coding: utf-8 -*-
"""清空 InsCode composer：Esc 关输入法候选 → 点框 → 三连击全选 → Del/Backspace。
带前后像素对比，判据=composer 区是否变化。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
from ctypes import wintypes
import win32gui, win32con, win32api
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image, ImageGrab, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class MI(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KI(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class IU(ctypes.Union):
    _fields_ = [("mi", MI), ("ki", KI)]


class INP(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", IU)]


SI = ctypes.windll.user32.SendInput
SI.restype = wintypes.UINT


def one(i):
    return SI(1, ctypes.byref(i), ctypes.sizeof(INP))


def kd(vk, up=False):
    return one(INP(type=1, u=IU(ki=KI(vk, 0, 0x0002 if up else 0, 0, None))))


def mdown():
    return one(INP(type=0, u=IU(mi=MI(0, 0, 0, 0x0002, 0, None))))


def mup():
    return one(INP(type=0, u=IU(mi=MI(0, 0, 0, 0x0004, 0, None))))


def click(x, y, n=1, gap=0.06):
    win32api.SetCursorPos((x, y)); time.sleep(0.35)
    for _ in range(n):
        mdown(); time.sleep(gap); mup(); time.sleep(gap)


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
L, T, R, B = win32gui.GetWindowRect(h)
BOX = (L + 450, B - 95, R - 200, B - 40)
print('BOX =', BOX, flush=True)


def crop_save(tag):
    p = OUT + '/%s.png' % tag
    ImageGrab.grab().save(p)
    Image.open(p).convert('RGB').crop(BOX).resize(((BOX[2] - BOX[0]) * 2, (BOX[3] - BOX[1]) * 2),
                                                  Image.LANCZOS).save(OUT + '/%s_crop.png' % tag)
    return p


def d(a, b):
    ia = Image.open(a).convert('RGB').crop(BOX); ib = Image.open(b).convert('RGB').crop(BOX)
    dd = ImageChops.difference(ia, ib).convert('L')
    return sum(dd.histogram()[16:])


# ① 先发 Esc 关掉可能存在的输入法候选
kd(0x1B); time.sleep(0.06); kd(0x1B, up=True); time.sleep(0.7)
p0 = crop_save('bx0_esc')
print('after esc saved', flush=True)

# ② 三连击选中
click(600, 945, n=3, gap=0.05)
time.sleep(0.7)
p1 = crop_save('bx1_triple')
print('triple-click diff vs esc =', d(p0, p1), flush=True)

# ③ 删
kd(0x2E); time.sleep(0.07); kd(0x2E, up=True); time.sleep(0.3)
for _ in range(6):
    kd(0x08); time.sleep(0.06); kd(0x08, up=True); time.sleep(0.12)
time.sleep(1.0)
p2 = crop_save('bx2_deleted')
print('delete diff vs triple =', d(p1, p2), flush=True)
print('DONE', flush=True)
