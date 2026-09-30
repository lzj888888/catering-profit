# -*- coding: utf-8 -*-
"""终极判别：鼠标点击对 InsCode 到底有没有效（点侧栏「搜索」/「插件」+ 窗口缩放重排）。"""
import ctypes, sys, time
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()
from ctypes import wintypes
import win32gui, win32con, win32api, win32process
sys.path.insert(0, r'C:/Users/lzj/.workbuddy/skills/inscode-desktop-feed/scripts')
import inscode_ui as ui
from PIL import Image, ImageGrab, ImageChops

OUT = r'C:/Users/lzj/WorkBuddy/Claw/catering-profit/review/evidence/r181h_m317'
ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class MI(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class IU(ctypes.Union):
    _fields_ = [("mi", MI)]


class INP(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", IU)]


SI = ctypes.windll.user32.SendInput
SI.restype = wintypes.UINT


def si_click(x, y):
    win32api.SetCursorPos((x, y)); time.sleep(0.4)
    n = 0
    for f in (0x0002, 0x0004):
        n += SI(1, ctypes.byref(INP(type=0, u=IU(mi=MI(0, 0, 0, f, 0, None)))), ctypes.sizeof(INP))
        time.sleep(0.12)
    return n


h = ui.find_inscode()
win32gui.ShowWindow(h, win32con.SW_RESTORE); time.sleep(0.5)
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(1.0)
try:
    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
    win32gui.SetForegroundWindow(h)
    win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
except Exception:
    pass
time.sleep(1.5)
L, T, R, B = win32gui.GetWindowRect(h)
print('LTRB =', (L, T, R, B), flush=True)
BOX = (L, T, R, B)


def g(p):
    ImageGrab.grab().save(p); return p


def d(a, b):
    ia = Image.open(a).convert('RGB').crop(BOX); ib = Image.open(b).convert('RGB').crop(BOX)
    dd = ImageChops.difference(ia, ib).convert('L')
    return sum(dd.histogram()[12:]), dd.getbbox()


p0 = g(OUT + '/y0.png'); time.sleep(0.4)
for label, (x, y) in [('搜索', (60, 133)), ('插件', (60, 65)), ('新建任务', (60, 32)), ('会话项', (100, 180))]:
    p1 = g(OUT + '/y_before_%s.png' % label); time.sleep(0.3)
    n = si_click(x, y); time.sleep(1.5)
    p2 = g(OUT + '/y_after_%s.png' % label)
    print('点「%s」(%d,%d) ret=%d  diff=%s' % (label, x, y, n, d(p1, p2)), flush=True)
    time.sleep(0.3)

print()
print('=== 窗口缩放重排测试（活体会重排；冻体会留残影/黑块）===')
p3 = g(OUT + '/y_before_resize.png'); time.sleep(0.4)
win32gui.MoveWindow(h, 20, 20, 1100, 760, True); time.sleep(1.8)
g(OUT + '/y_small.png')
win32gui.MoveWindow(h, 20, 20, 1620, 1000, True); time.sleep(1.8)
g(OUT + '/y_restored.png')
print('resize ok', flush=True)

print()
print('=== InsCode 进程树 CPU 时间（判冻）===')
import subprocess
out = subprocess.run(['powershell', '-NoProfile', '-Command',
                      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'inscode|msedgewebview2' } | "
                      "Select-Object ProcessId,ParentProcessId,Name,UserModeTime | ConvertTo-Csv -NoTypeInformation"],
                     capture_output=True, text=True, timeout=60)
print(out.stdout[:2000] or out.stderr[:500], flush=True)
