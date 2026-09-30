# -*- coding: utf-8 -*-
"""诊断：注入通道是否全局可用（Win+R 运行框）+ InsCode 是否响应鼠标点击。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
from ctypes import wintypes
import win32gui, win32con, win32api
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


def si_key(vk, up=False):
    return one(INP(type=1, u=IU(ki=KI(vk, 0, 0x0002 if up else 0, 0, None))))


def si_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.4)
    n = 0
    for f in (0x0002, 0x0004):
        n += one(INP(type=0, u=IU(mi=MI(0, 0, 0, f, 0, None)))); time.sleep(0.12)
    return n


def grab(name):
    p = OUT + '/' + name
    ImageGrab.grab().save(p)
    return p


def full_diff(a, b):
    ia = Image.open(a).convert('RGB'); ib = Image.open(b).convert('RGB')
    dd = ImageChops.difference(ia, ib).convert('L')
    return sum(dd.histogram()[10:]), dd.getbbox()


print('=== 测试1：SendInput 发 Win+R（全局）===')
p0 = grab('i0_before.png'); time.sleep(0.5)
n1 = si_key(0x5B)            # LWIN down
time.sleep(0.12)
n2 = si_key(0x52)            # R
time.sleep(0.12)
si_key(0x52, up=True)
si_key(0x5B, up=True)
print('SendInput ret =', (n1, n2), flush=True)
time.sleep(2.2)
p1 = grab('i1_winr.png')
d, bb = full_diff(p0, p1)
print('Win+R 后 全屏变化 =', d, 'bbox =', bb, flush=True)
# 有运行框则存在 #32770 类窗口
found = []
win32gui.EnumWindows(lambda h, l: found.append((h, win32gui.GetClassName(h), win32gui.GetWindowText(h))) or True, None)
run = [x for x in found if x[1] == '#32770' and '运行' in x[2]]
print('运行框窗口 =', run, flush=True)
si_key(0x1B); time.sleep(0.8)   # Esc 关掉
if run:
    print('>>> 结论：SendInput 全局可用，注入通道没断', flush=True)
else:
    print('>>> 结论：SendInput 无效（或 Win+R 被拦）', flush=True)

print()
print('=== 测试2：鼠标点击 InsCode 模型芯片 (1245,977) ===')
h = None
try:
    sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
    import inscode_ui as ui
    h = ui.find_inscode()
except Exception as e:
    print('find err', e)
if h:
    win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.4)
    win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(1.0)
    L, T, R, B = win32gui.GetWindowRect(h)
    p2 = grab('i2_before_click.png'); time.sleep(0.5)
    print('click ret =', si_click(1245, 977), flush=True)
    time.sleep(1.8)
    p3 = grab('i3_after_chip.png')
    ia = Image.open(p2).convert('RGB').crop((L, T, R, B))
    ib = Image.open(p3).convert('RGB').crop((L, T, R, B))
    dd = ImageChops.difference(ia, ib).convert('L')
    print('点模型芯片后 窗口区变化 =', sum(dd.histogram()[10:]), 'bbox =', dd.getbbox(), flush=True)
    si_key(0x1B); time.sleep(0.6)

print()
print('=== 测试3：点会话侧栏 (200,300) ===')
if h:
    p4 = grab('i4_before_side.png'); time.sleep(0.5)
    print('click ret =', si_click(200, 300), flush=True)
    time.sleep(1.8)
    p5 = grab('i5_after_side.png')
    ia = Image.open(p4).convert('RGB').crop((L, T, R, B))
    ib = Image.open(p5).convert('RGB').crop((L, T, R, B))
    dd = ImageChops.difference(ia, ib).convert('L')
    print('点侧栏后 窗口区变化 =', sum(dd.histogram()[10:]), 'bbox =', dd.getbbox(), flush=True)
