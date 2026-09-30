# -*- coding: utf-8 -*-
"""定点实验：把 composer 点聚焦后，逐个试「Shift+Insert / Ctrl+V / 直接打字」，
diff 区域取 composer 全宽（含最左插入点）。目的：找出哪条通道真的能把文本送进去。"""
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


def k(vk, up=False):
    return one(INP(type=1, u=IU(ki=KI(vk, 0, 0x0002 if up else 0, 0, None))))


def tap(vk, d=0.08):
    n = k(vk); time.sleep(d); n += k(vk, up=True); time.sleep(d); return n


def si_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.4)
    n = 0
    for f in (0x0002, 0x0004):
        n += one(INP(type=0, u=IU(mi=MI(0, 0, 0, f, 0, None)))); time.sleep(0.12)
    return n


def grab(p):
    ImageGrab.grab().save(p); return p


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

# composer 全宽比对区（左端含插入点）
BOX = (L + 360, B - 95, R - 240, B - 8)
print('BOX =', BOX, flush=True)


def diff(a, b):
    ia = Image.open(a).convert('RGB').crop(BOX); ib = Image.open(b).convert('RGB').crop(BOX)
    dd = ImageChops.difference(ia, ib).convert('L')
    return sum(dd.histogram()[16:]), dd.getbbox()


CX, CY = 700, 958
base = grab(OUT + '/x0_placeholder.png'); time.sleep(0.4)

print('--- 1) 点击 composer 本身是否产生变化（光标/聚焦环）---')
si_click(CX, CY); time.sleep(1.2)
p = grab(OUT + '/x1_clicked.png')
print('   click-only diff =', diff(base, p), flush=True)

print('--- 2) Shift+Insert ---')
ui.set_clipboard('MK7TEST-ZZ')
time.sleep(0.4)
k(0x10); time.sleep(0.08); tap(0x2D); k(0x10, up=True); time.sleep(2.0)
p2 = grab(OUT + '/x2_shiftins.png')
print('   shift+insert diff =', diff(p, p2), flush=True)

print('--- 3) 清空后 Ctrl+V ---')
k(0x11); time.sleep(0.08); tap(0x41); k(0x11, up=True); time.sleep(0.4)
tap(0x2E); tap(0x2E); time.sleep(0.9)
p3a = grab(OUT + '/x3a_cleared.png'); time.sleep(0.4)
ui.set_clipboard('MK7TEST-ZZ'); time.sleep(0.4)
k(0x11); time.sleep(0.08); tap(0x56); k(0x11, up=True); time.sleep(2.0)
p3 = grab(OUT + '/x3_ctrlv.png')
print('   ctrl+v diff =', diff(p3a, p3), flush=True)

print('--- 4) 清空后直接打字（Unicode 注入 "AB12"）---')
k(0x11); time.sleep(0.08); tap(0x41); k(0x11, up=True); time.sleep(0.4)
tap(0x2E); tap(0x2E); time.sleep(0.9)
p4a = grab(OUT + '/x4a_cleared.png'); time.sleep(0.4)
for ch in 'AB12':
    one(INP(type=1, u=IU(ki=KI(0, ord(ch), 0x0004, 0, None)))); time.sleep(0.04)
    one(INP(type=1, u=IU(ki=KI(0, ord(ch), 0x0004 | 0x0002, 0, None)))); time.sleep(0.06)
time.sleep(1.6)
p4 = grab(OUT + '/x4_typed.png')
print('   typing diff =', diff(p4a, p4), flush=True)

print('--- 5) 清空后 VK 打字（真实按键 A/B）---')
k(0x11); time.sleep(0.08); tap(0x41); k(0x11, up=True); time.sleep(0.4)
tap(0x2E); tap(0x2E); time.sleep(0.9)
p5a = grab(OUT + '/x5a_cleared.png'); time.sleep(0.4)
tap(0x41); tap(0x42); time.sleep(1.6)
p5 = grab(OUT + '/x5_vk.png')
print('   vk typing diff =', diff(p5a, p5), flush=True)
